export interface RetainedRunMeta {
  documentId: string;
  runId: string;
  forRunId: string;
}

export interface ProposalGuardInput {
  mounted: boolean;
  capturedContextSeq: number;
  currentContextSeq: number;
  capturedProposalSeq: number;
  currentProposalSeq: number;
}

export function shouldApplyProposalResult(input: ProposalGuardInput): boolean {
  return (
    input.mounted &&
    input.capturedContextSeq === input.currentContextSeq &&
    input.capturedProposalSeq === input.currentProposalSeq
  );
}

export interface SnapshotLoadGuardInput {
  mounted: boolean;
  capturedLoadSeq: number;
  currentLoadSeq: number;
}

export function shouldApplySnapshotLoad(input: SnapshotLoadGuardInput): boolean {
  return input.mounted && input.capturedLoadSeq === input.currentLoadSeq;
}

export function shouldHandleExternalRevision(input: {
  inFlightCommitBatchId: string | null;
}): boolean {
  return input.inFlightCommitBatchId === null;
}

export interface CommitSettlementInput {
  resultStatus: 'applied' | 'replay' | 'conflict' | 'rejected' | 'stale' | string;
  committedRevision: number;
  commitBatchId: string;
  activePendingBatchId: string | null;
  capturedContextSeq: number;
  currentContextSeq: number;
  activeRunId: string | null;
  capturedRetainMeta: RetainedRunMeta | null;
}

export interface CommitSettlementPlan {
  committed: boolean;
  shouldInvalidateMatcher: boolean;
  shouldReloadSnapshot: boolean;
  shouldClearPendingProposal: boolean;
  shouldAttachRetainedRunLink: boolean;
  viewStaleAfterCommit: boolean;
}

/**
 * Reconciles the outcome of an in-flight canonical gateway write with current view state.
 * An already-committed canonical transaction (applied/replay) is NEVER hidden or reverted,
 * while view-local side effects (such as attaching a retainedRunLink or clearing a newer
 * pending proposal) are gated against context/run drift.
 */
export function evaluateCommitSettlement(input: CommitSettlementInput): CommitSettlementPlan {
  const committed = input.resultStatus === 'applied' || input.resultStatus === 'replay';
  const sameContext = input.capturedContextSeq === input.currentContextSeq;
  const samePending = input.activePendingBatchId === input.commitBatchId;

  if (!committed) {
    return {
      committed: false,
      shouldInvalidateMatcher: false,
      shouldReloadSnapshot: false,
      shouldClearPendingProposal: samePending,
      shouldAttachRetainedRunLink: false,
      viewStaleAfterCommit: !sameContext,
    };
  }

  const retainMatchesActiveRun = Boolean(
    input.capturedRetainMeta &&
      sameContext &&
      input.activeRunId === input.capturedRetainMeta.forRunId,
  );

  return {
    committed: true,
    shouldInvalidateMatcher: true,
    shouldReloadSnapshot: true,
    shouldClearPendingProposal: samePending,
    shouldAttachRetainedRunLink: retainMatchesActiveRun,
    viewStaleAfterCommit: !sameContext,
  };
}
