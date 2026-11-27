import { describe, expect, it } from 'vitest';
import { parseDelimitedText } from '@/domain/delimited-intake';
import { evaluateChangeOnSnapshot } from '@/domain/changes';
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
import {
  buildAdditiveImportPlan,
  ImportPlanningError,
} from '@/application/import-planner';
import { approveChange } from '@/application/library';

const TS = '2026-11-27T10:30:00.000Z';

function makeSnapshotWithExistingConcept(): LibrarySnapshot {
  return {
    ...createEmptySnapshot(),
    libraryRevision: 7,
    concepts: [
      { id: 'c-existing-perio', revision: 2, createdAt: TS, updatedAt: TS },
    ],
    expressions: [
      {
        id: 'e-existing-perio',
        conceptId: 'c-existing-perio',
        revision: 1,
        text: 'periodontal ligament',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    assertions: [
      {
        id: 'a-existing-perio',
        expressionId: 'e-existing-perio',
        field: 'text',
        value: 'periodontal ligament',
        recordRevision: 1,
        kind: 'user-confirmed',
        actor: 'local-user',
        assertedAt: TS,
      },
    ],
    provenance: [
      { id: 'p-existing-perio', expressionId: 'e-existing-perio', kind: 'manual', createdAt: TS, source: null },
    ],
  };
}

const SPEC: StagingMappingSpec = {
  mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
  termColumnIndex: 1,
  languageSource: { kind: 'column', columnIndex: 2, missingPolicy: 'error' },
  roleSource: { kind: 'column', columnIndex: 3, missingPolicy: 'error' },
  groupKeyColumnIndex: 0,
  textTransform: 'trim-exterior',
};

describe('WP03 E5: Additive import plan and immutable gateway preview', () => {
  it('generates an atomic ChangePayload with createConcept/addExpression only, exact expectedConceptRevision progression, manual source:null provenance, and zero direct writes', async () => {
    const csv = [
      'grp,term,lang,role,unmapped_col',
      'G-NEW-1,probing depth,en,preferred,loss_1',
      'G-NEW-1,PD,en,abbreviation,loss_2',
      'G-NEW-1,sondalama derinliği,tr,preferred,loss_3',
      'G-EXIST,periodontal ligament,en,preferred,loss_4', // exact duplicate -> skip
      'G-EXIST,periodontal bağ,tr,preferred,loss_5', // link to existing c-existing-perio (starts at rev 2 -> expected 2)
      'G-EXIST,PDL,en,abbreviation,loss_6', // second link to c-existing-perio in same batch (expected 3)
    ].join('\n');

    const raw = await parseDelimitedText(csv, { delimiter: ',' });
    const snapshot = makeSnapshotWithExistingConcept();
    const mapped = applyStagingMapping(raw, SPEC, snapshot.libraryRevision);

    const decisions: Record<string, StagedRowUserDecision> = {
      'row-1': { action: 'create-new-concept' },
      'row-2': { action: 'link-staged-group', groupKey: 'G-NEW-1' },
      'row-3': { action: 'link-staged-group', groupKey: 'G-NEW-1' },
      'row-4': { action: 'skip' },
      'row-5': { action: 'link-existing-concept', targetConceptId: 'c-existing-perio' },
      'row-6': { action: 'link-existing-concept', targetConceptId: 'c-existing-perio' },
    };

    const review = evaluateStagingReview(mapped, snapshot, decisions);
    expect(review.canBuildProposal).toBe(true);

    const plan = await buildAdditiveImportPlan(review, snapshot);

    // 1. Exact operation cardinality & kinds
    expect(plan.proposal.payload.baseLibraryRevision).toBe(7);
    expect(plan.proposal.payload.ops).toHaveLength(5);
    expect(plan.summary.totalOperations).toBe(5);
    expect(plan.summary.createConceptCount).toBe(1);
    expect(plan.summary.addExpressionCount).toBe(4);
    expect(plan.summary.skippedRowCount).toBe(1);
    expect(plan.summary.unresolvedRowCount).toBe(0);
    expect(plan.summary.unmappedColumnCount).toBe(1);
    expect(plan.summary.provenanceLimitationDisclosure).toMatch(/source: null|not preserved as canonical source evidence/i);

    const ops = plan.proposal.payload.ops;
    expect(ops[0].kind).toBe('createConcept');
    if (ops[0].kind === 'createConcept') {
      const createdConceptId = ops[0].concept.id;
      expect(ops[0].provenance.kind).toBe('manual');
      expect(ops[0].provenance.source).toBeNull();

      // Next two ops link to the newly created concept with expectedConceptRevision 0 then 1
      expect(ops[1].kind).toBe('addExpression');
      expect(ops[2].kind).toBe('addExpression');
      if (ops[1].kind === 'addExpression' && ops[2].kind === 'addExpression') {
        expect(ops[1].expression.conceptId).toBe(createdConceptId);
        expect(ops[1].expectedConceptRevision).toBe(0);
        expect(ops[1].provenance.kind).toBe('manual');
        expect(ops[1].provenance.source).toBeNull();

        expect(ops[2].expression.conceptId).toBe(createdConceptId);
        expect(ops[2].expectedConceptRevision).toBe(1);
      }
    }

    // Ops 3 and 4 link to existing concept 'c-existing-perio' (currently at revision 2 -> expected 2 then 3)
    expect(ops[3].kind).toBe('addExpression');
    expect(ops[4].kind).toBe('addExpression');
    if (ops[3].kind === 'addExpression' && ops[4].kind === 'addExpression') {
      expect(ops[3].expression.conceptId).toBe('c-existing-perio');
      expect(ops[3].expectedConceptRevision).toBe(2);
      expect(ops[4].expression.conceptId).toBe('c-existing-perio');
      expect(ops[4].expectedConceptRevision).toBe(3);
    }

    // 2. Evaluate against canonical gateway -> applies cleanly, advances libraryRevision 7 -> 8,
    // creates 0 assertions, and leaves protected existing assertion intact!
    const approval = approveChange(plan.proposal);
    const outcome = evaluateChangeOnSnapshot(snapshot, plan.proposal.payload, approval);
    expect(outcome.kind).toBe('apply');
    if (outcome.kind === 'apply') {
      expect(outcome.nextRevision).toBe(8);
      expect(outcome.createdAssertions).toHaveLength(0);
      expect(outcome.nextSnapshot.concepts).toHaveLength(2);
      expect(outcome.nextSnapshot.expressions).toHaveLength(6);

      // Replaying the exact same proposal against the post-apply snapshot returns replay at rev 8
      const replayOutcome = evaluateChangeOnSnapshot(
        outcome.nextSnapshot,
        plan.proposal.payload,
        approval,
      );
      expect(replayOutcome).toEqual({ kind: 'replay', revision: 8 });
    }
  });

  it('rejects unresolved rows, stale snapshot revisions, ID collisions, and batches exceeding 250 operations before any partial write', async () => {
    const snapshot = makeSnapshotWithExistingConcept();

    // 1. Unresolved row blocks plan generation
    const smallCsv = 'grp,term,lang,role\nG1,TNF-α,shared,abbreviation';
    const rawSmall = await parseDelimitedText(smallCsv, { delimiter: ',' });
    const mappedSmall = applyStagingMapping(rawSmall, SPEC, snapshot.libraryRevision);
    const unresolvedReview = evaluateStagingReview(mappedSmall, snapshot, {});
    await expect(buildAdditiveImportPlan(unresolvedReview, snapshot)).rejects.toThrowError(
      ImportPlanningError,
    );

    // 2. Stale snapshot revision (mapped at rev 6 vs current snapshot rev 7) rejected fail-closed
    const mappedStale = applyStagingMapping(rawSmall, SPEC, 6);
    const staleReview = evaluateStagingReview(mappedStale, snapshot, {
      'row-1': { action: 'create-new-concept' },
    });
    await expect(buildAdditiveImportPlan(staleReview, snapshot)).rejects.toThrowError(/stale/i);

    // 3. ID collision with existing snapshot ID rejected fail-closed
    const validReview = evaluateStagingReview(mappedSmall, snapshot, {
      'row-1': { action: 'create-new-concept' },
    });
    await expect(
      buildAdditiveImportPlan(validReview, snapshot, {
        idGenerator: () => 'c-existing-perio',
      }),
    ).rejects.toThrowError(/collision|already exists/i);

    // 4. >250 operations (251 rows selected for create-new-concept) rejected before any partial write
    const rows251 = ['grp,term,lang,role'];
    const decisions251: Record<string, StagedRowUserDecision> = {};
    for (let i = 1; i <= 251; i += 1) {
      rows251.push(`,Term_${i},en,preferred`);
      decisions251[`row-${i}`] = { action: 'create-new-concept' };
    }
    const raw251 = await parseDelimitedText(rows251.join('\n'), { delimiter: ',' });
    const mapped251 = applyStagingMapping(raw251, SPEC, snapshot.libraryRevision);
    const review251 = evaluateStagingReview(mapped251, snapshot, decisions251);
    expect(review251.canBuildProposal).toBe(true);

    await expect(buildAdditiveImportPlan(review251, snapshot)).rejects.toThrowError(/250/);

    // Exactly 250 operations succeeds
    decisions251['row-251'] = { action: 'skip' };
    const review250 = evaluateStagingReview(mapped251, snapshot, decisions251);
    const plan250 = await buildAdditiveImportPlan(review250, snapshot);
    expect(plan250.proposal.payload.ops).toHaveLength(250);
  });
});
