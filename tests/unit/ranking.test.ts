import { describe, expect, it } from 'vitest';
import { buildCandidateGroups, rankCandidates } from '@/application/ranking';
import type { Occurrence } from '@/domain/schema';

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
});
