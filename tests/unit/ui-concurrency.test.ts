import { describe, expect, it } from 'vitest';
import {
  evaluateCommitSettlement,
  RevisionReconciliationController,
  shouldApplyProposalResult,
  shouldApplySnapshotLoad,
  type RetainedRunMeta,
} from '@/features/extraction/concurrency-controller';
import type { ApplyResult, ProposedChange } from '@/domain/changes';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeProposal(batchId: string, baseLibraryRevision: number): ProposedChange {
  return {
    digest: 'a'.repeat(64),
    preview: [`Test proposal ${batchId}`],
    payload: {
      schemaVersion: 1,
      batchId,
      baseLibraryRevision,
      ops: [],
    },
  };
}

function makeSnapshot(revision: number): LibrarySnapshot {
  return {
    ...createEmptySnapshot(),
    libraryRevision: revision,
  };
}

describe('QC05 + FH01: ExtractionWorkspace async concurrency and lossless revision reconciliation', () => {
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

    expect(
      shouldApplyProposalResult({
        mounted: true,
        capturedContextSeq: 3,
        currentContextSeq: 4,
        capturedProposalSeq: 2,
        currentProposalSeq: 2,
      }),
    ).toBe(false);

    expect(
      shouldApplyProposalResult({
        mounted: true,
        capturedContextSeq: 3,
        currentContextSeq: 3,
        capturedProposalSeq: 2,
        currentProposalSeq: 3,
      }),
    ).toBe(false);

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

    const movedView = evaluateCommitSettlement({
      resultStatus: 'applied',
      committedRevision: 6,
      commitBatchId: 'batch-2',
      activePendingBatchId: 'batch-3',
      capturedContextSeq: 2,
      currentContextSeq: 3,
      activeRunId: 'run-B',
      capturedRetainMeta: { documentId: 'doc-2', runId: 'ret-2', forRunId: 'run-A' },
    });
    expect(movedView.committed).toBe(true);
    expect(movedView.shouldInvalidateMatcher).toBe(true);
    expect(movedView.shouldReloadSnapshot).toBe(true);
    expect(movedView.shouldClearPendingProposal).toBe(false);
    expect(movedView.shouldAttachRetainedRunLink).toBe(false);
    expect(movedView.viewStaleAfterCommit).toBe(true);

    const conflict = evaluateCommitSettlement({
      resultStatus: 'conflict',
      committedRevision: -1,
      commitBatchId: 'batch-4',
      activePendingBatchId: 'batch-4',
      capturedContextSeq: 3,
      currentContextSeq: 3,
      activeRunId: 'run-B',
      capturedRetainMeta: { documentId: 'doc-3', runId: 'ret-3', forRunId: 'run-B' },
    });
    expect(conflict.committed).toBe(false);
    expect(conflict.shouldInvalidateMatcher).toBe(true);
    expect(conflict.shouldReloadSnapshot).toBe(true);
    expect(conflict.shouldAttachRetainedRunLink).toBe(false);
    expect(conflict.shouldClearPendingProposal).toBe(true);
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

  it('FH01-1: reconciles a concurrent external revision notification when an in-flight commit settles as conflict, rejected, or error', async () => {
    for (const outcome of [
      { kind: 'result' as const, result: { status: 'conflict' as const, reason: 'Base revision 0 is stale; current revision is 1.' } },
      { kind: 'result' as const, result: { status: 'invalid' as const, reason: 'Digest rejected.' } },
      { kind: 'throw' as const, error: new Error('Simulated IndexedDB transaction abort') },
    ]) {
      let currentSnapshot = makeSnapshot(0);
      let matcherInvalidations = 0;
      let analysisAborts = 0;
      let loadCalls = 0;
      let pendingEntry: { proposal: ProposedChange; retainMeta: RetainedRunMeta | null } | null = {
        proposal: makeProposal('batch-fail', 0),
        retainMeta: { documentId: 'd1', runId: 'r1', forRunId: 'run-1' },
      };
      let lastError: string | null = null;
      let applying = false;

      const applyDeferred = createDeferred<ApplyResult>();
      const reloadDeferred = createDeferred<LibrarySnapshot>();

      const controller = new RevisionReconciliationController();
      const loadSnapshot = async (): Promise<LibrarySnapshot | null> => {
        loadCalls += 1;
        const snap = await reloadDeferred.promise;
        currentSnapshot = snap;
        return snap;
      };

      const commitPromise = controller.runCommit({
        proposal: pendingEntry.proposal,
        retainMeta: pendingEntry.retainMeta,
        capturedContextSeq: 1,
        getCurrentContextSeq: () => 1,
        getActiveRunId: () => 'run-1',
        getActivePendingEntry: () => pendingEntry,
        isMounted: () => true,
        applyProposal: () => applyDeferred.promise,
        loadSnapshot,
        invalidateMatcher: () => {
          matcherInvalidations += 1;
        },
        abortActiveAnalysis: () => {
          analysisAborts += 1;
        },
        setApplying: (v) => {
          applying = v;
        },
        clearPendingIfBatchMatches: (batchId) => {
          if (pendingEntry?.proposal.payload.batchId === batchId) {
            pendingEntry = null;
          }
        },
        invalidateStalePendingProposal: () => {
          pendingEntry = null;
        },
        attachRetainedRunLink: () => {
          throw new Error('Failed commit must never attach retainedRunLink');
        },
        setStatusNotice: () => {},
        setAnalysisError: (msg) => {
          lastError = msg;
        },
      });

      expect(applying).toBe(true);

      // External write commits revision 1 while batch-fail is still awaiting IndexedDB!
      const obs = controller.observeRevisionNotification(1);
      expect(obs).toEqual({ action: 'defer' });

      // Now batch-fail settles with conflict / invalid / thrown error
      if (outcome.kind === 'result') {
        applyDeferred.resolve(outcome.result);
      } else {
        applyDeferred.reject(outcome.error);
      }

      // Reload MUST be triggered to reconcile revision 1
      await Promise.resolve();
      reloadDeferred.resolve(makeSnapshot(1));
      await commitPromise;

      expect(applying).toBe(false);
      expect(loadCalls).toBe(1);
      expect(currentSnapshot.libraryRevision).toBe(1);
      expect(matcherInvalidations).toBeGreaterThanOrEqual(1);
      expect(analysisAborts).toBeGreaterThanOrEqual(1);
      expect(pendingEntry).toBeNull();
      expect(lastError).toBeTruthy();
      expect(controller.isCommitInFlight()).toBe(false);
    }
  });

  it('FH01-2: reconciles a revision notification arriving during post-commit loadSnapshot without losing the later revision or looping infinitely', async () => {
    let currentSnapshot = makeSnapshot(0);
    let matcherInvalidations = 0;
    let analysisAborts = 0;
    let statusNotice: string | null = null;
    let applying = false;
    let loadSeq = 0;

    const applyDeferred = createDeferred<ApplyResult>();
    const firstLoadDeferred = createDeferred<LibrarySnapshot>();
    const secondLoadDeferred = createDeferred<LibrarySnapshot>();

    const controller = new RevisionReconciliationController();
    const commitProposal = makeProposal('batch-own', 0);
    let pendingEntry: { proposal: ProposedChange; retainMeta: RetainedRunMeta | null } | null = {
      proposal: commitProposal,
      retainMeta: null,
    };

    const loadSnapshot = async (): Promise<LibrarySnapshot | null> => {
      const seq = ++loadSeq;
      const snap = seq === 1 ? await firstLoadDeferred.promise : await secondLoadDeferred.promise;
      if (shouldApplySnapshotLoad({ mounted: true, capturedLoadSeq: seq, currentLoadSeq: loadSeq })) {
        currentSnapshot = snap;
      }
      return snap;
    };

    const commitPromise = controller.runCommit({
      proposal: commitProposal,
      retainMeta: null,
      capturedContextSeq: 1,
      getCurrentContextSeq: () => 1,
      getActiveRunId: () => 'run-1',
      getActivePendingEntry: () => pendingEntry,
      isMounted: () => true,
      applyProposal: async () => {
        const res = await applyDeferred.promise;
        if (res.status === 'applied') {
          // Dexie fires subscribeRevision synchronously right before apply() returns
          controller.observeRevisionNotification(res.revision);
        }
        return res;
      },
      loadSnapshot,
      invalidateMatcher: () => {
        matcherInvalidations += 1;
      },
      abortActiveAnalysis: () => {
        analysisAborts += 1;
      },
      setApplying: (v) => {
        applying = v;
      },
      clearPendingIfBatchMatches: (batchId) => {
        if (pendingEntry?.proposal.payload.batchId === batchId) {
          pendingEntry = null;
        }
      },
      invalidateStalePendingProposal: () => {
        pendingEntry = null;
      },
      attachRetainedRunLink: () => {},
      setStatusNotice: (msg) => {
        statusNotice = msg;
      },
      setAnalysisError: () => {},
    });

    // Own commit applies Rev 1
    applyDeferred.resolve({ status: 'applied', revision: 1 });
    await Promise.resolve();
    await Promise.resolve();

    // While first loadSnapshot() is reading Rev 1, another write commits Rev 2 AND Rev 3!
    expect(controller.observeRevisionNotification(2)).toEqual({ action: 'defer' });
    expect(controller.observeRevisionNotification(3)).toEqual({ action: 'defer' });

    // First load resolves with stale Rev 1 -> controller MUST coalesce and run exactly ONE follow-up load!
    firstLoadDeferred.resolve(makeSnapshot(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(loadSeq).toBe(2);
    secondLoadDeferred.resolve(makeSnapshot(3));
    await commitPromise;

    expect(applying).toBe(false);
    expect(loadSeq).toBe(2); // Coalesced Rev 2 & Rev 3 into one follow-up refresh; no infinite loop
    expect(currentSnapshot.libraryRevision).toBe(3);
    expect(matcherInvalidations).toBeGreaterThanOrEqual(2);
    expect(analysisAborts).toBeGreaterThanOrEqual(1);
    expect(statusNotice).toContain('revision 1');
    expect(statusNotice).toContain('revision 3');
  });

  it('FH01-3: preserves newer non-stale proposal and its retainMeta while explicitly invalidating a newer proposal that became stale against the new revision', async () => {
    // Case A: Own replay at Rev 1 while a newer proposal targeting Rev 1 (with retainMeta) is open -> PRESERVED!
    {
      const controller = new RevisionReconciliationController();
      const newerRetain: RetainedRunMeta = { documentId: 'doc-new', runId: 'run-new', forRunId: 'run-2' };
      let pendingEntry: { proposal: ProposedChange; retainMeta: RetainedRunMeta | null } | null = {
        proposal: makeProposal('batch-newer', 1),
        retainMeta: newerRetain,
      };
      let attachedRetain: RetainedRunMeta | null = null;
      let statusNotice: string | null = null;

      await controller.runCommit({
        proposal: makeProposal('batch-replay', 0),
        retainMeta: { documentId: 'doc-old', runId: 'run-old', forRunId: 'run-1' },
        capturedContextSeq: 1,
        getCurrentContextSeq: () => 2, // view already moved on
        getActiveRunId: () => 'run-2',
        getActivePendingEntry: () => pendingEntry,
        isMounted: () => true,
        applyProposal: async () => ({ status: 'replay', revision: 1 }),
        loadSnapshot: async () => makeSnapshot(1),
        invalidateMatcher: () => {},
        abortActiveAnalysis: () => {},
        setApplying: () => {},
        clearPendingIfBatchMatches: (batchId) => {
          if (pendingEntry?.proposal.payload.batchId === batchId) pendingEntry = null;
        },
        invalidateStalePendingProposal: () => {
          pendingEntry = null;
        },
        attachRetainedRunLink: (meta) => {
          attachedRetain = meta;
        },
        setStatusNotice: (msg) => {
          statusNotice = msg;
        },
        setAnalysisError: () => {},
      });

      expect(attachedRetain).toBeNull(); // Stale run link NOT attached
      expect(pendingEntry?.proposal.payload.batchId).toBe('batch-newer'); // Newer proposal preserved
      expect(pendingEntry?.retainMeta).toEqual(newerRetain); // Paired retainMeta preserved!
      expect(statusNotice).toContain('revision 1');
    }

    // Case B: Own commit advances to Rev 2 while a newer proposal targeting Rev 1 is open -> EXPLICITLY INVALIDATED!
    {
      const controller = new RevisionReconciliationController();
      let pendingEntry: { proposal: ProposedChange; retainMeta: RetainedRunMeta | null } | null = {
        proposal: makeProposal('batch-stale-newer', 1),
        retainMeta: { documentId: 'doc-x', runId: 'run-x', forRunId: 'run-2' },
      };
      let invalidatedReason: string | null = null;

      await controller.runCommit({
        proposal: makeProposal('batch-commit', 1),
        retainMeta: null,
        capturedContextSeq: 1,
        getCurrentContextSeq: () => 1,
        getActiveRunId: () => 'run-2',
        getActivePendingEntry: () => pendingEntry,
        isMounted: () => true,
        applyProposal: async () => {
          controller.observeRevisionNotification(2);
          return { status: 'applied', revision: 2 };
        },
        loadSnapshot: async () => makeSnapshot(2),
        invalidateMatcher: () => {},
        abortActiveAnalysis: () => {},
        setApplying: () => {},
        clearPendingIfBatchMatches: (batchId) => {
          if (pendingEntry?.proposal.payload.batchId === batchId) pendingEntry = null;
        },
        invalidateStalePendingProposal: (reason) => {
          invalidatedReason = reason;
          pendingEntry = null;
        },
        attachRetainedRunLink: () => {},
        setStatusNotice: () => {},
        setAnalysisError: () => {},
      });

      expect(pendingEntry).toBeNull();
      expect(invalidatedReason).toMatch(/revision 2/i);
    }
  });

  it('FH01-4: never rolls back an authorized commit and suppresses UI publication if workspace unmounts mid-flight', async () => {
    const controller = new RevisionReconciliationController();
    const applyDeferred = createDeferred<ApplyResult>();
    let mounted = true;
    let committedInRepo = false;
    let uiWritesAfterUnmount = 0;
    let matcherInvalidated = false;

    const commitPromise = controller.runCommit({
      proposal: makeProposal('batch-unmount', 0),
      retainMeta: { documentId: 'd1', runId: 'r1', forRunId: 'run-1' },
      capturedContextSeq: 1,
      getCurrentContextSeq: () => 1,
      getActiveRunId: () => 'run-1',
      getActivePendingEntry: () => null,
      isMounted: () => mounted,
      applyProposal: async () => {
        const res = await applyDeferred.promise;
        committedInRepo = true;
        return res;
      },
      loadSnapshot: async () => {
        if (!mounted) uiWritesAfterUnmount += 1;
        return makeSnapshot(1);
      },
      invalidateMatcher: () => {
        matcherInvalidated = true;
      },
      abortActiveAnalysis: () => {},
      setApplying: (v) => {
        if (!mounted && !v) uiWritesAfterUnmount += 1;
      },
      clearPendingIfBatchMatches: () => {
        if (!mounted) uiWritesAfterUnmount += 1;
      },
      invalidateStalePendingProposal: () => {
        if (!mounted) uiWritesAfterUnmount += 1;
      },
      attachRetainedRunLink: () => {
        if (!mounted) uiWritesAfterUnmount += 1;
      },
      setStatusNotice: () => {
        if (!mounted) uiWritesAfterUnmount += 1;
      },
      setAnalysisError: () => {
        if (!mounted) uiWritesAfterUnmount += 1;
      },
    });

    // Unmount while IndexedDB commit is in flight
    mounted = false;
    applyDeferred.resolve({ status: 'applied', revision: 1 });
    await commitPromise;

    expect(committedInRepo).toBe(true);
    expect(matcherInvalidated).toBe(true);
    expect(uiWritesAfterUnmount).toBe(0);
    expect(controller.isCommitInFlight()).toBe(false);
  });

  it('E1-1: does not silently lose a revision notification arriving during the 8th reconcile drain and converges via bounded continuation', async () => {
    const controller = new RevisionReconciliationController();
    let currentSnapshot = makeSnapshot(0);
    let loadCallCount = 0;
    let matcherInvalidations = 0;
    let analysisAborts = 0;
    let statusNotice: string | null = null;
    let pendingEntry: { proposal: ProposedChange; retainMeta: RetainedRunMeta | null } | null = {
      proposal: makeProposal('batch-newer-rev8', 8),
      retainMeta: null,
    };
    let invalidatedReason: string | null = null;

    // 1 initial post-commit load (rev 1) + 8 drain loads (revs 2..9).
    // During load #9 (the 8th drain, loading rev 9), notification rev 10 arrives!
    // The controller must NOT drop rev 10 in finally — it must coalesce and schedule a bounded
    // continuation refresh (load #10 -> rev 10) and invalidate the stale rev-8 proposal.
    const loadSnapshot = async (): Promise<LibrarySnapshot | null> => {
      loadCallCount += 1;
      const loadedRevision = loadCallCount; // load 1 -> rev 1, ..., load 9 (8th drain) -> rev 9, load 10 -> rev 10
      if (loadCallCount >= 1 && loadCallCount <= 9) {
        // An external write commits loadedRevision + 1 while this loadSnapshot is in flight!
        // Specifically, when loadCallCount === 9 (the 8th drain!), rev 10 arrives.
        controller.observeRevisionNotification(loadedRevision + 1);
      }
      const snap = makeSnapshot(loadedRevision);
      currentSnapshot = snap;
      return snap;
    };

    await controller.runCommit({
      proposal: makeProposal('batch-e1', 0),
      retainMeta: null,
      capturedContextSeq: 1,
      getCurrentContextSeq: () => 1,
      getActiveRunId: () => 'run-1',
      getActivePendingEntry: () => pendingEntry,
      isMounted: () => true,
      applyProposal: async () => {
        controller.observeRevisionNotification(1);
        return { status: 'applied', revision: 1 };
      },
      loadSnapshot,
      invalidateMatcher: () => {
        matcherInvalidations += 1;
      },
      abortActiveAnalysis: () => {
        analysisAborts += 1;
      },
      setApplying: () => {},
      clearPendingIfBatchMatches: (batchId) => {
        if (pendingEntry?.proposal.payload.batchId === batchId) {
          pendingEntry = null;
        }
      },
      invalidateStalePendingProposal: (reason) => {
        invalidatedReason = reason;
        pendingEntry = null;
      },
      attachRetainedRunLink: () => {},
      setStatusNotice: (msg) => {
        statusNotice = msg;
      },
      setAnalysisError: () => {},
    });

    expect(currentSnapshot.libraryRevision).toBe(10);
    expect(loadCallCount).toBe(10);
    expect(controller.isFreshnessConfirmed()).toBe(true);
    expect(controller.getPendingHighWaterRevision()).toBeNull();
    expect(pendingEntry).toBeNull();
    expect(invalidatedReason).toContain('revision 10');
    expect(statusNotice).toContain('revision 1');
    expect(statusNotice).toContain('revision 10');
    expect(matcherInvalidations).toBeGreaterThanOrEqual(9);
    expect(analysisAborts).toBeGreaterThanOrEqual(8);
  });

  it('E1-2: fails closed with explicit unconfirmed freshness state when continuous revision notifications exceed total bounded continuation passes', async () => {
    const controller = new RevisionReconciliationController();
    let currentSnapshot = makeSnapshot(0);
    let loadCallCount = 0;
    let analysisError: string | null = null;
    let pendingEntry: { proposal: ProposedChange; retainMeta: RetainedRunMeta | null } | null = {
      proposal: makeProposal('batch-open', 1),
      retainMeta: null,
    };

    // Every single loadSnapshot triggers yet another external notification without stopping.
    const loadSnapshot = async (): Promise<LibrarySnapshot | null> => {
      loadCallCount += 1;
      controller.observeRevisionNotification(loadCallCount + 1);
      const snap = makeSnapshot(loadCallCount);
      currentSnapshot = snap;
      return snap;
    };

    await controller.runCommit({
      proposal: makeProposal('batch-storm', 0),
      retainMeta: null,
      capturedContextSeq: 1,
      getCurrentContextSeq: () => 1,
      getActiveRunId: () => 'run-1',
      getActivePendingEntry: () => pendingEntry,
      isMounted: () => true,
      applyProposal: async () => {
        controller.observeRevisionNotification(1);
        return { status: 'applied', revision: 1 };
      },
      loadSnapshot,
      invalidateMatcher: () => {},
      abortActiveAnalysis: () => {},
      setApplying: () => {},
      clearPendingIfBatchMatches: (batchId) => {
        if (pendingEntry?.proposal.payload.batchId === batchId) {
          pendingEntry = null;
        }
      },
      invalidateStalePendingProposal: () => {
        pendingEntry = null;
      },
      attachRetainedRunLink: () => {},
      setStatusNotice: () => {},
      setAnalysisError: (msg) => {
        analysisError = msg;
      },
    });

    // Must stop within a strict upper bound (no unbounded loop), fail closed on freshness,
    // invalidate any open proposal, and preserve the pending high-water revision until an explicit retry succeeds.
    expect(loadCallCount).toBeLessThanOrEqual(20);
    expect(controller.isFreshnessConfirmed()).toBe(false);
    expect(controller.getPendingHighWaterRevision()).toBe(loadCallCount + 1);
    expect(pendingEntry).toBeNull();
    expect(analysisError).toMatch(/authoritative revision freshness could not be confirmed/i);

    // Explicit retry settles cleanly once notifications stop arriving
    const settledSnap = await controller.confirmFreshnessWithSnapshot(async () => {
      const snap = makeSnapshot(loadCallCount + 1);
      currentSnapshot = snap;
      return snap;
    });
    expect(settledSnap?.libraryRevision).toBe(loadCallCount + 1);
    expect(controller.isFreshnessConfirmed()).toBe(true);
    expect(controller.getPendingHighWaterRevision()).toBeNull();
  });
});

