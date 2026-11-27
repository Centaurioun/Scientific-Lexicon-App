import type { SourceEvidenceCandidate } from '@/adapters/sources/synthetic-source-adapter';
import { deepFreeze } from './changes';
import type { ReviewEvidenceRef, ReviewResponseV1, ReviewTaskPacketV1 } from './review-exchange';
import {
  compareCodeUnits,
  formatLanguageUse,
  type ExpressionRole,
  type LanguageUse,
} from './schema';

export type EvidenceValidityStatus =
  | 'supported-by-allowlisted-source'
  | 'unverified-claim'
  | 'none';

export interface SlotClaimDetail {
  readonly slotId: string;
  readonly responseId: string;
  readonly claimedProvider: string;
  readonly claimedModel: string;
  readonly claimedVersion: string;
  readonly selfReportedUnauthenticated: true;
  readonly syntheticSimulation: boolean;
  readonly rationale: string;
  readonly evidenceRefs: readonly ReviewEvidenceRef[];
}

export interface ComparisonProposalGroup {
  readonly groupKey: string;
  readonly targetConceptId: string;
  readonly expectedConceptRevision: number;
  readonly operation: 'proposeExpression' | 'no-change' | 'abstain';
  readonly text: string | null;
  readonly language: LanguageUse | null;
  readonly role: ExpressionRole | null;
  readonly votes: number;
  readonly eligibleSlotCount: number;
  readonly voteSummaryLabel: string;
  readonly slotIds: readonly string[];
  readonly slotDetails: readonly SlotClaimDetail[];
  readonly disagreementDetected: boolean;
  readonly evidenceValidity: EvidenceValidityStatus;
  readonly hasUnverifiedEvidenceClaim: boolean;
  readonly matchedEvidenceIds: readonly string[];
  readonly canAutoAccept: false;
}

export interface ReviewComparisonSummary {
  readonly taskId: string;
  readonly taskDigest: string;
  readonly baseLibraryRevision: number;
  readonly eligibleSlotCount: number;
  readonly respondedSlotCount: number;
  readonly abstainSlotCount: number;
  readonly missingSlotCount: number;
  readonly invalidResponseCount: number;
  readonly blindReviewLimitationDisclosure: string;
  readonly groups: readonly ComparisonProposalGroup[];
}

export const BLIND_REVIEW_LIMITATION_DISCLOSURE =
  'Independent blind review slots isolate exported task packets in TermForge design, but claimed provider/model identities and external independence are self-reported and unauthenticated. Vote tallies (e.g. 3/3 synthetic-simulated) represent reviewer agreement count, NOT scientific truth or calibrated confidence. Zero auto-acceptance is permitted.';

function makeExactGroupKey(input: {
  targetConceptId: string;
  operation: 'proposeExpression' | 'no-change' | 'abstain';
  text: string | null;
  language: LanguageUse | null;
  role: ExpressionRole | null;
}): string {
  const langKey = input.language ? formatLanguageUse(input.language) : '';
  return [
    input.targetConceptId,
    input.operation,
    input.text ?? '',
    langKey,
    input.role ?? '',
  ].join('\u0000');
}

/**
 * Pure deterministic comparison across isolated blind reviewer slots (WP04 F6).
 * Preserves exact Unicode/ASCII case, keeps target concepts strictly separate,
 * tracks abstentions/missing/invalid responses distinctly from votes, and separates
 * source evidence support from vote consensus.
 */
export function buildReviewComparisonSummary(input: {
  readonly packet: ReviewTaskPacketV1;
  readonly acceptedResponses: readonly ReviewResponseV1[];
  readonly rejectedResponseErrors: readonly string[];
  readonly allowlistedEvidenceCandidates: readonly SourceEvidenceCandidate[];
}): ReviewComparisonSummary {
  const { packet, acceptedResponses, rejectedResponseErrors, allowlistedEvidenceCandidates } =
    input;

  const validSlotIds = new Set(packet.blindReviewerSlots.map((s) => s.slotId));
  const seenSlots = new Set<string>();
  const seenResponseIds = new Set<string>();

  for (const resp of acceptedResponses) {
    if (resp.taskId !== packet.taskId || resp.taskDigest !== packet.taskDigest) {
      throw new Error(
        `Response ${resp.responseId} does not match active packet taskId/taskDigest.`,
      );
    }
    if (resp.baseLibraryRevision !== packet.baseLibraryRevision) {
      throw new Error(
        `Response ${resp.responseId} revision ${resp.baseLibraryRevision} does not match packet revision ${packet.baseLibraryRevision}.`,
      );
    }
    if (!validSlotIds.has(resp.reviewerSlotId)) {
      throw new Error(`Response ${resp.responseId} references unknown slot "${resp.reviewerSlotId}".`);
    }
    if (seenSlots.has(resp.reviewerSlotId)) {
      throw new Error(
        `Duplicate response for slot "${resp.reviewerSlotId}" detected in comparison input.`,
      );
    }
    if (seenResponseIds.has(resp.responseId)) {
      throw new Error(`Duplicate responseId "${resp.responseId}" detected in comparison input.`);
    }
    seenSlots.add(resp.reviewerSlotId);
    seenResponseIds.add(resp.responseId);
  }

  // Index allowlisted synthetic source evidence deterministically
  const evidenceBySourceAndId = new Map<string, SourceEvidenceCandidate>();
  for (const ev of allowlistedEvidenceCandidates) {
    evidenceBySourceAndId.set(`${ev.sourceId}\u0000${ev.evidenceId}`, ev);
  }

  interface MutableGroup {
    groupKey: string;
    targetConceptId: string;
    expectedConceptRevision: number;
    operation: 'proposeExpression' | 'no-change' | 'abstain';
    text: string | null;
    language: LanguageUse | null;
    role: ExpressionRole | null;
    slotIdsSet: Set<string>;
    slotDetails: SlotClaimDetail[];
    matchedEvidenceIdsSet: Set<string>;
    hasAnyEvidenceRef: boolean;
    hasUnverifiedEvidenceClaim: boolean;
  }

  const groupMap = new Map<string, MutableGroup>();
  const targetAlternativeKeys = new Map<string, Set<string>>();
  const abstainSlots = new Set<string>();

  for (const resp of acceptedResponses) {
    for (const sug of resp.suggestions) {
      if (sug.operation === 'abstain') {
        abstainSlots.add(resp.reviewerSlotId);
      }

      const text = sug.operation === 'proposeExpression' ? sug.text : null;
      const language = sug.operation === 'proposeExpression' ? sug.language : null;
      const role = sug.operation === 'proposeExpression' ? sug.role : null;

      const groupKey = makeExactGroupKey({
        targetConceptId: sug.targetConceptId,
        operation: sug.operation,
        text,
        language,
        role,
      });

      let altKeys = targetAlternativeKeys.get(sug.targetConceptId);
      if (!altKeys) {
        altKeys = new Set();
        targetAlternativeKeys.set(sug.targetConceptId, altKeys);
      }
      altKeys.add(groupKey);

      let group = groupMap.get(groupKey);
      if (!group) {
        group = {
          groupKey,
          targetConceptId: sug.targetConceptId,
          expectedConceptRevision: sug.expectedConceptRevision,
          operation: sug.operation,
          text,
          language,
          role,
          slotIdsSet: new Set(),
          slotDetails: [],
          matchedEvidenceIdsSet: new Set(),
          hasAnyEvidenceRef: false,
          hasUnverifiedEvidenceClaim: false,
        };
        groupMap.set(groupKey, group);
      }

      if (!group.slotIdsSet.has(resp.reviewerSlotId)) {
        group.slotIdsSet.add(resp.reviewerSlotId);
        group.slotDetails.push({
          slotId: resp.reviewerSlotId,
          responseId: resp.responseId,
          claimedProvider: resp.claimedProviderIdentity.provider,
          claimedModel: resp.claimedProviderIdentity.model,
          claimedVersion: resp.claimedProviderIdentity.version,
          selfReportedUnauthenticated: resp.claimedProviderIdentity.selfReportedUnauthenticated,
          syntheticSimulation: resp.syntheticSimulation,
          rationale: sug.rationale,
          evidenceRefs: sug.evidenceRefs,
        });
      }

      for (const ref of sug.evidenceRefs) {
        group.hasAnyEvidenceRef = true;
        const matched = evidenceBySourceAndId.get(`${ref.sourceId}\u0000${ref.referenceId}`);
        if (
          matched &&
          matched.targetConceptId === sug.targetConceptId &&
          (text === null || matched.candidateText === text)
        ) {
          group.matchedEvidenceIdsSet.add(matched.evidenceId);
        } else {
          group.hasUnverifiedEvidenceClaim = true;
        }
      }
    }
  }

  const eligibleSlotCount = packet.blindReviewerSlots.length;
  const respondedSlotCount = acceptedResponses.length;
  const missingSlotCount = Math.max(0, eligibleSlotCount - respondedSlotCount);
  const invalidResponseCount = rejectedResponseErrors.length;
  const abstainSlotCount = abstainSlots.size;

  const groups: ComparisonProposalGroup[] = Array.from(groupMap.values())
    .map((g): ComparisonProposalGroup => {
      const votes = g.slotIdsSet.size;
      const altCount = targetAlternativeKeys.get(g.targetConceptId)?.size ?? 0;
      const disagreementDetected = altCount > 1;
      const matchedEvidenceIds = Array.from(g.matchedEvidenceIdsSet).sort(compareCodeUnits);
      const evidenceValidity: EvidenceValidityStatus =
        matchedEvidenceIds.length > 0
          ? 'supported-by-allowlisted-source'
          : g.hasAnyEvidenceRef
            ? 'unverified-claim'
            : 'none';

      const slotIds = Array.from(g.slotIdsSet).sort(compareCodeUnits);
      const slotDetails = [...g.slotDetails].sort((a, b) => compareCodeUnits(a.slotId, b.slotId));

      return {
        groupKey: g.groupKey,
        targetConceptId: g.targetConceptId,
        expectedConceptRevision: g.expectedConceptRevision,
        operation: g.operation,
        text: g.text,
        language: g.language,
        role: g.role,
        votes,
        eligibleSlotCount,
        voteSummaryLabel: `${votes}/${eligibleSlotCount} synthetic-simulated slots`,
        slotIds,
        slotDetails,
        disagreementDetected,
        evidenceValidity,
        hasUnverifiedEvidenceClaim: g.hasUnverifiedEvidenceClaim,
        matchedEvidenceIds,
        canAutoAccept: false,
      };
    })
    .sort((a, b) => {
      const byConcept = compareCodeUnits(a.targetConceptId, b.targetConceptId);
      if (byConcept !== 0) return byConcept;
      if (b.votes !== a.votes) return b.votes - a.votes;
      return compareCodeUnits(a.groupKey, b.groupKey);
    });

  return deepFreeze({
    taskId: packet.taskId,
    taskDigest: packet.taskDigest,
    baseLibraryRevision: packet.baseLibraryRevision,
    eligibleSlotCount,
    respondedSlotCount,
    abstainSlotCount,
    missingSlotCount,
    invalidResponseCount,
    blindReviewLimitationDisclosure: BLIND_REVIEW_LIMITATION_DISCLOSURE,
    groups,
  });
}
