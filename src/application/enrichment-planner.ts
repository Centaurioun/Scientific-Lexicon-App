import type { SourceEvidenceCandidate } from '@/adapters/sources/synthetic-source-adapter';
import { proposeChange } from './library';
import {
  deepFreeze,
  type ChangeOp,
  type ChangePayload,
  type ProposedChange,
} from '@/domain/changes';
import type { ReviewComparisonSummary } from '@/domain/review-comparison';
import { REVIEW_EXCHANGE_LIMITS, type ReviewTaskPacketV1 } from '@/domain/review-exchange';
import {
  computeEnrichmentReviewIntentDigest,
  type EnrichmentSelectedProposalItem,
} from '@/domain/review-guard';
import {
  formatLanguageUse,
  isExpressionProtected,
  parseLibrarySnapshot,
  type ExpressionRole,
  type LanguageUse,
  type LibrarySnapshot,
} from '@/domain/schema';

export class EnrichmentPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnrichmentPlanningError';
  }
}

export interface EnrichmentProposalSelectionItem {
  readonly operation: 'addExpression' | 'createConcept';
  readonly targetConceptId: string | null;
  readonly expectedConceptRevision: number | null;
  readonly text: string;
  readonly language: LanguageUse;
  readonly role: ExpressionRole;
}

export interface EnrichmentBeforeAfterPreview {
  readonly operation: 'addExpression' | 'createConcept';
  readonly targetConceptId: string;
  readonly beforeExpressions: readonly {
    readonly id: string;
    readonly text: string;
    readonly language: string;
    readonly role: ExpressionRole;
    readonly protected: boolean;
  }[];
  readonly afterExpression: {
    readonly text: string;
    readonly language: string;
    readonly role: ExpressionRole;
  };
}

export interface PlannedEnrichmentChange {
  readonly proposal: ProposedChange;
  readonly reviewIntentDigest: string;
  readonly selectedItems: readonly EnrichmentSelectedProposalItem[];
  readonly beforeAfterPreviews: readonly EnrichmentBeforeAfterPreview[];
  readonly provenanceLimitationDisclosure: string;
}

export const ENRICHMENT_PROVENANCE_LIMITATION_DISCLOSURE =
  'Approved enrichment expressions commit with canonical v1 manual provenance (kind: "manual", source: null) and create zero verification assertions. Canonical LibrarySnapshot v1 cannot retain AI model names, reviewer slot tallies, or external source evidence; export the separate Non-Canonical Session Evidence Report if needed.';

function allocateUniqueId(
  existingIds: Set<string>,
  idGenerator: () => string,
  label: string,
): string {
  const id = idGenerator();
  if (!id || existingIds.has(id)) {
    throw new EnrichmentPlanningError(
      `ID collision: generated ${label} ID "${id}" already exists in snapshot or batch.`,
    );
  }
  existingIds.add(id);
  return id;
}

/**
 * Pure additive enrichment ChangeSet planner (WP04 F7).
 * Produces an immutable `ProposedChange` containing ONLY `addExpression` (preferred)
 * or explicit `createConcept` operations with `kind: 'manual', source: null`,
 * zero assertions, zero response-supplied canonical IDs, and max 250 operations.
 */
export async function buildEnrichmentProposalPlan(params: {
  readonly snapshot: LibrarySnapshot;
  readonly packet: ReviewTaskPacketV1;
  readonly selectedItems: readonly EnrichmentProposalSelectionItem[];
  readonly timestamp?: string;
  readonly idGenerator?: () => string;
}): Promise<PlannedEnrichmentChange> {
  const validSnapshot = parseLibrarySnapshot(params.snapshot);
  const { packet, selectedItems } = params;

  if (packet.baseLibraryRevision !== validSnapshot.libraryRevision) {
    throw new EnrichmentPlanningError(
      `Stale ReviewTaskPacket: packet revision ${packet.baseLibraryRevision} does not match current library revision ${validSnapshot.libraryRevision}.`,
    );
  }

  if (selectedItems.length === 0) {
    throw new EnrichmentPlanningError(
      'Select at least one reviewed additive suggestion before building an enrichment proposal.',
    );
  }
  if (selectedItems.length > REVIEW_EXCHANGE_LIMITS.maxEnrichmentOperations) {
    throw new EnrichmentPlanningError(
      `Enrichment proposal exceeds maximum ${REVIEW_EXCHANGE_LIMITS.maxEnrichmentOperations} atomic operations (selected ${selectedItems.length}).`,
    );
  }

  const now = params.timestamp ?? new Date().toISOString();
  const idGenerator = params.idGenerator ?? (() => globalThis.crypto.randomUUID());

  const existingConceptIds = new Set(validSnapshot.concepts.map((c) => c.id));
  const existingExprIds = new Set(validSnapshot.expressions.map((e) => e.id));
  const existingProvIds = new Set(validSnapshot.provenance.map((p) => p.id));
  const existingBatchIds = new Set(validSnapshot.batches.map((b) => b.batchId));
  const existingOpIds = new Set(validSnapshot.audit.map((a) => a.opId));

  const conceptMap = new Map(validSnapshot.concepts.map((c) => [c.id, c]));
  const runningConceptRevision = new Map(validSnapshot.concepts.map((c) => [c.id, c.revision]));
  const exprsByConcept = new Map<string, typeof validSnapshot.expressions>();
  for (const expr of validSnapshot.expressions) {
    const list = exprsByConcept.get(expr.conceptId) ?? [];
    list.push(expr);
    exprsByConcept.set(expr.conceptId, list);
  }

  const packetTargetIds = new Set(packet.selectedTargets.map((t) => t.conceptId));
  const batchId = allocateUniqueId(existingBatchIds, idGenerator, 'batch');

  const ops: ChangeOp[] = [];
  const normalizedSelected: EnrichmentSelectedProposalItem[] = [];
  const beforeAfterPreviews: EnrichmentBeforeAfterPreview[] = [];
  const batchSeenConceptSurface = new Set<string>();

  for (const item of selectedItems) {
    if (item.operation === 'addExpression') {
      if (!item.targetConceptId) {
        throw new EnrichmentPlanningError('addExpression requires an explicit targetConceptId.');
      }
      if (!packetTargetIds.has(item.targetConceptId)) {
        throw new EnrichmentPlanningError(
          `Target concept ${item.targetConceptId} is outside active ReviewTaskPacket scope.`,
        );
      }
      const concept = conceptMap.get(item.targetConceptId);
      if (!concept) {
        throw new EnrichmentPlanningError(
          `Target concept ${item.targetConceptId} no longer exists in snapshot.`,
        );
      }
      if (item.expectedConceptRevision !== concept.revision) {
        throw new EnrichmentPlanningError(
          `Stale concept ${concept.id} revision: expected ${item.expectedConceptRevision}, current is ${concept.revision}.`,
        );
      }

      const existingConceptExprs = exprsByConcept.get(concept.id) ?? [];
      for (const existing of existingConceptExprs) {
        if (existing.text === item.text) {
          if (isExpressionProtected(existing, validSnapshot.assertions)) {
            throw new EnrichmentPlanningError(
              `Protected duplicate blocked on concept ${concept.id}: expression "${existing.text}" already exists with an active user-confirmed assertion.`,
            );
          }
          throw new EnrichmentPlanningError(
            `Duplicate expression blocked on concept ${concept.id}: exact form "${item.text}" already exists.`,
          );
        }
      }

      const intraKey = `${concept.id}\u0000${item.text}`;
      if (batchSeenConceptSurface.has(intraKey)) {
        throw new EnrichmentPlanningError(
          `Duplicate selection in batch: concept ${concept.id} already includes "${item.text}".`,
        );
      }
      batchSeenConceptSurface.add(intraKey);

      const expectedRevForOp = runningConceptRevision.get(concept.id)!;
      runningConceptRevision.set(concept.id, expectedRevForOp + 1);

      const opId = allocateUniqueId(existingOpIds, idGenerator, 'op');
      const exprId = allocateUniqueId(existingExprIds, idGenerator, 'expression');
      const provId = allocateUniqueId(existingProvIds, idGenerator, 'provenance');

      ops.push({
        kind: 'addExpression',
        opId,
        expectedConceptRevision: expectedRevForOp,
        expression: {
          id: exprId,
          conceptId: concept.id,
          revision: 0,
          text: item.text,
          language: item.language,
          role: item.role,
          createdAt: now,
          updatedAt: now,
        },
        provenance: {
          id: provId,
          expressionId: exprId,
          kind: 'manual',
          createdAt: now,
          source: null,
        },
      });

      normalizedSelected.push({
        operation: 'addExpression',
        targetConceptId: concept.id,
        expectedConceptRevision: item.expectedConceptRevision,
        text: item.text,
        language: item.language,
        role: item.role,
      });

      beforeAfterPreviews.push({
        operation: 'addExpression',
        targetConceptId: concept.id,
        beforeExpressions: existingConceptExprs.map((e) => ({
          id: e.id,
          text: e.text,
          language: formatLanguageUse(e.language),
          role: e.role,
          protected: isExpressionProtected(e, validSnapshot.assertions),
        })),
        afterExpression: {
          text: item.text,
          language: formatLanguageUse(item.language),
          role: item.role,
        },
      });
    } else {
      // Explicit authorized manual createConcept path (new canonical ID generated locally)
      const opId = allocateUniqueId(existingOpIds, idGenerator, 'op');
      const conceptId = allocateUniqueId(existingConceptIds, idGenerator, 'concept');
      const exprId = allocateUniqueId(existingExprIds, idGenerator, 'expression');
      const provId = allocateUniqueId(existingProvIds, idGenerator, 'provenance');

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
          id: exprId,
          conceptId,
          revision: 0,
          text: item.text,
          language: item.language,
          role: item.role,
          createdAt: now,
          updatedAt: now,
        },
        provenance: {
          id: provId,
          expressionId: exprId,
          kind: 'manual',
          createdAt: now,
          source: null,
        },
      });

      normalizedSelected.push({
        operation: 'createConcept',
        targetConceptId: null,
        expectedConceptRevision: null,
        text: item.text,
        language: item.language,
        role: item.role,
      });

      beforeAfterPreviews.push({
        operation: 'createConcept',
        targetConceptId: conceptId,
        beforeExpressions: [],
        afterExpression: {
          text: item.text,
          language: formatLanguageUse(item.language),
          role: item.role,
        },
      });
    }
  }

  const payload: ChangePayload = {
    schemaVersion: 1,
    batchId,
    baseLibraryRevision: validSnapshot.libraryRevision,
    ops,
  };

  const proposal = await proposeChange(validSnapshot, payload);
  const reviewIntentDigest = await computeEnrichmentReviewIntentDigest({
    taskId: packet.taskId,
    taskDigest: packet.taskDigest,
    baseLibraryRevision: validSnapshot.libraryRevision,
    selectedItems: normalizedSelected,
  });

  return deepFreeze({
    proposal,
    reviewIntentDigest,
    selectedItems: normalizedSelected,
    beforeAfterPreviews,
    provenanceLimitationDisclosure: ENRICHMENT_PROVENANCE_LIMITATION_DISCLOSURE,
  });
}

/**
 * Builds an explicit non-canonical session evidence report for optional user download.
 * Never persisted into canonical LibrarySnapshot v1 or portable backup.
 */
export function buildSessionEvidenceReport(params: {
  readonly packet: ReviewTaskPacketV1;
  readonly comparison: ReviewComparisonSummary | null;
  readonly evidenceCandidates: readonly SourceEvidenceCandidate[];
  readonly generatedAt?: string;
}): string {
  const report = {
    reportFormat: 'NON_CANONICAL_SESSION_EVIDENCE_REPORT',
    version: 1,
    warning:
      'Non-canonical session evidence export only. NOT a portable TermForge backup and NOT durable canonical provenance. Approved terminology commits store only manual/source:null expressions.',
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    taskId: params.packet.taskId,
    taskDigest: params.packet.taskDigest,
    baseLibraryRevision: params.packet.baseLibraryRevision,
    sourceEvidenceCandidates: params.evidenceCandidates,
    comparisonSummary: params.comparison,
  };
  return JSON.stringify(report, null, 2);
}
