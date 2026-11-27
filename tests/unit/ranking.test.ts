import { describe, expect, it } from 'vitest';
import { buildCandidateGroups, isStrictTokenSubsequence, rankCandidates, tokenizeSurfaceForRanking } from '@/application/ranking';
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
    // 7 occurrences of unnested 2-token term "bone marrow"
    for (let i = 0; i < 7; i += 1) {
      occurrences.push(makeOccurrence(`occ-bm-${i}`, offset, 'bone marrow'));
      offset += 20;
    }

    const ranked = rankCandidates(occurrences, 'c-value');

    const stemCell = ranked.find((r) => r.group.surface === 'stem cell')!;
    const boneMarrow = ranked.find((r) => r.group.surface === 'bone marrow')!;

    // Hand-computed nested: log2(2) * (7 - (2 + 4) / 2) = 1 * (7 - 3) = 4
    expect(stemCell.unigramGroup).toBe(false);
    expect(stemCell.score).toBeCloseTo(4, 10);
    expect(stemCell.features.frequency).toBe(7);
    expect(stemCell.features.tokenCount).toBe(2);
    expect(stemCell.features.nestedContainerCount).toBe(2);
    expect(stemCell.features.nestedContainerFreqSum).toBe(6);

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
});
