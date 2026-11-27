import { RevisionCachedRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import {
  CANDIDATE_GRAMMAR_VERSION,
  compareOccurrences,
  compareSpans,
  makeOccurrenceId,
  MATCH_BOUNDARY_POLICY,
  type CandidateFilter,
  type CandidateGenerator,
  type CanonicalPos,
  type ExtractionRun,
  type NlpEngine,
  type RegisteredMatcher,
  type Span,
  type Token,
} from '@/domain/extraction';
import type { LibrarySnapshot, Occurrence } from '@/domain/schema';

export const MAX_TXT_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_TEXT_UTF16_LENGTH = 200_000; // 200k UTF-16 code units
export const EXTRACTION_ALGORITHM_VERSION = `${CANDIDATE_GRAMMAR_VERSION}+${MATCH_BOUNDARY_POLICY}`;

const START_POS = new Set<CanonicalPos>(['ADJ', 'NOUN', 'PROPN']);
const END_POS = new Set<CanonicalPos>(['NOUN', 'PROPN']);
const INTERNAL_POS = new Set<CanonicalPos>(['ADJ', 'NOUN', 'PROPN', 'ADP', 'DET']);
const MAX_PHRASE_TOKENS = 8;
const GENERATION_YIELD_INTERVAL = 2_048;

const HAS_LETTER_RE = /\p{L}/u;
const HAS_DIGIT_RE = /\p{N}/u;
const HAS_GREEK_RE = /\p{Script=Greek}/u;
const HAS_SCIENTIFIC_SYMBOL_RE = /[+/]/;
const RAW_SYMBOL_CANDIDATE_RE =
  /[\p{L}\p{M}\p{N}]+(?:(?:[-+/]|,(?=\p{N}))[\p{L}\p{M}\p{N}]+)*\+{0,2}/gu;

export class InputLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputLimitError';
  }
}

export function validateInputText(text: string): void {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new InputLimitError('Input text must not be empty or whitespace-only.');
  }
  if (text.length > MAX_TEXT_UTF16_LENGTH) {
    throw new InputLimitError(
      `Input text exceeds the ${MAX_TEXT_UTF16_LENGTH.toLocaleString('en-US')} UTF-16 character limit (${text.length.toLocaleString('en-US')} provided). Input is rejected rather than truncated.`,
    );
  }
}

function isQualifiedScientificSymbol(surface: string): boolean {
  if (!HAS_LETTER_RE.test(surface)) return false;
  if (HAS_DIGIT_RE.test(surface)) return true;
  if (HAS_GREEK_RE.test(surface)) return true;
  if (HAS_SCIENTIFIC_SYMBOL_RE.test(surface)) return true;
  // Hyphenated form with at least one uppercase letter or Greek marker (e.g. TGF-beta, x-TNF-α)
  if (surface.includes('-') && /\p{Lu}/u.test(surface)) return true;
  return false;
}

export class S1CandidateGenerator implements CandidateGenerator {
  async generate(text: string, tokens: readonly Token[], signal?: AbortSignal): Promise<Span[]> {
    throwIfAborted(signal);
    const bySpan = new Map<string, Span>();

    const addSpan = (start: number, end: number) => {
      if (start < 0 || end <= start || end > text.length) return;
      const surface = text.slice(start, end);
      if (surface.trim().length === 0 || !HAS_LETTER_RE.test(surface)) return;
      const key = `${start}:${end}`;
      if (!bySpan.has(key)) {
        bySpan.set(key, { start, end, surface });
      }
    };

    // 1. Bounded raw scientific-symbol spans first (exact UTF-16 slices)
    const symbolSpans: Span[] = [];
    // Use a per-run regex: yielding below lets independent analyses interleave.
    const rawSymbolCandidateRegex = new RegExp(
      RAW_SYMBOL_CANDIDATE_RE.source,
      RAW_SYMBOL_CANDIDATE_RE.flags,
    );
    let processedSinceYield = 0;
    const checkpoint = async () => {
      processedSinceYield += 1;
      if (processedSinceYield >= GENERATION_YIELD_INTERVAL) {
        processedSinceYield = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        throwIfAborted(signal);
      }
    };

    let match = rawSymbolCandidateRegex.exec(text);
    while (match !== null) {
      const surface = match[0];
      const start = match.index;
      const end = start + surface.length;
      if (isQualifiedScientificSymbol(surface)) {
        addSpan(start, end);
        symbolSpans.push({ start, end, surface });
      }
      await checkpoint();
      match = rawSymbolCandidateRegex.exec(text);
    }

    // Global regex matches are sorted and non-overlapping. Find the last match
    // starting at or before the candidate instead of scanning every symbol.
    const isStrictSubSpanOfSymbol = (start: number, end: number): boolean => {
      let low = 0;
      let high = symbolSpans.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (symbolSpans[middle].start <= start) low = middle + 1;
        else high = middle;
      }
      const symbol = symbolSpans[low - 1];
      return Boolean(
        symbol &&
          symbol.start <= start &&
          end <= symbol.end &&
          (start > symbol.start || end < symbol.end),
      );
    };

    // 2. Deterministic POS noun-phrase grammar (1-8 tokens within a single sentence)
    for (let i = 0; i < tokens.length; i += 1) {
      await checkpoint();
      const startToken = tokens[i];
      if (!START_POS.has(startToken.pos)) continue;

      const sentenceId = startToken.sentenceId;
      const maxEndIndex = Math.min(tokens.length, i + MAX_PHRASE_TOKENS);

      for (let j = i; j < maxEndIndex; j += 1) {
        const curr = tokens[j];
        if (curr.sentenceId !== sentenceId) break;

        if (j > i && !INTERNAL_POS.has(curr.pos)) {
          break;
        }

        if (END_POS.has(curr.pos) && !isStrictSubSpanOfSymbol(startToken.start, curr.end)) {
          addSpan(startToken.start, curr.end);
        }
      }
    }

    throwIfAborted(signal);
    return Array.from(bySpan.values()).sort(compareSpans);
  }
}

export interface AnalyzeTextOptions {
  signal?: AbortSignal;
  candidateGenerator?: CandidateGenerator;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Extraction analysis was aborted.', 'AbortError');
  }
}

export async function analyzeText(
  text: string,
  snapshot: LibrarySnapshot,
  nlp: NlpEngine,
  matcher: RegisteredMatcher,
  options: AnalyzeTextOptions = {},
): Promise<ExtractionRun> {
  throwIfAborted(options.signal);
  validateInputText(text);

  const generator = options.candidateGenerator ?? new S1CandidateGenerator();

  const matchPromise =
    matcher instanceof RevisionCachedRegisteredMatcher
      ? matcher.matchForRevision(snapshot.libraryRevision, text, snapshot.expressions)
      : matcher.match(text, snapshot.expressions);

  const [knownOccurrences, tokens] = await Promise.all([matchPromise, nlp.analyze(text)]);

  throwIfAborted(options.signal);

  const candidateSpans = await generator.generate(text, tokens, options.signal);
  throwIfAborted(options.signal);

  const bySpan = new Map<string, Occurrence>();

  for (const occ of knownOccurrences) {
    bySpan.set(`${occ.start}:${occ.end}`, occ);
  }

  for (const span of candidateSpans) {
    const key = `${span.start}:${span.end}`;
    if (!bySpan.has(key)) {
      bySpan.set(key, {
        id: makeOccurrenceId(span.start, span.end),
        start: span.start,
        end: span.end,
        surface: span.surface,
        expressionIds: [],
        conceptIds: [],
        state: 'new-candidate',
        resolvedConceptId: null,
      });
    }
  }

  const occurrences = Array.from(bySpan.values()).sort(compareOccurrences);

  return {
    id: crypto.randomUUID(),
    text,
    algorithmVersion: EXTRACTION_ALGORITHM_VERSION,
    libraryRevision: snapshot.libraryRevision,
    occurrences,
  };
}

export function selectCandidates(run: ExtractionRun, filter: CandidateFilter): Occurrence[] {
  if (filter === 'all') {
    return [...run.occurrences];
  }
  return run.occurrences.filter((occ) => occ.state === filter);
}
