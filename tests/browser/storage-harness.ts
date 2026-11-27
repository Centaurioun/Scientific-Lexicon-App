import { DexieLibraryRepository } from '@/adapters/storage/dexie-library';
import { applyChange, approveChange, proposeChange } from '@/application/library';
import type { ChangePayload } from '@/domain/changes';

const TS = '2026-11-26T12:00:00.000Z';

export interface StorageVerificationReport {
  emptyRevision: number;
  afterCreateRevision: number;
  formCountAfterAdd: number;
  pdConceptCount: number;
  orphanStatus: string;
  duplicateIdStatus: string;
  replayStatus: string;
  replayRevision: number;
  conflictStatus: string;
  staleStatus: string;
  duplicateOpStatus: string;
  protectedTextStatus: string;
  protectedLanguageStatus: string;
  abortedStatus: string;
  snapshotUnchangedAfterAbort: boolean;
  simultaneousAppliedCount: number;
  simultaneousStaleCount: number;
  simultaneousNoSilentDataLoss: boolean;
  persistenceSupport: boolean;
}

export async function runDexieStorageInvariants(dbName: string): Promise<StorageVerificationReport> {
  const repoA = new DexieLibraryRepository(dbName);
  const repoB = new DexieLibraryRepository(dbName);

  try {
    const empty = await repoA.snapshot();

    // 1. Create concept + first form -> revision 1
    const p1: ChangePayload = {
      schemaVersion: 1,
      batchId: 'batch-1',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-1',
          concept: { id: 'c1', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e1',
            conceptId: 'c1',
            revision: 0,
            text: 'PD',
            language: { kind: 'language', tag: 'en' },
            role: 'abbreviation',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p1', expressionId: 'e1', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    };
    const prop1 = await proposeChange(empty, p1);
    const app1 = approveChange(prop1);
    const res1 = await applyChange(repoA, prop1, app1);
    if (res1.status !== 'applied') throw new Error(`Expected applied, got ${res1.status}`);

    // 2. Replay same batchId + same digest -> replay, revision unchanged
    const replayRes = await applyChange(repoA, prop1, app1);

    // 3. Same batchId + different digest -> conflict
    const snap1 = await repoA.snapshot();
    const conflictPayload: ChangePayload = {
      schemaVersion: 1,
      batchId: 'batch-1',
      baseLibraryRevision: 1,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-conflict',
          concept: { id: 'c-conf', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e-conf',
            conceptId: 'c-conf',
            revision: 0,
            text: 'IL-1',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p-conf', expressionId: 'e-conf', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    };
    const propConf = await proposeChange(snap1, conflictPayload);
    const conflictRes = await applyChange(repoA, propConf, approveChange(propConf));

    // 4. Add second form to c1 and second concept with PD
    const p2: ChangePayload = {
      schemaVersion: 1,
      batchId: 'batch-2',
      baseLibraryRevision: 1,
      ops: [
        {
          kind: 'addExpression',
          opId: 'op-2',
          expectedConceptRevision: 0,
          expression: {
            id: 'e2',
            conceptId: 'c1',
            revision: 0,
            text: 'sondalama derinliği',
            language: { kind: 'language', tag: 'tr' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p2', expressionId: 'e2', kind: 'manual', createdAt: TS, source: null },
        },
        {
          kind: 'createConcept',
          opId: 'op-3',
          concept: { id: 'c2', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e3',
            conceptId: 'c2',
            revision: 0,
            text: 'PD',
            language: { kind: 'language', tag: 'en' },
            role: 'abbreviation',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p3', expressionId: 'e3', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    };
    const prop2 = await proposeChange(snap1, p2);
    const res2 = await applyChange(repoA, prop2, approveChange(prop2));
    if (res2.status !== 'applied') throw new Error(`Expected applied for batch-2, got ${res2.status}`);
    const snap2 = await repoA.snapshot();

    // 5. Orphan expression (missing concept) rejected
    const orphanProp = await proposeChange(snap2, {
      schemaVersion: 1,
      batchId: 'batch-orphan',
      baseLibraryRevision: 2,
      ops: [
        {
          kind: 'addExpression',
          opId: 'op-orphan',
          expectedConceptRevision: 0,
          expression: {
            id: 'e-orphan',
            conceptId: 'missing-concept',
            revision: 0,
            text: 'TNF-α',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p-orphan', expressionId: 'e-orphan', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    });
    const orphanRes = await applyChange(repoA, orphanProp, approveChange(orphanProp));

    // 6. Duplicate concept ID rejected
    const dupIdProp = await proposeChange(snap2, {
      schemaVersion: 1,
      batchId: 'batch-dupid',
      baseLibraryRevision: 2,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-dupid',
          concept: { id: 'c1', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e-dupid',
            conceptId: 'c1',
            revision: 0,
            text: 'Duplicate',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p-dupid', expressionId: 'e-dupid', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    });
    const dupIdRes = await applyChange(repoA, dupIdProp, approveChange(dupIdProp));

    // 7. Stale base revision rejected
    const staleProp = await proposeChange(snap1, {
      schemaVersion: 1,
      batchId: 'batch-stale',
      baseLibraryRevision: 1,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-stale',
          concept: { id: 'c-stale', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e-stale',
            conceptId: 'c-stale',
            revision: 0,
            text: 'Stale',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p-stale', expressionId: 'e-stale', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    });
    const staleRes = await applyChange(repoA, staleProp, approveChange(staleProp));

    // 8. Duplicate opId across batches rejected
    const dupOpProp = await proposeChange(snap2, {
      schemaVersion: 1,
      batchId: 'batch-dupop',
      baseLibraryRevision: 2,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-1',
          concept: { id: 'c-dupop', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e-dupop',
            conceptId: 'c-dupop',
            revision: 0,
            text: 'DupOp',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p-dupop', expressionId: 'e-dupop', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    });
    const dupOpRes = await applyChange(repoA, dupOpProp, approveChange(dupOpProp));

    // 9. Assert e1 user-confirmed -> reject text or language edit
    const assertProp = await proposeChange(snap2, {
      schemaVersion: 1,
      batchId: 'batch-assert',
      baseLibraryRevision: 2,
      ops: [
        {
          kind: 'assertExpression',
          opId: 'op-assert',
          id: 'e1',
          expectedRevision: 0,
          assertion: {
            id: 'a1',
            expressionId: 'e1',
            field: 'text',
            value: 'PD',
            recordRevision: 1,
            kind: 'user-confirmed',
            actor: 'local-user',
            assertedAt: TS,
          },
        },
      ],
    });
    const assertRes = await applyChange(repoA, assertProp, approveChange(assertProp));
    if (assertRes.status !== 'applied') throw new Error('Expected assert applied');
    const snap3 = await repoA.snapshot();

    const protTextProp = await proposeChange(snap3, {
      schemaVersion: 1,
      batchId: 'batch-prot-text',
      baseLibraryRevision: 3,
      ops: [
        {
          kind: 'editExpression',
          opId: 'op-prot-text',
          id: 'e1',
          expectedRevision: 1,
          text: 'Probing Depth',
          language: { kind: 'language', tag: 'en' },
          role: 'abbreviation',
        },
      ],
    });
    const protTextRes = await applyChange(repoA, protTextProp, approveChange(protTextProp));

    const protLangProp = await proposeChange(snap3, {
      schemaVersion: 1,
      batchId: 'batch-prot-lang',
      baseLibraryRevision: 3,
      ops: [
        {
          kind: 'editExpression',
          opId: 'op-prot-lang',
          id: 'e1',
          expectedRevision: 1,
          text: 'PD',
          language: { kind: 'language', tag: 'tr' },
          role: 'abbreviation',
        },
      ],
    });
    const protLangRes = await applyChange(repoA, protLangProp, approveChange(protLangProp));

    // 10. Inject mid-transaction exception -> complete rollback
    const abortRepo = new DexieLibraryRepository(dbName, {
      afterWritesBeforeCommit: () => {
        throw new Error('Injected mid-transaction abort');
      },
    });
    const abortProp = await proposeChange(snap3, {
      schemaVersion: 1,
      batchId: 'batch-abort',
      baseLibraryRevision: 3,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-abort',
          concept: { id: 'c-abort', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e-abort',
            conceptId: 'c-abort',
            revision: 0,
            text: 'ShouldRollback',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p-abort', expressionId: 'e-abort', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    });
    const abortRes = await applyChange(abortRepo, abortProp, approveChange(abortProp));
    abortRepo.close();
    const snapAfterAbort = await repoA.snapshot();
    const snapshotUnchangedAfterAbort = JSON.stringify(snapAfterAbort) === JSON.stringify(snap3);

    // 11. Two connections stale detection
    const snapB = await repoB.snapshot();
    const propA = await proposeChange(snap3, {
      schemaVersion: 1,
      batchId: 'batch-conn-a',
      baseLibraryRevision: 3,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-conn-a',
          concept: { id: 'c-conn-a', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e-conn-a',
            conceptId: 'c-conn-a',
            revision: 0,
            text: 'ConnA',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p-conn-a', expressionId: 'e-conn-a', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    });
    const propB = await proposeChange(snapB, {
      schemaVersion: 1,
      batchId: 'batch-conn-b',
      baseLibraryRevision: 3,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-conn-b',
          concept: { id: 'c-conn-b', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e-conn-b',
            conceptId: 'c-conn-b',
            revision: 0,
            text: 'ConnB',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p-conn-b', expressionId: 'e-conn-b', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    });
    // Launch both independently approved Rev 3 proposals in the same turn so
    // digesting and IndexedDB transaction acquisition overlap in real Chromium.
    const [resConnA, resConnB] = await Promise.all([
      applyChange(repoA, propA, approveChange(propA)),
      applyChange(repoB, propB, approveChange(propB)),
    ]);
    const concurrentSnapshot = await repoA.snapshot();
    const concurrentAppliedCount = [resConnA, resConnB].filter((result) => result.status === 'applied').length;
    const concurrentStaleCount = [resConnA, resConnB].filter((result) => result.status === 'stale').length;
    const concurrentNoSilentDataLoss = concurrentSnapshot.concepts.filter(
      (concept) => concept.id === 'c-conn-a' || concept.id === 'c-conn-b',
    ).length === 1;

    return {
      emptyRevision: empty.libraryRevision,
      afterCreateRevision: res1.revision,
      formCountAfterAdd: snap2.expressions.filter((e) => e.conceptId === 'c1').length,
      pdConceptCount: new Set(snap2.expressions.filter((e) => e.text === 'PD').map((e) => e.conceptId)).size,
      orphanStatus: orphanRes.status,
      duplicateIdStatus: dupIdRes.status,
      replayStatus: replayRes.status,
      replayRevision: replayRes.status === 'replay' ? replayRes.revision : -1,
      conflictStatus: conflictRes.status,
      staleStatus: staleRes.status,
      duplicateOpStatus: dupOpRes.status,
      protectedTextStatus: protTextRes.status,
      protectedLanguageStatus: protLangRes.status,
      abortedStatus: abortRes.status,
      snapshotUnchangedAfterAbort,
      simultaneousAppliedCount: concurrentAppliedCount,
      simultaneousStaleCount: concurrentStaleCount,
      simultaneousNoSilentDataLoss: concurrentNoSilentDataLoss,
      persistenceSupport: typeof navigator !== 'undefined' && Boolean(navigator.storage?.persist),
    };
  } finally {
    repoA.close();
    repoB.close();
    await repoA.deleteDatabaseForTest();
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__runDexieStorageInvariants =
    runDexieStorageInvariants;
}
