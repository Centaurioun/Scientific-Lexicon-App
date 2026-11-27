import { describe, expect, it } from 'vitest';
import { parseDelimitedText } from '@/domain/delimited-intake';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';
import {
  applyStagingMapping,
  STAGING_MAPPING_SCHEMA_VERSION,
  type StagingMappingSpec,
} from '@/domain/staging-mapping';
import {
  evaluateStagingReview,
  type StagedRowUserDecision,
} from '@/domain/staging-review';

const TS = '2026-11-27T10:00:00.000Z';

function makeSeededLibrary(): LibrarySnapshot {
  return {
    ...createEmptySnapshot(),
    libraryRevision: 4,
    concepts: [
      { id: 'c-pd-perio', revision: 1, createdAt: TS, updatedAt: TS },
      { id: 'c-pd-neuro', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c-p53-gene', revision: 0, createdAt: TS, updatedAt: TS },
    ],
    expressions: [
      {
        id: 'e-pd-1',
        conceptId: 'c-pd-perio',
        revision: 1,
        text: 'PD',
        language: { kind: 'language', tag: 'en' },
        role: 'abbreviation',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-pd-1-full',
        conceptId: 'c-pd-perio',
        revision: 0,
        text: 'probing depth',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-pd-2',
        conceptId: 'c-pd-neuro',
        revision: 0,
        text: 'PD',
        language: { kind: 'language', tag: 'en' },
        role: 'abbreviation',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-p53',
        conceptId: 'c-p53-gene',
        revision: 0,
        text: 'p53',
        language: { kind: 'shared' },
        role: 'abbreviation',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    assertions: [
      {
        id: 'a-pd-1',
        expressionId: 'e-pd-1',
        field: 'text',
        value: 'PD',
        recordRevision: 1,
        kind: 'user-confirmed',
        actor: 'local-user',
        assertedAt: TS,
      },
    ],
    provenance: [
      { id: 'p1', expressionId: 'e-pd-1', kind: 'manual', createdAt: TS, source: null },
      { id: 'p2', expressionId: 'e-pd-1-full', kind: 'manual', createdAt: TS, source: null },
      { id: 'p3', expressionId: 'e-pd-2', kind: 'manual', createdAt: TS, source: null },
      { id: 'p4', expressionId: 'e-p53', kind: 'manual', createdAt: TS, source: null },
    ],
  };
}

const DEFAULT_SPEC: StagingMappingSpec = {
  mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
  termColumnIndex: 1,
  languageSource: { kind: 'column', columnIndex: 2, missingPolicy: 'error' },
  roleSource: { kind: 'column', columnIndex: 3, missingPolicy: 'error' },
  groupKeyColumnIndex: 0,
  textTransform: 'trim-exterior',
};

describe('WP03 E4: Duplicate/conflict classification, grouping review, and explicit row/group decisions', () => {
  it('distinguishes exact single-concept match, protected existing form, ambiguous multi-concept homonym, intra-stage duplicate, and advisory case/whitespace similarity without auto-merging', async () => {
    const csv = [
      'grp,term,lang,role',
      'G-PERIO,probing depth,en,preferred', // row 1: exact match to single concept c-pd-perio
      'G-PERIO,sondalama derinliği,tr,preferred', // row 2: compatible new TR expression in G-PERIO
      'G-AMB,PD,en,abbreviation', // row 3: matches BOTH c-pd-perio (protected!) and c-pd-neuro -> ambiguous homonym + protected existing value
      'G-PROT,P53,shared,preferred', // row 4: advisory case similarity to existing 'p53' (c-p53-gene), NOT exact duplicate
      'G-NEW,TNF-α,shared,abbreviation', // row 5: novel expression in G-NEW
      'G-NEW,TNF-α,shared,abbreviation', // row 6: intra-stage exact duplicate of row 5 in G-NEW
      'G-OTHER,TNF-α,shared,abbreviation', // row 7: intra-stage homonym across different group G-OTHER vs G-NEW
    ].join('\n');

    const raw = await parseDelimitedText(csv, { delimiter: ',' });
    const snapshot = makeSeededLibrary();
    const mapped = applyStagingMapping(raw, DEFAULT_SPEC, snapshot.libraryRevision);

    // Evaluate with no explicit user decisions yet -> groups and ambiguous/duplicate rows require review!
    const initialReview = evaluateStagingReview(mapped, snapshot, {});

    // Row 1: exact match to single existing concept c-pd-perio
    expect(initialReview.rows[0].classification).toBe('exact-single-concept-match');
    expect(initialReview.rows[0].matchingExistingConceptIds).toEqual(['c-pd-perio']);

    // Row 2: novel surface in group G-PERIO
    expect(initialReview.rows[1].classification).toBe('new-surface');

    // Row 3: 'PD' matches c-pd-perio and c-pd-neuro, and e-pd-1 is user-confirmed protected
    expect(initialReview.rows[2].classification).toBe('ambiguous-multi-concept-homonym');
    expect(initialReview.rows[2].matchingExistingConceptIds).toEqual(['c-pd-neuro', 'c-pd-perio']);
    expect(initialReview.rows[2].matchesProtectedExistingExpression).toBe(true);
    expect(initialReview.rows[2].conflictFlags).toContain('AMBIGUOUS_EXISTING_HOMONYM');
    expect(initialReview.rows[2].conflictFlags).toContain('PROTECTED_EXISTING_MATCH');

    // Row 4: 'P53' has non-exact case/whitespace advisory similarity to existing 'p53', never auto-merged
    expect(initialReview.rows[3].classification).toBe('new-surface');
    expect(initialReview.rows[3].advisorySimilarConceptIds).toEqual(['c-p53-gene']);
    expect(initialReview.rows[3].conflictFlags).toContain('ADVISORY_CASE_OR_WHITESPACE_SIMILARITY');

    // Row 6: intra-stage exact duplicate in G-NEW (same text, language, role, group)
    expect(initialReview.rows[5].conflictFlags).toContain('INTRA_STAGE_DUPLICATE');

    // Row 7: intra-stage same surface across different staged groups (G-NEW vs G-OTHER)
    expect(initialReview.rows[6].conflictFlags).toContain('INTRA_STAGE_CROSS_GROUP_HOMONYM');

    // Because G-PERIO, G-AMB, G-NEW, G-OTHER have unreviewed decisions/conflicts, approval is blocked
    expect(initialReview.canBuildProposal).toBe(false);
    expect(initialReview.counts.unresolvedRowCount).toBeGreaterThan(0);
  });

  it('enforces group target consistency and allows explicit user decisions to skip duplicates, link to existing concepts, or create new staged concepts', async () => {
    const csv = [
      'grp,term,lang,role',
      'G-PERIO,probing depth,en,preferred', // row 1: already exists in c-pd-perio -> user skips
      'G-PERIO,sondalama derinliği,tr,preferred', // row 2: user links to existing c-pd-perio
      'G-DNP,"2,4-dinitrophenol",en,preferred', // row 3: user creates new concept for G-DNP
      'G-DNP,"2,4-dinitrofenol",tr,preferred', // row 4: user links to staged group G-DNP
    ].join('\n');

    const raw = await parseDelimitedText(csv, { delimiter: ',' });
    const snapshot = makeSeededLibrary();
    const mapped = applyStagingMapping(raw, DEFAULT_SPEC, snapshot.libraryRevision);

    // 1. Conflicting group target: row 1 targets c-pd-perio, row 2 creates new concept for G-PERIO -> GROUP_TARGET_CONFLICT!
    const conflictingDecisions: Record<string, StagedRowUserDecision> = {
      'row-1': { action: 'link-existing-concept', targetConceptId: 'c-pd-perio' },
      'row-2': { action: 'create-new-concept' },
      'row-3': { action: 'create-new-concept' },
      'row-4': { action: 'link-staged-group', groupKey: 'G-DNP' },
    };
    const conflictReview = evaluateStagingReview(mapped, snapshot, conflictingDecisions);
    expect(conflictReview.canBuildProposal).toBe(false);
    expect(conflictReview.rows[0].conflictFlags).toContain('GROUP_TARGET_CONFLICT');
    expect(conflictReview.rows[1].conflictFlags).toContain('GROUP_TARGET_CONFLICT');

    // 2. Exact duplicate row 1 attempting to link-existing-concept to c-pd-perio where 'probing depth' (en, preferred) already exists -> EXACT_SAME_CONCEPT_DUPLICATE blocks unless skipped!
    const duplicateTargetDecisions: Record<string, StagedRowUserDecision> = {
      'row-1': { action: 'link-existing-concept', targetConceptId: 'c-pd-perio' },
      'row-2': { action: 'link-existing-concept', targetConceptId: 'c-pd-perio' },
      'row-3': { action: 'create-new-concept' },
      'row-4': { action: 'link-staged-group', groupKey: 'G-DNP' },
    };
    const dupTargetReview = evaluateStagingReview(mapped, snapshot, duplicateTargetDecisions);
    expect(dupTargetReview.rows[0].conflictFlags).toContain('EXACT_SAME_CONCEPT_DUPLICATE');
    expect(dupTargetReview.canBuildProposal).toBe(false);

    // 3. Clean reviewed decisions: row 1 skipped, row 2 linked to c-pd-perio, row 3 creates new concept for G-DNP, row 4 joins staged group G-DNP
    const cleanDecisions: Record<string, StagedRowUserDecision> = {
      'row-1': { action: 'skip' },
      'row-2': { action: 'link-existing-concept', targetConceptId: 'c-pd-perio' },
      'row-3': { action: 'create-new-concept' },
      'row-4': { action: 'link-staged-group', groupKey: 'G-DNP' },
    };
    const cleanReview = evaluateStagingReview(mapped, snapshot, cleanDecisions);
    expect(cleanReview.canBuildProposal).toBe(true);
    expect(cleanReview.counts).toEqual({
      totalRows: 4,
      validRows: 4,
      invalidRows: 0,
      createConceptCount: 1,
      addExpressionToExistingCount: 1,
      addExpressionToStagedGroupCount: 1,
      skippedRowCount: 1,
      unresolvedRowCount: 0,
      blockingConflictRowCount: 0,
    });
  });
});
