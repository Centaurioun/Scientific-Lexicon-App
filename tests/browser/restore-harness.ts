import Dexie from 'dexie';
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
import { canonicalJson, type ChangePayload } from '@/domain/changes';
import { createEmptySnapshot } from '@/domain/schema';

const TS = '2026-11-26T12:00:00.000Z';

export interface RestoreVerificationReport {
  exactSnapshotMatch: boolean;
  nonEmptyRestoreStatus: string;
  wrongApprovalStatus: string;
  abortRestoreStatus: string;
  targetStillEmptyAfterAbort: boolean;
  concurrentSuccessCount: number;
  concurrentConflictCount: number;
  concurrentEmptyBackupSuccessCount: number;
  concurrentEmptyBackupConflictCount: number;
  emptyBackupStateIntact: boolean;
  corruptedMetadataStatus: string;
  corruptedMetadataPreserved: boolean;
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
  const emptyRaceRepo1 = new DexieLibraryRepository(`${prefix}-empty-race`);
  const emptyRaceRepo2 = new DexieLibraryRepository(`${prefix}-empty-race`);
  const corruptRepo = new DexieLibraryRepository(`${prefix}-corrupt-meta`);

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

    // An empty backup still claims the empty target. The first restore writes
    // metadata; the concurrent second restore must not report a second apply.
    const emptyBackup = await createBackup(createEmptySnapshot());
    const [emptyRaceA, emptyRaceB] = await Promise.all([
      restoreEmptyLibrary(emptyRaceRepo1, emptyBackup, approveRestore(emptyBackup)),
      restoreEmptyLibrary(emptyRaceRepo2, emptyBackup, approveRestore(emptyBackup)),
    ]);
    const emptyRaceStatuses = [emptyRaceA.status, emptyRaceB.status];
    const concurrentEmptyBackupSuccessCount = emptyRaceStatuses.filter((status) => status === 'applied').length;
    const concurrentEmptyBackupConflictCount = emptyRaceStatuses.filter((status) => status === 'conflict').length;
    const emptyRaceSnapshot = await emptyRaceRepo1.snapshot();
    const emptyBackupStateIntact = canonicalJson(emptyRaceSnapshot) === canonicalJson(emptyBackup.snapshot);

    // Malformed existing metadata must be reported and preserved, never replaced.
    const corruptDb = new Dexie(`${prefix}-corrupt-meta`);
    corruptDb.version(1).stores({
      meta: 'key', concepts: 'id', expressions: 'id, conceptId', assertions: 'id, expressionId',
      provenance: 'id, expressionId', documents: 'id', runs: 'id, documentId', batches: 'batchId', audit: 'id, batchId, &opId',
    });
    await corruptDb.open();
    await corruptDb.table('meta').put({ key: 'library', schemaVersion: 99, libraryRevision: 0 });
    corruptDb.close();
    const corruptedMetadataResult = await restoreEmptyLibrary(corruptRepo, backup, approveRestore(backup));
    const inspectCorruptDb = new Dexie(`${prefix}-corrupt-meta`);
    inspectCorruptDb.version(1).stores({
      meta: 'key', concepts: 'id', expressions: 'id, conceptId', assertions: 'id, expressionId',
      provenance: 'id, expressionId', documents: 'id', runs: 'id, documentId', batches: 'batchId', audit: 'id, batchId, &opId',
    });
    await inspectCorruptDb.open();
    const preservedMeta = await inspectCorruptDb.table('meta').get('library');
    inspectCorruptDb.close();
    const corruptedMetadataPreserved = preservedMeta?.schemaVersion === 99 && preservedMeta?.libraryRevision === 0;

    return {
      exactSnapshotMatch,
      nonEmptyRestoreStatus: secondRes.status,
      wrongApprovalStatus: wrongRes.status,
      abortRestoreStatus: abortRes.status,
      targetStillEmptyAfterAbort,
      concurrentSuccessCount,
      concurrentConflictCount,
      concurrentEmptyBackupSuccessCount,
      concurrentEmptyBackupConflictCount,
      emptyBackupStateIntact,
      corruptedMetadataStatus: corruptedMetadataResult.status,
      corruptedMetadataPreserved,
      matcherInvalidatedAfterRestore,
    };
  } finally {
    srcRepo.close();
    dstRepo.close();
    abortRepo.close();
    raceRepo1.close();
    raceRepo2.close();
    emptyRaceRepo1.close();
    emptyRaceRepo2.close();
    corruptRepo.close();
    await srcRepo.deleteDatabaseForTest();
    await dstRepo.deleteDatabaseForTest();
    await abortRepo.deleteDatabaseForTest();
    await raceRepo1.deleteDatabaseForTest();
    await emptyRaceRepo1.deleteDatabaseForTest();
    await corruptRepo.deleteDatabaseForTest();
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__runRestoreInvariants = runRestoreInvariants;
}
