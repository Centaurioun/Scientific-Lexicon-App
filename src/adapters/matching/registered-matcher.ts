import AhoCorasick from 'ahocorasick';
import {
  checkScientificBoundary,
  compareOccurrences,
  makeOccurrenceId,
  MATCH_BOUNDARY_POLICY,
  type MatcherOptions,
  type RegisteredMatcher,
} from '@/domain/extraction';
import { compareCodeUnits, type Expression, type Occurrence } from '@/domain/schema';
import {
  DEFAULT_PROCESSING_LIMITS,
  OccurrenceLimitTracker,
} from '@/domain/processing-limits';

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

const MATCH_YIELD_INTERVAL = 2_048;

interface GroupedOccurrence {
  start: number;
  end: number;
  surface: string;
  provisionalHyphen: boolean;
  expressionIds: Set<string>;
  conceptIds: Set<string>;
}

class OccurrenceCollector {
  private readonly bySpan = new Map<string, GroupedOccurrence>();

  constructor(private readonly tracker: OccurrenceLimitTracker) {}

  add(hit: RawHit): void {
    const key = `${hit.start}:${hit.end}`;
    this.tracker.add(hit.start, hit.end);
    let entry = this.bySpan.get(key);
    if (!entry) {
      entry = {
        start: hit.start,
        end: hit.end,
        surface: hit.surface,
        provisionalHyphen: hit.provisionalHyphen,
        expressionIds: new Set<string>(),
        conceptIds: new Set<string>(),
      };
      this.bySpan.set(key, entry);
    } else if (hit.provisionalHyphen) {
      entry.provisionalHyphen = true;
    }

    for (const expr of hit.expressions) {
      entry.expressionIds.add(expr.id);
      entry.conceptIds.add(expr.conceptId);
    }
  }

  toOccurrences(): Occurrence[] {
    const occurrences: Occurrence[] = [];
    for (const entry of this.bySpan.values()) {
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
}

function newTracker(options?: MatcherOptions): OccurrenceLimitTracker {
  return (
    options?.occurrenceTracker ??
    new OccurrenceLimitTracker(DEFAULT_PROCESSING_LIMITS.maxCandidateOccurrences)
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Registered matching was aborted.', 'AbortError');
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

async function executeCompiledSearch(
  text: string,
  index: CompiledIndex,
  options?: MatcherOptions,
): Promise<Occurrence[]> {
  if (text.length === 0 || index.byPattern.size === 0) {
    return [];
  }

  // The dependency's search() materializes every raw match. Walk its compiled
  // transition tables directly so the application can stop at the occurrence
  // bound without constructing an unbounded intermediate results array.
  const machine = index.automaton as unknown as {
    gotoFn: Record<number, Record<string, number>>;
    failure: Record<number, number>;
    output: Record<number, string[]>;
  };
  const collector = new OccurrenceCollector(newTracker(options));
  let state = 0;
  let processed = 0;

  for (let i = 0; i < text.length; i += 1) {
    throwIfAborted(options?.signal);
    const char = text[i];
    while (state > 0 && !(char in machine.gotoFn[state])) {
      state = machine.failure[state];
    }

    if (char in machine.gotoFn[state]) {
      state = machine.gotoFn[state][char];
      const matchedPatterns = machine.output[state] ?? [];
      for (const pattern of matchedPatterns) {
        const end = i + 1;
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

        collector.add({
          start,
          end,
          surface: slice,
          provisionalHyphen: boundary.provisionalHyphen,
          expressions: exprs,
        });
        processed += 1;
        if (processed >= MATCH_YIELD_INTERVAL) {
          processed = 0;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          throwIfAborted(options?.signal);
        }
      }
    }

    if ((i + 1) % MATCH_YIELD_INTERVAL === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      throwIfAborted(options?.signal);
    }
  }

  return collector.toOccurrences();
}

export class AhoCorasickRegisteredMatcher implements RegisteredMatcher {
  async match(
    text: string,
    expressions: readonly Expression[],
    options?: MatcherOptions,
  ): Promise<Occurrence[]> {
    throwIfAborted(options?.signal);
    const byPattern = buildPatternMap(expressions);
    if (text.length === 0 || byPattern.size === 0) {
      return [];
    }
    const index: CompiledIndex = {
      automaton: new AhoCorasick(Array.from(byPattern.keys())),
      byPattern,
    };
    return executeCompiledSearch(text, index, options);
  }
}

export class SimpleOracleRegisteredMatcher implements RegisteredMatcher {
  async match(
    text: string,
    expressions: readonly Expression[],
    options?: MatcherOptions,
  ): Promise<Occurrence[]> {
    throwIfAborted(options?.signal);
    const byPattern = buildPatternMap(expressions);
    if (text.length === 0 || byPattern.size === 0) {
      return [];
    }

    const collector = new OccurrenceCollector(newTracker(options));
    let processed = 0;
    for (const [pattern, exprs] of byPattern.entries()) {
      let searchFrom = 0;
      while (searchFrom <= text.length - pattern.length) {
        const start = text.indexOf(pattern, searchFrom);
        if (start === -1) break;
        const end = start + pattern.length;
        const slice = text.slice(start, end);
        const boundary = checkScientificBoundary(text, start, end);
        if (boundary.allowed) {
          collector.add({
            start,
            end,
            surface: slice,
            provisionalHyphen: boundary.provisionalHyphen,
            expressions: exprs,
          });
          processed += 1;
          if (processed >= MATCH_YIELD_INTERVAL) {
            processed = 0;
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            throwIfAborted(options?.signal);
          }
        }
        searchFrom = start + 1;
      }
    }

    return collector.toOccurrences();
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
    options?: MatcherOptions,
  ): Promise<Occurrence[]> {
    throwIfAborted(options?.signal);
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
    return executeCompiledSearch(text, this.cachedIndex, options);
  }

  async match(
    text: string,
    expressions: readonly Expression[],
    options?: MatcherOptions,
  ): Promise<Occurrence[]> {
    const index = compileIndex(expressions);
    if (text.length === 0 || index.byPattern.size === 0) {
      return [];
    }
    return executeCompiledSearch(text, index, options);
  }
}
