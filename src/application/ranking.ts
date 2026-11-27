import { compareCodeUnits, type Occurrence } from '@/domain/schema';
import type { CandidateGroup, RankedCandidate, RankMode } from '@/domain/ranking';
import type { Token } from '@/domain/extraction';

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
 * Groups occurrences by exact case-sensitive surface and compatible review state/concept associations.
 * Never merges distinct concepts, never case-folds, and counts unique occurrence IDs only.
 */
export function buildCandidateGroups(occurrences: readonly Occurrence[]): CandidateGroup[] {
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
    const tokens = tokenizeSurfaceForRanking(entry.surface);
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
): RankedCandidate[] {
  if (occurrences.length === 0) return [];

  const groups = buildCandidateGroups(occurrences);

  // Build distinct surface-type table for exact token-sequence nesting lookup in C-value
  const occurrenceById = new Map(occurrences.map((occ) => [occ.id, occ]));
  const orderedTokens = [...sourceTokens].sort((a, b) => a.start - b.start || a.end - b.end);
  const tokensForOccurrence = (occurrence: Occurrence): string[] => {
    let low = 0;
    let high = orderedTokens.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (orderedTokens[mid].start < occurrence.start) low = mid + 1;
      else high = mid;
    }
    const matched: string[] = [];
    for (let i = low; i < orderedTokens.length && orderedTokens[i].start < occurrence.end; i += 1) {
      if (orderedTokens[i].end <= occurrence.end) matched.push(orderedTokens[i].surface);
    }
    // Some known forms are not segmented by the NLP engine. Keep a deterministic
    // whitespace fallback for those forms; candidate spans use the explicit NLP tokens.
    return matched.length > 0 ? matched : tokenizeSurfaceForRanking(occurrence.surface);
  };
  const surfaceTypes = new Map<string, { tokens: string[]; frequency: number }>();
  for (const group of groups) {
    const existing = surfaceTypes.get(group.surface);
    if (existing) {
      existing.frequency += group.frequency;
    } else {
      surfaceTypes.set(group.surface, {
        tokens: tokensForOccurrence(occurrenceById.get(group.occurrenceIds[0])!),
        frequency: group.frequency,
      });
    }
  }

  // Index every contiguous multiword subsequence by exact token sequence. WP02
  // candidates are bounded to eight NLP tokens, so this costs O(types * 8²)
  // plus the actual containment edges instead of comparing every type pair.
  const containersByTokenSequence = new Map<
    string,
    Array<{ surface: string; frequency: number }>
  >();
  for (const [surface, info] of surfaceTypes.entries()) {
    const sequencesInContainer = new Set<string>();
    for (let start = 0; start < info.tokens.length; start += 1) {
      for (let end = start + 2; end <= info.tokens.length; end += 1) {
        if (end - start >= info.tokens.length) continue;
        const key = JSON.stringify(info.tokens.slice(start, end));
        if (sequencesInContainer.has(key)) continue;
        sequencesInContainer.add(key);
        const containers = containersByTokenSequence.get(key);
        const container = { surface, frequency: info.frequency };
        if (containers) containers.push(container);
        else containersByTokenSequence.set(key, [container]);
      }
    }
  }

  const ranked: RankedCandidate[] = groups.map((group) => {
    const tokens = surfaceTypes.get(group.surface)?.tokens ?? tokenizeSurfaceForRanking(group.surface);
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

    const containers = containersByTokenSequence.get(JSON.stringify(tokens)) ?? [];

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
