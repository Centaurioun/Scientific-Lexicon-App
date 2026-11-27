import { compareCodeUnits, type Occurrence } from '@/domain/schema';
import type { CandidateGroup, RankedCandidate, RankMode } from '@/domain/ranking';
import type { Token } from '@/domain/extraction';

/** Maximum subsequence transition probes permitted during C-value nesting index construction. */
export const MAX_CVALUE_INDEX_PROBES = 1_000_000;

/**
 * Maximum conservative length- and escape-weighted work units permitted across C-value
 * preprocessing (token interning + trie insertion), trie traversal, and containment edge
 * recording/sorting. One unit approximates processing one UTF-16 code unit (including
 * worst-case JSON/escape expansion overhead) or one structural trie/edge operation.
 */
export const MAX_CVALUE_WORK_UNITS = 10_000_000;

/** Maximum total distinct (nested-term, container) containment edges permitted in C-value mode. */
export const MAX_CVALUE_CONTAINER_EDGES = 250_000;

export type RankingWorkloadBoundKind = 'work-units' | 'probes' | 'container-edges';

export interface CValueWorkMetrics {
  probes: number;
  tokenSteps: number;
  textUnits: number;
  containerEdges: number;
  workUnits: number;
}

export class RankingWorkloadExceededError extends Error {
  readonly probes: number;
  readonly workUnits: number;
  readonly containerEdges: number;
  readonly limit: number;
  readonly boundKind: RankingWorkloadBoundKind;

  constructor(
    metrics: CValueWorkMetrics,
    limit: number,
    boundKind: RankingWorkloadBoundKind = 'work-units',
  ) {
    const label =
      boundKind === 'work-units'
        ? `${limit.toLocaleString('en-US')} length-weighted work units`
        : boundKind === 'container-edges'
          ? `${limit.toLocaleString('en-US')} containment edges`
          : `${limit.toLocaleString('en-US')} subsequence probes`;
    super(
      `C-value nested-container indexing exceeded the safe work bound (${label}). Ranking was aborted without partial results; switch to source-order or frequency ranking or reduce candidate cardinality.`,
    );
    this.name = 'RankingWorkloadExceededError';
    this.probes = metrics.probes;
    this.workUnits = metrics.workUnits;
    this.containerEdges = metrics.containerEdges;
    this.limit = limit;
    this.boundKind = boundKind;
  }
}

export interface RankCandidatesOptions {
  maxIndexProbes?: number;
  maxWorkUnits?: number;
  maxContainerEdges?: number;
  signal?: AbortSignal;
  /** Optional deterministic work-counter observer for testing and diagnostics. */
  onWorkMetrics?: (metrics: CValueWorkMetrics) => void;
}

function throwIfRankingAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Candidate ranking was aborted.', 'AbortError');
  }
}

function assertPositiveSafeIntegerOption(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

/**
 * Conservative serialized text cost for a single token: UTF-16 length plus worst-case
 * escape expansion (`"` / `\` add 1 char; control chars < 0x20 add 5 chars for `\u00xx`)
 * plus 2 structural delimiter units. Guarantees long or escape-heavy tokens are billed
 * proportionally to actual text/escaping cost.
 */
function conservativeTokenTextUnits(token: string): number {
  let extra = 2;
  for (let i = 0; i < token.length; i += 1) {
    const code = token.charCodeAt(i);
    if (code === 0x22 || code === 0x5c) {
      extra += 1;
    } else if (code < 0x20) {
      extra += 5;
    }
  }
  return token.length + extra;
}

interface TrieNode {
  children: Map<number, TrieNode>;
  tokenSeqId: number;
}

function createTrieNode(): TrieNode {
  return { children: new Map<number, TrieNode>(), tokenSeqId: -1 };
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
 * 3. Deterministic tie-break: longer token count, then binary UTF-16 token sequence order.
 */
function resolveDeterministicSurfaceTokens(
  occurrences: readonly Occurrence[],
  orderedTokens: readonly Token[],
): Map<string, string[]> {
  type Vote = { tokens: string[]; nlpExact: boolean; count: number; key: string };
  const votesBySurface = new Map<string, Map<string, Vote>>();

  for (const occ of occurrences) {
    const exactNlp = extractExactNlpTokensForOccurrence(occ, orderedTokens);
    const nlpExact = exactNlp !== null;

    let surfaceVotes = votesBySurface.get(occ.surface);
    if (!surfaceVotes) {
      surfaceVotes = new Map<string, Vote>();
      votesBySurface.set(occ.surface, surfaceVotes);
    }

    // Fallback whitespace tokenization is deterministic per surface; avoid repeated JSON.stringify
    // allocation for identical fallback surfaces.
    if (!nlpExact) {
      const fallbackKey = '0:fallback';
      const existing = surfaceVotes.get(fallbackKey);
      if (existing) {
        existing.count += 1;
      } else {
        surfaceVotes.set(fallbackKey, {
          tokens: tokenizeSurfaceForRanking(occ.surface),
          nlpExact: false,
          count: 1,
          key: fallbackKey,
        });
      }
      continue;
    }

    const key = `1:${JSON.stringify(exactNlp)}`;
    const existing = surfaceVotes.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      surfaceVotes.set(key, { tokens: exactNlp, nlpExact: true, count: 1, key });
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

  // Validate numeric budget options upfront in C-value mode so non-finite/negative limits fail closed.
  const maxProbes =
    rankMode === 'c-value'
      ? assertPositiveSafeIntegerOption('maxIndexProbes', options.maxIndexProbes, MAX_CVALUE_INDEX_PROBES)
      : MAX_CVALUE_INDEX_PROBES;
  const maxWorkUnits =
    rankMode === 'c-value'
      ? assertPositiveSafeIntegerOption('maxWorkUnits', options.maxWorkUnits, MAX_CVALUE_WORK_UNITS)
      : MAX_CVALUE_WORK_UNITS;
  const maxContainerEdges =
    rankMode === 'c-value'
      ? assertPositiveSafeIntegerOption(
          'maxContainerEdges',
          options.maxContainerEdges,
          MAX_CVALUE_CONTAINER_EDGES,
        )
      : MAX_CVALUE_CONTAINER_EDGES;

  const orderedTokens =
    sourceTokens.length > 0
      ? [...sourceTokens].sort((a, b) => a.start - b.start || a.end - b.end)
      : [];
  const resolvedTokensBySurface = resolveDeterministicSurfaceTokens(occurrences, orderedTokens);
  throwIfRankingAborted(options.signal);

  const groups = buildCandidateGroups(occurrences, resolvedTokensBySurface);
  throwIfRankingAborted(options.signal);

  // Build exact Token-ID Trie & C-value containment index ONLY when rankMode === 'c-value'.
  // In source-order and frequency modes, zero container indexing or intermediate allocation runs.
  let tokenSeqIdBySurface: Map<string, number> | null = null;
  let containersBySeqId: Array<Array<{ surface: string; frequency: number }>> | null = null;

  if (rankMode === 'c-value') {
    const metrics: CValueWorkMetrics = {
      probes: 0,
      tokenSteps: 0,
      textUnits: 0,
      containerEdges: 0,
      workUnits: 0,
    };

    const debitWork = (stepCost: number, textCost: number): void => {
      if (!Number.isSafeInteger(stepCost) || stepCost < 0 || !Number.isSafeInteger(textCost) || textCost < 0) {
        throw new RankingWorkloadExceededError(metrics, maxWorkUnits, 'work-units');
      }
      if (textCost > maxWorkUnits - stepCost) {
        throw new RankingWorkloadExceededError(metrics, maxWorkUnits, 'work-units');
      }
      const delta = stepCost + textCost;
      if (delta > maxWorkUnits - metrics.workUnits) {
        metrics.workUnits = maxWorkUnits + 1;
        throw new RankingWorkloadExceededError(metrics, maxWorkUnits, 'work-units');
      }
      metrics.tokenSteps += stepCost;
      metrics.textUnits += textCost;
      metrics.workUnits += delta;
    };

    const surfaceTypes = new Map<
      string,
      {
        tokens: string[];
        tokenIds: number[];
        frequency: number;
        surfaceTextWeight: number;
      }
    >();
    const tokenToId = new Map<string, number>();
    const tokenWeightById: number[] = [];

    // Phase A: Intern unique tokens and build exact integer-keyed Token-ID Trie for all multiword terms.
    // Zero per-probe slice() or JSON.stringify() allocation is performed during containment search.
    const trieRoot = createTrieNode();
    tokenSeqIdBySurface = new Map<string, number>();
    containersBySeqId = [];

    for (const group of groups) {
      const existing = surfaceTypes.get(group.surface);
      if (existing) {
        existing.frequency += group.frequency;
        continue;
      }

      const tokens = resolvedTokensBySurface.get(group.surface) ?? tokenizeSurfaceForRanking(group.surface);
      const tokenIds = new Array<number>(tokens.length);
      let surfaceTextWeight = 0;

      for (let i = 0; i < tokens.length; i += 1) {
        const tok = tokens[i];
        let id = tokenToId.get(tok);
        let tokWeight: number;
        if (id === undefined) {
          tokWeight = conservativeTokenTextUnits(tok);
          debitWork(1, tokWeight);
          id = tokenWeightById.length;
          tokenToId.set(tok, id);
          tokenWeightById.push(tokWeight);
        } else {
          tokWeight = tokenWeightById[id];
          debitWork(1, tokWeight);
        }
        tokenIds[i] = id;
        surfaceTextWeight += tokWeight;
      }

      surfaceTypes.set(group.surface, {
        tokens,
        tokenIds,
        frequency: group.frequency,
        surfaceTextWeight,
      });

      if (tokens.length >= 2) {
        let node = trieRoot;
        for (let i = 0; i < tokenIds.length; i += 1) {
          const id = tokenIds[i];
          debitWork(1, tokenWeightById[id]);
          let next = node.children.get(id);
          if (!next) {
            next = createTrieNode();
            node.children.set(id, next);
          }
          node = next;
        }
        if (node.tokenSeqId === -1) {
          node.tokenSeqId = containersBySeqId.length;
          containersBySeqId.push([]);
        }
        tokenSeqIdBySurface.set(group.surface, node.tokenSeqId);
      }
    }

    // Phase B: Walk each container (len >= 3) through the exact Token-ID Trie.
    for (const [surface, info] of surfaceTypes.entries()) {
      throwIfRankingAborted(options.signal);
      const containerLen = info.tokenIds.length;
      if (containerLen < 3) continue; // Strict container of a multiword term (len >= 2) needs >= 3 tokens

      const seenSeqIds = new Set<number>();
      for (let start = 0; start < containerLen - 1; start += 1) {
        const startTokenId = info.tokenIds[start];
        let node = trieRoot.children.get(startTokenId);
        if (!node) continue;

        const maxEnd = start === 0 ? containerLen - 2 : containerLen - 1;
        for (let end = start + 1; end <= maxEnd; end += 1) {
          const tokenId = info.tokenIds[end];

          // Preflight probes and length-/escape-weighted work BEFORE descending trie edge.
          metrics.probes += 1;
          if (metrics.probes > maxProbes) {
            throw new RankingWorkloadExceededError(metrics, maxProbes, 'probes');
          }
          const stepTextWeight =
            end === start + 1
              ? tokenWeightById[startTokenId] + tokenWeightById[tokenId]
              : tokenWeightById[tokenId];
          debitWork(1, stepTextWeight);

          if ((metrics.probes & 4095) === 0) {
            throwIfRankingAborted(options.signal);
          }

          node = node.children.get(tokenId);
          if (!node) break;

          if (node.tokenSeqId !== -1 && !seenSeqIds.has(node.tokenSeqId)) {
            seenSeqIds.add(node.tokenSeqId);

            // Preflight result-edge amplification & output surface sort cost BEFORE allocating edge.
            metrics.containerEdges += 1;
            if (metrics.containerEdges > maxContainerEdges) {
              throw new RankingWorkloadExceededError(metrics, maxContainerEdges, 'container-edges');
            }
            debitWork(2, info.surfaceTextWeight);

            containersBySeqId[node.tokenSeqId].push({ surface, frequency: info.frequency });
          }
        }
      }
    }

    options.onWorkMetrics?.({ ...metrics });
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

    const seqId = tokenSeqIdBySurface?.get(group.surface);
    const containers = seqId !== undefined && containersBySeqId ? [...containersBySeqId[seqId]] : [];
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
