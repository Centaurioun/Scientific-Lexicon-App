import { proposeChange } from './library';
import {
  deepFreeze,
  type ChangeOp,
  type ChangePayload,
  type ProposedChange,
} from '@/domain/changes';
import { DELIMITED_INTAKE_LIMITS } from '@/domain/delimited-intake';
import type { LibrarySnapshot } from '@/domain/schema';
import { computeStagingSessionFingerprint } from '@/domain/staging-mapping';
import type { ReviewedStagedRow, StagedReviewEvaluation } from '@/domain/staging-review';

export class ImportPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportPlanningError';
  }
}

export interface ImportPlanSummary {
  readonly baseLibraryRevision: number;
  readonly sourceRawByteSha256: string;
  readonly totalStagedRows: number;
  readonly totalOperations: number;
  readonly createConceptCount: number;
  readonly addExpressionCount: number;
  readonly addExpressionToExistingCount: number;
  readonly addExpressionToStagedGroupCount: number;
  readonly skippedRowCount: number;
  readonly unresolvedRowCount: number;
  readonly unmappedColumnCount: number;
  readonly unmappedNonEmptyCellCount: number;
  readonly transformedRowCount: number;
  readonly formulaWarningRowCount: number;
  readonly provenanceLimitationDisclosure: string;
}

export interface PlannedAdditiveImport {
  readonly proposal: ProposedChange;
  readonly summary: ImportPlanSummary;
  readonly sessionFingerprint: string;
}

export interface BuildAdditiveImportPlanOptions {
  timestamp?: string;
  idGenerator?: () => string;
}

export const PROVENANCE_LIMITATION_DISCLOSURE =
  'Imported expressions are committed with v1 manual provenance (kind: "manual", source: null) after explicit user review and creates zero verification assertions. External spreadsheet row coordinates and unmapped columns are available only in this session preview and loss report and are not preserved as canonical source evidence.';

/**
 * Pure additive import plan generator (WP03 E5).
 *
 * Rules enforced:
 * 1. Generates one atomic `ChangePayload` with `createConcept` and `addExpression` operations only
 *    (no `editExpression`, `assertExpression`, `retainDocument`, `deleteRetainedDocument`, merge, or delete).
 * 2. Maximum `250` operations (`DELIMITED_INTAKE_LIMITS.maxAtomicChangeOperations`) per reviewed batch;
 *    rejects over-limit selections before any partial write.
 * 3. Rejects if `review.canBuildProposal === false`, if `review.table.baseLibraryRevision !== snapshot.libraryRevision`,
 *    or if any generated UUID collides with existing or batch-internal IDs.
 * 4. Orders staged group operations so `createConcept` for a staged `groupKey` always executes at `revision: 0`
 *    before its linked `addExpression` operations, incrementing `expectedConceptRevision` (`0, 1, 2, ...`)
 *    deterministically across multiple forms for the same new or existing concept.
 * 5. Calls existing `proposeChange(snapshot, payload)` without performing any direct repository writes.
 */
export async function buildAdditiveImportPlan(
  review: StagedReviewEvaluation,
  snapshot: LibrarySnapshot,
  options: BuildAdditiveImportPlanOptions = {},
): Promise<PlannedAdditiveImport> {
  if (
    review.baseLibraryRevision !== snapshot.libraryRevision ||
    review.table.baseLibraryRevision !== snapshot.libraryRevision
  ) {
    throw new ImportPlanningError(
      `Stale staging review revision: staging was evaluated against library revision ${review.table.baseLibraryRevision}, but current library snapshot is at revision ${snapshot.libraryRevision}. Reload and review against the latest revision.`,
    );
  }

  if (!review.canBuildProposal) {
    throw new ImportPlanningError(
      `Cannot generate additive import proposal while blocking review issues remain: ${review.blockingReasons.join(' ')}`,
    );
  }

  const actionableRows = review.rows.filter((r) => r.isActionableOperation);
  if (actionableRows.length === 0) {
    throw new ImportPlanningError(
      'No actionable rows are selected for import. Select at least one row to create or link.',
    );
  }

  if (actionableRows.length > DELIMITED_INTAKE_LIMITS.maxAtomicChangeOperations) {
    throw new ImportPlanningError(
      `Selected import batch requires ${actionableRows.length} operations, which exceeds the maximum atomic batch limit of ${DELIMITED_INTAKE_LIMITS.maxAtomicChangeOperations} operations. Skip or reduce selected rows before building a proposal.`,
    );
  }

  const now = options.timestamp ?? new Date().toISOString();
  const nextId = options.idGenerator ?? (() => crypto.randomUUID());

  // Collect all existing IDs in snapshot to fail closed on any UUID collision
  const usedIds = new Set<string>();
  for (const c of snapshot.concepts) usedIds.add(c.id);
  for (const e of snapshot.expressions) usedIds.add(e.id);
  for (const a of snapshot.assertions) usedIds.add(a.id);
  for (const p of snapshot.provenance) usedIds.add(p.id);
  for (const d of snapshot.documents) usedIds.add(d.id);
  for (const r of snapshot.runs) usedIds.add(r.id);
  for (const b of snapshot.batches) usedIds.add(b.batchId);
  for (const au of snapshot.audit) {
    usedIds.add(au.id);
    usedIds.add(au.opId);
  }

  const allocateUniqueId = (label: string): string => {
    const candidate = nextId();
    if (usedIds.has(candidate)) {
      throw new ImportPlanningError(
        `Generated ${label} ID "${candidate}" already exists in snapshot or current batch (ID collision).`,
      );
    }
    usedIds.add(candidate);
    return candidate;
  };

  // Track concept revision progression across the batch:
  // - existing concepts start at their snapshot revision
  // - newly created concepts start at revision 0 after their createConcept op
  const conceptRevisionTracker = new Map<string, number>();
  for (const c of snapshot.concepts) {
    conceptRevisionTracker.set(c.id, c.revision);
  }

  // First pass: ensure that for any staged groupKey that has `link-staged-group` rows,
  // its `create-new-concept` root row is scheduled before its dependent `link-staged-group` rows
  // even if the user selected a non-first row in the group as the `create-new-concept` root.
  const orderedActionableRows: ReviewedStagedRow[] = [];
  const deferredGroupLinkRows = new Map<string, ReviewedStagedRow[]>();
  const createdGroupConceptIds = new Map<string, string>();

  for (const item of actionableRows) {
    if (item.decision.action === 'link-staged-group') {
      const gKey = item.decision.groupKey;
      // If root for gKey already scheduled, we can schedule right away; otherwise defer until root is scheduled
      const hasRootAlready = orderedActionableRows.some(
        (prev) => prev.decision.action === 'create-new-concept' && prev.row.groupKey === gKey,
      );
      if (hasRootAlready) {
        orderedActionableRows.push(item);
      } else {
        const list = deferredGroupLinkRows.get(gKey) ?? [];
        list.push(item);
        deferredGroupLinkRows.set(gKey, list);
      }
    } else {
      orderedActionableRows.push(item);
      if (item.decision.action === 'create-new-concept' && item.row.groupKey) {
        const waiting = deferredGroupLinkRows.get(item.row.groupKey);
        if (waiting && waiting.length > 0) {
          orderedActionableRows.push(...waiting);
          deferredGroupLinkRows.delete(item.row.groupKey);
        }
      }
    }
  }

  if (deferredGroupLinkRows.size > 0) {
    const orphanGroups = Array.from(deferredGroupLinkRows.keys()).join(', ');
    throw new ImportPlanningError(
      `Staged group(s) [${orphanGroups}] have linked expression rows without a corresponding create-new-concept root row.`,
    );
  }

  const batchId = allocateUniqueId('batch');
  const ops: ChangeOp[] = [];
  let createConceptCount = 0;
  let addExpressionToExistingCount = 0;
  let addExpressionToStagedGroupCount = 0;

  for (const item of orderedActionableRows) {
    const { row, decision } = item;
    if (!row.stagedLanguage || !row.stagedRole) {
      throw new ImportPlanningError(`Row ${row.rowNumber} is missing valid language or role.`);
    }

    if (decision.action === 'create-new-concept') {
      const opId = allocateUniqueId('op');
      const conceptId = allocateUniqueId('concept');
      const expressionId = allocateUniqueId('expression');
      const provenanceId = allocateUniqueId('provenance');

      if (row.groupKey) {
        if (createdGroupConceptIds.has(row.groupKey)) {
          throw new ImportPlanningError(
            `Group "${row.groupKey}" has more than one create-new-concept root row.`,
          );
        }
        createdGroupConceptIds.set(row.groupKey, conceptId);
      }
      conceptRevisionTracker.set(conceptId, 0);
      createConceptCount += 1;

      ops.push({
        kind: 'createConcept',
        opId,
        concept: {
          id: conceptId,
          revision: 0,
          createdAt: now,
          updatedAt: now,
        },
        firstExpression: {
          id: expressionId,
          conceptId,
          revision: 0,
          text: row.stagedTermText,
          language: row.stagedLanguage,
          role: row.stagedRole,
          createdAt: now,
          updatedAt: now,
        },
        provenance: {
          id: provenanceId,
          expressionId,
          kind: 'manual',
          createdAt: now,
          source: null,
        },
      });
    } else if (decision.action === 'link-staged-group') {
      const targetConceptId = createdGroupConceptIds.get(decision.groupKey);
      if (!targetConceptId) {
        throw new ImportPlanningError(
          `Row ${row.rowNumber} links to staged group "${decision.groupKey}", which has no created concept ID.`,
        );
      }
      const expectedConceptRevision = conceptRevisionTracker.get(targetConceptId);
      if (expectedConceptRevision === undefined) {
        throw new ImportPlanningError(
          `Missing expected revision state for staged concept "${targetConceptId}".`,
        );
      }

      const opId = allocateUniqueId('op');
      const expressionId = allocateUniqueId('expression');
      const provenanceId = allocateUniqueId('provenance');
      conceptRevisionTracker.set(targetConceptId, expectedConceptRevision + 1);
      addExpressionToStagedGroupCount += 1;

      ops.push({
        kind: 'addExpression',
        opId,
        expectedConceptRevision,
        expression: {
          id: expressionId,
          conceptId: targetConceptId,
          revision: 0,
          text: row.stagedTermText,
          language: row.stagedLanguage,
          role: row.stagedRole,
          createdAt: now,
          updatedAt: now,
        },
        provenance: {
          id: provenanceId,
          expressionId,
          kind: 'manual',
          createdAt: now,
          source: null,
        },
      });
    } else if (decision.action === 'link-existing-concept') {
      const targetConceptId = decision.targetConceptId;
      const expectedConceptRevision = conceptRevisionTracker.get(targetConceptId);
      if (expectedConceptRevision === undefined) {
        throw new ImportPlanningError(
          `Target existing concept "${targetConceptId}" does not exist in library snapshot at revision ${snapshot.libraryRevision}.`,
        );
      }

      const opId = allocateUniqueId('op');
      const expressionId = allocateUniqueId('expression');
      const provenanceId = allocateUniqueId('provenance');
      conceptRevisionTracker.set(targetConceptId, expectedConceptRevision + 1);
      addExpressionToExistingCount += 1;

      ops.push({
        kind: 'addExpression',
        opId,
        expectedConceptRevision,
        expression: {
          id: expressionId,
          conceptId: targetConceptId,
          revision: 0,
          text: row.stagedTermText,
          language: row.stagedLanguage,
          role: row.stagedRole,
          createdAt: now,
          updatedAt: now,
        },
        provenance: {
          id: provenanceId,
          expressionId,
          kind: 'manual',
          createdAt: now,
          source: null,
        },
      });
    }
  }

  const payload: ChangePayload = {
    schemaVersion: 1,
    batchId,
    baseLibraryRevision: snapshot.libraryRevision,
    ops,
  };

  const proposal = await proposeChange(snapshot, payload);
  const unmappedNonEmptyCellCount = review.table.unmappedColumns.reduce(
    (sum, col) => sum + col.nonEmptyRowCount,
    0,
  );

  return deepFreeze({
    proposal,
    sessionFingerprint: computeStagingSessionFingerprint(review.table),
    summary: {
      baseLibraryRevision: snapshot.libraryRevision,
      sourceRawByteSha256: review.table.sourceRawByteSha256,
      totalStagedRows: review.counts.totalRows,
      totalOperations: ops.length,
      createConceptCount,
      addExpressionCount: addExpressionToExistingCount + addExpressionToStagedGroupCount,
      addExpressionToExistingCount,
      addExpressionToStagedGroupCount,
      skippedRowCount: review.counts.skippedRowCount,
      unresolvedRowCount: review.counts.unresolvedRowCount,
      unmappedColumnCount: review.table.unmappedColumns.length,
      unmappedNonEmptyCellCount,
      transformedRowCount: review.table.transformedRowCount,
      formulaWarningRowCount: review.table.formulaWarningRowCount,
      provenanceLimitationDisclosure: PROVENANCE_LIMITATION_DISCLOSURE,
    },
  });
}
