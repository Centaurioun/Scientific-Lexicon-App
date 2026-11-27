import { describe, expect, it } from 'vitest';
import {
  evaluateCommitSettlement,
  shouldApplyProposalResult,
  shouldApplySnapshotLoad,
  shouldHandleExternalRevision,
} from '@/features/extraction/concurrency-controller';

describe('QC05: ExtractionWorkspace async concurrency and commit reconciliation rules', () => {
  it('suppresses delayed proposal generation if source context or proposal sequence advanced or dialog was dismissed', () => {
    expect(
      shouldApplyProposalResult({
        mounted: true,
        capturedContextSeq: 3,
        currentContextSeq: 3,
        capturedProposalSeq: 2,
        currentProposalSeq: 2,
      }),
    ).toBe(true);

    // Source/policy changed while proposeChange() was computing SHA-256 digest
    expect(
      shouldApplyProposalResult({
        mounted: true,
        capturedContextSeq: 3,
        currentContextSeq: 4,
        capturedProposalSeq: 2,
        currentProposalSeq: 2,
      }),
    ).toBe(false);

    // Dialog was dismissed or a newer proposal superseded it
    expect(
      shouldApplyProposalResult({
        mounted: true,
        capturedContextSeq: 3,
        currentContextSeq: 3,
        capturedProposalSeq: 2,
        currentProposalSeq: 3,
      }),
    ).toBe(false);

    // Component unmounted
    expect(
      shouldApplyProposalResult({
        mounted: false,
        capturedContextSeq: 3,
        currentContextSeq: 3,
        capturedProposalSeq: 2,
        currentProposalSeq: 2,
      }),
    ).toBe(false);
  });

  it('distinguishes an already-committed canonical transaction from stale view effects when source or run changed mid-flight', () => {
    // Normal commit where active run and context are unchanged
    const sameContext = evaluateCommitSettlement({
      resultStatus: 'applied',
      committedRevision: 5,
      commitBatchId: 'batch-1',
      activePendingBatchId: 'batch-1',
      capturedContextSeq: 2,
      currentContextSeq: 2,
      activeRunId: 'run-A',
      capturedRetainMeta: { documentId: 'doc-1', runId: 'ret-1', forRunId: 'run-A' },
    });
    expect(sameContext.committed).toBe(true);
    expect(sameContext.shouldInvalidateMatcher).toBe(true);
    expect(sameContext.shouldReloadSnapshot).toBe(true);
    expect(sameContext.shouldClearPendingProposal).toBe(true);
    expect(sameContext.shouldAttachRetainedRunLink).toBe(true);
    expect(sameContext.viewStaleAfterCommit).toBe(false);

    // Source/policy changed while applyChange was awaiting IndexedDB commit:
    // Canonical commit MUST still be recognized (never hidden or reversed),
    // matcher invalidated and snapshot reloaded, while stale retainedRunLink is NOT attached!
    const movedView = evaluateCommitSettlement({
      resultStatus: 'applied',
      committedRevision: 6,
      commitBatchId: 'batch-2',
      activePendingBatchId: 'batch-3', // a newer proposal is open
      capturedContextSeq: 2,
      currentContextSeq: 3,
      activeRunId: 'run-B',
      capturedRetainMeta: { documentId: 'doc-2', runId: 'ret-2', forRunId: 'run-A' },
    });
    expect(movedView.committed).toBe(true);
    expect(movedView.shouldInvalidateMatcher).toBe(true);
    expect(movedView.shouldReloadSnapshot).toBe(true);
    expect(movedView.shouldClearPendingProposal).toBe(false); // do not wipe newer batch-3!
    expect(movedView.shouldAttachRetainedRunLink).toBe(false); // do not attach doc-2 to run-B!
    expect(movedView.viewStaleAfterCommit).toBe(true);

    // Rejected/conflicting change does NOT commit and does NOT attach retain link
    const conflict = evaluateCommitSettlement({
      resultStatus: 'conflict',
      committedRevision: 6,
      commitBatchId: 'batch-4',
      activePendingBatchId: 'batch-4',
      capturedContextSeq: 3,
      currentContextSeq: 3,
      activeRunId: 'run-B',
      capturedRetainMeta: { documentId: 'doc-3', runId: 'ret-3', forRunId: 'run-B' },
    });
    expect(conflict.committed).toBe(false);
    expect(conflict.shouldAttachRetainedRunLink).toBe(false);
    expect(conflict.shouldClearPendingProposal).toBe(true);
  });

  it('distinguishes genuine external library revisions from the workspace own in-flight commit', () => {
    expect(shouldHandleExternalRevision({ inFlightCommitBatchId: null })).toBe(true);
    expect(shouldHandleExternalRevision({ inFlightCommitBatchId: 'batch-1' })).toBe(false);
  });

  it('prevents overlapping older loadSnapshot calls from overwriting newer snapshots', () => {
    expect(shouldApplySnapshotLoad({ mounted: true, capturedLoadSeq: 4, currentLoadSeq: 4 })).toBe(
      true,
    );
    expect(shouldApplySnapshotLoad({ mounted: true, capturedLoadSeq: 3, currentLoadSeq: 4 })).toBe(
      false,
    );
    expect(shouldApplySnapshotLoad({ mounted: false, capturedLoadSeq: 4, currentLoadSeq: 4 })).toBe(
      false,
    );
  });
});
