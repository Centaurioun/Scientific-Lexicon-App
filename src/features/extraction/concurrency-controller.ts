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
const MAX_CONTINUATION_TURNS = 2;

/**
 * Lossless same-instance revision reconciliation controller for ExtractionWorkspace & Data Operations (FH01 + WP03 E1).
 *
 * Scope boundary: `DexieLibraryRepository.subscribeRevision` delivers notifications within the
 * same repository instance only (it is not a cross-tab broadcast channel). Separate browser tabs
 * remain protected by IndexedDB transaction atomicity and CAS revision checks (`conflict` / `stale`),
 * which this controller reconciles by invalidating the matcher and reloading the authoritative snapshot.
 *
 * WP03 E1 invariants:
 * - Never drops a notification arriving during the 8th drain or in a finally block.
 * - Coalesces any residual notifications into `pendingHighWaterRevision` and yields across a bounded
 *   number of scheduled continuation turns (`MAX_CONTINUATION_TURNS`) so bursty notifications settle
 *   without an unbounded synchronous loop.
 * - If notifications continue beyond the bounded continuation budget, fails closed (`freshnessConfirmed = false`),
 *   retains `pendingHighWaterRevision`, invalidates any open proposal, and requires an explicit retry
 *   (`confirmFreshnessWithSnapshot`) before new bulk or candidate writes are allowed.
 */
export class RevisionReconciliationController {
  private inFlightCommitBatchId: string | null = null;
  private phase: 'idle' | 'applying' | 'reconciling' = 'idle';
  private observedDuringApply: number[] = [];
  private observedDuringReconcile: number[] = [];
  private freshnessConfirmed = true;
  private pendingHighWaterRevision: number | null = null;

  isCommitInFlight(): boolean {
    return this.inFlightCommitBatchId !== null;
  }

  isFreshnessConfirmed(): boolean {
    return this.freshnessConfirmed;
  }

  getPendingHighWaterRevision(): number | null {
    return this.pendingHighWaterRevision;
  }

  private recordHighWater(revisions: readonly number[]): void {
    for (const rev of revisions) {
      if (this.pendingHighWaterRevision === null || rev > this.pendingHighWaterRevision) {
        this.pendingHighWaterRevision = rev;
      }
    }
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

  /**
   * Explicit retry helper when a prior notification storm left `freshnessConfirmed === false`.
   * Executes a bounded reconciliation pass to re-establish authoritative snapshot freshness.
   */
  async confirmFreshnessWithSnapshot(
    loadSnapshot: () => Promise<LibrarySnapshot | null>,
    onInvalidate?: () => void,
  ): Promise<LibrarySnapshot | null> {
    if (this.inFlightCommitBatchId !== null) return null;
    this.phase = 'reconciling';
    this.observedDuringReconcile = [];
    let latestSnapshot: LibrarySnapshot | null = null;

    try {
      onInvalidate?.();
      latestSnapshot = await loadSnapshot();

      let drains = 0;
      while (this.observedDuringReconcile.length > 0 && drains < MAX_RECONCILE_DRAINS) {
        drains += 1;
        this.recordHighWater(this.observedDuringReconcile);
        this.observedDuringReconcile = [];
        onInvalidate?.();
        latestSnapshot = await loadSnapshot();
      }

      if (this.observedDuringReconcile.length > 0) {
        this.recordHighWater(this.observedDuringReconcile);
        this.observedDuringReconcile = [];
      }

      if (
        latestSnapshot !== null &&
        (this.pendingHighWaterRevision === null ||
          latestSnapshot.libraryRevision >= this.pendingHighWaterRevision) &&
        this.observedDuringReconcile.length === 0
      ) {
        this.freshnessConfirmed = true;
        this.pendingHighWaterRevision = null;
      } else {
        this.freshnessConfirmed = false;
      }

      return latestSnapshot;
    } finally {
      this.phase = 'idle';
    }
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
        this.recordHighWater(externalDuringApply);
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
      // Primary drain loop (bounded to MAX_RECONCILE_DRAINS).
      let drains = 0;
      while (
        ctx.isMounted() &&
        this.observedDuringReconcile.length > 0 &&
        drains < MAX_RECONCILE_DRAINS
      ) {
        drains += 1;
        externalRevisionsObserved = true;
        this.recordHighWater(this.observedDuringReconcile);
        this.observedDuringReconcile = [];
        ctx.invalidateMatcher();
        ctx.abortActiveAnalysis();
        latestSnapshot = await ctx.loadSnapshot();
      }

      // WP03 E1: If a notification arrived during the 8th drain (or more notifications remain),
      // do NOT drop them in finally. Yield across a bounded number of scheduled continuation turns
      // (MAX_CONTINUATION_TURNS), coalescing all pending notifications into one refresh per turn.
      let continuationTurns = 0;
      while (
        ctx.isMounted() &&
        this.observedDuringReconcile.length > 0 &&
        continuationTurns < MAX_CONTINUATION_TURNS
      ) {
        continuationTurns += 1;
        externalRevisionsObserved = true;
        this.recordHighWater(this.observedDuringReconcile);
        this.observedDuringReconcile = [];
        // Yield a macrotask/microtask turn before the coalesced continuation refresh
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!ctx.isMounted()) break;
        // Include any notifications that arrived during the scheduled yield
        if (this.observedDuringReconcile.length > 0) {
          this.recordHighWater(this.observedDuringReconcile);
          this.observedDuringReconcile = [];
        }
        ctx.invalidateMatcher();
        ctx.abortActiveAnalysis();
        latestSnapshot = await ctx.loadSnapshot();
      }

      // Check whether any un-drained notifications still remain after the bounded continuation budget.
      if (this.observedDuringReconcile.length > 0) {
        externalRevisionsObserved = true;
        this.recordHighWater(this.observedDuringReconcile);
        this.observedDuringReconcile = [];
      }

      const unconfirmedHighWater =
        this.pendingHighWaterRevision !== null &&
        (latestSnapshot === null || latestSnapshot.libraryRevision < this.pendingHighWaterRevision);

      if (unconfirmedHighWater) {
        // Fail closed: cannot confirm authoritative snapshot freshness within bounded budget.
        this.freshnessConfirmed = false;
        if (ctx.isMounted()) {
          ctx.invalidateMatcher();
          ctx.abortActiveAnalysis();
          const activePending = ctx.getActivePendingEntry();
          if (activePending) {
            ctx.invalidateStalePendingProposal(
              `Pending proposal was invalidated because authoritative revision freshness could not be confirmed (observed revision ${this.pendingHighWaterRevision}). Reload latest snapshot before proposing changes.`,
            );
          }
          ctx.setAnalysisError(
            `STALE: Authoritative revision freshness could not be confirmed after bounded reconciliation (pending revision high-water mark: Rev ${this.pendingHighWaterRevision}, loaded: Rev ${latestSnapshot?.libraryRevision ?? 'unknown'}). Reload latest library snapshot before applying further changes.`,
          );
        }
      } else {
        this.freshnessConfirmed = true;
        this.pendingHighWaterRevision = null;
      }

      // Reconcile any newer open proposal against the authoritative loaded revision:
      // preserve it (and its paired retainMeta) if still current; invalidate explicitly if stale.
      if (ctx.isMounted() && latestSnapshot !== null && this.freshnessConfirmed) {
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
        if (!this.freshnessConfirmed && this.pendingHighWaterRevision !== null) {
          ctx.setStatusNotice(
            `Saved approved change locally (library revision ${committedRevision}), but subsequent rapid revision updates up to Rev ${this.pendingHighWaterRevision} exceeded bounded reconciliation. Refresh library snapshot to confirm freshness.`,
          );
        } else if (externalRevisionsObserved && latestRev !== committedRevision) {
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
      if (this.observedDuringApply.length > 0) {
        this.recordHighWater(this.observedDuringApply);
        this.observedDuringApply = [];
      }
      if (this.observedDuringReconcile.length > 0) {
        this.recordHighWater(this.observedDuringReconcile);
        this.observedDuringReconcile = [];
        this.freshnessConfirmed = false;
      }
      this.inFlightCommitBatchId = null;
      this.phase = 'idle';
      if (ctx.isMounted()) {
        ctx.setApplying(false);
      }
    }
  }
}
