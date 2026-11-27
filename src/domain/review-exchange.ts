import { z } from 'zod';
import { canonicalJson, deepFreeze, digest } from './changes';
import {
  compareCodeUnits,
  ExpressionRoleSchema,
  LanguageUseSchema,
  NonBlankTextSchema,
  OpaqueIdSchema,
  RevisionSchema,
  Sha256HexSchema,
  UtcIsoTimestampSchema,
  type LibrarySnapshot,
} from './schema';
import type { ValidatedEnrichmentSelection } from '@/application/enrichment-tasks';

export const REVIEW_EXCHANGE_LIMITS = Object.freeze({
  maxTargetsPerTask: 50,
  maxBlindSlots: 3,
  maxPacketBytes: 262_144, // 256 KiB
  maxResponseBytes: 262_144, // 256 KiB
  maxDecodedResponseChars: 200_000,
  maxJsonDepth: 16,
  maxSuggestionsPerResponse: 100,
  maxEvidenceRefsPerResponse: 32,
  maxTextLength: 4_096, // rationale / evidence / context UTF-16 limit
  maxSuggestedSurfaceLength: 512, // suggested expression form UTF-16 limit
  maxEnrichmentOperations: 250, // <= WP03 bulk commit cap
});

export const REVIEW_ALLOWED_OPERATIONS = ['proposeExpression', 'no-change', 'abstain'] as const;

const SafeTextNoControlsSchema = NonBlankTextSchema.refine(
  (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
  'Text must not contain unsafe ASCII control characters.',
);

export const BoundedContextTextSchema = SafeTextNoControlsSchema.max(
  REVIEW_EXCHANGE_LIMITS.maxTextLength,
  `Text exceeds ${REVIEW_EXCHANGE_LIMITS.maxTextLength} UTF-16 characters.`,
);

export const BoundedSuggestedSurfaceSchema = NonBlankTextSchema.refine(
  (value) => !/[\u0000-\u001F\u007F]/.test(value),
  'Suggested expression form must not contain ASCII control characters.',
).refine(
  (value) => value.length <= REVIEW_EXCHANGE_LIMITS.maxSuggestedSurfaceLength,
  `Suggested expression form exceeds ${REVIEW_EXCHANGE_LIMITS.maxSuggestedSurfaceLength} UTF-16 characters.`,
);

export const BoundedShortLabelSchema = NonBlankTextSchema.refine(
  (value) => !/[\u0000-\u001F\u007F]/.test(value),
  'Label must not contain ASCII control characters.',
).refine((value) => value.length <= 256, 'Label exceeds 256 UTF-16 characters.');

export const ReviewTaskKindSchema = z.enum([
  'missing-en',
  'missing-tr',
  'unspecified-role',
  'undetermined-language',
  'candidate-review',
]);
export type ReviewTaskKind = z.infer<typeof ReviewTaskKindSchema>;

export const ScopedTargetExpressionSchema = z
  .object({
    id: OpaqueIdSchema,
    revision: RevisionSchema,
    text: NonBlankTextSchema,
    language: LanguageUseSchema,
    role: ExpressionRoleSchema,
  })
  .strict();

export const ScopedReviewTargetSchema = z
  .object({
    conceptId: OpaqueIdSchema,
    conceptRevision: RevisionSchema,
    expressions: z.array(ScopedTargetExpressionSchema).min(1),
  })
  .strict();

export const BlindReviewerSlotSchema = z
  .object({
    slotId: OpaqueIdSchema,
    slotLabel: BoundedShortLabelSchema,
    blindPolicy: z.literal('isolated-no-sibling-responses'),
  })
  .strict();
export type BlindReviewerSlot = z.infer<typeof BlindReviewerSlotSchema>;

export const ReviewTaskPacketCoreSchema = z
  .object({
    format: z.literal('termforge-review-task-packet'),
    version: z.literal(1),
    taskId: OpaqueIdSchema,
    createdAt: UtcIsoTimestampSchema,
    syntheticOnly: z.literal(true),
    baseLibraryRevision: RevisionSchema,
    taskKind: ReviewTaskKindSchema,
    allowedOperations: z.tuple([
      z.literal('proposeExpression'),
      z.literal('no-change'),
      z.literal('abstain'),
    ]),
    blindReviewerSlots: z
      .array(BlindReviewerSlotSchema)
      .min(1)
      .max(REVIEW_EXCHANGE_LIMITS.maxBlindSlots)
      .superRefine((slots, ctx) => {
        const seen = new Set<string>();
        for (const s of slots) {
          if (seen.has(s.slotId)) {
            ctx.addIssue({ code: 'custom', message: `Duplicate blind reviewer slotId: ${s.slotId}` });
          }
          seen.add(s.slotId);
        }
      }),
    contextMode: z.enum(['none', 'explicit-scoped-note']),
    explicitContextNote: BoundedContextTextSchema.nullable(),
    selectedTargets: z
      .array(ScopedReviewTargetSchema)
      .min(1)
      .max(REVIEW_EXCHANGE_LIMITS.maxTargetsPerTask)
      .superRefine((targets, ctx) => {
        const seen = new Set<string>();
        for (const t of targets) {
          if (seen.has(t.conceptId)) {
            ctx.addIssue({ code: 'custom', message: `Duplicate target conceptId: ${t.conceptId}` });
          }
          seen.add(t.conceptId);
        }
      }),
    externalUsageInstructions: BoundedContextTextSchema,
  })
  .strict()
  .superRefine((core, ctx) => {
    if (core.contextMode === 'none' && core.explicitContextNote !== null) {
      ctx.addIssue({
        code: 'custom',
        message: 'explicitContextNote must be null when contextMode is "none".',
      });
    }
    if (core.contextMode === 'explicit-scoped-note' && core.explicitContextNote === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'explicitContextNote is required when contextMode is "explicit-scoped-note".',
      });
    }
  });

export const ReviewTaskPacketV1Schema = ReviewTaskPacketCoreSchema.extend({
  taskDigest: Sha256HexSchema,
}).strict();

export type ReviewTaskPacketCore = z.infer<typeof ReviewTaskPacketCoreSchema>;
export type ReviewTaskPacketV1 = z.infer<typeof ReviewTaskPacketV1Schema>;

export const EXTERNAL_REVIEW_USAGE_INSTRUCTIONS =
  'SYNTHETIC DATA ONLY: This exported ReviewTaskPacket v1 uses synthetic terminology under bounded G4/G5 rules. Do not submit real clinical text, manuscripts, credentials, or proprietary corpora to external services. External reviewers act in isolated blind slots without sibling responses and may return only JSON conforming to termforge-review-response v1 with operations proposeExpression, no-change, or abstain.';

export interface BuiltReviewTaskPacket {
  readonly packet: ReviewTaskPacketV1;
  readonly canonicalJsonText: string;
  readonly byteLength: number;
}

export async function buildReviewTaskPacket(
  selection: ValidatedEnrichmentSelection,
  options: {
    readonly taskId: string;
    readonly createdAt?: string;
    readonly slotCount?: number;
    readonly contextMode?: 'none' | 'explicit-scoped-note';
    readonly explicitContextNote?: string | null;
  },
): Promise<BuiltReviewTaskPacket> {
  const slotCount = options.slotCount ?? REVIEW_EXCHANGE_LIMITS.maxBlindSlots;
  if (!Number.isInteger(slotCount) || slotCount < 1 || slotCount > REVIEW_EXCHANGE_LIMITS.maxBlindSlots) {
    throw new Error(
      `blindReviewerSlots count must be between 1 and ${REVIEW_EXCHANGE_LIMITS.maxBlindSlots}.`,
    );
  }

  const contextMode = options.contextMode ?? 'none';
  const explicitContextNote =
    contextMode === 'none' ? null : (options.explicitContextNote ?? null);

  const slots: BlindReviewerSlot[] = Array.from({ length: slotCount }, (_, idx) => ({
    slotId: `slot-${idx + 1}`,
    slotLabel: `Blind Reviewer Slot ${idx + 1}`,
    blindPolicy: 'isolated-no-sibling-responses' as const,
  }));

  const sortedTargets = [...selection.targets]
    .sort((a, b) => compareCodeUnits(a.conceptId, b.conceptId))
    .map((target) => ({
      conceptId: target.conceptId,
      conceptRevision: target.conceptRevision,
      expressions: [...target.expressions]
        .sort((a, b) => compareCodeUnits(a.id, b.id))
        .map((expr) => ({
          id: expr.id,
          revision: expr.revision,
          text: expr.text,
          language: expr.language,
          role: expr.role,
        })),
    }));

  const core: ReviewTaskPacketCore = ReviewTaskPacketCoreSchema.parse({
    format: 'termforge-review-task-packet',
    version: 1,
    taskId: options.taskId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    syntheticOnly: true,
    baseLibraryRevision: selection.baseLibraryRevision,
    taskKind: selection.taskKind,
    allowedOperations: ['proposeExpression', 'no-change', 'abstain'],
    blindReviewerSlots: slots,
    contextMode,
    explicitContextNote,
    selectedTargets: sortedTargets,
    externalUsageInstructions: EXTERNAL_REVIEW_USAGE_INSTRUCTIONS,
  });

  const taskDigest = await digest(core);
  const packet = ReviewTaskPacketV1Schema.parse({
    ...core,
    taskDigest,
  });

  const canonicalJsonText = canonicalJson(packet);
  const byteLength = new TextEncoder().encode(canonicalJsonText).byteLength;
  if (byteLength > REVIEW_EXCHANGE_LIMITS.maxPacketBytes) {
    throw new Error(
      `ReviewTaskPacket size (${byteLength} bytes) exceeds maximum limit (${REVIEW_EXCHANGE_LIMITS.maxPacketBytes} bytes / 256 KiB). Reduce selected targets.`,
    );
  }

  return deepFreeze({
    packet,
    canonicalJsonText,
    byteLength,
  });
}

export async function verifyReviewTaskPacket(input: unknown): Promise<ReviewTaskPacketV1> {
  const parsed = ReviewTaskPacketV1Schema.parse(input);
  const canonicalText = canonicalJson(parsed);
  const byteLength = new TextEncoder().encode(canonicalText).byteLength;
  if (byteLength > REVIEW_EXCHANGE_LIMITS.maxPacketBytes) {
    throw new Error(
      `ReviewTaskPacket size (${byteLength} bytes) exceeds 256 KiB (${REVIEW_EXCHANGE_LIMITS.maxPacketBytes} bytes).`,
    );
  }
  const { taskDigest, ...core } = parsed;
  const expectedDigest = await digest(core);
  if (expectedDigest !== taskDigest) {
    throw new Error(
      `ReviewTaskPacket taskDigest mismatch (expected ${expectedDigest}, received ${taskDigest}). Packet may be tampered.`,
    );
  }
  return deepFreeze(parsed);
}

export async function verifyReviewTaskPacketAgainstSnapshot(
  packet: ReviewTaskPacketV1,
  snapshot: LibrarySnapshot,
): Promise<ReviewTaskPacketV1> {
  const verified = await verifyReviewTaskPacket(packet);
  if (verified.baseLibraryRevision !== snapshot.libraryRevision) {
    throw new Error(
      `Stale ReviewTaskPacket: packet targets library revision ${verified.baseLibraryRevision}, but current library revision is ${snapshot.libraryRevision}.`,
    );
  }
  const conceptMap = new Map(snapshot.concepts.map((c) => [c.id, c]));
  for (const target of verified.selectedTargets) {
    const live = conceptMap.get(target.conceptId);
    if (!live) {
      throw new Error(
        `Stale ReviewTaskPacket: target concept ${target.conceptId} no longer exists in snapshot.`,
      );
    }
    if (live.revision !== target.conceptRevision) {
      throw new Error(
        `Stale ReviewTaskPacket: concept ${target.conceptId} revision drifted from ${target.conceptRevision} to ${live.revision}.`,
      );
    }
  }
  return verified;
}

// --- ReviewResponse v1 Schema (shared with F5 / F6 / F7) ---

export const ReviewEvidenceRefSchema = z
  .object({
    sourceId: OpaqueIdSchema,
    referenceId: OpaqueIdSchema,
    referenceUri: BoundedSuggestedSurfaceSchema.optional(),
    quotedEvidence: BoundedContextTextSchema.optional(),
    note: BoundedContextTextSchema,
  })
  .strict();
export type ReviewEvidenceRef = z.infer<typeof ReviewEvidenceRefSchema>;

export const ProposeExpressionSuggestionSchema = z
  .object({
    operation: z.literal('proposeExpression'),
    targetConceptId: OpaqueIdSchema,
    expectedConceptRevision: RevisionSchema,
    text: BoundedSuggestedSurfaceSchema,
    language: LanguageUseSchema,
    role: ExpressionRoleSchema,
    rationale: BoundedContextTextSchema,
    evidenceRefs: z
      .array(ReviewEvidenceRefSchema)
      .max(REVIEW_EXCHANGE_LIMITS.maxEvidenceRefsPerResponse),
  })
  .strict();

export const NoChangeSuggestionSchema = z
  .object({
    operation: z.literal('no-change'),
    targetConceptId: OpaqueIdSchema,
    expectedConceptRevision: RevisionSchema,
    rationale: BoundedContextTextSchema,
    evidenceRefs: z
      .array(ReviewEvidenceRefSchema)
      .max(REVIEW_EXCHANGE_LIMITS.maxEvidenceRefsPerResponse),
  })
  .strict();

export const AbstainSuggestionSchema = z
  .object({
    operation: z.literal('abstain'),
    targetConceptId: OpaqueIdSchema,
    expectedConceptRevision: RevisionSchema,
    rationale: BoundedContextTextSchema,
    evidenceRefs: z
      .array(ReviewEvidenceRefSchema)
      .max(REVIEW_EXCHANGE_LIMITS.maxEvidenceRefsPerResponse),
  })
  .strict();

export const ReviewResponseSuggestionSchema = z.discriminatedUnion('operation', [
  ProposeExpressionSuggestionSchema,
  NoChangeSuggestionSchema,
  AbstainSuggestionSchema,
]);
export type ReviewResponseSuggestion = z.infer<typeof ReviewResponseSuggestionSchema>;

export const ClaimedProviderIdentitySchema = z
  .object({
    provider: BoundedShortLabelSchema,
    model: BoundedShortLabelSchema,
    version: BoundedShortLabelSchema,
    selfReportedUnauthenticated: z.literal(true),
  })
  .strict();

export const ReviewResponseV1Schema = z
  .object({
    format: z.literal('termforge-review-response'),
    version: z.literal(1),
    syntheticSimulation: z.boolean(),
    taskId: OpaqueIdSchema,
    taskDigest: Sha256HexSchema,
    baseLibraryRevision: RevisionSchema,
    reviewerSlotId: OpaqueIdSchema,
    responseId: OpaqueIdSchema,
    claimedProviderIdentity: ClaimedProviderIdentitySchema,
    createdAt: UtcIsoTimestampSchema,
    suggestions: z
      .array(ReviewResponseSuggestionSchema)
      .max(REVIEW_EXCHANGE_LIMITS.maxSuggestionsPerResponse),
  })
  .strict()
  .superRefine((response, ctx) => {
    let totalEvidenceRefs = 0;
    for (const s of response.suggestions) {
      totalEvidenceRefs += s.evidenceRefs.length;
    }
    if (totalEvidenceRefs > REVIEW_EXCHANGE_LIMITS.maxEvidenceRefsPerResponse) {
      ctx.addIssue({
        code: 'custom',
        message: `Total evidence references across response (${totalEvidenceRefs}) exceeds maximum (${REVIEW_EXCHANGE_LIMITS.maxEvidenceRefsPerResponse}).`,
      });
    }
  });

export type ReviewResponseV1 = z.infer<typeof ReviewResponseV1Schema>;
