import { describe, expect, it } from 'vitest';
import {
  buildReviewComparisonSummary,
} from '@/domain/review-comparison';
import { lookupSyntheticSourceEvidence } from '@/adapters/sources/synthetic-source-adapter';
import { selectEnrichmentTargets } from '@/application/enrichment-tasks';
import { generateSyntheticSimulatedReviewResponses } from '@/application/review-response';
import { buildReviewTaskPacket, type ReviewResponseV1 } from '@/domain/review-exchange';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

const TS = '2026-11-27T12:00:00.000Z';

function makeSnapshot(rev = 5): LibrarySnapshot {
  return {
    ...createEmptySnapshot(),
    libraryRevision: rev,
    concepts: [
      { id: 'c-sulcus', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c-homonym-a', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c-homonym-b', revision: 1, createdAt: TS, updatedAt: TS },
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
        id: 'e-2',
        conceptId: 'c-homonym-a',
        revision: 0,
        text: 'PD',
        language: { kind: 'language', tag: 'en' },
        role: 'abbreviation',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-3',
        conceptId: 'c-homonym-b',
        revision: 0,
        text: 'PD',
        language: { kind: 'language', tag: 'en' },
        role: 'abbreviation',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    provenance: [
      { id: 'p-1', expressionId: 'e-1', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-2', expressionId: 'e-2', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-3', expressionId: 'e-3', kind: 'manual', createdAt: TS, source: null },
    ],
  };
}

function makeSlotResponse(
  packet: Awaited<ReturnType<typeof buildReviewTaskPacket>>['packet'],
  slotId: string,
  responseId: string,
  suggestions: ReviewResponseV1['suggestions'],
): ReviewResponseV1 {
  return {
    format: 'termforge-review-response',
    version: 1,
    syntheticSimulation: true,
    taskId: packet.taskId,
    taskDigest: packet.taskDigest,
    baseLibraryRevision: packet.baseLibraryRevision,
    reviewerSlotId: slotId,
    responseId,
    claimedProviderIdentity: {
      provider: 'synthetic-local-simulator',
      model: `sim-${slotId}`,
      version: 'v1',
      selfReportedUnauthenticated: true,
    },
    createdAt: TS,
    suggestions,
  };
}

describe('WP04 F6: Independent-slot comparison & evidence validity review', () => {
  it('computes 3/3 consensus with synthetic-simulated label, verified source support, and canAutoAccept=false', async () => {
    const snapshot = makeSnapshot();
    const sel = selectEnrichmentTargets(
      snapshot,
      [{ conceptId: 'c-sulcus', expectedConceptRevision: 0 }],
      'missing-tr',
    );
    const evidence = await lookupSyntheticSourceEvidence(snapshot, sel, {
      sourceId: 'synth-bilingual-lexicon-v1',
    });
    const { packet } = await buildReviewTaskPacket(sel, {
      taskId: 'task-cmp-3of3',
      createdAt: TS,
      slotCount: 3,
    });
    const bundle = await generateSyntheticSimulatedReviewResponses(packet, evidence.candidates, {
      scenario: 'consensus-with-source',
      createdAt: TS,
    });

    const summary = buildReviewComparisonSummary({
      packet,
      acceptedResponses: bundle.responses,
      rejectedResponseErrors: [],
      allowlistedEvidenceCandidates: evidence.candidates,
    });

    expect(summary.eligibleSlotCount).toBe(3);
    expect(summary.respondedSlotCount).toBe(3);
    expect(summary.missingSlotCount).toBe(0);
    expect(summary.invalidResponseCount).toBe(0);
    expect(summary.abstainSlotCount).toBe(0);
    expect(summary.blindReviewLimitationDisclosure).toMatch(/self-reported|synthetic-simulated|not verified/i);

    const group = summary.groups.find((g) => g.text === 'dişeti oluğu');
    expect(group).toBeDefined();
    expect(group?.votes).toBe(3);
    expect(group?.eligibleSlotCount).toBe(3);
    expect(group?.disagreementDetected).toBe(false);
    expect(group?.evidenceValidity).toBe('supported-by-allowlisted-source');
    expect(group?.canAutoAccept).toBe(false);
  });

  it('tracks 2/3, contradictory alternatives, abstain, missing slot, invalid response count, and unsupported external evidence separately', async () => {
    const snapshot = makeSnapshot();
    const sel = selectEnrichmentTargets(
      snapshot,
      [{ conceptId: 'c-sulcus', expectedConceptRevision: 0 }],
      'missing-tr',
    );
    const evidence = await lookupSyntheticSourceEvidence(snapshot, sel, {
      sourceId: 'synth-bilingual-lexicon-v1',
    });
    const { packet } = await buildReviewTaskPacket(sel, {
      taskId: 'task-cmp-mixed',
      createdAt: TS,
      slotCount: 3,
    });

    // Scenario A: 2/3 agree (with 1 unverified external claim, 1 allowlisted claim) + 1 abstain
    const r1 = makeSlotResponse(packet, 'slot-1', 'r-1', [
      {
        operation: 'proposeExpression',
        targetConceptId: 'c-sulcus',
        expectedConceptRevision: 0,
        text: 'dişeti oluğu',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        rationale: 'Allowlisted hit',
        evidenceRefs: [
          {
            sourceId: 'synth-bilingual-lexicon-v1',
            referenceId: evidence.candidates[0].evidenceId,
            note: 'Allowlisted match',
          },
        ],
      },
    ]);
    const r2 = makeSlotResponse(packet, 'slot-2', 'r-2', [
      {
        operation: 'proposeExpression',
        targetConceptId: 'c-sulcus',
        expectedConceptRevision: 0,
        text: 'dişeti oluğu',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        rationale: 'Unverified ref',
        evidenceRefs: [
          {
            sourceId: 'untrusted-ext',
            referenceId: 'ext-1',
            referenceUri: 'https://example.invalid/not-fetched',
            note: 'Unverified external link',
          },
        ],
      },
    ]);
    const r3Abstain = makeSlotResponse(packet, 'slot-3', 'r-3', [
      {
        operation: 'abstain',
        targetConceptId: 'c-sulcus',
        expectedConceptRevision: 0,
        rationale: 'Insufficient evidence',
        evidenceRefs: [],
      },
    ]);

    const mixedSummary = buildReviewComparisonSummary({
      packet,
      acceptedResponses: [r1, r2, r3Abstain],
      rejectedResponseErrors: ['slot-3 tampered invalid upload'],
      allowlistedEvidenceCandidates: evidence.candidates,
    });

    expect(mixedSummary.respondedSlotCount).toBe(3);
    expect(mixedSummary.abstainSlotCount).toBe(1);
    expect(mixedSummary.invalidResponseCount).toBe(1);
    expect(mixedSummary.missingSlotCount).toBe(0);

    const proposedGroup = mixedSummary.groups.find((g) => g.operation === 'proposeExpression');
    expect(proposedGroup?.votes).toBe(2);
    expect(proposedGroup?.evidenceValidity).toBe('supported-by-allowlisted-source');
    expect(proposedGroup?.hasUnverifiedEvidenceClaim).toBe(true);
    expect(proposedGroup?.disagreementDetected).toBe(true); // abstain + proposeExpression across slots

    // Missing slot & contradictory proposals
    const r2Contra = makeSlotResponse(packet, 'slot-2', 'r-2c', [
      {
        operation: 'proposeExpression',
        targetConceptId: 'c-sulcus',
        expectedConceptRevision: 0,
        text: 'gingival yarık',
        language: { kind: 'language', tag: 'tr' },
        role: 'alternative',
        rationale: 'Unverified alternative',
        evidenceRefs: [
          {
            sourceId: 'unverified-ext',
            referenceId: 'ext-9',
            note: 'Unverified claim',
          },
        ],
      },
    ]);
    const contraSummary = buildReviewComparisonSummary({
      packet,
      acceptedResponses: [r1, r2Contra], // slot-3 missing
      rejectedResponseErrors: [],
      allowlistedEvidenceCandidates: evidence.candidates,
    });
    expect(contraSummary.missingSlotCount).toBe(1);
    const contraAlt = contraSummary.groups.find((g) => g.text === 'gingival yarık');
    expect(contraAlt?.evidenceValidity).toBe('unverified-claim');
    expect(contraAlt?.disagreementDetected).toBe(true);
  });

  it('never merges exact Unicode/case variants (p53 vs P53, İ vs I vs ı) or identical surfaces across distinct target concepts, and rejects duplicate slots', async () => {
    const snapshot = makeSnapshot();
    const sel = selectEnrichmentTargets(
      snapshot,
      [
        { conceptId: 'c-homonym-a', expectedConceptRevision: 0 },
        { conceptId: 'c-homonym-b', expectedConceptRevision: 1 },
      ],
      'missing-tr',
    );
    const { packet } = await buildReviewTaskPacket(sel, {
      taskId: 'task-cmp-unicode',
      createdAt: TS,
      slotCount: 3,
    });

    const r1 = makeSlotResponse(packet, 'slot-1', 'r-u1', [
      {
        operation: 'proposeExpression',
        targetConceptId: 'c-homonym-a',
        expectedConceptRevision: 0,
        text: 'İltihap',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        rationale: 'Dotted capital İ',
        evidenceRefs: [],
      },
      {
        operation: 'proposeExpression',
        targetConceptId: 'c-homonym-b',
        expectedConceptRevision: 1,
        text: 'İltihap',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        rationale: 'Same text on different target concept',
        evidenceRefs: [],
      },
    ]);
    const r2 = makeSlotResponse(packet, 'slot-2', 'r-u2', [
      {
        operation: 'proposeExpression',
        targetConceptId: 'c-homonym-a',
        expectedConceptRevision: 0,
        text: 'Iltihap',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        rationale: 'ASCII I variant must NOT merge with İ',
        evidenceRefs: [],
      },
    ]);

    const summary = buildReviewComparisonSummary({
      packet,
      acceptedResponses: [r1, r2],
      rejectedResponseErrors: [],
      allowlistedEvidenceCandidates: [],
    });

    const dottedGroup = summary.groups.find(
      (g) => g.targetConceptId === 'c-homonym-a' && g.text === 'İltihap',
    );
    const dotlessGroup = summary.groups.find(
      (g) => g.targetConceptId === 'c-homonym-a' && g.text === 'Iltihap',
    );
    const conceptBGroup = summary.groups.find(
      (g) => g.targetConceptId === 'c-homonym-b' && g.text === 'İltihap',
    );

    expect(dottedGroup?.votes).toBe(1);
    expect(dotlessGroup?.votes).toBe(1);
    expect(conceptBGroup?.votes).toBe(1);
    expect(dottedGroup?.disagreementDetected).toBe(true);

    // Duplicate slot in input throws fail-closed rather than inflating votes
    const r1Dup = makeSlotResponse(packet, 'slot-1', 'r-u1-dup', r1.suggestions);
    expect(() =>
      buildReviewComparisonSummary({
        packet,
        acceptedResponses: [r1, r1Dup],
        rejectedResponseErrors: [],
        allowlistedEvidenceCandidates: [],
      }),
    ).toThrow(/duplicate.*slot/i);
  });
});
