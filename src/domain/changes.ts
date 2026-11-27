import { z } from 'zod';
import {
  compareCodeUnits,
  ConceptSchema,
  ExpressionRoleSchema,
  ExpressionSchema,
  formatLanguageUse,
  isExpressionProtected,
  languageUseEquals,
  LanguageUseSchema,
  NonBlankTextSchema,
  OpaqueIdSchema,
  parseLibrarySnapshot,
  ProvenanceSchema,
  RetainedDocumentSchema,
  RetainedRunSchema,
  RevisionSchema,
  Sha256HexSchema,
  UtcIsoTimestampSchema,
  VerificationAssertionSchema,
  type AuditEntry,
  type Concept,
  type Expression,
  type LibrarySnapshot,
  type Provenance,
  type RetainedDocument,
  type RetainedRun,
  type VerificationAssertion,
} from './schema';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serializeCanonical(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  const kind = typeof value;
  if (kind === 'boolean') return value ? 'true' : 'false';
  if (kind === 'string') return JSON.stringify(value);
  if (kind === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Non-finite numbers (NaN/Infinity) are not valid canonical JSON');
    }
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (kind !== 'object') {
    throw new Error(`Value of type "${kind}" is not valid canonical JSON`);
  }

  const obj = value as object;
  if (seen.has(obj)) {
    throw new Error('Circular structure is not valid canonical JSON');
  }

  if (Array.isArray(value)) {
    seen.add(obj);
    const items = value.map((item) => serializeCanonical(item, seen));
    seen.delete(obj);
    return `[${items.join(',')}]`;
  }

  if (!isPlainObject(value)) {
    throw new Error('Non-plain object instances (such as Date/Map/Set) are not valid canonical JSON');
  }

  seen.add(obj);
  const keys = Object.keys(value).sort(compareCodeUnits);
  const pairs: string[] = [];
  for (const key of keys) {
    const propVal = value[key];
    if (propVal === undefined) {
      throw new Error(`Property "${key}" has undefined value, which is not valid canonical JSON`);
    }
    pairs.push(`${JSON.stringify(key)}:${serializeCanonical(propVal, seen)}`);
  }
  seen.delete(obj);
  return `{${pairs.join(',')}}`;
}

export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, new Set());
}

export async function digest(value: unknown): Promise<string> {
  const json = canonicalJson(value);
  const bytes = new TextEncoder().encode(json);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hashArray = new Uint8Array(hashBuffer);
  let hex = '';
  for (let i = 0; i < hashArray.length; i += 1) {
    hex += hashArray[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    if (!Object.isFrozen(value)) {
      Object.freeze(value);
    }
    const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    for (const item of entries) {
      deepFreeze(item);
    }
  }
  return value;
}

export function cloneAndFreezeJson<T>(value: T): T {
  const cloned = JSON.parse(canonicalJson(value)) as T;
  return deepFreeze(cloned);
}

export const CreateConceptOpSchema = z
  .object({
    kind: z.literal('createConcept'),
    opId: OpaqueIdSchema,
    concept: ConceptSchema,
    firstExpression: ExpressionSchema,
    provenance: ProvenanceSchema,
  })
  .strict()
  .superRefine((op, ctx) => {
    if (op.concept.revision !== 0) {
      ctx.addIssue({ code: 'custom', message: 'New concept revision must start at 0' });
    }
    if (op.firstExpression.revision !== 0) {
      ctx.addIssue({ code: 'custom', message: 'New expression revision must start at 0' });
    }
    if (op.firstExpression.conceptId !== op.concept.id) {
      ctx.addIssue({ code: 'custom', message: 'firstExpression.conceptId must match concept.id' });
    }
    if (op.provenance.expressionId !== op.firstExpression.id) {
      ctx.addIssue({ code: 'custom', message: 'provenance.expressionId must match firstExpression.id' });
    }
  });

export const AddExpressionOpSchema = z
  .object({
    kind: z.literal('addExpression'),
    opId: OpaqueIdSchema,
    expression: ExpressionSchema,
    provenance: ProvenanceSchema,
    expectedConceptRevision: RevisionSchema,
  })
  .strict()
  .superRefine((op, ctx) => {
    if (op.expression.revision !== 0) {
      ctx.addIssue({ code: 'custom', message: 'New expression revision must start at 0' });
    }
    if (op.provenance.expressionId !== op.expression.id) {
      ctx.addIssue({ code: 'custom', message: 'provenance.expressionId must match expression.id' });
    }
  });

export const EditExpressionOpSchema = z
  .object({
    kind: z.literal('editExpression'),
    opId: OpaqueIdSchema,
    id: OpaqueIdSchema,
    expectedRevision: RevisionSchema,
    text: NonBlankTextSchema,
    language: LanguageUseSchema,
    role: ExpressionRoleSchema,
  })
  .strict();

export const AssertExpressionOpSchema = z
  .object({
    kind: z.literal('assertExpression'),
    opId: OpaqueIdSchema,
    id: OpaqueIdSchema,
    expectedRevision: RevisionSchema,
    assertion: VerificationAssertionSchema,
  })
  .strict()
  .superRefine((op, ctx) => {
    if (op.assertion.expressionId !== op.id) {
      ctx.addIssue({ code: 'custom', message: 'assertion.expressionId must match op.id' });
    }
  });

export const RetainDocumentOpSchema = z
  .object({
    kind: z.literal('retainDocument'),
    opId: OpaqueIdSchema,
    document: RetainedDocumentSchema,
    run: RetainedRunSchema,
  })
  .strict()
  .superRefine((op, ctx) => {
    if (op.run.documentId !== op.document.id) {
      ctx.addIssue({ code: 'custom', message: 'run.documentId must match document.id' });
    }
  });

export const DeleteRetainedDocumentOpSchema = z
  .object({
    kind: z.literal('deleteRetainedDocument'),
    opId: OpaqueIdSchema,
    id: OpaqueIdSchema,
  })
  .strict();

export const ChangeOpSchema = z.discriminatedUnion('kind', [
  CreateConceptOpSchema,
  AddExpressionOpSchema,
  EditExpressionOpSchema,
  AssertExpressionOpSchema,
  RetainDocumentOpSchema,
  DeleteRetainedDocumentOpSchema,
]);
export type ChangeOp = z.infer<typeof ChangeOpSchema>;

export const ChangePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: OpaqueIdSchema,
    baseLibraryRevision: RevisionSchema,
    ops: z.array(ChangeOpSchema).min(1, 'ChangePayload must include at least one operation'),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const seen = new Set<string>();
    for (const op of payload.ops) {
      if (seen.has(op.opId)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate opId in payload: ${op.opId}` });
      }
      seen.add(op.opId);
    }
  });
export type ChangePayload = z.infer<typeof ChangePayloadSchema>;

export const ApprovalSchema = z
  .object({
    batchId: OpaqueIdSchema,
    digest: Sha256HexSchema,
    actor: z.literal('local-user'),
    approvedAt: UtcIsoTimestampSchema,
  })
  .strict();
export type Approval = z.infer<typeof ApprovalSchema>;

export interface ProposedChange {
  readonly payload: ChangePayload;
  readonly digest: string;
  readonly preview: readonly string[];
}

export type ApplyResult =
  | { status: 'applied'; revision: number }
  | { status: 'replay'; revision: number }
  | {
      status: 'conflict' | 'stale' | 'invalid' | 'protected' | 'aborted' | 'unavailable';
      reason: string;
    };

export function parseChangePayload(input: unknown): ChangePayload {
  // Validate strict JSON-safety before Zod parsing
  canonicalJson(input);
  return ChangePayloadSchema.parse(input);
}

export function parseApproval(input: unknown): Approval {
  canonicalJson(input);
  return ApprovalSchema.parse(input);
}

export function buildChangePreview(snapshot: LibrarySnapshot, payload: ChangePayload): string[] {
  const expressionsById = new Map(snapshot.expressions.map((e) => [e.id, e]));
  const documentsById = new Map(snapshot.documents.map((d) => [d.id, d]));
  const lines: string[] = [];

  for (const op of payload.ops) {
    switch (op.kind) {
      case 'createConcept':
        lines.push(
          `Create concept ${op.concept.id} with initial expression "${op.firstExpression.text}" (${formatLanguageUse(op.firstExpression.language)}, role: ${op.firstExpression.role})`,
        );
        break;
      case 'addExpression':
        lines.push(
          `Add expression "${op.expression.text}" (${formatLanguageUse(op.expression.language)}, role: ${op.expression.role}) to concept ${op.expression.conceptId}`,
        );
        break;
      case 'editExpression': {
        const current = expressionsById.get(op.id);
        const before = current ? `"${current.text}" (${formatLanguageUse(current.language)}, ${current.role})` : op.id;
        lines.push(
          `Edit expression ${before} -> "${op.text}" (${formatLanguageUse(op.language)}, role: ${op.role})`,
        );
        break;
      }
      case 'assertExpression':
        lines.push(
          `Assert user-confirmed text "${op.assertion.value}" on expression ${op.id}`,
        );
        break;
      case 'retainDocument':
        lines.push(
          `Retain local source "${op.document.title}" (${op.document.text.length} UTF-16 chars, ${op.run.occurrences.length} recorded occurrences) with explicit consent`,
        );
        break;
      case 'deleteRetainedDocument': {
        const doc = documentsById.get(op.id);
        lines.push(
          `Delete retained source ${doc ? `"${doc.title}"` : op.id}, remove its recorded runs, and clear linked provenance source pointers`,
        );
        break;
      }
    }
  }

  return lines;
}

export type TransitionOutcome =
  | { kind: 'replay'; revision: number }
  | { kind: 'error'; result: Exclude<ApplyResult, { status: 'applied' | 'replay' }> }
  | {
      kind: 'apply';
      nextSnapshot: LibrarySnapshot;
      nextRevision: number;
      newAuditEntries: AuditEntry[];
      deletedDocumentIdList: string[];
      deletedRunIdList: string[];
      updatedConcepts: Concept[];
      createdConcepts: Concept[];
      updatedExpressions: Expression[];
      createdExpressions: Expression[];
      createdAssertions: VerificationAssertion[];
      createdProvenance: Provenance[];
      updatedProvenance: Provenance[];
      createdDocuments: RetainedDocument[];
      createdRuns: RetainedRun[];
    };

export function evaluateChangeOnSnapshot(
  currentSnapshot: LibrarySnapshot,
  payload: ChangePayload,
  approval: Approval,
): TransitionOutcome {
  // 1. Idempotency / conflict check on batchId
  const existingBatch = currentSnapshot.batches.find((b) => b.batchId === payload.batchId);
  if (existingBatch) {
    if (existingBatch.digest === approval.digest) {
      return { kind: 'replay', revision: existingBatch.appliedRevision };
    }
    return {
      kind: 'error',
      result: {
        status: 'conflict',
        reason: `Batch ${payload.batchId} already applied with a different payload digest.`,
      },
    };
  }

  // 2. Base library revision check
  if (payload.baseLibraryRevision !== currentSnapshot.libraryRevision) {
    return {
      kind: 'error',
      result: {
        status: 'stale',
        reason: `Stale baseLibraryRevision: expected ${currentSnapshot.libraryRevision}, got ${payload.baseLibraryRevision}.`,
      },
    };
  }

  // 3. Cross-batch opId uniqueness check
  const existingOpIds = new Set(currentSnapshot.audit.map((a) => a.opId));
  for (const op of payload.ops) {
    if (existingOpIds.has(op.opId)) {
      return {
        kind: 'error',
        result: {
          status: 'conflict',
          reason: `Operation ID ${op.opId} was already applied in a previous batch.`,
        },
      };
    }
  }

  // Working copies of maps
  const concepts = new Map(currentSnapshot.concepts.map((c) => [c.id, { ...c }]));
  const expressions = new Map(currentSnapshot.expressions.map((e) => [e.id, { ...e }]));
  const assertions = new Map(currentSnapshot.assertions.map((a) => [a.id, { ...a }]));
  const provenance = new Map(
    currentSnapshot.provenance.map((p) => [p.id, { ...p, source: p.source ? { ...p.source } : null }]),
  );
  const documents = new Map(currentSnapshot.documents.map((d) => [d.id, { ...d }]));
  const runs = new Map(currentSnapshot.runs.map((r) => [r.id, { ...r }]));

  const createdConcepts: Concept[] = [];
  const updatedConceptsMap = new Map<string, Concept>();
  const createdExpressions: Expression[] = [];
  const updatedExpressionsMap = new Map<string, Expression>();
  const createdAssertions: VerificationAssertion[] = [];
  const createdProvenance: Provenance[] = [];
  const updatedProvenanceMap = new Map<string, Provenance>();
  const createdDocuments: RetainedDocument[] = [];
  const createdRuns: RetainedRun[] = [];
  const deletedDocumentIdList: string[] = [];
  const deletedRunIdList: string[] = [];
  const newAuditEntries: AuditEntry[] = [];

  const nextRevision = currentSnapshot.libraryRevision + 1;

  for (const op of payload.ops) {
    switch (op.kind) {
      case 'createConcept': {
        if (concepts.has(op.concept.id)) {
          return {
            kind: 'error',
            result: { status: 'conflict', reason: `Concept ID ${op.concept.id} already exists.` },
          };
        }
        if (expressions.has(op.firstExpression.id)) {
          return {
            kind: 'error',
            result: { status: 'conflict', reason: `Expression ID ${op.firstExpression.id} already exists.` },
          };
        }
        if (provenance.has(op.provenance.id)) {
          return {
            kind: 'error',
            result: { status: 'conflict', reason: `Provenance ID ${op.provenance.id} already exists.` },
          };
        }
        concepts.set(op.concept.id, op.concept);
        expressions.set(op.firstExpression.id, op.firstExpression);
        provenance.set(op.provenance.id, op.provenance);
        createdConcepts.push(op.concept);
        createdExpressions.push(op.firstExpression);
        createdProvenance.push(op.provenance);
        newAuditEntries.push({
          id: `audit:${payload.batchId}:${op.opId}`,
          batchId: payload.batchId,
          opId: op.opId,
          kind: op.kind,
          recordIds: [op.concept.id, op.firstExpression.id, op.provenance.id],
          actor: 'local-user',
          approvedAt: approval.approvedAt,
          appliedRevision: nextRevision,
        });
        break;
      }

      case 'addExpression': {
        const concept = concepts.get(op.expression.conceptId);
        if (!concept) {
          return {
            kind: 'error',
            result: { status: 'invalid', reason: `Concept ${op.expression.conceptId} does not exist.` },
          };
        }
        if (concept.revision !== op.expectedConceptRevision) {
          return {
            kind: 'error',
            result: {
              status: 'stale',
              reason: `Stale concept ${concept.id} revision: expected ${op.expectedConceptRevision}, current ${concept.revision}.`,
            },
          };
        }
        if (expressions.has(op.expression.id)) {
          return {
            kind: 'error',
            result: { status: 'conflict', reason: `Expression ID ${op.expression.id} already exists.` },
          };
        }
        if (provenance.has(op.provenance.id)) {
          return {
            kind: 'error',
            result: { status: 'conflict', reason: `Provenance ID ${op.provenance.id} already exists.` },
          };
        }

        const updatedConcept: Concept = {
          ...concept,
          revision: concept.revision + 1,
          updatedAt: approval.approvedAt,
        };
        concepts.set(updatedConcept.id, updatedConcept);
        updatedConceptsMap.set(updatedConcept.id, updatedConcept);

        expressions.set(op.expression.id, op.expression);
        provenance.set(op.provenance.id, op.provenance);
        createdExpressions.push(op.expression);
        createdProvenance.push(op.provenance);

        newAuditEntries.push({
          id: `audit:${payload.batchId}:${op.opId}`,
          batchId: payload.batchId,
          opId: op.opId,
          kind: op.kind,
          recordIds: [updatedConcept.id, op.expression.id, op.provenance.id],
          actor: 'local-user',
          approvedAt: approval.approvedAt,
          appliedRevision: nextRevision,
        });
        break;
      }

      case 'editExpression': {
        const existing = expressions.get(op.id);
        if (!existing) {
          return {
            kind: 'error',
            result: { status: 'invalid', reason: `Expression ${op.id} does not exist.` },
          };
        }
        if (existing.revision !== op.expectedRevision) {
          return {
            kind: 'error',
            result: {
              status: 'stale',
              reason: `Stale expression ${op.id} revision: expected ${op.expectedRevision}, current ${existing.revision}.`,
            },
          };
        }
        const concept = concepts.get(existing.conceptId);
        if (!concept) {
          return {
            kind: 'error',
            result: { status: 'invalid', reason: `Parent concept ${existing.conceptId} is missing.` },
          };
        }

        const currentAssertions = Array.from(assertions.values());
        if (isExpressionProtected(existing, currentAssertions)) {
          if (op.text !== existing.text || !languageUseEquals(op.language, existing.language)) {
            return {
              kind: 'error',
              result: {
                status: 'protected',
                reason: `Expression ${op.id} has an active user-confirmed assertion protecting its text and language.`,
              },
            };
          }
        }

        const updatedExpr: Expression = {
          ...existing,
          revision: existing.revision + 1,
          text: op.text,
          language: op.language,
          role: op.role,
          updatedAt: approval.approvedAt,
        };
        const updatedConcept: Concept = {
          ...concept,
          revision: concept.revision + 1,
          updatedAt: approval.approvedAt,
        };
        expressions.set(updatedExpr.id, updatedExpr);
        updatedExpressionsMap.set(updatedExpr.id, updatedExpr);
        concepts.set(updatedConcept.id, updatedConcept);
        updatedConceptsMap.set(updatedConcept.id, updatedConcept);

        newAuditEntries.push({
          id: `audit:${payload.batchId}:${op.opId}`,
          batchId: payload.batchId,
          opId: op.opId,
          kind: op.kind,
          recordIds: [updatedExpr.id, updatedConcept.id],
          actor: 'local-user',
          approvedAt: approval.approvedAt,
          appliedRevision: nextRevision,
        });
        break;
      }

      case 'assertExpression': {
        const existing = expressions.get(op.id);
        if (!existing) {
          return {
            kind: 'error',
            result: { status: 'invalid', reason: `Expression ${op.id} does not exist.` },
          };
        }
        if (existing.revision !== op.expectedRevision) {
          return {
            kind: 'error',
            result: {
              status: 'stale',
              reason: `Stale expression ${op.id} revision: expected ${op.expectedRevision}, current ${existing.revision}.`,
            },
          };
        }
        if (assertions.has(op.assertion.id)) {
          return {
            kind: 'error',
            result: { status: 'conflict', reason: `Assertion ID ${op.assertion.id} already exists.` },
          };
        }
        if (op.assertion.value !== existing.text) {
          return {
            kind: 'error',
            result: {
              status: 'invalid',
              reason: `Assertion value does not match current expression text for ${op.id}.`,
            },
          };
        }
        if (
          op.assertion.recordRevision !== existing.revision &&
          op.assertion.recordRevision !== existing.revision + 1
        ) {
          return {
            kind: 'error',
            result: {
              status: 'invalid',
              reason: `Assertion recordRevision ${op.assertion.recordRevision} is inconsistent with expression revision ${existing.revision}.`,
            },
          };
        }
        const concept = concepts.get(existing.conceptId);
        if (!concept) {
          return {
            kind: 'error',
            result: { status: 'invalid', reason: `Parent concept ${existing.conceptId} is missing.` },
          };
        }

        const updatedExpr: Expression = {
          ...existing,
          revision: existing.revision + 1,
          updatedAt: approval.approvedAt,
        };
        const updatedConcept: Concept = {
          ...concept,
          revision: concept.revision + 1,
          updatedAt: approval.approvedAt,
        };
        expressions.set(updatedExpr.id, updatedExpr);
        updatedExpressionsMap.set(updatedExpr.id, updatedExpr);
        concepts.set(updatedConcept.id, updatedConcept);
        updatedConceptsMap.set(updatedConcept.id, updatedConcept);
        assertions.set(op.assertion.id, op.assertion);
        createdAssertions.push(op.assertion);

        newAuditEntries.push({
          id: `audit:${payload.batchId}:${op.opId}`,
          batchId: payload.batchId,
          opId: op.opId,
          kind: op.kind,
          recordIds: [op.assertion.id, updatedExpr.id, updatedConcept.id],
          actor: 'local-user',
          approvedAt: approval.approvedAt,
          appliedRevision: nextRevision,
        });
        break;
      }

      case 'retainDocument': {
        if (documents.has(op.document.id)) {
          return {
            kind: 'error',
            result: { status: 'conflict', reason: `Document ID ${op.document.id} already exists.` },
          };
        }
        if (runs.has(op.run.id)) {
          return {
            kind: 'error',
            result: { status: 'conflict', reason: `Run ID ${op.run.id} already exists.` },
          };
        }
        documents.set(op.document.id, op.document);
        runs.set(op.run.id, op.run);
        createdDocuments.push(op.document);
        createdRuns.push(op.run);

        newAuditEntries.push({
          id: `audit:${payload.batchId}:${op.opId}`,
          batchId: payload.batchId,
          opId: op.opId,
          kind: op.kind,
          recordIds: [op.document.id, op.run.id],
          actor: 'local-user',
          approvedAt: approval.approvedAt,
          appliedRevision: nextRevision,
        });
        break;
      }

      case 'deleteRetainedDocument': {
        if (!documents.has(op.id)) {
          return {
            kind: 'error',
            result: { status: 'invalid', reason: `Retained document ${op.id} does not exist.` },
          };
        }
        documents.delete(op.id);
        deletedDocumentIdList.push(op.id);

        const removedRuns: string[] = [];
        for (const [runId, run] of runs.entries()) {
          if (run.documentId === op.id) {
            runs.delete(runId);
            deletedRunIdList.push(runId);
            removedRuns.push(runId);
          }
        }

        const clearedProvIds: string[] = [];
        for (const [provId, prov] of provenance.entries()) {
          if (prov.source && prov.source.documentId === op.id) {
            const cleared: Provenance = { ...prov, source: null };
            provenance.set(provId, cleared);
            updatedProvenanceMap.set(provId, cleared);
            clearedProvIds.push(provId);
          }
        }

        newAuditEntries.push({
          id: `audit:${payload.batchId}:${op.opId}`,
          batchId: payload.batchId,
          opId: op.opId,
          kind: op.kind,
          recordIds: [op.id, ...removedRuns, ...clearedProvIds],
          actor: 'local-user',
          approvedAt: approval.approvedAt,
          appliedRevision: nextRevision,
        });
        break;
      }
    }
  }

  const candidateSnapshot: LibrarySnapshot = {
    schemaVersion: 1,
    libraryRevision: nextRevision,
    concepts: Array.from(concepts.values()),
    expressions: Array.from(expressions.values()),
    assertions: Array.from(assertions.values()),
    provenance: Array.from(provenance.values()),
    documents: Array.from(documents.values()),
    runs: Array.from(runs.values()),
    batches: [
      ...currentSnapshot.batches,
      {
        batchId: payload.batchId,
        digest: approval.digest,
        appliedRevision: nextRevision,
      },
    ],
    audit: [...currentSnapshot.audit, ...newAuditEntries],
  };

  let validated: LibrarySnapshot;
  try {
    validated = parseLibrarySnapshot(candidateSnapshot);
  } catch (error) {
    return {
      kind: 'error',
      result: {
        status: 'invalid',
        reason: error instanceof Error ? error.message : 'Resulting snapshot failed integrity validation.',
      },
    };
  }

  return {
    kind: 'apply',
    nextSnapshot: validated,
    nextRevision,
    newAuditEntries,
    deletedDocumentIdList,
    deletedRunIdList,
    // A record may be created and then updated later in the same approved
    // changeset. The adapter inserts creates, so persist the final evaluated
    // value in that insert rather than a stale revision-0 value.
    createdConcepts: createdConcepts.map((created) => concepts.get(created.id) ?? created),
    updatedConcepts: Array.from(updatedConceptsMap.values()).filter(
      (c) => !createdConcepts.some((created) => created.id === c.id),
    ),
    createdExpressions: createdExpressions.map((created) => expressions.get(created.id) ?? created),
    updatedExpressions: Array.from(updatedExpressionsMap.values()).filter(
      (e) => !createdExpressions.some((created) => created.id === e.id),
    ),
    createdAssertions,
    // Retained-source deletion can clear provenance created earlier in this batch.
    createdProvenance: createdProvenance.map((created) => provenance.get(created.id) ?? created),
    updatedProvenance: Array.from(updatedProvenanceMap.values()).filter(
      (p) => !createdProvenance.some((created) => created.id === p.id),
    ),
    // A source and run may be retained and deleted again within one batch.
    createdDocuments: createdDocuments.filter((created) => documents.has(created.id)),
    createdRuns: createdRuns.filter((created) => runs.has(created.id)),
  };
}
