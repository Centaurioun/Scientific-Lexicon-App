import type { ApplyResult, ProposedChange } from '@/domain/changes';
import type { LibrarySnapshot } from '@/domain/schema';

export interface RetainedRunMeta {
  documentId: string;
  runId: string;
  forRunId: string;
}

export interface PendingProposalEntry {
  proposal: ProposedChange;
  retainMeta: RetainedRunMeta | null;
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

export interface CommitSettlementInput {
  resultStatus: 'applied' | 'replay' | 'conflict' | 'rejected' | 'stale' | string;
  committedRevision: number;
  commitBatchId: string;
  activePendingBatchId: string | null;
  capturedContextSeq: number;
  currentContextSeq: number;
  activeRunId: string | null;
  capturedRetainMeta: RetainedRunMeta | null;
  hadExternalRevisionDuringCommit?: boolean;
}

export interface CommitSettlementPlan {
  committed: boolean;
  shouldInvalidateMatcher: boolean;
  shouldReloadSnapshot: boolean;
  shouldAbortActiveAnalysis: boolean;
  shouldClearPendingProposal: boolean;
  shouldAttachRetainedRunLink: boolean;
  viewStaleAfterCommit: boolean;
}

/**
 * Reconciles the outcome of an in-flight canonical gateway write with current view state.
 * - An already-committed canonical transaction (`applied` / `replay`) is NEVER hidden or reverted.
 * - A `conflict` / `stale` outcome or any concurrent external revision ALWAYS invalidates the
 *   matcher and forces an authoritative snapshot reload so stale state never lingers.
 * - View-local side effects (such as attaching `retainedRunLink` or clearing a newer proposal)
 *   are strictly gated against context/run/batch drift.
 */
export function evaluateCommitSettlement(input: CommitSettlementInput): CommitSettlementPlan {
  const committed = input.resultStatus === 'applied' || input.resultStatus === 'replay';
  const sameContext = input.capturedContextSeq === input.currentContextSeq;
  const samePending = input.activePendingBatchId === input.commitBatchId;
  const externalObserved = Boolean(input.hadExternalRevisionDuringCommit);
  const revisionDriftLikely =
    externalObserved || input.resultStatus === 'conflict' || input.resultStatus === 'stale';

  if (!committed) {
    return {
      committed: false,
      shouldInvalidateMatcher: revisionDriftLikely,
      shouldReloadSnapshot: revisionDriftLikely,
      shouldAbortActiveAnalysis: revisionDriftLikely,
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
    shouldAbortActiveAnalysis: externalObserved,
    shouldClearPendingProposal: samePending,
    shouldAttachRetainedRunLink: retainMatchesActiveRun,
    viewStaleAfterCommit: !sameContext,
  };
}

export type RevisionNotificationDecision =
  | { action: 'handle-external-immediately'; revision: number }
  | { action: 'defer' };

export interface RunCommitCallbacks {
  proposal: ProposedChange;
  retainMeta: RetainedRunMeta | null;
  capturedContextSeq: number;
  getCurrentContextSeq: () => number;
  getActiveRunId: () => string | null;
  getActivePendingEntry: () => PendingProposalEntry | null;
  isMounted: () => boolean;
  applyProposal: () => Promise<ApplyResult>;
  loadSnapshot: () => Promise<LibrarySnapshot | null>;
  invalidateMatcher: () => void;
  abortActiveAnalysis: () => void;
  setApplying: (applying: boolean) => void;
  clearPendingIfBatchMatches: (batchId: string) => void;
  invalidateStalePendingProposal: (reason: string) => void;
  attachRetainedRunLink: (meta: RetainedRunMeta) => void;
  setStatusNotice: (message: string | null) => void;
  setAnalysisError: (message: string | null) => void;
}

const MAX_RECONCILE_DRAINS = 8;

/**
 * Lossless same-instance revision reconciliation controller for ExtractionWorkspace (FH01).
 *
 * Scope boundary: `DexieLibraryRepository.subscribeRevision` delivers notifications within the
 * same repository instance only (it is not a cross-tab broadcast channel). Separate browser tabs
 * remain protected by IndexedDB transaction atomicity and CAS revision checks (`conflict`), which
 * this controller reconciles by invalidating the matcher and reloading the authoritative snapshot.
 */
export class RevisionReconciliationController {
  private inFlightCommitBatchId: string | null = null;
  private phase: 'idle' | 'applying' | 'reconciling' = 'idle';
  private observedDuringApply: number[] = [];
  private observedDuringReconcile: number[] = [];

  isCommitInFlight(): boolean {
    return this.inFlightCommitBatchId !== null;
  }

  observeRevisionNotification(revision: number): RevisionNotificationDecision {
    if (this.phase === 'applying') {
      this.observedDuringApply.push(revision);
      return { action: 'defer' };
    }
    if (this.phase === 'reconciling') {
      this.observedDuringReconcile.push(revision);
      return { action: 'defer' };
    }
    return { action: 'handle-external-immediately', revision };
  }

  async runCommit(ctx: RunCommitCallbacks): Promise<void> {
    if (this.inFlightCommitBatchId !== null) return;
    const commitBatchId = ctx.proposal.payload.batchId;

    this.inFlightCommitBatchId = commitBatchId;
    this.phase = 'applying';
    this.observedDuringApply = [];
    this.observedDuringReconcile = [];

    if (ctx.isMounted()) {
      ctx.setApplying(true);
      ctx.setAnalysisError(null);
      ctx.setStatusNotice(null);
    }

    let committedRevision: number | null = null;
    let isCommittedResult = false;
    let viewStaleAfterCommit = false;
    let latestSnapshot: LibrarySnapshot | null = null;
    let externalRevisionsObserved = false;

    try {
      let applyResult: ApplyResult | null = null;
      let thrownError: unknown = null;

      try {
        applyResult = await ctx.applyProposal();
      } catch (error) {
        thrownError = error;
      }

      // Transition to reconciling before inspecting deferred notifications so any notification
      // arriving during post-commit snapshot reload is captured in observedDuringReconcile.
      this.phase = 'reconciling';

      const duringApply = this.observedDuringApply;
      this.observedDuringApply = [];

      // Dexie emits subscribeRevision synchronously ONLY for status === 'applied'.
      // Remove at most one matching own-revision notification; any remaining entry is external.
      const externalDuringApply = [...duringApply];
      if (applyResult && applyResult.status === 'applied') {
        const ownIdx = externalDuringApply.indexOf(applyResult.revision);
        if (ownIdx !== -1) {
          externalDuringApply.splice(ownIdx, 1);
        }
      }
      if (externalDuringApply.length > 0) {
        externalRevisionsObserved = true;
      }

      if (thrownError !== null) {
        if (externalDuringApply.length > 0) {
          ctx.invalidateMatcher();
          ctx.abortActiveAnalysis();
        }
        if (ctx.isMounted()) {
          ctx.clearPendingIfBatchMatches(commitBatchId);
          ctx.setAnalysisError(
            thrownError instanceof Error ? thrownError.message : 'Unable to apply approved change.',
          );
          if (externalDuringApply.length > 0) {
            latestSnapshot = await ctx.loadSnapshot();
          }
        }
      } else if (applyResult !== null) {
        if (applyResult.status === 'applied' || applyResult.status === 'replay') {
          isCommittedResult = true;
          committedRevision = applyResult.revision;
        } else {
          isCommittedResult = false;
          committedRevision = null;
        }

        const plan = evaluateCommitSettlement({
          resultStatus: applyResult.status,
          committedRevision: committedRevision ?? -1,
          commitBatchId,
          activePendingBatchId: ctx.getActivePendingEntry()?.proposal.payload.batchId ?? null,
          capturedContextSeq: ctx.capturedContextSeq,
          currentContextSeq: ctx.getCurrentContextSeq(),
          activeRunId: ctx.getActiveRunId(),
          capturedRetainMeta: ctx.retainMeta,
          hadExternalRevisionDuringCommit: externalDuringApply.length > 0,
        });
        viewStaleAfterCommit = plan.viewStaleAfterCommit;

        if (plan.shouldInvalidateMatcher) {
          ctx.invalidateMatcher();
        }
        if (plan.shouldAbortActiveAnalysis) {
          ctx.abortActiveAnalysis();
        }
        if (ctx.isMounted() && plan.shouldClearPendingProposal) {
          ctx.clearPendingIfBatchMatches(commitBatchId);
        }

        if (isCommittedResult && plan.committed) {
          if (ctx.isMounted() && plan.shouldAttachRetainedRunLink && ctx.retainMeta) {
            ctx.attachRetainedRunLink(ctx.retainMeta);
          }
          if (ctx.isMounted() && plan.shouldReloadSnapshot) {
            latestSnapshot = await ctx.loadSnapshot();
          }
        } else {
          if (ctx.isMounted() && plan.shouldReloadSnapshot) {
            latestSnapshot = await ctx.loadSnapshot();
          }
          if (ctx.isMounted() && !isCommittedResult && applyResult.status !== 'applied' && applyResult.status !== 'replay') {
            ctx.setAnalysisError(`${applyResult.status.toUpperCase()}: ${applyResult.reason}`);
          }
        }
      }

      // Coalesce any revision notifications that arrived while loadSnapshot() was executing.
      let drains = 0;
      while (
        ctx.isMounted() &&
        this.observedDuringReconcile.length > 0 &&
        drains < MAX_RECONCILE_DRAINS
      ) {
        drains += 1;
        externalRevisionsObserved = true;
        this.observedDuringReconcile = [];
        ctx.invalidateMatcher();
        ctx.abortActiveAnalysis();
        latestSnapshot = await ctx.loadSnapshot();
      }

      // Reconcile any newer open proposal against the authoritative loaded revision:
      // preserve it (and its paired retainMeta) if still current; invalidate explicitly if stale.
      if (ctx.isMounted() && latestSnapshot !== null) {
        const activePending = ctx.getActivePendingEntry();
        if (
          activePending &&
          activePending.proposal.payload.batchId !== commitBatchId &&
          activePending.proposal.payload.baseLibraryRevision !== latestSnapshot.libraryRevision
        ) {
          ctx.invalidateStalePendingProposal(
            `Pending proposal was invalidated because library revision advanced to revision ${latestSnapshot.libraryRevision}.`,
          );
        }
      }

      // Publish final commit status notice without hiding legitimate committed transactions.
      if (ctx.isMounted() && isCommittedResult && committedRevision !== null) {
        const latestRev = latestSnapshot?.libraryRevision ?? committedRevision;
        if (externalRevisionsObserved && latestRev !== committedRevision) {
          ctx.setStatusNotice(
            `Saved approved change locally (library revision ${committedRevision}); later library revision ${latestRev} was also reconciled.`,
          );
        } else if (viewStaleAfterCommit) {
          ctx.setStatusNotice(
            `Saved approved change locally (library revision ${committedRevision}). Active source view changed while saving; stale run link was not attached.`,
          );
        } else {
          ctx.setStatusNotice(
            `Saved approved change locally (library revision ${committedRevision}). Re-analyze if you want matcher states refreshed against the new revision.`,
          );
        }
      }
    } finally {
      this.observedDuringApply = [];
      this.observedDuringReconcile = [];
      this.inFlightCommitBatchId = null;
      this.phase = 'idle';
      if (ctx.isMounted()) {
        ctx.setApplying(false);
      }
    }
  }
}
