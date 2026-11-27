import { describe, expect, it } from 'vitest';
import {
  buildCandidateGroups,
  isStrictTokenSubsequence,
  rankCandidates,
  RankingWorkloadExceededError,
  tokenizeSurfaceForRanking,
} from '@/application/ranking';
import type { Occurrence } from '@/domain/schema';
import type { Token } from '@/domain/extraction';

function makeOccurrence(
  id: string,
  start: number,
  surface: string,
  overrides: Partial<Occurrence> = {},
): Occurrence {
  return {
    id,
    start,
    end: start + surface.length,
    surface,
    expressionIds: [],
    conceptIds: [],
    state: 'new-candidate',
    resolvedConceptId: null,
    ...overrides,
  };
}

describe('D5: Session corpus statistics and canonical C-value ranking', () => {
  it('computes exact hand-verified canonical C-value for nested and unnested multiword candidates without clamping or fake confidence', () => {
    const occurrences: Occurrence[] = [];
    let offset = 0;

    // 7 occurrences of 2-token term "stem cell"
    for (let i = 0; i < 7; i += 1) {
      occurrences.push(makeOccurrence(`occ-sc-${i}`, offset, 'stem cell'));
      offset += 20;
    }
    // 2 occurrences of distinct longer container "mesenchymal stem cell"
    for (let i = 0; i < 2; i += 1) {
      occurrences.push(makeOccurrence(`occ-msc-${i}`, offset, 'mesenchymal stem cell'));
      offset += 30;
    }
    // 4 occurrences of distinct longer container "periodontal stem cell"
    for (let i = 0; i < 4; i += 1) {
      occurrences.push(makeOccurrence(`occ-psc-${i}`, offset, 'periodontal stem cell'));
      offset += 30;
    }
    // One longer term contains the nested sequence twice but remains one container type.
    for (let i = 0; i < 2; i += 1) {
      occurrences.push(makeOccurrence(`occ-repeat-container-${i}`, offset, 'stem cell stem cell'));
      offset += 40;
    }
    // 7 occurrences of unnested 2-token term "bone marrow"
    for (let i = 0; i < 7; i += 1) {
      occurrences.push(makeOccurrence(`occ-bm-${i}`, offset, 'bone marrow'));
      offset += 20;
    }

    const ranked = rankCandidates(occurrences, 'c-value');

    const stemCell = ranked.find((r) => r.group.surface === 'stem cell')!;
    const boneMarrow = ranked.find((r) => r.group.surface === 'bone marrow')!;

    // Hand-computed nested across three distinct container types: log2(2) * (7 - (2 + 4 + 2) / 3) = 13/3
    expect(stemCell.unigramGroup).toBe(false);
    expect(stemCell.score).toBeCloseTo(13 / 3, 10);
    expect(stemCell.features.frequency).toBe(7);
    expect(stemCell.features.tokenCount).toBe(2);
    expect(stemCell.features.nestedContainerCount).toBe(3);
    expect(stemCell.features.nestedContainerFreqSum).toBe(8);

    // Hand-computed unnested: log2(2) * 7 = 7
    expect(boneMarrow.unigramGroup).toBe(false);
    expect(boneMarrow.score).toBeCloseTo(7, 10);
    expect(boneMarrow.features.nestedContainerCount).toBe(0);

    // Unnested bone marrow (7) ranks above nested stem cell (4)
    expect(ranked.indexOf(boneMarrow)).toBeLessThan(ranked.indexOf(stemCell));
  });

  it('uses token-sequence containment rather than naive substring matching', () => {
    const occurrences: Occurrence[] = [
      makeOccurrence('occ-1', 0, 'cell line'),
      makeOccurrence('occ-2', 20, 'cell line'),
      // Substring trap: "intracellular line" does NOT contain token sequence ["cell", "line"]
      makeOccurrence('occ-3', 50, 'intracellular line'),
      makeOccurrence('occ-4', 80, 'intracellular line'),
      // Substring trap: "cell lineage" does NOT contain token sequence ["cell", "line"]
      makeOccurrence('occ-5', 110, 'cell lineage'),
    ];

    const ranked = rankCandidates(occurrences, 'c-value');
    const cellLine = ranked.find((r) => r.group.surface === 'cell line')!;
    expect(cellLine.features.nestedContainerCount).toBe(0);
    expect(cellLine.score).toBeCloseTo(2, 10);
  });

  it('separates unigrams from multiword C-value scores without inventing calibrated scores', () => {
    const occurrences: Occurrence[] = [
      makeOccurrence('occ-1', 0, 'TNF-α'),
      makeOccurrence('occ-2', 10, 'TNF-α'),
      makeOccurrence('occ-3', 20, 'TNF-α'),
      makeOccurrence('occ-4', 30, 'Gram staining'),
    ];

    const ranked = rankCandidates(occurrences, 'c-value');
    const multiword = ranked.find((r) => r.group.surface === 'Gram staining')!;
    const unigram = ranked.find((r) => r.group.surface === 'TNF-α')!;

    expect(multiword.unigramGroup).toBe(false);
    expect(multiword.score).toBeCloseTo(1, 10);

    expect(unigram.unigramGroup).toBe(true);
    expect(unigram.score).toBeNull();
    expect(unigram.features.frequency).toBe(3);

    // Multiword ranked section appears before separately labeled unigram section
    expect(ranked.indexOf(multiword)).toBeLessThan(ranked.indexOf(unigram));
  });

  it('groups exact case-sensitive surfaces without merging distinct concepts and breaks ties deterministically', () => {
    const occurrences: Occurrence[] = [
      makeOccurrence('occ-p53-lo', 0, 'p53'),
      makeOccurrence('occ-p53-hi', 10, 'P53'),
      makeOccurrence('occ-pd-amb', 20, 'PD', {
        state: 'ambiguous',
        conceptIds: ['c-1', 'c-2'],
        expressionIds: ['e-1', 'e-2'],
      }),
      makeOccurrence('occ-pd-known', 30, 'PD', {
        state: 'known-form',
        conceptIds: ['c-1'],
        expressionIds: ['e-1'],
        resolvedConceptId: 'c-1',
      }),
    ];

    const groups = buildCandidateGroups(occurrences);
    // p53 and P53 stay strictly distinct
    expect(groups.some((g) => g.surface === 'p53')).toBe(true);
    expect(groups.some((g) => g.surface === 'P53')).toBe(true);
    // PD ambiguous and PD known-form never merge their concept IDs
    const pdGroups = groups.filter((g) => g.surface === 'PD');
    expect(pdGroups).toHaveLength(2);

    // Deterministic tie-breaking by binary UTF-16 code units in frequency mode: 'P53' < 'PD' < 'p53'
    const freqRanked = rankCandidates(occurrences, 'frequency');
    expect(freqRanked.map((r) => r.group.surface)).toEqual(['P53', 'PD', 'PD', 'p53']);

    // Source-order mode preserves document offset order
    const sourceRanked = rankCandidates(occurrences, 'source-order');
    expect(sourceRanked.map((r) => r.group.firstStart)).toEqual([0, 10, 20, 30]);

    // Empty input returns empty array cleanly
    expect(rankCandidates([], 'c-value')).toEqual([]);
  });

  it('keeps C-value container statistics stable when the UI displays a filtered subset', () => {
    const all: Occurrence[] = [];
    let offset = 0;
    for (let i = 0; i < 7; i += 1) {
      all.push(makeOccurrence(`stem-${i}`, offset, 'stem cell', { state: 'new-candidate' }));
      offset += 20;
    }
    for (let i = 0; i < 2; i += 1) {
      all.push(makeOccurrence(`mes-${i}`, offset, 'mesenchymal stem cell', { state: 'known-form' }));
      offset += 30;
    }
    for (let i = 0; i < 4; i += 1) {
      all.push(makeOccurrence(`per-${i}`, offset, 'periodontal stem cell', { state: 'known-form' }));
      offset += 30;
    }
    const full = rankCandidates(all, 'c-value').find((item) => item.group.surface === 'stem cell')!;
    const displaySubset = all.filter((occ) => occ.state === 'new-candidate');
    const subset = rankCandidates(displaySubset, 'c-value').find((item) => item.group.surface === 'stem cell')!;
    expect(full.score).toBeCloseTo(4, 10);
    expect(subset.score).toBeCloseTo(7, 10);
  });

  it('uses explicit NLP token spans for ranking token counts and nesting', () => {
    const occurrence = makeOccurrence('hyphen', 0, 'stem-cell');
    const tokens: Token[] = [
      { start: 0, end: 4, surface: 'stem', pos: 'NOUN', sentenceId: 0 },
      { start: 4, end: 5, surface: '-', pos: 'PUNCT', sentenceId: 0 },
      { start: 5, end: 9, surface: 'cell', pos: 'NOUN', sentenceId: 0 },
    ];
    const ranked = rankCandidates([occurrence], 'c-value', tokens);
    expect(ranked[0].features.tokenCount).toBe(3);
    expect(ranked[0].unigramGroup).toBe(false);
  });

  it('matches an independent pairwise C-value reference on a mixed synthetic corpus', () => {
    const occurrences = [
      ...Array.from({ length: 7 }, (_, i) => makeOccurrence(`a-${i}`, i * 10, 'stem cell')),
      ...Array.from({ length: 2 }, (_, i) => makeOccurrence(`b-${i}`, 100 + i * 10, 'mesenchymal stem cell')),
      ...Array.from({ length: 4 }, (_, i) => makeOccurrence(`c-${i}`, 150 + i * 10, 'periodontal stem cell')),
      ...Array.from({ length: 3 }, (_, i) => makeOccurrence(`d-${i}`, 220 + i * 10, 'bone marrow')),
    ];
    const groups = buildCandidateGroups(occurrences);
    const distinctTypes = new Map<string, { tokens: string[]; frequency: number }>();
    for (const group of groups) {
      const existing = distinctTypes.get(group.surface);
      if (existing) existing.frequency += group.frequency;
      else distinctTypes.set(group.surface, {
        tokens: tokenizeSurfaceForRanking(group.surface),
        frequency: group.frequency,
      });
    }
    const reference = groups.map((group) => {
      const tokens = tokenizeSurfaceForRanking(group.surface);
      const containers = [...distinctTypes.entries()]
        .filter(([, item]) => isStrictTokenSubsequence(tokens, item.tokens))
        .map(([surface, item]) => ({ surface, frequency: item.frequency }));
      const meanContainerFrequency = containers.length
        ? containers.reduce((sum, item) => sum + item.frequency, 0) / containers.length
        : 0;
      return [group.surface, Math.log2(tokens.length) * (group.frequency - meanContainerFrequency)] as const;
    });
    const actual = rankCandidates(occurrences, 'c-value');
    for (const [surface, score] of reference) {
      const ranked = actual.find((item) => item.group.surface === surface)!;
      expect(ranked.score).toBeCloseTo(score, 10);
    }
  });

  it('measures repeated and high-diversity workloads at the authorized occurrence scales', () => {
    const measurements: Record<string, number> = {};
    for (const count of [5_000, 10_000]) {
      const repeated = Array.from({ length: count }, (_, i) =>
        makeOccurrence(`repeat-${i}`, i * 20, 'stem cell'),
      );
      const repeatedStart = performance.now();
      expect(rankCandidates(repeated, 'c-value')).toHaveLength(1);
      measurements[`repeated-${count}`] = performance.now() - repeatedStart;

      const diverse = Array.from({ length: count }, (_, i) =>
        makeOccurrence(`type-${i}`, i * 20, `term${i} marker`),
      );
      const diverseStart = performance.now();
      expect(rankCandidates(diverse, 'c-value')).toHaveLength(count);
      measurements[`distinct-${count}`] = performance.now() - diverseStart;
    }
    console.info(`WP02_RANKING_BENCHMARK_MS=${JSON.stringify(measurements)}`);
  });

  it('handles long registered/pack expressions beyond 8 tokens and matches the pairwise oracle exactly (QC02)', () => {
    const longForm = Array.from({ length: 24 }, (_, i) => `tok${i}`).join(' ');
    const nestedTwelve = Array.from({ length: 12 }, (_, i) => `tok${i + 4}`).join(' ');
    const nestedTwo = 'tok8 tok9';

    const occurrences: Occurrence[] = [
      makeOccurrence('long-1', 0, longForm, { state: 'known-form', conceptIds: ['c-long'], expressionIds: ['e-long'] }),
      makeOccurrence('long-2', 300, longForm, { state: 'known-form', conceptIds: ['c-long'], expressionIds: ['e-long'] }),
      makeOccurrence('mid-1', 600, nestedTwelve),
      makeOccurrence('mid-2', 750, nestedTwelve),
      makeOccurrence('mid-3', 900, nestedTwelve),
      makeOccurrence('short-1', 1050, nestedTwo),
      makeOccurrence('short-2', 1100, nestedTwo),
      makeOccurrence('short-3', 1150, nestedTwo),
      makeOccurrence('short-4', 1200, nestedTwo),
    ];

    const ranked = rankCandidates(occurrences, 'c-value');
    const longItem = ranked.find((r) => r.group.surface === longForm)!;
    const midItem = ranked.find((r) => r.group.surface === nestedTwelve)!;
    const shortItem = ranked.find((r) => r.group.surface === nestedTwo)!;

    expect(longItem.group.tokenCount).toBe(24);
    expect(longItem.features.tokenCount).toBe(24);
    expect(longItem.score).toBeCloseTo(Math.log2(24) * 2, 10);

    // nestedTwelve (f=3) is nested in longForm (f=2) => log2(12) * (3 - 2/1)
    expect(midItem.features.nestedContainerCount).toBe(1);
    expect(midItem.score).toBeCloseTo(Math.log2(12) * (3 - 2), 10);

    // nestedTwo (f=4) is nested in both longForm (f=2) and nestedTwelve (f=3) => log2(2) * (4 - 5/2) = 1.5
    expect(shortItem.features.nestedContainerCount).toBe(2);
    expect(shortItem.score).toBeCloseTo(Math.log2(2) * (4 - 2.5), 10);
  });

  it('falls back cleanly on partial NLP token coverage and resolves contextual tokenization of identical surfaces deterministically (QC02)', () => {
    // Occurrence 1 has partial NLP coverage (NLP token extends past occurrence.end)
    const occPartial = makeOccurrence('occ-partial', 0, 'alpha beta');
    const partialTokens: Token[] = [
      { start: 0, end: 5, surface: 'alpha', pos: 'NOUN', sentenceId: 0 },
      // extends past occPartial.end (10), leaving 'beta' uncovered
      { start: 6, end: 13, surface: 'betaXYZ', pos: 'NOUN', sentenceId: 0 },
    ];
    const rankedPartial = rankCandidates([occPartial], 'c-value', partialTokens);
    // Must fall back to whitespace ['alpha', 'beta'] (2 tokens), NOT truncated ['alpha'] (1 token)
    expect(rankedPartial[0].group.tokenCount).toBe(2);
    expect(rankedPartial[0].features.tokenCount).toBe(2);
    expect(rankedPartial[0].unigramGroup).toBe(false);

    // Contextual tokenization of identical surface "stem-cell":
    // Occ 1 falls back (partial/no tokens), Occ 2 has full NLP coverage ['stem', '-', 'cell']
    const occA = makeOccurrence('occ-a', 0, 'stem-cell');
    const occB = makeOccurrence('occ-b', 40, 'stem-cell');
    const contextTokens: Token[] = [
      { start: 40, end: 44, surface: 'stem', pos: 'NOUN', sentenceId: 1 },
      { start: 44, end: 45, surface: '-', pos: 'PUNCT', sentenceId: 1 },
      { start: 45, end: 49, surface: 'cell', pos: 'NOUN', sentenceId: 1 },
    ];
    const forward = rankCandidates([occA, occB], 'c-value', contextTokens);
    const reversed = rankCandidates([occB, occA], 'c-value', contextTokens);
    expect(forward[0].group.tokenCount).toBe(3);
    expect(forward[0].features.tokenCount).toBe(3);
    expect(reversed[0].group.tokenCount).toBe(3);
    expect(forward[0].score).toBeCloseTo(reversed[0].score!, 10);
  });

  it('skips C-value subsequence indexing in source-order and frequency modes and fails closed when C-value probe bound or AbortSignal triggers (QC02)', () => {
    const longForms = Array.from({ length: 12 }, (_, idx) =>
      makeOccurrence(
        `lf-${idx}`,
        idx * 300,
        Array.from({ length: 20 + idx }, (__, t) => `w${t}`).join(' '),
      ),
    );

    // source-order and frequency bypass subsequence index entirely even with tiny maxIndexProbes
    expect(() =>
      rankCandidates(longForms, 'source-order', [], { maxIndexProbes: 1 }),
    ).not.toThrow();
    expect(() =>
      rankCandidates(longForms, 'frequency', [], { maxIndexProbes: 1 }),
    ).not.toThrow();

    // c-value rejects excessive intermediate index probes fail-closed with no partial result
    expect(() =>
      rankCandidates(longForms, 'c-value', [], { maxIndexProbes: 5 }),
    ).toThrow(RankingWorkloadExceededError);

    // AbortSignal cancels ranking explicitly
    const ac = new AbortController();
    ac.abort();
    expect(() =>
      rankCandidates(longForms, 'c-value', [], { signal: ac.signal }),
    ).toThrow(/abort/i);
  });

  it('matches an adversarial pairwise reference oracle including negative un-clamped C-value, multi-state shared surfaces, and repeated nested windows (QC02)', () => {
    const occurrences: Occurrence[] = [
      // Nested surface appearing in two compatible groups (known-form + new-candidate)
      makeOccurrence('g1-1', 0, 'alpha beta', { state: 'known-form', conceptIds: ['c1'], expressionIds: ['e1'] }),
      makeOccurrence('g2-1', 20, 'alpha beta', { state: 'new-candidate' }),
      // Container with higher frequency causing negative C-value (must NOT clamp to 0)
      ...Array.from({ length: 5 }, (_, i) => makeOccurrence(`big-${i}`, 100 + i * 40, 'pre alpha beta post')),
      // Container repeating the same window twice (counts as 1 distinct container)
      makeOccurrence('dup-1', 400, 'alpha beta alpha beta'),
      // Long 14-token container containing 'pre alpha beta post' and 'alpha beta'
      makeOccurrence('long-1', 500, 't1 t2 t3 t4 pre alpha beta post t9 t10 t11 t12 t13 t14'),
      // Unigrams must remain separated with score === null
      makeOccurrence('uni-1', 700, 'alpha'),
      makeOccurrence('uni-2', 720, 'alpha'),
    ];

    const actual = rankCandidates(occurrences, 'c-value');

    // Build independent all-pairs reference oracle
    const groups = buildCandidateGroups(occurrences);
    const distinctTypes = new Map<string, { tokens: string[]; frequency: number }>();
    for (const g of groups) {
      const prev = distinctTypes.get(g.surface);
      if (prev) prev.frequency += g.frequency;
      else distinctTypes.set(g.surface, { tokens: tokenizeSurfaceForRanking(g.surface), frequency: g.frequency });
    }

    for (const item of actual) {
      const tokens = tokenizeSurfaceForRanking(item.group.surface);
      if (tokens.length < 2) {
        expect(item.unigramGroup).toBe(true);
        expect(item.score).toBeNull();
        continue;
      }
      const containers = [...distinctTypes.entries()].filter(([, info]) =>
        isStrictTokenSubsequence(tokens, info.tokens),
      );
      const expectedScore =
        containers.length === 0
          ? Math.log2(tokens.length) * item.group.frequency
          : Math.log2(tokens.length) *
            (item.group.frequency -
              containers.reduce((sum, [, info]) => sum + info.frequency, 0) / containers.length);
      expect(item.score).toBeCloseTo(expectedScore, 10);
      expect(item.features.nestedContainerCount).toBe(containers.length);
      expect(item.group.tokenCount).toBe(tokens.length);
    }

    // Verify negative C-value is preserved without clamping
    const alphaBetaKnown = actual.find(
      (r) => r.group.surface === 'alpha beta' && r.group.state === 'known-form',
    )!;
    expect(alphaBetaKnown.score!).toBeLessThan(0);
  });

  it('FH02: distinguishes many short probes from fewer long escape-sensitive probes and enforces length-weighted work and edge bounds deterministically', () => {
    // 1. Short-token workload: 20 nested 2-to-4 token phrases with 2-char tokens
    const shortOccs: Occurrence[] = [];
    for (let i = 0; i < 20; i += 1) {
      shortOccs.push(makeOccurrence(`s-sub-${i}`, i * 20, `a${i} b${i}`));
      shortOccs.push(makeOccurrence(`s-con-${i}`, 500 + i * 30, `p0 a${i} b${i} q0`));
    }
    let shortMetrics: { probes: number; workUnits: number; containerEdges: number } | null = null;
    rankCandidates(shortOccs, 'c-value', [], {
      onWorkMetrics: (m) => {
        shortMetrics = m;
      },
    });
    expect(shortMetrics).not.toBeNull();

    // 2. Fewer probes but long escape-sensitive tokens (quotes & backslashes), strictly inside 200,000 UTF-16 chars and <= 10,000 spans
    const heavyToken = (idx: number) => `\\"seq_${idx}_${'A\\"\\\\'.repeat(30)}\\"`;
    const longOccs: Occurrence[] = [];
    let offset = 0;
    const sharedPrefix = Array.from({ length: 12 }, (_, t) => heavyToken(t));
    for (let len = 2; len <= 12; len += 1) {
      const surface = sharedPrefix.slice(0, len).join(' ');
      longOccs.push(makeOccurrence(`l-${len}`, offset, surface));
      offset += surface.length + 2;
    }
    expect(offset).toBeLessThan(200_000);

    let longMetrics: { probes: number; workUnits: number; containerEdges: number } | null = null;
    const longRanked = rankCandidates(longOccs, 'c-value', [], {
      onWorkMetrics: (m) => {
        longMetrics = m;
      },
    });
    expect(longMetrics).not.toBeNull();
    // Weighted work units MUST reflect actual token length & escape weight, not just probe count
    expect(longMetrics!.workUnits).toBeGreaterThan(shortMetrics!.workUnits * 10);

    // Exact oracle verification on the long escape-sensitive chain (len=k is nested in len=k+1..12 => 12-k containers)
    for (let len = 2; len <= 12; len += 1) {
      const surface = sharedPrefix.slice(0, len).join(' ');
      const item = longRanked.find((r) => r.group.surface === surface)!;
      const expectedContainers = 12 - len;
      expect(item.features.tokenCount).toBe(len);
      expect(item.features.nestedContainerCount).toBe(expectedContainers);
      const expectedScore =
        expectedContainers === 0 ? Math.log2(len) * 1 : Math.log2(len) * (1 - 1);
      expect(item.score).toBeCloseTo(expectedScore, 10);
    }

    // 3. Exhausting maxWorkUnits fails closed with RankingWorkloadExceededError even when maxIndexProbes is huge
    expect(() =>
      rankCandidates(longOccs, 'c-value', [], {
        maxIndexProbes: 1_000_000,
        maxWorkUnits: Math.max(100, Math.floor(longMetrics!.workUnits / 2)),
      }),
    ).toThrow(RankingWorkloadExceededError);

    // 4. Exhausting maxContainerEdges fails closed against result-edge amplification
    expect(() =>
      rankCandidates(longOccs, 'c-value', [], {
        maxIndexProbes: 1_000_000,
        maxWorkUnits: 10_000_000,
        maxContainerEdges: 5,
      }),
    ).toThrow(RankingWorkloadExceededError);

    // 5. Non-finite / negative budget options fail closed instead of silently disabling bounds
    expect(() =>
      rankCandidates(longOccs, 'c-value', [], { maxWorkUnits: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      rankCandidates(longOccs, 'c-value', [], { maxWorkUnits: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    expect(() =>
      rankCandidates(longOccs, 'c-value', [], { maxContainerEdges: -1 }),
    ).toThrow(RangeError);

    // 6. source-order and frequency remain safe fallbacks without C-value indexing overhead
    expect(() =>
      rankCandidates(longOccs, 'source-order', [], { maxWorkUnits: 1, maxContainerEdges: 1 }),
    ).not.toThrow();
    expect(() =>
      rankCandidates(longOccs, 'frequency', [], { maxWorkUnits: 1, maxContainerEdges: 1 }),
    ).not.toThrow();
  });
});

