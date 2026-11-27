import { describe, expect, it } from 'vitest';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';
import {
  inspectLibraryQuality,
  paginateQualityItems,
  QUALITY_INSPECTOR_PAGE_SIZE,
} from '@/application/quality-inspector';

const TS = '2026-11-27T11:00:00.000Z';

describe('WP03 E7: Read-only quality and maintenance inspector', () => {
  it('handles zero-data empty snapshot cleanly with referential integrity PASS and zero findings', () => {
    const empty = createEmptySnapshot();
    const report = inspectLibraryQuality(empty);

    expect(report.referentialIntegrity.status).toBe('valid');
    expect(report.referentialIntegrity.errorMessage).toBeNull();
    expect(report.exactSameConceptDuplicates).toEqual([]);
    expect(report.homonymGroups).toEqual([]);
    expect(report.conceptCoverageItems).toEqual([]);
    expect(report.expressionAdvisoryItems).toEqual([]);
    expect(report.protectedExpressionItems).toEqual([]);
  });

  it('distinguishes exact same-concept duplicate candidates, non-error homonym groups across concepts, EN/TR/undetermined coverage, formula/whitespace flags, and protected expressions', () => {
    const snapshot: LibrarySnapshot = {
      ...createEmptySnapshot(),
      libraryRevision: 9,
      concepts: [
        { id: 'c-1', revision: 2, createdAt: TS, updatedAt: TS }, // EN-only, has exact same-concept duplicate for 'PD' + user-confirmed assertion
        { id: 'c-2', revision: 1, createdAt: TS, updatedAt: TS }, // TR-only + shared homonym 'PD' (alternative role, no preferred role)
        { id: 'c-3', revision: 0, createdAt: TS, updatedAt: TS }, // undetermined language + unspecified role + formula-leading text
      ],
      expressions: [
        {
          id: 'e-1a',
          conceptId: 'c-1',
          revision: 1,
          text: 'PD',
          language: { kind: 'language', tag: 'en' },
          role: 'abbreviation',
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'e-1b',
          conceptId: 'c-1',
          revision: 0,
          text: 'PD',
          language: { kind: 'language', tag: 'en' },
          role: 'abbreviation',
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'e-1c',
          conceptId: 'c-1',
          revision: 0,
          text: 'probing depth',
          language: { kind: 'language', tag: 'en' },
          role: 'preferred',
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'e-2a',
          conceptId: 'c-2',
          revision: 0,
          text: 'PD',
          language: { kind: 'language', tag: 'en' },
          role: 'abbreviation',
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'e-2b',
          conceptId: 'c-2',
          revision: 0,
          text: 'Parkinson hastalığı',
          language: { kind: 'language', tag: 'tr' },
          role: 'alternative',
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'e-3a',
          conceptId: 'c-3',
          revision: 0,
          text: '=1+1+TNF-α',
          language: { kind: 'undetermined' },
          role: 'unspecified',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
      assertions: [
        {
          id: 'a-1a',
          expressionId: 'e-1a',
          field: 'text',
          value: 'PD',
          recordRevision: 1,
          kind: 'user-confirmed',
          actor: 'local-user',
          assertedAt: TS,
        },
      ],
      provenance: [
        { id: 'p-1a', expressionId: 'e-1a', kind: 'manual', createdAt: TS, source: null },
        { id: 'p-1b', expressionId: 'e-1b', kind: 'manual', createdAt: TS, source: null },
        { id: 'p-1c', expressionId: 'e-1c', kind: 'manual', createdAt: TS, source: null },
        { id: 'p-2a', expressionId: 'e-2a', kind: 'manual', createdAt: TS, source: null },
        { id: 'p-2b', expressionId: 'e-2b', kind: 'manual', createdAt: TS, source: null },
        { id: 'p-3a', expressionId: 'e-3a', kind: 'manual', createdAt: TS, source: null },
      ],
    };

    const report = inspectLibraryQuality(snapshot);

    expect(report.referentialIntegrity.status).toBe('valid');

    // 1. Exact same-concept duplicate: c-1 has two identical ('PD', 'en', 'abbreviation') expressions e-1a and e-1b
    expect(report.exactSameConceptDuplicates).toHaveLength(1);
    expect(report.exactSameConceptDuplicates[0]).toMatchObject({
      conceptId: 'c-1',
      text: 'PD',
      language: 'en',
      role: 'abbreviation',
      expressionIds: ['e-1a', 'e-1b'],
    });

    // 2. Homonym group across distinct concepts (informational, NOT an error by itself): 'PD' appears in c-1 and c-2
    expect(report.homonymGroups).toHaveLength(1);
    expect(report.homonymGroups[0]).toMatchObject({
      surface: 'PD',
      conceptIds: ['c-1', 'c-2'],
      isError: false,
    });

    // 3. Concept coverage items: c-1 missing TR, c-2 missing preferred form, c-3 missing both EN and TR
    const covC1 = report.conceptCoverageItems.find((i) => i.conceptId === 'c-1');
    expect(covC1?.flags).toContain('MISSING_TR_EXPRESSION');
    expect(covC1?.flags).not.toContain('NO_PREFERRED_EXPRESSION');

    const covC2 = report.conceptCoverageItems.find((i) => i.conceptId === 'c-2');
    expect(covC2?.flags).toContain('NO_PREFERRED_EXPRESSION');

    const covC3 = report.conceptCoverageItems.find((i) => i.conceptId === 'c-3');
    expect(covC3?.flags).toContain('MISSING_EN_EXPRESSION');
    expect(covC3?.flags).toContain('MISSING_TR_EXPRESSION');
    expect(covC3?.flags).toContain('NO_PREFERRED_EXPRESSION');

    // 4. Expression advisory items: e-3a has UNDETERMINED_LANGUAGE, UNSPECIFIED_ROLE, FORMULA_LEADING_TEXT
    const advE3 = report.expressionAdvisoryItems.find((i) => i.expressionId === 'e-3a');
    expect(advE3?.flags).toEqual([
      'UNDETERMINED_LANGUAGE',
      'UNSPECIFIED_ROLE',
      'FORMULA_LEADING_TEXT',
    ]);

    // 5. Protected expression inventory: e-1a is user-confirmed protected
    expect(report.protectedExpressionItems).toHaveLength(1);
    expect(report.protectedExpressionItems[0]).toMatchObject({
      expressionId: 'e-1a',
      conceptId: 'c-1',
      text: 'PD',
      assertionId: 'a-1a',
    });
  });

  it('surfaces canonical parser/referential integrity failures fail-closed without attempting automatic repair and supports bounded pagination at scale', () => {
    // 1. Corrupted snapshot (orphan expression pointing to missing concept) fails closed
    const corrupted = {
      ...createEmptySnapshot(),
      libraryRevision: 1,
      concepts: [],
      expressions: [
        {
          id: 'e-orphan',
          conceptId: 'c-missing',
          revision: 0,
          text: 'Orphan term',
          language: { kind: 'language' as const, tag: 'en' as const },
          role: 'preferred' as const,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    };

    const badReport = inspectLibraryQuality(corrupted);
    expect(badReport.referentialIntegrity.status).toBe('invalid-fail-closed');
    expect(badReport.referentialIntegrity.errorMessage).toMatch(/Orphan expression/i);
    expect(badReport.exactSameConceptDuplicates).toEqual([]);

    // 2. Bounded scale: 2,500 concepts / 5,000 expressions inspected deterministically + paginated at 50 items per page
    const concepts = [];
    const expressions = [];
    const provenance = [];
    for (let i = 0; i < 2500; i += 1) {
      const cid = `c-${String(i).padStart(5, '0')}`;
      const eid1 = `e-${String(i).padStart(5, '0')}-en`;
      const eid2 = `e-${String(i).padStart(5, '0')}-tr`;
      concepts.push({ id: cid, revision: 1, createdAt: TS, updatedAt: TS });
      expressions.push({
        id: eid1,
        conceptId: cid,
        revision: 0,
        text: `Term_EN_${i}`,
        language: { kind: 'language' as const, tag: 'en' as const },
        role: 'preferred' as const,
        createdAt: TS,
        updatedAt: TS,
      });
      expressions.push({
        id: eid2,
        conceptId: cid,
        revision: 0,
        text: `Term_TR_${i}`,
        language: { kind: 'language' as const, tag: 'tr' as const },
        role: 'unspecified' as const,
        createdAt: TS,
        updatedAt: TS,
      });
      provenance.push({ id: `p-${eid1}`, expressionId: eid1, kind: 'manual' as const, createdAt: TS, source: null });
      provenance.push({ id: `p-${eid2}`, expressionId: eid2, kind: 'manual' as const, createdAt: TS, source: null });
    }

    const scaleSnap: LibrarySnapshot = {
      ...createEmptySnapshot(),
      libraryRevision: 100,
      concepts,
      expressions,
      provenance,
    };

    const scaleReport = inspectLibraryQuality(scaleSnap);
    expect(scaleReport.referentialIntegrity.status).toBe('valid');
    expect(scaleReport.expressionAdvisoryItems).toHaveLength(2500);

    const page1 = paginateQualityItems(scaleReport.expressionAdvisoryItems, 1, QUALITY_INSPECTOR_PAGE_SIZE);
    expect(page1.items).toHaveLength(50);
    expect(page1.totalItems).toBe(2500);
    expect(page1.totalPages).toBe(50);
    expect(page1.currentPage).toBe(1);
  });
});
