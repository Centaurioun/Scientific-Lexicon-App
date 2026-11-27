import Dexie, { type Table } from 'dexie';
import {
  parseRestoreApproval,
  validateBackup,
  type BackupEnvelope,
  type RestoreApproval,
} from '@/domain/backup';
import {
  cloneAndFreezeJson,
  digest,
  evaluateChangeOnSnapshot,
  parseApproval,
  parseChangePayload,
  type Approval,
  type ApplyResult,
  type ChangePayload,
  type ProposedChange,
} from '@/domain/changes';
import type { RecoveryRepository } from '@/domain/repository';
import {
  createEmptySnapshot,
  parseLibrarySnapshot,
  type AppliedBatch,
  type AuditEntry,
  type Concept,
  type Expression,
  type LibrarySnapshot,
  type Provenance,
  type RetainedDocument,
  type RetainedRun,
  type VerificationAssertion,
} from '@/domain/schema';

export const DEFAULT_LIBRARY_DB_NAME = 'termforge-library-v1';

export interface MetaRecord {
  key: 'library';
  schemaVersion: 1;
  libraryRevision: number;
}

export interface DexieRepositoryOptions {
  /** Test-only fault injection hook invoked inside the transaction after writes and before commit. */
  afterWritesBeforeCommit?: () => void;
  /** Optional listener invoked after a committed revision change so derived caches can invalidate. */
  onRevisionCommitted?: (revision: number) => void;
}

export interface BrowserStorageStatus {
  indexedDbAvailable: boolean;
  persistenceSupported: boolean;
  persisted: boolean | null;
  quotaBytes: number | null;
  usageBytes: number | null;
}

class TermForgeDatabase extends Dexie {
  meta!: Table<MetaRecord, 'library'>;
  concepts!: Table<Concept, string>;
  expressions!: Table<Expression, string>;
  assertions!: Table<VerificationAssertion, string>;
  provenance!: Table<Provenance, string>;
  documents!: Table<RetainedDocument, string>;
  runs!: Table<RetainedRun, string>;
  batches!: Table<AppliedBatch, string>;
  audit!: Table<AuditEntry, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      meta: 'key',
      concepts: 'id',
      expressions: 'id, conceptId',
      assertions: 'id, expressionId',
      provenance: 'id, expressionId',
      documents: 'id',
      runs: 'id, documentId',
      batches: 'batchId',
      audit: 'id, batchId, &opId',
    });
  }
}

function classifyStorageError(error: unknown): Exclude<ApplyResult, { status: 'applied' | 'replay' }> {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  if (
    name === 'QuotaExceededError' ||
    name === 'SecurityError' ||
    name === 'OpenFailedError' ||
    name === 'DatabaseClosedError' ||
    name === 'MissingAPIError' ||
    /indexeddb|storage denied|quota|securityerror/i.test(message)
  ) {
    return {
      status: 'unavailable',
      reason: `Local IndexedDB storage is unavailable or denied: ${message}`,
    };
  }

  return {
    status: 'aborted',
    reason: `Transaction aborted and rolled back: ${message}`,
  };
}

export class DexieLibraryRepository implements RecoveryRepository {
  protected readonly db: TermForgeDatabase;
  protected readonly dbName: string;
  protected readonly options: DexieRepositoryOptions;
  private readonly revisionListeners = new Set<(revision: number) => void>();

  constructor(dbName: string = DEFAULT_LIBRARY_DB_NAME, options: DexieRepositoryOptions = {}) {
    this.dbName = dbName;
    this.options = options;
    this.db = new TermForgeDatabase(dbName);
    if (options.onRevisionCommitted) {
      this.revisionListeners.add(options.onRevisionCommitted);
    }
  }

  protected get allTables() {
    return [
      this.db.meta,
      this.db.concepts,
      this.db.expressions,
      this.db.assertions,
      this.db.provenance,
      this.db.documents,
      this.db.runs,
      this.db.batches,
      this.db.audit,
    ] as const;
  }

  subscribeRevision(listener: (revision: number) => void): () => void {
    this.revisionListeners.add(listener);
    return () => {
      this.revisionListeners.delete(listener);
    };
  }

  protected notifyRevisionCommitted(revision: number): void {
    for (const listener of this.revisionListeners) {
      try {
        listener(revision);
      } catch {
        // Cache invalidation callbacks must never corrupt committed repository outcomes.
      }
    }
  }

  close(): void {
    this.db.close();
  }

  async deleteDatabaseForTest(): Promise<void> {
    this.db.close();
    await Dexie.delete(this.dbName);
  }

  protected async readSnapshotInsideTransaction(): Promise<{
    snapshot: LibrarySnapshot;
    hasMeta: boolean;
  }> {
    const [meta, concepts, expressions, assertions, provenance, documents, runs, batches, audit] =
      await Promise.all([
        this.db.meta.get('library'),
        this.db.concepts.toArray(),
        this.db.expressions.toArray(),
        this.db.assertions.toArray(),
        this.db.provenance.toArray(),
        this.db.documents.toArray(),
        this.db.runs.toArray(),
        this.db.batches.toArray(),
        this.db.audit.toArray(),
      ]);

    const totalRecords =
      concepts.length +
      expressions.length +
      assertions.length +
      provenance.length +
      documents.length +
      runs.length +
      batches.length +
      audit.length;

    if (!meta) {
      if (totalRecords === 0) {
        return { snapshot: createEmptySnapshot(), hasMeta: false };
      }
      throw new Error('Corrupted library database: metadata record is missing while stores contain data.');
    }

    if (meta.schemaVersion !== 1) {
      throw new Error(`Unsupported library schemaVersion: ${String(meta.schemaVersion)}`);
    }

    const rawSnapshot: LibrarySnapshot = {
      schemaVersion: 1,
      libraryRevision: meta.libraryRevision,
      concepts,
      expressions,
      assertions,
      provenance,
      documents,
      runs,
      batches,
      audit,
    };

    const validated = parseLibrarySnapshot(rawSnapshot);
    return { snapshot: validated, hasMeta: true };
  }

  async snapshot(): Promise<LibrarySnapshot> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is unavailable in this runtime environment.');
    }

    return this.db.transaction('r', [...this.allTables], async () => {
      const { snapshot } = await this.readSnapshotInsideTransaction();
      return snapshot;
    });
  }

  async apply(proposal: ProposedChange, approval: Approval): Promise<ApplyResult> {
    if (typeof indexedDB === 'undefined') {
      return {
        status: 'unavailable',
        reason: 'IndexedDB is unavailable in this runtime environment.',
      };
    }

    let validPayload: ChangePayload;
    let validApproval: Approval;
    let recomputedDigest: string;
    try {
      validPayload = parseChangePayload(proposal?.payload);
      validApproval = parseApproval(approval);
      recomputedDigest = await digest(validPayload);
    } catch (error) {
      return {
        status: 'invalid',
        reason: error instanceof Error ? error.message : 'Invalid proposal or approval payload.',
      };
    }

    if (recomputedDigest !== proposal.digest) {
      return {
        status: 'invalid',
        reason: 'Proposal digest does not match canonical payload.',
      };
    }
    if (validApproval.batchId !== validPayload.batchId || validApproval.digest !== recomputedDigest) {
      return {
        status: 'invalid',
        reason: 'Approval does not match proposal batchId and canonical digest.',
      };
    }

    const frozenPayload = cloneAndFreezeJson(validPayload);

    try {
      const txResult = await this.db.transaction('rw', [...this.allTables], async () => {
        const { snapshot, hasMeta } = await this.readSnapshotInsideTransaction();
        const outcome = evaluateChangeOnSnapshot(snapshot, frozenPayload, validApproval);

        if (outcome.kind === 'replay') {
          return { status: 'replay' as const, revision: outcome.revision };
        }

        if (outcome.kind === 'error') {
          return outcome.result;
        }

        // Creates use strict add() so duplicate IDs fail closed instead of silently overwriting
        for (const concept of outcome.createdConcepts) {
          await this.db.concepts.add(concept);
        }
        for (const expression of outcome.createdExpressions) {
          await this.db.expressions.add(expression);
        }
        for (const assertion of outcome.createdAssertions) {
          await this.db.assertions.add(assertion);
        }
        for (const prov of outcome.createdProvenance) {
          await this.db.provenance.add(prov);
        }
        for (const doc of outcome.createdDocuments) {
          await this.db.documents.add(doc);
        }
        for (const run of outcome.createdRuns) {
          await this.db.runs.add(run);
        }

        // Updates enforce revision checks
        for (const concept of outcome.updatedConcepts) {
          const prevRev = snapshot.concepts.find((c) => c.id === concept.id)?.revision;
          const modified = await this.db.concepts
            .where('id')
            .equals(concept.id)
            .and((row) => row.revision === prevRev)
            .modify(concept);
          if (modified !== 1) {
            throw new Error(`Revision-checked update failed for concept ${concept.id}`);
          }
        }

        for (const expr of outcome.updatedExpressions) {
          const prevRev = snapshot.expressions.find((e) => e.id === expr.id)?.revision;
          const modified = await this.db.expressions
            .where('id')
            .equals(expr.id)
            .and((row) => row.revision === prevRev)
            .modify(expr);
          if (modified !== 1) {
            throw new Error(`Revision-checked update failed for expression ${expr.id}`);
          }
        }

        for (const prov of outcome.updatedProvenance) {
          const modified = await this.db.provenance
            .where('id')
            .equals(prov.id)
            .modify(prov);
          if (modified !== 1) {
            throw new Error(`Provenance update failed for ${prov.id}`);
          }
        }

        // Explicit retained source deletion cleanup
        for (const runId of outcome.deletedRunIdList) {
          await this.db.runs.delete(runId);
        }
        for (const docId of outcome.deletedDocumentIdList) {
          await this.db.documents.delete(docId);
        }

        // Record batch idempotency marker (digest-only, never raw payload/document text)
        await this.db.batches.add({
          batchId: frozenPayload.batchId,
          digest: validApproval.digest,
          appliedRevision: outcome.nextRevision,
        });

        // Record audit entries
        for (const entry of outcome.newAuditEntries) {
          await this.db.audit.add(entry);
        }

        // Update meta revision
        const nextMeta: MetaRecord = {
          key: 'library',
          schemaVersion: 1,
          libraryRevision: outcome.nextRevision,
        };
        if (hasMeta) {
          const modified = await this.db.meta
            .where('key')
            .equals('library')
            .and((row) => row.libraryRevision === snapshot.libraryRevision)
            .modify(nextMeta);
          if (modified !== 1) {
            throw new Error('Failed to advance meta libraryRevision atomically.');
          }
        } else {
          await this.db.meta.add(nextMeta);
        }

        if (this.options.afterWritesBeforeCommit) {
          this.options.afterWritesBeforeCommit();
        }

        return { status: 'applied' as const, revision: outcome.nextRevision };
      });

      if (txResult.status === 'applied') {
        this.notifyRevisionCommitted(txResult.revision);
      }

      return txResult;
    } catch (error) {
      return classifyStorageError(error);
    }
  }

  async restoreEmpty(backup: BackupEnvelope, approval: RestoreApproval): Promise<ApplyResult> {
    if (typeof indexedDB === 'undefined') {
      return {
        status: 'unavailable',
        reason: 'IndexedDB is unavailable in this runtime environment.',
      };
    }

    let validated: BackupEnvelope;
    let validApproval: RestoreApproval;
    try {
      validated = await validateBackup(backup);
      validApproval = parseRestoreApproval(approval);
    } catch (error) {
      return {
        status: 'invalid',
        reason: error instanceof Error ? error.message : 'Invalid backup or restore approval.',
      };
    }

    if (validApproval.digest !== validated.digest) {
      return {
        status: 'invalid',
        reason: 'Restore approval digest does not match validated backup digest.',
      };
    }

    const snap = validated.snapshot;

    try {
      const txResult = await this.db.transaction('rw', [...this.allTables], async () => {
        const [
          metadataRows,
          conceptsCount,
          expressionsCount,
          assertionsCount,
          provenanceCount,
          documentsCount,
          runsCount,
          batchesCount,
          auditCount,
        ] = await Promise.all([
          this.db.meta.toArray(),
          this.db.concepts.count(),
          this.db.expressions.count(),
          this.db.assertions.count(),
          this.db.provenance.count(),
          this.db.documents.count(),
          this.db.runs.count(),
          this.db.batches.count(),
          this.db.audit.count(),
        ]);

        const metadataIsCorrupted =
          metadataRows.length > 1 ||
          metadataRows.some(
            (record) =>
              record.key !== 'library' ||
              record.schemaVersion !== 1 ||
              !Number.isSafeInteger(record.libraryRevision) ||
              record.libraryRevision < 0,
          );
        if (metadataIsCorrupted) {
          return {
            status: 'invalid' as const,
            reason: 'Target library metadata is malformed or corrupted; restore refuses to overwrite it.',
          };
        }

        const totalExisting =
          conceptsCount +
          expressionsCount +
          assertionsCount +
          provenanceCount +
          documentsCount +
          runsCount +
          batchesCount +
          auditCount;

        if (totalExisting > 0 || metadataRows.length > 0) {
          return {
            status: 'conflict' as const,
            reason:
              'Target library is not empty (records or metadata already exist). Restore refuses to overwrite an existing library.',
          };
        }

        for (const concept of snap.concepts) {
          await this.db.concepts.add(concept);
        }
        for (const expr of snap.expressions) {
          await this.db.expressions.add(expr);
        }
        for (const assertion of snap.assertions) {
          await this.db.assertions.add(assertion);
        }
        for (const prov of snap.provenance) {
          await this.db.provenance.add(prov);
        }
        for (const doc of snap.documents) {
          await this.db.documents.add(doc);
        }
        for (const run of snap.runs) {
          await this.db.runs.add(run);
        }
        for (const batch of snap.batches) {
          await this.db.batches.add(batch);
        }
        for (const entry of snap.audit) {
          await this.db.audit.add(entry);
        }

        const metaRecord: MetaRecord = {
          key: 'library',
          schemaVersion: 1,
          libraryRevision: snap.libraryRevision,
        };
        await this.db.meta.add(metaRecord);

        if (this.options.afterWritesBeforeCommit) {
          this.options.afterWritesBeforeCommit();
        }

        return { status: 'applied' as const, revision: snap.libraryRevision };
      });

      if (txResult.status === 'applied') {
        this.notifyRevisionCommitted(txResult.revision);
      }

      return txResult;
    } catch (error) {
      return classifyStorageError(error);
    }
  }
}

let singletonRepo: DexieLibraryRepository | null = null;

export function getBrowserLibraryRepository(): DexieLibraryRepository {
  if (!singletonRepo) {
    singletonRepo = new DexieLibraryRepository(DEFAULT_LIBRARY_DB_NAME);
  }
  return singletonRepo;
}

export async function inspectBrowserStorageStatus(
  requestPersist = false,
): Promise<BrowserStorageStatus> {
  const indexedDbAvailable = typeof indexedDB !== 'undefined';
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return {
      indexedDbAvailable,
      persistenceSupported: false,
      persisted: null,
      quotaBytes: null,
      usageBytes: null,
    };
  }

  const persistenceSupported = typeof navigator.storage.persist === 'function';
  let persisted: boolean | null = null;
  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;

  try {
    if (requestPersist && persistenceSupported) {
      persisted = await navigator.storage.persist();
    } else if (typeof navigator.storage.persisted === 'function') {
      persisted = await navigator.storage.persisted();
    }
  } catch {
    persisted = false;
  }

  try {
    if (typeof navigator.storage.estimate === 'function') {
      const estimate = await navigator.storage.estimate();
      quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null;
      usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null;
    }
  } catch {
    quotaBytes = null;
    usageBytes = null;
  }

  return {
    indexedDbAvailable,
    persistenceSupported,
    persisted,
    quotaBytes,
    usageBytes,
  };
}
