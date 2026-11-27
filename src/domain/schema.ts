import { z } from 'zod';

const UTC_ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export const OpaqueIdSchema = z
  .string()
  .min(1, 'ID must not be empty')
  .max(256, 'ID exceeds maximum length')
  .refine((value) => value.trim() === value && value.length > 0, 'ID must not have leading or trailing whitespace')
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), 'ID must not contain control characters');

export const RevisionSchema = z
  .number()
  .int('Revision must be an integer')
  .min(0, 'Revision must be nonnegative')
  .refine((value) => Number.isSafeInteger(value), 'Revision must be a safe integer');

export const UtcIsoTimestampSchema = z
  .string()
  .refine((value) => UTC_ISO_REGEX.test(value) && !Number.isNaN(Date.parse(value)), 'Timestamp must be valid UTC ISO 8601');

export const NonBlankTextSchema = z
  .string()
  .min(1, 'Text must not be empty')
  .refine((value) => value.trim().length > 0, 'Text must not be whitespace-only');

export const Sha256HexSchema = z
  .string()
  .refine((value) => SHA256_HEX_REGEX.test(value), 'Digest must be 64 lowercase hexadecimal characters');

export const LanguageTagSchema = z.enum(['en', 'en-US', 'en-GB', 'tr']);
export type LanguageTag = z.infer<typeof LanguageTagSchema>;

export const LanguageUseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('language'),
      tag: LanguageTagSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('shared'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('undetermined'),
    })
    .strict(),
]);
export type LanguageUse = z.infer<typeof LanguageUseSchema>;

export const EXPRESSION_ROLES = [
  'preferred',
  'alternative',
  'abbreviation',
  'acronym',
  'orthographic',
  'morphological',
  'historical',
  'nonpreferred',
  'unspecified',
] as const;

export const ExpressionRoleSchema = z.enum(EXPRESSION_ROLES);
export type ExpressionRole = z.infer<typeof ExpressionRoleSchema>;

export const ConceptSchema = z
  .object({
    id: OpaqueIdSchema,
    revision: RevisionSchema,
    createdAt: UtcIsoTimestampSchema,
    updatedAt: UtcIsoTimestampSchema,
  })
  .strict();
export type Concept = z.infer<typeof ConceptSchema>;

export const ExpressionSchema = z
  .object({
    id: OpaqueIdSchema,
    conceptId: OpaqueIdSchema,
    revision: RevisionSchema,
    text: NonBlankTextSchema,
    language: LanguageUseSchema,
    role: ExpressionRoleSchema,
    createdAt: UtcIsoTimestampSchema,
    updatedAt: UtcIsoTimestampSchema,
  })
  .strict();
export type Expression = z.infer<typeof ExpressionSchema>;

export const VerificationAssertionSchema = z
  .object({
    id: OpaqueIdSchema,
    expressionId: OpaqueIdSchema,
    field: z.literal('text'),
    value: NonBlankTextSchema,
    recordRevision: RevisionSchema,
    kind: z.literal('user-confirmed'),
    actor: z.literal('local-user'),
    assertedAt: UtcIsoTimestampSchema,
  })
  .strict();
export type VerificationAssertion = z.infer<typeof VerificationAssertionSchema>;

export const ProvenanceSourceSchema = z
  .object({
    documentId: OpaqueIdSchema,
    runId: OpaqueIdSchema,
    start: RevisionSchema,
    end: RevisionSchema,
  })
  .strict()
  .refine((source) => source.end > source.start, 'Provenance source span end must exceed start');
export type ProvenanceSource = z.infer<typeof ProvenanceSourceSchema>;

export const ProvenanceSchema = z
  .object({
    id: OpaqueIdSchema,
    expressionId: OpaqueIdSchema,
    kind: z.enum(['manual', 'reviewed-candidate']),
    createdAt: UtcIsoTimestampSchema,
    source: ProvenanceSourceSchema.nullable(),
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const OccurrenceStateSchema = z.enum([
  'known-form',
  'new-candidate',
  'possible-new-form',
  'ambiguous',
]);
export type OccurrenceState = z.infer<typeof OccurrenceStateSchema>;

export const OccurrenceSchema = z
  .object({
    id: OpaqueIdSchema,
    start: RevisionSchema,
    end: RevisionSchema,
    surface: NonBlankTextSchema,
    expressionIds: z.array(OpaqueIdSchema),
    conceptIds: z.array(OpaqueIdSchema),
    state: OccurrenceStateSchema,
    resolvedConceptId: OpaqueIdSchema.nullable(),
  })
  .strict()
  .refine((occ) => occ.end > occ.start, 'Occurrence end must exceed start')
  .refine((occ) => occ.surface.length === occ.end - occ.start, 'Occurrence surface length must match UTF-16 span')
  .refine(
    (occ) => new Set(occ.expressionIds).size === occ.expressionIds.length,
    'Occurrence expressionIds must be unique',
  )
  .refine(
    (occ) => new Set(occ.conceptIds).size === occ.conceptIds.length,
    'Occurrence conceptIds must be unique',
  );
export type Occurrence = z.infer<typeof OccurrenceSchema>;

export const RetainedDocumentSchema = z
  .object({
    id: OpaqueIdSchema,
    text: z.string().min(1, 'Retained document text must not be empty'),
    title: NonBlankTextSchema,
    createdAt: UtcIsoTimestampSchema,
  })
  .strict();
export type RetainedDocument = z.infer<typeof RetainedDocumentSchema>;

export const RetainedRunSchema = z
  .object({
    id: OpaqueIdSchema,
    documentId: OpaqueIdSchema,
    algorithmVersion: NonBlankTextSchema,
    libraryRevision: RevisionSchema,
    createdAt: UtcIsoTimestampSchema,
    occurrences: z.array(OccurrenceSchema),
  })
  .strict();
export type RetainedRun = z.infer<typeof RetainedRunSchema>;

export const AppliedBatchSchema = z
  .object({
    batchId: OpaqueIdSchema,
    digest: Sha256HexSchema,
    appliedRevision: RevisionSchema,
  })
  .strict();
export type AppliedBatch = z.infer<typeof AppliedBatchSchema>;

export const ChangeOpKindSchema = z.enum([
  'createConcept',
  'addExpression',
  'editExpression',
  'assertExpression',
  'retainDocument',
  'deleteRetainedDocument',
]);
export type ChangeOpKind = z.infer<typeof ChangeOpKindSchema>;

export const AuditEntrySchema = z
  .object({
    id: OpaqueIdSchema,
    batchId: OpaqueIdSchema,
    opId: OpaqueIdSchema,
    kind: ChangeOpKindSchema,
    recordIds: z.array(OpaqueIdSchema),
    actor: z.literal('local-user'),
    approvedAt: UtcIsoTimestampSchema,
    appliedRevision: RevisionSchema,
  })
  .strict();
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const LibrarySnapshotBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    libraryRevision: RevisionSchema,
    concepts: z.array(ConceptSchema),
    expressions: z.array(ExpressionSchema),
    assertions: z.array(VerificationAssertionSchema),
    provenance: z.array(ProvenanceSchema),
    documents: z.array(RetainedDocumentSchema),
    runs: z.array(RetainedRunSchema),
    batches: z.array(AppliedBatchSchema),
    audit: z.array(AuditEntrySchema),
  })
  .strict();

export type LibrarySnapshot = z.infer<typeof LibrarySnapshotBaseSchema>;

function assertUniqueIds<T>(items: readonly T[], keyOf: (item: T) => string, label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (map.has(key)) {
      throw new Error(`Duplicate ${label} ID: ${key}`);
    }
    map.set(key, item);
  }
  return map;
}

export function validateLibrarySnapshotIntegrity(snapshot: LibrarySnapshot): void {
  const conceptsById = assertUniqueIds(snapshot.concepts, (c) => c.id, 'concept');
  const expressionsById = assertUniqueIds(snapshot.expressions, (e) => e.id, 'expression');
  assertUniqueIds(snapshot.assertions, (a) => a.id, 'assertion');
  assertUniqueIds(snapshot.provenance, (p) => p.id, 'provenance');
  const documentsById = assertUniqueIds(snapshot.documents, (d) => d.id, 'document');
  const runsById = assertUniqueIds(snapshot.runs, (r) => r.id, 'run');
  const batchesById = assertUniqueIds(snapshot.batches, (b) => b.batchId, 'batch');
  assertUniqueIds(snapshot.audit, (a) => a.id, 'audit');
  assertUniqueIds(snapshot.audit, (a) => a.opId, 'audit opId');

  const expressionsPerConcept = new Map<string, number>();
  for (const expr of snapshot.expressions) {
    if (!conceptsById.has(expr.conceptId)) {
      throw new Error(`Orphan expression ${expr.id} references missing concept ${expr.conceptId}`);
    }
    expressionsPerConcept.set(expr.conceptId, (expressionsPerConcept.get(expr.conceptId) ?? 0) + 1);
  }

  for (const concept of snapshot.concepts) {
    if ((expressionsPerConcept.get(concept.id) ?? 0) < 1) {
      throw new Error(`Concept ${concept.id} must have at least one expression`);
    }
  }

  for (const assertion of snapshot.assertions) {
    const expr = expressionsById.get(assertion.expressionId);
    if (!expr) {
      throw new Error(`Assertion ${assertion.id} references missing expression ${assertion.expressionId}`);
    }
    if (assertion.recordRevision > expr.revision) {
      throw new Error(
        `Assertion ${assertion.id} recordRevision ${assertion.recordRevision} exceeds expression revision ${expr.revision}`,
      );
    }
  }

  const runSpans = new Map<string, Set<string>>();
  for (const run of snapshot.runs) {
    const doc = documentsById.get(run.documentId);
    if (!doc) {
      throw new Error(`Retained run ${run.id} references missing document ${run.documentId}`);
    }
    if (run.libraryRevision > snapshot.libraryRevision) {
      throw new Error(
        `Retained run ${run.id} libraryRevision ${run.libraryRevision} exceeds snapshot libraryRevision ${snapshot.libraryRevision}`,
      );
    }
    const seenOccIds = new Set<string>();
    const spans = new Set<string>();
    for (const occ of run.occurrences) {
      if (seenOccIds.has(occ.id)) {
        throw new Error(`Duplicate occurrence ID ${occ.id} in run ${run.id}`);
      }
      seenOccIds.add(occ.id);

      const spanKey = `${occ.start}:${occ.end}`;
      if (spans.has(spanKey)) {
        throw new Error(`Duplicate occurrence span ${spanKey} in run ${run.id}`);
      }
      spans.add(spanKey);

      if (occ.end > doc.text.length) {
        throw new Error(`Occurrence ${occ.id} span [${occ.start}, ${occ.end}) exceeds document length`);
      }
      if (doc.text.slice(occ.start, occ.end) !== occ.surface) {
        throw new Error(`Occurrence ${occ.id} surface does not match document slice at [${occ.start}, ${occ.end})`);
      }
      for (const exprId of occ.expressionIds) {
        if (!expressionsById.has(exprId)) {
          throw new Error(`Occurrence ${occ.id} references missing expression ${exprId}`);
        }
      }
      for (const conceptId of occ.conceptIds) {
        if (!conceptsById.has(conceptId)) {
          throw new Error(`Occurrence ${occ.id} references missing concept ${conceptId}`);
        }
      }
      if (occ.resolvedConceptId !== null && !conceptsById.has(occ.resolvedConceptId)) {
        throw new Error(`Occurrence ${occ.id} resolvedConceptId references missing concept ${occ.resolvedConceptId}`);
      }
    }
    runSpans.set(run.id, spans);
  }

  for (const prov of snapshot.provenance) {
    if (!expressionsById.has(prov.expressionId)) {
      throw new Error(`Provenance ${prov.id} references missing expression ${prov.expressionId}`);
    }
    if (prov.source !== null) {
      const doc = documentsById.get(prov.source.documentId);
      if (!doc) {
        throw new Error(`Provenance ${prov.id} source references missing document ${prov.source.documentId}`);
      }
      const run = runsById.get(prov.source.runId);
      if (!run || run.documentId !== doc.id) {
        throw new Error(`Provenance ${prov.id} source references invalid or mismatched run ${prov.source.runId}`);
      }
      if (prov.source.end > doc.text.length) {
        throw new Error(`Provenance ${prov.id} source span exceeds document length`);
      }
      const spans = runSpans.get(run.id);
      if (!spans || !spans.has(`${prov.source.start}:${prov.source.end}`)) {
        throw new Error(`Provenance ${prov.id} source span does not match any occurrence in run ${run.id}`);
      }
    }
  }

  for (const batch of snapshot.batches) {
    if (batch.appliedRevision > snapshot.libraryRevision) {
      throw new Error(
        `Batch ${batch.batchId} appliedRevision ${batch.appliedRevision} exceeds libraryRevision ${snapshot.libraryRevision}`,
      );
    }
  }

  for (const entry of snapshot.audit) {
    const batch = batchesById.get(entry.batchId);
    if (!batch) {
      throw new Error(`Audit entry ${entry.id} references missing batch ${entry.batchId}`);
    }
    if (entry.appliedRevision !== batch.appliedRevision) {
      throw new Error(
        `Audit entry ${entry.id} appliedRevision ${entry.appliedRevision} does not match batch revision ${batch.appliedRevision}`,
      );
    }
  }
}

export function sortSnapshotCollections(snapshot: LibrarySnapshot): LibrarySnapshot {
  return {
    schemaVersion: 1,
    libraryRevision: snapshot.libraryRevision,
    concepts: [...snapshot.concepts].sort((a, b) => compareCodeUnits(a.id, b.id)),
    expressions: [...snapshot.expressions].sort((a, b) => compareCodeUnits(a.id, b.id)),
    assertions: [...snapshot.assertions].sort((a, b) => compareCodeUnits(a.id, b.id)),
    provenance: [...snapshot.provenance].sort((a, b) => compareCodeUnits(a.id, b.id)),
    documents: [...snapshot.documents].sort((a, b) => compareCodeUnits(a.id, b.id)),
    runs: [...snapshot.runs].sort((a, b) => compareCodeUnits(a.id, b.id)),
    batches: [...snapshot.batches].sort((a, b) => compareCodeUnits(a.batchId, b.batchId)),
    audit: [...snapshot.audit].sort((a, b) => compareCodeUnits(a.id, b.id)),
  };
}

export function createEmptySnapshot(): LibrarySnapshot {
  return {
    schemaVersion: 1,
    libraryRevision: 0,
    concepts: [],
    expressions: [],
    assertions: [],
    provenance: [],
    documents: [],
    runs: [],
    batches: [],
    audit: [],
  };
}

export function parseConcept(input: unknown): Concept {
  return ConceptSchema.parse(input);
}

export function parseExpression(input: unknown): Expression {
  return ExpressionSchema.parse(input);
}

export function parseVerificationAssertion(input: unknown): VerificationAssertion {
  return VerificationAssertionSchema.parse(input);
}

export function parseProvenance(input: unknown): Provenance {
  return ProvenanceSchema.parse(input);
}

export function parseRetainedDocument(input: unknown): RetainedDocument {
  return RetainedDocumentSchema.parse(input);
}

export function parseRetainedRun(input: unknown): RetainedRun {
  return RetainedRunSchema.parse(input);
}

export function parseOccurrence(input: unknown): Occurrence {
  return OccurrenceSchema.parse(input);
}

export function parseLibrarySnapshot(input: unknown): LibrarySnapshot {
  const parsed = LibrarySnapshotBaseSchema.parse(input);
  validateLibrarySnapshotIntegrity(parsed);
  return sortSnapshotCollections(parsed);
}

export function isExpressionProtected(
  expression: Pick<Expression, 'id' | 'text'>,
  assertions: readonly VerificationAssertion[],
): boolean {
  return assertions.some(
    (assertion) =>
      assertion.expressionId === expression.id &&
      assertion.field === 'text' &&
      assertion.value === expression.text,
  );
}

export function formatLanguageUse(language: LanguageUse): string {
  if (language.kind === 'language') {
    return language.tag;
  }
  return language.kind;
}

export function languageMatchesFilter(
  language: LanguageUse,
  filter: 'all' | 'en' | 'tr' | 'shared',
): boolean {
  if (filter === 'all') return true;
  if (filter === 'shared') return language.kind === 'shared';
  if (filter === 'en') {
    return (
      language.kind === 'language' &&
      (language.tag === 'en' || language.tag === 'en-US' || language.tag === 'en-GB')
    );
  }
  return language.kind === 'language' && language.tag === 'tr';
}

export function languageUseEquals(a: LanguageUse, b: LanguageUse): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'language' && b.kind === 'language') {
    return a.tag === b.tag;
  }
  return true;
}
