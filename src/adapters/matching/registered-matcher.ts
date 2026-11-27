import AhoCorasick from 'ahocorasick';
import {
  checkScientificBoundary,
  compareOccurrences,
  makeOccurrenceId,
  MATCH_BOUNDARY_POLICY,
  type RegisteredMatcher,
} from '@/domain/extraction';
import { compareCodeUnits, type Expression, type Occurrence } from '@/domain/schema';

interface RawHit {
  start: number;
  end: number;
  surface: string;
  provisionalHyphen: boolean;
  expressions: Expression[];
}

function buildPatternMap(expressions: readonly Expression[]): Map<string, Expression[]> {
  const byPattern = new Map<string, Expression[]>();
  for (const expr of expressions) {
    if (expr.text.length === 0 || expr.text.trim().length === 0) {
      throw new Error(`Empty or blank expression pattern is rejected (expression ${expr.id}).`);
    }
    const bucket = byPattern.get(expr.text);
    if (bucket) {
      bucket.push(expr);
    } else {
      byPattern.set(expr.text, [expr]);
    }
  }
  return byPattern;
}

function groupHitsToOccurrences(hits: readonly RawHit[]): Occurrence[] {
  const bySpan = new Map<
    string,
    {
      start: number;
      end: number;
      surface: string;
      provisionalHyphen: boolean;
      expressionIds: Set<string>;
      conceptIds: Set<string>;
    }
  >();

  for (const hit of hits) {
    const key = `${hit.start}:${hit.end}`;
    let entry = bySpan.get(key);
    if (!entry) {
      entry = {
        start: hit.start,
        end: hit.end,
        surface: hit.surface,
        provisionalHyphen: hit.provisionalHyphen,
        expressionIds: new Set<string>(),
        conceptIds: new Set<string>(),
      };
      bySpan.set(key, entry);
    } else if (hit.provisionalHyphen) {
      entry.provisionalHyphen = true;
    }

    for (const expr of hit.expressions) {
      entry.expressionIds.add(expr.id);
      entry.conceptIds.add(expr.conceptId);
    }
  }

  const occurrences: Occurrence[] = [];
  for (const entry of bySpan.values()) {
    const expressionIds = Array.from(entry.expressionIds).sort(compareCodeUnits);
    const conceptIds = Array.from(entry.conceptIds).sort(compareCodeUnits);

    let state: Occurrence['state'];
    let resolvedConceptId: string | null = null;

    if (conceptIds.length > 1) {
      state = 'ambiguous';
      resolvedConceptId = null;
    } else if (entry.provisionalHyphen) {
      state = 'possible-new-form';
      resolvedConceptId = null;
    } else {
      state = 'known-form';
      resolvedConceptId = conceptIds.length === 1 ? conceptIds[0] : null;
    }

    occurrences.push({
      id: makeOccurrenceId(entry.start, entry.end),
      start: entry.start,
      end: entry.end,
      surface: entry.surface,
      expressionIds,
      conceptIds,
      state,
      resolvedConceptId,
    });
  }

  return occurrences.sort(compareOccurrences);
}

interface CompiledIndex {
  automaton: AhoCorasick;
  byPattern: Map<string, Expression[]>;
}

function compileIndex(expressions: readonly Expression[]): CompiledIndex {
  const byPattern = buildPatternMap(expressions);
  const patterns = Array.from(byPattern.keys());
  const automaton = new AhoCorasick(patterns);
  return { automaton, byPattern };
}

function executeCompiledSearch(text: string, index: CompiledIndex): Occurrence[] {
  if (text.length === 0 || index.byPattern.size === 0) {
    return [];
  }

  const rawResults = index.automaton.search(text);
  const hits: RawHit[] = [];

  for (const [endInclusive, matchedPatterns] of rawResults) {
    const end = endInclusive + 1;
    for (const pattern of matchedPatterns) {
      const start = end - pattern.length;
      if (start < 0 || end > text.length) continue;

      const slice = text.slice(start, end);
      if (slice !== pattern) {
        throw new Error(
          `Registered matcher slice mismatch at [${start}, ${end}): expected "${pattern}", observed "${slice}".`,
        );
      }

      const boundary = checkScientificBoundary(text, start, end);
      if (!boundary.allowed) continue;

      const exprs = index.byPattern.get(pattern);
      if (!exprs || exprs.length === 0) continue;

      hits.push({
        start,
        end,
        surface: slice,
        provisionalHyphen: boundary.provisionalHyphen,
        expressions: exprs,
      });
    }
  }

  return groupHitsToOccurrences(hits);
}

export class AhoCorasickRegisteredMatcher implements RegisteredMatcher {
  async match(text: string, expressions: readonly Expression[]): Promise<Occurrence[]> {
    const byPattern = buildPatternMap(expressions);
    if (text.length === 0 || byPattern.size === 0) {
      return [];
    }
    const index: CompiledIndex = {
      automaton: new AhoCorasick(Array.from(byPattern.keys())),
      byPattern,
    };
    return executeCompiledSearch(text, index);
  }
}

export class SimpleOracleRegisteredMatcher implements RegisteredMatcher {
  async match(text: string, expressions: readonly Expression[]): Promise<Occurrence[]> {
    const byPattern = buildPatternMap(expressions);
    if (text.length === 0 || byPattern.size === 0) {
      return [];
    }

    const hits: RawHit[] = [];
    for (const [pattern, exprs] of byPattern.entries()) {
      let searchFrom = 0;
      while (searchFrom <= text.length - pattern.length) {
        const start = text.indexOf(pattern, searchFrom);
        if (start === -1) break;
        const end = start + pattern.length;
        const slice = text.slice(start, end);
        const boundary = checkScientificBoundary(text, start, end);
        if (boundary.allowed) {
          hits.push({
            start,
            end,
            surface: slice,
            provisionalHyphen: boundary.provisionalHyphen,
            expressions: exprs,
          });
        }
        searchFrom = start + 1;
      }
    }

    return groupHitsToOccurrences(hits);
  }
}

export class RevisionCachedRegisteredMatcher implements RegisteredMatcher {
  private cachedKey: string | null = null;
  private cachedIndex: CompiledIndex | null = null;

  invalidate(): void {
    this.cachedKey = null;
    this.cachedIndex = null;
  }

  async matchForRevision(
    libraryRevision: number,
    text: string,
    expressions: readonly Expression[],
  ): Promise<Occurrence[]> {
    const cacheKey = `${libraryRevision}:${MATCH_BOUNDARY_POLICY}:${expressions.length}`;
    if (this.cachedKey !== cacheKey || !this.cachedIndex) {
      // Validate empty patterns even when text is empty
      const byPattern = buildPatternMap(expressions);
      if (byPattern.size === 0) {
        this.cachedKey = cacheKey;
        this.cachedIndex = { automaton: new AhoCorasick([]), byPattern };
        return [];
      }
      this.cachedIndex = compileIndex(expressions);
      this.cachedKey = cacheKey;
    }

    if (text.length === 0 || this.cachedIndex.byPattern.size === 0) {
      return [];
    }
    return executeCompiledSearch(text, this.cachedIndex);
  }

  async match(text: string, expressions: readonly Expression[]): Promise<Occurrence[]> {
    const index = compileIndex(expressions);
    if (text.length === 0 || index.byPattern.size === 0) {
      return [];
    }
    return executeCompiledSearch(text, index);
  }
}
