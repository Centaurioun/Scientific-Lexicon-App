import Dexie from 'dexie';
import { DexieLibraryRepository } from '@/adapters/storage/dexie-library';
import { applyChange, approveChange, proposeChange } from '@/application/library';
import { canonicalJson, evaluateChangeOnSnapshot, type ChangePayload } from '@/domain/changes';

const TS = '2026-11-27T00:00:00.000Z';

async function readRawSnapshot(dbName: string) {
  const db = new Dexie(dbName);
  db.version(1).stores({
    meta: 'key', concepts: 'id', expressions: 'id, conceptId', assertions: 'id, expressionId',
    provenance: 'id, expressionId', documents: 'id', runs: 'id, documentId', batches: 'batchId', audit: 'id, batchId, &opId',
  });
  await db.open();
  try {
    const [meta, concepts, expressions, assertions, provenance, documents, runs, batches, audit] =
      await Promise.all([
        db.table('meta').get('library'), db.table('concepts').toArray(), db.table('expressions').toArray(),
        db.table('assertions').toArray(), db.table('provenance').toArray(), db.table('documents').toArray(),
        db.table('runs').toArray(), db.table('batches').toArray(), db.table('audit').toArray(),
      ]);
    return {
      schemaVersion: 1 as const,
      libraryRevision: meta?.libraryRevision ?? 0,
      concepts, expressions, assertions, provenance, documents, runs, batches, audit,
    };
  } finally {
    db.close();
  }
}

export async function runMultiBatchPersistence(dbName: string) {
  const repo = new DexieLibraryRepository(dbName);
  try {
    const before = await repo.snapshot();
    const payload: ChangePayload = {
      schemaVersion: 1,
      batchId: 'batch-create-update-assert',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-create',
          concept: { id: 'concept-1', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'expression-1', conceptId: 'concept-1', revision: 0, text: 'TNF',
            language: { kind: 'language', tag: 'en' }, role: 'preferred', createdAt: TS, updatedAt: TS,
          },
          provenance: { id: 'provenance-1', expressionId: 'expression-1', kind: 'manual', createdAt: TS, source: null },
        },
        {
          kind: 'addExpression', opId: 'op-add', expectedConceptRevision: 0,
          expression: {
            id: 'expression-2', conceptId: 'concept-1', revision: 0, text: 'TNF alpha',
            language: { kind: 'language', tag: 'en' }, role: 'alternative', createdAt: TS, updatedAt: TS,
          },
          provenance: {
            id: 'provenance-2', expressionId: 'expression-2', kind: 'manual', createdAt: TS,
            source: { documentId: 'document-1', runId: 'run-1', start: 0, end: 5 },
          },
        },
        {
          kind: 'editExpression', opId: 'op-edit', id: 'expression-2', expectedRevision: 0,
          text: 'TNF-α', language: { kind: 'language', tag: 'en' }, role: 'preferred',
        },
        {
          kind: 'assertExpression', opId: 'op-assert', id: 'expression-2', expectedRevision: 1,
          assertion: {
            id: 'assertion-1', expressionId: 'expression-2', field: 'text', value: 'TNF-α',
            recordRevision: 2, kind: 'user-confirmed', actor: 'local-user', assertedAt: TS,
          },
        },
        {
          kind: 'retainDocument', opId: 'op-retain',
          document: { id: 'document-1', title: 'Synthetic source', text: 'TNF-α', createdAt: TS },
          run: {
            id: 'run-1', documentId: 'document-1', algorithmVersion: 's1-grammar-1+s1-boundary-v1',
            libraryRevision: 0, createdAt: TS,
            occurrences: [{
              id: 'occ:0:5', start: 0, end: 5, surface: 'TNF-α', expressionIds: ['expression-2'],
              conceptIds: ['concept-1'], state: 'known-form', resolvedConceptId: 'concept-1',
            }],
          },
        },
        { kind: 'deleteRetainedDocument', opId: 'op-delete-source', id: 'document-1' },
      ],
    };
    const proposal = await proposeChange(before, payload);
    const approval = approveChange(proposal);
    const outcome = evaluateChangeOnSnapshot(before, proposal.payload, approval);
    if (outcome.kind !== 'apply') throw new Error(`Expected evaluator apply, got ${outcome.kind}`);

    const applied = await applyChange(repo, proposal, approval);
    repo.close();
    const persisted = await readRawSnapshot(dbName);
    const abortDbName = `${dbName}-abort`;
    const abortRepo = new DexieLibraryRepository(abortDbName, {
      afterWritesBeforeCommit: () => { throw new Error('Injected atomicity check'); },
    });
    const abortBefore = await abortRepo.snapshot();
    const abortProposal = await proposeChange(abortBefore, {
      schemaVersion: 1,
      batchId: 'batch-abort-multibatch',
      baseLibraryRevision: abortBefore.libraryRevision,
      ops: [{
        kind: 'createConcept', opId: 'op-abort',
        concept: { id: 'concept-abort', revision: 0, createdAt: TS, updatedAt: TS },
        firstExpression: {
          id: 'expression-abort', conceptId: 'concept-abort', revision: 0, text: 'rollback',
          language: { kind: 'language', tag: 'en' }, role: 'preferred', createdAt: TS, updatedAt: TS,
        },
        provenance: { id: 'provenance-abort', expressionId: 'expression-abort', kind: 'manual', createdAt: TS, source: null },
      }],
    });
    const abortResult = await applyChange(abortRepo, abortProposal, approveChange(abortProposal));
    const afterAbort = await abortRepo.snapshot();
    abortRepo.close();
    const result = {
      status: applied.status,
      parity: canonicalJson(persisted) === canonicalJson(outcome.nextSnapshot),
      libraryRevision: persisted.libraryRevision,
      conceptRevision: persisted.concepts.find((concept) => concept.id === 'concept-1')?.revision,
      addedExpressionRevision: persisted.expressions.find((expression) => expression.id === 'expression-2')?.revision,
      assertionProtectsValue: persisted.assertions.some((assertion) =>
        assertion.expressionId === 'expression-2' && assertion.recordRevision === 2 && assertion.value === 'TNF-α'),
      retainedSourceCleanup: persisted.documents.length === 0 && persisted.runs.length === 0 &&
        persisted.provenance.find((item) => item.id === 'provenance-2')?.source === null,
      abortStatus: abortResult.status,
      abortSnapshotUnchanged: canonicalJson(afterAbort) === canonicalJson(abortBefore),
    };
    return result;
  } finally {
    repo.close();
    await Dexie.delete(`${dbName}-abort`);
    await repo.deleteDatabaseForTest();
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__runMultiBatchPersistence = runMultiBatchPersistence;
}
