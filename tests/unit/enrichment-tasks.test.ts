import { describe, expect, it } from 'vitest';
import {
  discoverMissingFieldTasks,
  ENRICHMENT_TASK_MAX_PAGE_SIZE,
  ENRICHMENT_TASK_MAX_TARGETS,
  selectEnrichmentTargets,
} from '@/application/enrichment-tasks';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

const TS = '2026-11-27T12:00:00.000Z';

function makeTestSnapshot(): LibrarySnapshot {
  return {
    ...createEmptySnapshot(),
    libraryRevision: 4,
    concepts: [
      { id: 'c-en-only', revision: 1, createdAt: TS, updatedAt: TS },
      { id: 'c-tr-only', revision: 2, createdAt: TS, updatedAt: TS },
      { id: 'c-shared-unspec', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c-homonym-a', revision: 3, createdAt: TS, updatedAt: TS },
      { id: 'c-homonym-b', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c-complete-protected', revision: 5, createdAt: TS, updatedAt: TS },
    ],
    expressions: [
      {
        id: 'e-1',
        conceptId: 'c-en-only',
        revision: 1,
        text: 'gingival sulcus',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-2',
        conceptId: 'c-tr-only',
        revision: 0,
        text: 'dişeti oluğu',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-3',
        conceptId: 'c-shared-unspec',
        revision: 0,
        text: 'H2O2',
        language: { kind: 'shared' },
        role: 'unspecified',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-4',
        conceptId: 'c-shared-unspec-undet',
        revision: 0,
        text: 'undet-token',
        language: { kind: 'undetermined' },
        role: 'alternative',
        createdAt: TS,
        updatedAt: TS,
      }.conceptId === 'c-shared-unspec-undet'
        ? {
            id: 'e-4',
            conceptId: 'c-shared-unspec',
            revision: 0,
            text: 'undet-token',
            language: { kind: 'undetermined' },
            role: 'alternative',
            createdAt: TS,
            updatedAt: TS,
          }
        : ({} as never),
      {
        id: 'e-5',
        conceptId: 'c-homonym-a',
        revision: 1,
        text: 'PD',
        language: { kind: 'language', tag: 'en' },
        role: 'abbreviation',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-6',
        conceptId: 'c-homonym-b',
        revision: 0,
        text: 'PD',
        language: { kind: 'language', tag: 'en' },
        role: 'abbreviation',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-7',
        conceptId: 'c-complete-protected',
        revision: 2,
        text: 'dental plaque',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-8',
        conceptId: 'c-complete-protected',
        revision: 1,
        text: 'diş plağı',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    assertions: [
      {
        id: 'a-1',
        expressionId: 'e-7',
        field: 'text',
        value: 'dental plaque',
        recordRevision: 2,
        kind: 'user-confirmed',
        actor: 'local-user',
        assertedAt: TS,
      },
      {
        id: 'a-2',
        expressionId: 'e-8',
        field: 'text',
        value: 'diş plağı',
        recordRevision: 1,
        kind: 'user-confirmed',
        actor: 'local-user',
        assertedAt: TS,
      },
    ],
    provenance: [
      { id: 'p-1', expressionId: 'e-1', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-2', expressionId: 'e-2', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-3', expressionId: 'e-3', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-4', expressionId: 'e-4', kind: 'reviewed-candidate', createdAt: TS, source: null },
      { id: 'p-5', expressionId: 'e-5', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-6', expressionId: 'e-6', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-7', expressionId: 'e-7', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-8', expressionId: 'e-8', kind: 'manual', createdAt: TS, source: null },
    ],
    documents: [
      {
        id: 'doc-secret',
        title: 'Private Manuscript',
        text: 'PRIVATE_SYNTH_DOC_TEXT_F2_MUST_NOT_LEAK gingival sulcus',
        createdAt: TS,
      },
    ],
  };
}

describe('WP04 F2: Missing-field task discovery & bounded target selection', () => {
  it('handles an empty library cleanly without errors', () => {
    const empty = createEmptySnapshot();
    const page = discoverMissingFieldTasks(empty);
    expect(page.baseLibraryRevision).toBe(0);
    expect(page.totalItems).toBe(0);
    expect(page.items).toEqual([]);
  });

  it('discovers missing-tr, missing-en, unspecified-role, undetermined-language, candidate-review, protected flags, and homonym siblings deterministically without leaking document text', () => {
    const snapshot = makeTestSnapshot();
    const page = discoverMissingFieldTasks(snapshot, { taskKind: 'all' });

    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain('PRIVATE_SYNTH_DOC_TEXT_F2_MUST_NOT_LEAK');

    const enOnly = page.items.find((i) => i.conceptId === 'c-en-only');
    expect(enOnly?.conceptRevision).toBe(1);
    expect(enOnly?.eligibleKinds).toContain('missing-tr');
    expect(enOnly?.eligibleKinds).not.toContain('missing-en');
    expect(enOnly?.uncertaintyNotice).toMatch(/absence.*not an error|no inferred translation/i);

    const trOnly = page.items.find((i) => i.conceptId === 'c-tr-only');
    expect(trOnly?.conceptRevision).toBe(2);
    expect(trOnly?.eligibleKinds).toContain('missing-en');
    expect(trOnly?.eligibleKinds).not.toContain('missing-tr');

    const shared = page.items.find((i) => i.conceptId === 'c-shared-unspec');
    expect(shared?.eligibleKinds).toEqual(
      expect.arrayContaining([
        'missing-en',
        'missing-tr',
        'unspecified-role',
        'undetermined-language',
        'candidate-review',
      ]),
    );

    const homA = page.items.find((i) => i.conceptId === 'c-homonym-a');
    const homB = page.items.find((i) => i.conceptId === 'c-homonym-b');
    expect(homA?.homonymSiblingCount).toBe(1);
    expect(homB?.homonymSiblingCount).toBe(1);

    const completeProtected = page.items.find((i) => i.conceptId === 'c-complete-protected');
    expect(completeProtected).toBeUndefined();
  });

  it('filters cleanly by specific taskKind and preserves protected status on partially asserted concepts', () => {
    const snapshot = makeTestSnapshot();
    snapshot.assertions.push({
      id: 'a-en-only',
      expressionId: 'e-1',
      field: 'text',
      value: 'gingival sulcus',
      recordRevision: 1,
      kind: 'user-confirmed',
      actor: 'local-user',
      assertedAt: TS,
    });

    const missingTr = discoverMissingFieldTasks(snapshot, { taskKind: 'missing-tr' });
    expect(missingTr.items.map((i) => i.conceptId)).toContain('c-en-only');
    const enOnly = missingTr.items.find((i) => i.conceptId === 'c-en-only');
    expect(enOnly?.hasProtectedExpression).toBe(true);
    expect(enOnly?.expressions[0].protected).toBe(true);
  });

  it('enforces bounded pagination (<= 50/page) and bounded explicit target selection with stale revision rejection', () => {
    const base = createEmptySnapshot();
    const concepts = [];
    const expressions = [];
    const provenance = [];
    for (let i = 0; i < 65; i += 1) {
      const cid = `c-${String(i).padStart(3, '0')}`;
      const eid = `e-${String(i).padStart(3, '0')}`;
      concepts.push({ id: cid, revision: i % 3, createdAt: TS, updatedAt: TS });
      expressions.push({
        id: eid,
        conceptId: cid,
        revision: 0,
        text: `synthetic term ${i}`,
        language: { kind: 'language' as const, tag: 'en' as const },
        role: 'preferred' as const,
        createdAt: TS,
        updatedAt: TS,
      });
      provenance.push({
        id: `p-${String(i).padStart(3, '0')}`,
        expressionId: eid,
        kind: 'manual' as const,
        createdAt: TS,
        source: null,
      });
    }
    const largeSnapshot: LibrarySnapshot = {
      ...base,
      libraryRevision: 9,
      concepts,
      expressions,
      provenance,
    };

    expect(() =>
      discoverMissingFieldTasks(largeSnapshot, { pageSize: ENRICHMENT_TASK_MAX_PAGE_SIZE + 1 }),
    ).toThrow(/pageSize/i);

    const page1 = discoverMissingFieldTasks(largeSnapshot, { page: 1, pageSize: 50 });
    const page2 = discoverMissingFieldTasks(largeSnapshot, { page: 2, pageSize: 50 });
    expect(page1.items.length).toBe(50);
    expect(page2.items.length).toBe(15);

    const validSelection = selectEnrichmentTargets(
      largeSnapshot,
      [
        { conceptId: 'c-000', expectedConceptRevision: 0 },
        { conceptId: 'c-001', expectedConceptRevision: 1 },
      ],
      'missing-tr',
    );
    expect(validSelection.baseLibraryRevision).toBe(9);
    expect(validSelection.targets.length).toBe(2);

    // Over 50 targets fails closed
    const tooMany = Array.from({ length: ENRICHMENT_TASK_MAX_TARGETS + 1 }, (_, i) => ({
      conceptId: `c-${String(i).padStart(3, '0')}`,
      expectedConceptRevision: i % 3,
    }));
    expect(() => selectEnrichmentTargets(largeSnapshot, tooMany, 'missing-tr')).toThrow(/50/);

    // Stale concept revision fails closed
    expect(() =>
      selectEnrichmentTargets(
        largeSnapshot,
        [{ conceptId: 'c-001', expectedConceptRevision: 0 }],
        'missing-tr',
      ),
    ).toThrow(/revision/i);

    // Missing concept fails closed
    expect(() =>
      selectEnrichmentTargets(
        largeSnapshot,
        [{ conceptId: 'c-nonexistent', expectedConceptRevision: 0 }],
        'missing-tr',
      ),
    ).toThrow(/missing/i);

    // Empty selection fails closed
    expect(() => selectEnrichmentTargets(largeSnapshot, [], 'missing-tr')).toThrow(/at least one/i);
  });
});
