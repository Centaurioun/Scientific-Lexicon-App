import { compareCodeUnits, type Occurrence } from '@/domain/schema';
import type { CandidateGroup, RankedCandidate, RankMode } from '@/domain/ranking';
import type { Token } from '@/domain/extraction';

export const MAX_CVALUE_INDEX_PROBES = 1_000_000;

export class RankingWorkloadExceededError extends Error {
  readonly probes: number;
  readonly limit: number;

  constructor(probes: number, limit: number) {
    super(
      `C-value nested-container indexing exceeded the safe work bound (${limit.toLocaleString('en-US')} subsequence probes). Ranking was aborted without partial results; switch to source-order or frequency ranking or reduce candidate cardinality.`,
    );
    this.name = 'RankingWorkloadExceededError';
    this.probes = probes;
    this.limit = limit;
  }
}

export interface RankCandidatesOptions {
  maxIndexProbes?: number;
  signal?: AbortSignal;
}

function throwIfRankingAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Candidate ranking was aborted.', 'AbortError');
  }
}

export function tokenizeSurfaceForRanking(surface: string): string[] {
  return surface
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length > 0);
}

/**
 * Exact case-sensitive contiguous token-sequence containment check (haystack strictly longer than needle).
 * Avoids naive substring false positives such as "cell" inside "intracellular".
 */
export function isStrictTokenSubsequence(
  needle: readonly string[],
  haystack: readonly string[],
): boolean {
  if (needle.length === 0 || haystack.length <= needle.length) return false;
  const maxStart = haystack.length - needle.length;
  for (let i = 0; i <= maxStart; i += 1) {
    let matches = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function makeGroupKey(occ: Occurrence): string {
  const concepts = [...occ.conceptIds].sort(compareCodeUnits);
  const exprs = [...occ.expressionIds].sort(compareCodeUnits);
  // Encode tuple boundaries structurally: surfaces and opaque IDs may contain delimiters.
  return JSON.stringify([occ.surface, occ.state, concepts, exprs]);
}

/**
 * Extracts explicit NLP tokens covering the entire non-whitespace span of `occurrence`.
 * Returns `null` when NLP tokens are absent or only partially cover `occurrence.surface`,
 * ensuring partial token coverage never silently truncates a candidate's token sequence.
 */
function extractExactNlpTokensForOccurrence(
  occurrence: Occurrence,
  orderedTokens: readonly Token[],
): string[] | null {
  if (orderedTokens.length === 0) return null;

  let low = 0;
  let high = orderedTokens.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (orderedTokens[mid].start < occurrence.start) low = mid + 1;
    else high = mid;
  }

  const matched: string[] = [];
  let cursor = occurrence.start;

  for (let i = low; i < orderedTokens.length && orderedTokens[i].start < occurrence.end; i += 1) {
    const tok = orderedTokens[i];
    if (tok.start < cursor || tok.end > occurrence.end) {
      return null;
    }
    const gap = occurrence.surface.slice(cursor - occurrence.start, tok.start - occurrence.start);
    if (!/^\s*$/.test(gap)) {
      return null;
    }
    const expectedSlice = occurrence.surface.slice(
      tok.start - occurrence.start,
      tok.end - occurrence.start,
    );
    if (expectedSlice !== tok.surface) {
      return null;
    }
    matched.push(tok.surface);
    cursor = tok.end;
  }

  if (matched.length === 0) return null;
  const trailing = occurrence.surface.slice(cursor - occurrence.start);
  if (!/^\s*$/.test(trailing)) {
    return null;
  }
  return matched;
}

/**
 * Resolves one deterministic canonical token sequence per exact surface across all
 * occurrences of that surface:
 * 1. Prefer exact full-coverage NLP tokenizations over whitespace fallbacks.
 * 2. Among equal-quality tokenizations, pick the highest occurrence count.
 * 3. Deterministic tie-break: longer token count, then binary UTF-16 JSON key order.
 */
function resolveDeterministicSurfaceTokens(
  occurrences: readonly Occurrence[],
  orderedTokens: readonly Token[],
): Map<string, string[]> {
  type Vote = { tokens: string[]; nlpExact: boolean; count: number; key: string };
  const votesBySurface = new Map<string, Map<string, Vote>>();

  for (const occ of occurrences) {
    const exactNlp = extractExactNlpTokensForOccurrence(occ, orderedTokens);
    const tokens = exactNlp ?? tokenizeSurfaceForRanking(occ.surface);
    const nlpExact = exactNlp !== null;
    const key = `${nlpExact ? '1' : '0'}:${JSON.stringify(tokens)}`;

    let surfaceVotes = votesBySurface.get(occ.surface);
    if (!surfaceVotes) {
      surfaceVotes = new Map<string, Vote>();
      votesBySurface.set(occ.surface, surfaceVotes);
    }
    const existing = surfaceVotes.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      surfaceVotes.set(key, { tokens, nlpExact, count: 1, key });
    }
  }

  const resolved = new Map<string, string[]>();
  for (const [surface, voteMap] of votesBySurface.entries()) {
    let best: Vote | null = null;
    for (const vote of voteMap.values()) {
      if (!best) {
        best = vote;
        continue;
      }
      if (vote.nlpExact !== best.nlpExact) {
        if (vote.nlpExact) best = vote;
        continue;
      }
      if (vote.count !== best.count) {
        if (vote.count > best.count) best = vote;
        continue;
      }
      if (vote.tokens.length !== best.tokens.length) {
        if (vote.tokens.length > best.tokens.length) best = vote;
        continue;
      }
      if (compareCodeUnits(vote.key, best.key) < 0) {
        best = vote;
      }
    }
    resolved.set(surface, best ? best.tokens : tokenizeSurfaceForRanking(surface));
  }

  return resolved;
}

/**
 * Groups occurrences by exact case-sensitive surface and compatible review state/concept associations.
 * Never merges distinct concepts, never case-folds, and counts unique occurrence IDs only.
 */
export function buildCandidateGroups(
  occurrences: readonly Occurrence[],
  resolvedTokensBySurface?: ReadonlyMap<string, readonly string[]>,
): CandidateGroup[] {
  const byKey = new Map<
    string,
    {
      surface: string;
      occurrenceIds: Set<string>;
      firstStart: number;
      firstEnd: number;
      state: Occurrence['state'];
      conceptIds: string[];
      expressionIds: string[];
    }
  >();

  for (const occ of occurrences) {
    const key = makeGroupKey(occ);
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        surface: occ.surface,
        occurrenceIds: new Set<string>(),
        firstStart: occ.start,
        firstEnd: occ.end,
        state: occ.state,
        conceptIds: [...occ.conceptIds].sort(compareCodeUnits),
        expressionIds: [...occ.expressionIds].sort(compareCodeUnits),
      };
      byKey.set(key, entry);
    } else if (
      occ.start < entry.firstStart ||
      (occ.start === entry.firstStart && occ.end > entry.firstEnd)
    ) {
      entry.firstStart = occ.start;
      entry.firstEnd = occ.end;
    }
    entry.occurrenceIds.add(occ.id);
  }

  const groups: CandidateGroup[] = [];
  for (const [key, entry] of byKey.entries()) {
    const occurrenceIds = Array.from(entry.occurrenceIds);
    const tokens =
      resolvedTokensBySurface?.get(entry.surface) ?? tokenizeSurfaceForRanking(entry.surface);
    groups.push({
      key,
      surface: entry.surface,
      occurrenceIds,
      firstStart: entry.firstStart,
      firstEnd: entry.firstEnd,
      frequency: occurrenceIds.length,
      tokenCount: Math.max(1, tokens.length),
      state: entry.state,
      conceptIds: entry.conceptIds,
      expressionIds: entry.expressionIds,
    });
  }

  return groups.sort((a, b) => {
    if (a.firstStart !== b.firstStart) return a.firstStart - b.firstStart;
    const lenDiff = b.firstEnd - b.firstStart - (a.firstEnd - a.firstStart);
    if (lenDiff !== 0) return lenDiff;
    return compareCodeUnits(a.key, b.key);
  });
}

function compareGroupDeterministicTie(a: CandidateGroup, b: CandidateGroup): number {
  const surfaceCmp = compareCodeUnits(a.surface, b.surface);
  if (surfaceCmp !== 0) return surfaceCmp;
  const keyCmp = compareCodeUnits(a.key, b.key);
  if (keyCmp !== 0) return keyCmp;
  return a.firstStart - b.firstStart;
}

/**
 * Ranks session candidate groups deterministically using source-order, raw frequency,
 * or canonical multiword C-value with unigrams separated and transparent raw features.
 */
export function rankCandidates(
  occurrences: readonly Occurrence[],
  rankMode: RankMode,
  sourceTokens: readonly Token[] = [],
  options: RankCandidatesOptions = {},
): RankedCandidate[] {
  throwIfRankingAborted(options.signal);
  if (occurrences.length === 0) return [];

  const orderedTokens =
    sourceTokens.length > 0
      ? [...sourceTokens].sort((a, b) => a.start - b.start || a.end - b.end)
      : [];
  const resolvedTokensBySurface = resolveDeterministicSurfaceTokens(occurrences, orderedTokens);
  throwIfRankingAborted(options.signal);

  const groups = buildCandidateGroups(occurrences, resolvedTokensBySurface);
  throwIfRankingAborted(options.signal);

  // Build C-value subsequence containment index ONLY when rankMode === 'c-value'.
  // In source-order and frequency modes, zero container indexing or intermediate allocation runs.
  let containersByTokenSequence:
    | Map<string, Array<{ surface: string; frequency: number }>>
    | null = null;

  if (rankMode === 'c-value') {
    const surfaceTypes = new Map<string, { tokens: string[]; frequency: number }>();
    for (const group of groups) {
      const existing = surfaceTypes.get(group.surface);
      if (existing) {
        existing.frequency += group.frequency;
      } else {
        surfaceTypes.set(group.surface, {
          tokens: resolvedTokensBySurface.get(group.surface) ?? tokenizeSurfaceForRanking(group.surface),
          frequency: group.frequency,
        });
      }
    }

    // Index only exact multiword candidate token sequences that exist in this run,
    // keyed by (firstToken -> targetLengths) and (length -> exact JSON sequence keys).
    // This supports arbitrary-length registered/pack expressions accurately without O(L²) bloat.
    const candidateKeysByLength = new Map<number, Set<string>>();
    const targetLengthsByFirstToken = new Map<string, number[]>();
    const targetLengthSetsByFirstToken = new Map<string, Set<number>>();

    for (const info of surfaceTypes.values()) {
      const len = info.tokens.length;
      if (len < 2) continue;
      const key = JSON.stringify(info.tokens);
      let keySet = candidateKeysByLength.get(len);
      if (!keySet) {
        keySet = new Set<string>();
        candidateKeysByLength.set(len, keySet);
      }
      keySet.add(key);

      const firstTok = info.tokens[0];
      let lenSet = targetLengthSetsByFirstToken.get(firstTok);
      if (!lenSet) {
        lenSet = new Set<number>();
        targetLengthSetsByFirstToken.set(firstTok, lenSet);
      }
      lenSet.add(len);
    }

    for (const [tok, lenSet] of targetLengthSetsByFirstToken.entries()) {
      targetLengthsByFirstToken.set(
        tok,
        Array.from(lenSet).sort((a, b) => a - b),
      );
    }

    const maxProbes = options.maxIndexProbes ?? MAX_CVALUE_INDEX_PROBES;
    let probes = 0;
    containersByTokenSequence = new Map<string, Array<{ surface: string; frequency: number }>>();

    for (const [surface, info] of surfaceTypes.entries()) {
      throwIfRankingAborted(options.signal);
      const containerLen = info.tokens.length;
      if (containerLen < 3) continue; // Strict container of a multiword term (len >= 2) needs >= 3 tokens

      const sequencesInContainer = new Set<string>();
      for (let start = 0; start < containerLen - 1; start += 1) {
        const candidateLens = targetLengthsByFirstToken.get(info.tokens[start]);
        if (!candidateLens) continue;

        for (let k = 0; k < candidateLens.length; k += 1) {
          const len = candidateLens[k];
          if (len >= containerLen || start + len > containerLen) break;

          probes += 1;
          if (probes > maxProbes) {
            throw new RankingWorkloadExceededError(probes, maxProbes);
          }
          if ((probes & 4095) === 0) {
            throwIfRankingAborted(options.signal);
          }

          const subseqKey = JSON.stringify(info.tokens.slice(start, start + len));
          if (!candidateKeysByLength.get(len)?.has(subseqKey)) continue;
          if (sequencesInContainer.has(subseqKey)) continue;
          sequencesInContainer.add(subseqKey);

          const containers = containersByTokenSequence.get(subseqKey);
          const container = { surface, frequency: info.frequency };
          if (containers) containers.push(container);
          else containersByTokenSequence.set(subseqKey, [container]);
        }
      }
    }
  }

  throwIfRankingAborted(options.signal);

  const ranked: RankedCandidate[] = groups.map((group) => {
    const tokens =
      resolvedTokensBySurface.get(group.surface) ?? tokenizeSurfaceForRanking(group.surface);
    const n = tokens.length;
    const isUnigram = n < 2;

    if (rankMode === 'source-order') {
      return {
        group,
        rankMode,
        score: null,
        unigramGroup: isUnigram,
        features: {
          frequency: group.frequency,
          tokenCount: n,
          nestedContainerCount: 0,
          nestedContainerFreqSum: 0,
          nestedContainerSurfaces: [],
          formulaDescription: 'Source document order (first UTF-16 offset)',
          formulaDetails: `firstStart=${group.firstStart}, f=${group.frequency}, n=${n}`,
        },
      };
    }

    if (rankMode === 'frequency') {
      return {
        group,
        rankMode,
        score: group.frequency,
        unigramGroup: isUnigram,
        features: {
          frequency: group.frequency,
          tokenCount: n,
          nestedContainerCount: 0,
          nestedContainerFreqSum: 0,
          nestedContainerSurfaces: [],
          formulaDescription: 'Raw session occurrence frequency f(a)',
          formulaDetails: `f=${group.frequency} distinct occurrences, n=${n} tokens`,
        },
      };
    }

    // rankMode === 'c-value'
    if (isUnigram) {
      return {
        group,
        rankMode,
        score: null,
        unigramGroup: true,
        features: {
          frequency: group.frequency,
          tokenCount: n,
          nestedContainerCount: 0,
          nestedContainerFreqSum: 0,
          nestedContainerSurfaces: [],
          formulaDescription: 'Unigram (raw frequency; C-value applies to multiword terms n >= 2)',
          formulaDetails: `f=${group.frequency}, n=1`,
        },
      };
    }

    const containers = [...(containersByTokenSequence?.get(JSON.stringify(tokens)) ?? [])];
    containers.sort((a, b) => compareCodeUnits(a.surface, b.surface));
    const nestedCount = containers.length;
    const nestedFreqSum = containers.reduce((sum, item) => sum + item.frequency, 0);
    const log2n = Math.log2(n);
    const rawCValue =
      nestedCount === 0
        ? log2n * group.frequency
        : log2n * (group.frequency - nestedFreqSum / nestedCount);

    const formulaDetails =
      nestedCount === 0
        ? `log2(${n}) * ${group.frequency} = ${rawCValue.toFixed(3)}`
        : `log2(${n}) * (${group.frequency} - (${nestedFreqSum} / ${nestedCount})) = ${rawCValue.toFixed(3)}`;

    return {
      group,
      rankMode,
      score: rawCValue,
      unigramGroup: false,
      features: {
        frequency: group.frequency,
        tokenCount: n,
        nestedContainerCount: nestedCount,
        nestedContainerFreqSum: nestedFreqSum,
        nestedContainerSurfaces: containers.map((c) => c.surface),
        formulaDescription:
          nestedCount === 0
            ? 'Canonical multiword C-value (unnested): log2(n) * f(a)'
            : 'Canonical multiword C-value (nested): log2(n) * (f(a) - (1 / |T_a|) * sum f(b))',
        formulaDetails,
      },
    };
  });

  throwIfRankingAborted(options.signal);

  if (rankMode === 'source-order') {
    return ranked.sort((a, b) => {
      if (a.group.firstStart !== b.group.firstStart) {
        return a.group.firstStart - b.group.firstStart;
      }
      const lenDiff =
        b.group.firstEnd - b.group.firstStart - (a.group.firstEnd - a.group.firstStart);
      if (lenDiff !== 0) return lenDiff;
      return compareGroupDeterministicTie(a.group, b.group);
    });
  }

  if (rankMode === 'frequency') {
    return ranked.sort((a, b) => {
      if (b.group.frequency !== a.group.frequency) {
        return b.group.frequency - a.group.frequency;
      }
      if (b.features.tokenCount !== a.features.tokenCount) {
        return b.features.tokenCount - a.features.tokenCount;
      }
      return compareGroupDeterministicTie(a.group, b.group);
    });
  }

  // rankMode === 'c-value': multiword ranked section first, then separately labeled unigrams
  return ranked.sort((a, b) => {
    if (a.unigramGroup !== b.unigramGroup) {
      return a.unigramGroup ? 1 : -1;
    }
    if (!a.unigramGroup && !b.unigramGroup) {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
    }
    if (b.group.frequency !== a.group.frequency) {
      return b.group.frequency - a.group.frequency;
    }
    return compareGroupDeterministicTie(a.group, b.group);
  });
}
