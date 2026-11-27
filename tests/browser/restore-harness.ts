import { RevisionCachedRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import { DexieLibraryRepository } from '@/adapters/storage/dexie-library';
import {
  applyChange,
  approveChange,
  approveRestore,
  proposeChange,
  restoreEmptyLibrary,
} from '@/application/library';
import { createBackup } from '@/domain/backup';
import type { ChangePayload } from '@/domain/changes';

const TS = '2026-11-26T12:00:00.000Z';

export interface RestoreVerificationReport {
  exactSnapshotMatch: boolean;
  nonEmptyRestoreStatus: string;
  wrongApprovalStatus: string;
  abortRestoreStatus: string;
  targetStillEmptyAfterAbort: boolean;
  concurrentSuccessCount: number;
  concurrentConflictCount: number;
  matcherInvalidatedAfterRestore: boolean;
}

export async function runRestoreInvariants(prefix: string): Promise<RestoreVerificationReport> {
  const srcRepo = new DexieLibraryRepository(`${prefix}-src`);
  const dstRepo = new DexieLibraryRepository(`${prefix}-dst`);
  const abortRepo = new DexieLibraryRepository(`${prefix}-abort`, {
    afterWritesBeforeCommit: () => {
      throw new Error('Injected restore write abort');
    },
  });
  const raceRepo1 = new DexieLibraryRepository(`${prefix}-race`);
  const raceRepo2 = new DexieLibraryRepository(`${prefix}-race`);

  try {
    // Seed source DB through approved gateway
    const empty = await srcRepo.snapshot();
    const payload: ChangePayload = {
      schemaVersion: 1,
      batchId: 'b-src-1',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-src-1',
          concept: { id: 'c1', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e1',
            conceptId: 'c1',
            revision: 0,
            text: 'TNF-α',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p1', expressionId: 'e1', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    };
    const prop = await proposeChange(empty, payload);
    const applyRes = await applyChange(srcRepo, prop, approveChange(prop));
    if (applyRes.status !== 'applied') throw new Error('Source seed failed');
    const sourceSnap = await srcRepo.snapshot();
    const backup = await createBackup(sourceSnap);

    // Prepare cached matcher subscribed to dstRepo revision commits
    const matcher = new RevisionCachedRegisteredMatcher();
    dstRepo.subscribeRevision(() => matcher.invalidate());
    // Prime matcher at revision 0 (empty)
    const beforeRestoreMatches = await matcher.matchForRevision(0, 'TNF-α here', []);
    if (beforeRestoreMatches.length !== 0) throw new Error('Expected 0 matches before restore');

    // 1. Wrong digest approval rejected
    const wrongApproval = { ...approveRestore(backup), digest: '0'.repeat(64) };
    const wrongRes = await restoreEmptyLibrary(dstRepo, backup, wrongApproval);

    // 2. Valid restore into empty target
    const validRes = await restoreEmptyLibrary(dstRepo, backup, approveRestore(backup));
    if (validRes.status !== 'applied') throw new Error(`Expected restore applied, got ${validRes.status}`);
    const restoredSnap = await dstRepo.snapshot();
    const exactSnapshotMatch = JSON.stringify(restoredSnap) === JSON.stringify(sourceSnap);

    const afterRestoreMatches = await matcher.matchForRevision(
      restoredSnap.libraryRevision,
      'TNF-α here',
      restoredSnap.expressions,
    );
    const matcherInvalidatedAfterRestore =
      afterRestoreMatches.length === 1 && afterRestoreMatches[0].surface === 'TNF-α';

    // 3. Same backup into now non-empty target rejected
    const secondRes = await restoreEmptyLibrary(dstRepo, backup, approveRestore(backup));

    // 4. Injected write failure rolls back completely leaving empty target
    const abortRes = await restoreEmptyLibrary(abortRepo, backup, approveRestore(backup));
    const checkAbortRepo = new DexieLibraryRepository(`${prefix}-abort`);
    const afterAbortSnap = await checkAbortRepo.snapshot();
    checkAbortRepo.close();
    const targetStillEmptyAfterAbort =
      afterAbortSnap.libraryRevision === 0 &&
      afterAbortSnap.concepts.length === 0 &&
      afterAbortSnap.audit.length === 0;

    // 5. Two simultaneous restore requests -> at most one succeeds
    const [raceA, raceB] = await Promise.all([
      restoreEmptyLibrary(raceRepo1, backup, approveRestore(backup)),
      restoreEmptyLibrary(raceRepo2, backup, approveRestore(backup)),
    ]);
    const raceStatuses = [raceA.status, raceB.status];
    const concurrentSuccessCount = raceStatuses.filter((s) => s === 'applied').length;
    const concurrentConflictCount = raceStatuses.filter((s) => s === 'conflict').length;

    return {
      exactSnapshotMatch,
      nonEmptyRestoreStatus: secondRes.status,
      wrongApprovalStatus: wrongRes.status,
      abortRestoreStatus: abortRes.status,
      targetStillEmptyAfterAbort,
      concurrentSuccessCount,
      concurrentConflictCount,
      matcherInvalidatedAfterRestore,
    };
  } finally {
    srcRepo.close();
    dstRepo.close();
    abortRepo.close();
    raceRepo1.close();
    raceRepo2.close();
    await srcRepo.deleteDatabaseForTest();
    await dstRepo.deleteDatabaseForTest();
    await abortRepo.deleteDatabaseForTest();
    await raceRepo1.deleteDatabaseForTest();
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__runRestoreInvariants = runRestoreInvariants;
}
