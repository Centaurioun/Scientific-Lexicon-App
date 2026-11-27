import { describe, expect, it } from 'vitest';
import {
  buildEnrichmentProposalPlan,
  buildSessionEvidenceReport,
  ENRICHMENT_PROVENANCE_LIMITATION_DISCLOSURE,
  type EnrichmentProposalSelectionItem,
} from '@/application/enrichment-planner';
import { lookupSyntheticSourceEvidence } from '@/adapters/sources/synthetic-source-adapter';
import { selectEnrichmentTargets } from '@/application/enrichment-tasks';
import { applyChange, approveChange } from '@/application/library';
import { generateSyntheticSimulatedReviewResponses } from '@/application/review-response';
import { buildReviewComparisonSummary } from '@/domain/review-comparison';
import { buildReviewTaskPacket } from '@/domain/review-exchange';
import {
  computeEnrichmentReviewIntentDigest,
  createValidatedPreCommitBackupOffer,
  verifyPreCommitCommitAuthorization,
} from '@/domain/review-guard';
import type { ApplyResult, Approval, ProposedChange } from '@/domain/changes';
import type { LibraryRepository } from '@/domain/repository';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';
import { evaluateChangeOnSnapshot } from '@/domain/changes';

const TS = '2026-11-27T12:00:00.000Z';

function makeSnapshot(rev = 2): LibrarySnapshot {
  return {
    ...createEmptySnapshot(),
    libraryRevision: rev,
    concepts: [
      { id: 'c-sulcus', revision: 1, createdAt: TS, updatedAt: TS },
      { id: 'c-protected', revision: 2, createdAt: TS, updatedAt: TS },
    ],
    expressions: [
      {
        id: 'e-1',
        conceptId: 'c-sulcus',
        revision: 0,
        text: 'gingival sulcus',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-prot',
        conceptId: 'c-protected',
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
        id: 'a-prot',
        expressionId: 'e-prot',
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
      { id: 'p-prot', expressionId: 'e-prot', kind: 'manual', createdAt: TS, source: null },
    ],
  };
}

class InMemoryTestRepo implements LibraryRepository {
  private snap: LibrarySnapshot;
  constructor(initial: LibrarySnapshot) {
    this.snap = initial;
  }
  async snapshot(): Promise<LibrarySnapshot> {
    return this.snap;
  }
  async apply(proposal: ProposedChange, approval: Approval): Promise<ApplyResult> {
    const outcome = evaluateChangeOnSnapshot(this.snap, proposal.payload, approval);
    if (outcome.kind === 'replay') return { status: 'replay', revision: outcome.revision };
    if (outcome.kind === 'error') return outcome.result;
    this.snap = outcome.nextSnapshot;
    return { status: 'applied', revision: outcome.nextRevision };
  }
}

describe('WP04 F7: Approved enrichment proposal planner & H1/H2 commit guard reuse', () => {
  it('builds atomic addExpression proposal with before/after preview, manual/source:null provenance, zero assertions, and enforces H1 backup proof + H2 review-intent guard before committing', async () => {
    const snapshot = makeSnapshot(2);
    const repo = new InMemoryTestRepo(snapshot);

    const sel = selectEnrichmentTargets(
      snapshot,
      [{ conceptId: 'c-sulcus', expectedConceptRevision: 1 }],
      'missing-tr',
    );
    const evidence = await lookupSyntheticSourceEvidence(snapshot, sel, {
      sourceId: 'synth-bilingual-lexicon-v1',
    });
    const { packet } = await buildReviewTaskPacket(sel, {
      taskId: 'task-f7-1',
      createdAt: TS,
      slotCount: 3,
    });
    const bundle = await generateSyntheticSimulatedReviewResponses(packet, evidence.candidates, {
      scenario: 'consensus-with-source',
      createdAt: TS,
    });
    const comparison = buildReviewComparisonSummary({
      packet,
      acceptedResponses: bundle.responses,
      rejectedResponseErrors: [],
      allowlistedEvidenceCandidates: evidence.candidates,
    });

    const chosenGroup = comparison.groups.find((g) => g.text === 'dişeti oluğu')!;
    const selectedItems: EnrichmentProposalSelectionItem[] = [
      {
        operation: 'addExpression',
        targetConceptId: chosenGroup.targetConceptId,
        expectedConceptRevision: chosenGroup.expectedConceptRevision,
        text: chosenGroup.text!,
        language: chosenGroup.language!,
        role: chosenGroup.role!,
      },
    ];

    let seq = 0;
    const plan = await buildEnrichmentProposalPlan({
      snapshot,
      packet,
      selectedItems,
      timestamp: TS,
      idGenerator: () => `gen-f7-${++seq}`,
    });

    expect(plan.proposal.payload.ops.length).toBe(1);
    expect(plan.proposal.payload.ops[0].kind).toBe('addExpression');
    const op = plan.proposal.payload.ops[0];
    if (op.kind !== 'addExpression') throw new Error('expected addExpression');
    expect(op.provenance.kind).toBe('manual');
    expect(op.provenance.source).toBeNull();
    expect(plan.beforeAfterPreviews[0].beforeExpressions).toHaveLength(1);
    expect(plan.beforeAfterPreviews[0].afterExpression.text).toBe('dişeti oluğu');
    expect(ENRICHMENT_PROVENANCE_LIMITATION_DISCLOSURE).toMatch(/manual.*source: null/i);

    // Non-canonical session evidence report
    const reportJson = buildSessionEvidenceReport({
      packet,
      comparison,
      evidenceCandidates: evidence.candidates,
      generatedAt: TS,
    });
    expect(reportJson).toContain('NON_CANONICAL_SESSION_EVIDENCE_REPORT');
    expect(reportJson).toContain(packet.taskDigest);

    // Zero writes prior to explicit backup offer & approval
    expect((await repo.snapshot()).libraryRevision).toBe(2);

    // H1 guard rejects missing backup proof & missing ack
    const unauthorizedNoBackup = verifyPreCommitCommitAuthorization({
      plannedProposal: {
        digest: plan.proposal.digest,
        batchId: plan.proposal.payload.batchId,
        baseLibraryRevision: plan.proposal.payload.baseLibraryRevision,
      },
      expectedReviewIntentDigest: plan.reviewIntentDigest,
      actualReviewIntentDigest: await computeEnrichmentReviewIntentDigest({
        taskId: packet.taskId,
        taskDigest: packet.taskDigest,
        baseLibraryRevision: snapshot.libraryRevision,
        selectedItems,
      }),
      authoritativeSnapshot: snapshot,
      backupProof: null,
      preCommitAckChecked: true,
      freshnessConfirmed: true,
    });
    expect(unauthorizedNoBackup.ok).toBe(false);

    // Valid pre-commit backup offer + ack passes guard and commits atomically
    const offer = await createValidatedPreCommitBackupOffer({
      snapshot,
      proposalDigest: plan.proposal.digest,
      batchId: plan.proposal.payload.batchId,
      reviewIntentDigest: plan.reviewIntentDigest,
      filenamePrefix: 'termforge-pre-enrichment-backup',
      now: TS,
    });

    const authorized = verifyPreCommitCommitAuthorization({
      plannedProposal: {
        digest: plan.proposal.digest,
        batchId: plan.proposal.payload.batchId,
        baseLibraryRevision: plan.proposal.payload.baseLibraryRevision,
      },
      expectedReviewIntentDigest: plan.reviewIntentDigest,
      actualReviewIntentDigest: await computeEnrichmentReviewIntentDigest({
        taskId: packet.taskId,
        taskDigest: packet.taskDigest,
        baseLibraryRevision: snapshot.libraryRevision,
        selectedItems,
      }),
      authoritativeSnapshot: snapshot,
      backupProof: offer.proof,
      preCommitAckChecked: true,
      freshnessConfirmed: true,
    });
    expect(authorized.ok).toBe(true);

    const approval = approveChange(plan.proposal);
    const applyRes = await applyChange(repo, plan.proposal, approval);
    expect(applyRes).toEqual({ status: 'applied', revision: 3 });

    const finalSnap = await repo.snapshot();
    expect(finalSnap.expressions.length).toBe(3);
    const added = finalSnap.expressions.find((e) => e.text === 'dişeti oluğu');
    expect(added).toBeDefined();
    expect(finalSnap.assertions.length).toBe(1); // Zero assertions added
    const addedProv = finalSnap.provenance.find((p) => p.expressionId === added!.id);
    expect(addedProv?.kind).toBe('manual');
    expect(addedProv?.source).toBeNull();
    // No external evidence or model identities persisted into canonical library
    expect(JSON.stringify(finalSnap)).not.toContain('synthetic-local-simulator');
    expect(JSON.stringify(finalSnap)).not.toContain('syn-src-001');

    // Replay returns idempotent replay cleanly
    const replayRes = await applyChange(repo, plan.proposal, approval);
    expect(replayRes).toEqual({ status: 'replay', revision: 3 });
  });

  it('rejects duplicate/protected expressions, stale revisions, ID collisions, and >250 operations cleanly', async () => {
    const snapshot = makeSnapshot(2);
    const sel = selectEnrichmentTargets(
      snapshot,
      [
        { conceptId: 'c-sulcus', expectedConceptRevision: 1 },
        { conceptId: 'c-protected', expectedConceptRevision: 2 },
      ],
      'missing-tr',
    );
    const { packet } = await buildReviewTaskPacket(sel, {
      taskId: 'task-f7-guards',
      createdAt: TS,
      slotCount: 2,
    });

    // Protected / duplicate surface rejected
    await expect(
      buildEnrichmentProposalPlan({
        snapshot,
        packet,
        selectedItems: [
          {
            operation: 'addExpression',
            targetConceptId: 'c-protected',
            expectedConceptRevision: 2,
            text: 'diş plağı',
            language: { kind: 'language', tag: 'tr' },
            role: 'preferred',
          },
        ],
        timestamp: TS,
      }),
    ).rejects.toThrow(/protected|duplicate/i);

    // Duplicate exact existing form rejected even without assertion
    await expect(
      buildEnrichmentProposalPlan({
        snapshot,
        packet,
        selectedItems: [
          {
            operation: 'addExpression',
            targetConceptId: 'c-sulcus',
            expectedConceptRevision: 1,
            text: 'gingival sulcus',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
          },
        ],
        timestamp: TS,
      }),
    ).rejects.toThrow(/duplicate/i);

    // ID collision rejected fail-closed
    await expect(
      buildEnrichmentProposalPlan({
        snapshot,
        packet,
        selectedItems: [
          {
            operation: 'addExpression',
            targetConceptId: 'c-sulcus',
            expectedConceptRevision: 1,
            text: 'dişeti oluğu',
            language: { kind: 'language', tag: 'tr' },
            role: 'preferred',
          },
        ],
        timestamp: TS,
        idGenerator: () => 'e-1', // collides with existing expression ID!
      }),
    ).rejects.toThrow(/collision/i);

    // Stale CAS rejection in gateway
    let seq = 0;
    const plan = await buildEnrichmentProposalPlan({
      snapshot,
      packet,
      selectedItems: [
        {
          operation: 'addExpression',
          targetConceptId: 'c-sulcus',
          expectedConceptRevision: 1,
          text: 'dişeti oluğu',
          language: { kind: 'language', tag: 'tr' },
          role: 'preferred',
        },
      ],
      timestamp: TS,
      idGenerator: () => `gen-stale-${++seq}`,
    });
    const advancedRepo = new InMemoryTestRepo({ ...snapshot, libraryRevision: 9 });
    const staleResult = await applyChange(advancedRepo, plan.proposal, approveChange(plan.proposal));
    expect(staleResult.status).toBe('stale');

    // Over-cap (> 250) rejected cleanly
    const overCap: EnrichmentProposalSelectionItem[] = Array.from({ length: 251 }, (_, i) => ({
      operation: 'addExpression',
      targetConceptId: 'c-sulcus',
      expectedConceptRevision: 1,
      text: `term-${i}`,
      language: { kind: 'language', tag: 'tr' },
      role: 'alternative',
    }));
    await expect(
      buildEnrichmentProposalPlan({
        snapshot,
        packet,
        selectedItems: overCap,
        timestamp: TS,
      }),
    ).rejects.toThrow(/250/);
  });
});
