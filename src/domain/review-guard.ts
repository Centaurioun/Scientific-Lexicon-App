import { canonicalJson, deepFreeze, digest } from './changes';
import { createBackup, serializeBackupFile } from './backup';
import type { BlankLinePolicy, DelimitedDelimiter, RawDelimitedStage } from './delimited-intake';
import type { ExpressionRole, LanguageUse, LibrarySnapshot } from './schema';
import type { StagingMappingSpec, StagingMappingSpecSchema } from './staging-mapping';
import type { StagedReviewEvaluation, StagedRowUserDecision } from './staging-review';

export const DELIMITED_REVIEW_INTENT_VERSION = 'wp03-delimited-review-intent-v1' as const;
export const ENRICHMENT_REVIEW_INTENT_VERSION = 'wp04-enrichment-review-intent-v1' as const;

export interface DelimitedReviewIntentDecisionRecord {
  readonly rowId: string;
  readonly rowNumber: number;
  readonly stagedTermText: string;
  readonly stagedLanguage: LanguageUse | null;
  readonly stagedRole: ExpressionRole | null;
  readonly groupKey: string | null;
  readonly decision: StagedRowUserDecision;
  readonly isActionableOperation: boolean;
  readonly hasBlockingConflict: boolean;
}

export interface DelimitedReviewIntentPayload {
  readonly kind: typeof DELIMITED_REVIEW_INTENT_VERSION;
  readonly sourceRawByteSha256: string;
  readonly delimiter: DelimitedDelimiter;
  readonly blankLinePolicy: BlankLinePolicy;
  readonly baseLibraryRevision: number;
  readonly mappingVersion: StagingMappingSpec['mappingVersion'];
  readonly mapping: StagingMappingSpec;
  readonly orderedRowDecisions: readonly DelimitedReviewIntentDecisionRecord[];
}

export interface EnrichmentSelectedProposalItem {
  readonly targetConceptId: string | null;
  readonly operation: 'addExpression' | 'createConcept';
  readonly expectedConceptRevision: number | null;
  readonly text: string;
  readonly language: LanguageUse;
  readonly role: ExpressionRole;
}

export interface EnrichmentReviewIntentPayload {
  readonly kind: typeof ENRICHMENT_REVIEW_INTENT_VERSION;
  readonly taskId: string;
  readonly taskDigest: string;
  readonly baseLibraryRevision: number;
  readonly selectedItems: readonly EnrichmentSelectedProposalItem[];
}

export interface PreCommitBackupProof {
  readonly proposalDigest: string;
  readonly batchId: string;
  readonly reviewIntentDigest: string;
  readonly snapshotRevision: number;
  readonly backupDigest: string;
  readonly filename: string;
  readonly byteLength: number;
  readonly offeredAt: string;
}

export interface ValidatedPreCommitBackupOffer {
  readonly proof: PreCommitBackupProof;
  readonly serializedBackup: string;
  readonly filename: string;
}

export interface CommitProposalSummary {
  readonly digest: string;
  readonly batchId: string;
  readonly baseLibraryRevision: number;
}

export interface CommitAuthorizationCheckInput {
  readonly plannedProposal: CommitProposalSummary | null;
  readonly expectedReviewIntentDigest: string | null;
  readonly actualReviewIntentDigest: string | null;
  readonly authoritativeSnapshot: LibrarySnapshot | null;
  readonly backupProof: PreCommitBackupProof | null;
  readonly preCommitAckChecked: boolean;
  readonly freshnessConfirmed: boolean;
}

export type CommitAuthorizationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Computes a deterministic, lossless canonical JSON representation of the entire
 * delimited review intent: source raw SHA-256, parse policy (delimiter + blankLinePolicy),
 * base library revision, positional mapping spec, and deterministic row-ordered effective
 * user decisions (including skip, unresolved, create-new-concept, link-existing-concept + target,
 * and link-staged-group + groupKey). Zero ambiguous string concatenation.
 */
export function buildDelimitedReviewIntentPayload(
  rawStage: {
    readonly rawByteSha256: string;
    readonly delimiter: DelimitedDelimiter;
    readonly blankLinePolicy: BlankLinePolicy;
  },
  review: StagedReviewEvaluation,
): DelimitedReviewIntentPayload {
  const sourceRawByteSha256 = rawStage.rawByteSha256;

  const orderedRowDecisions = [...review.rows]
    .sort((a, b) => a.row.rowNumber - b.row.rowNumber)
    .map(
      (item): DelimitedReviewIntentDecisionRecord => ({
        rowId: item.row.rowId,
        rowNumber: item.row.rowNumber,
        stagedTermText: item.row.stagedTermText,
        stagedLanguage: item.row.stagedLanguage,
        stagedRole: item.row.stagedRole,
        groupKey: item.row.groupKey,
        decision: item.decision,
        isActionableOperation: item.isActionableOperation,
        hasBlockingConflict: item.hasBlockingConflict,
      }),
    );

  return deepFreeze({
    kind: DELIMITED_REVIEW_INTENT_VERSION,
    sourceRawByteSha256,
    delimiter: rawStage.delimiter,
    blankLinePolicy: rawStage.blankLinePolicy,
    baseLibraryRevision: review.baseLibraryRevision,
    mappingVersion: review.table.mappingVersion,
    mapping: review.table.mapping,
    orderedRowDecisions,
  });
}

export function computeDelimitedReviewIntentCanonical(
  rawStage: {
    readonly rawByteSha256: string;
    readonly delimiter: DelimitedDelimiter;
    readonly blankLinePolicy: BlankLinePolicy;
  },
  review: StagedReviewEvaluation,
): string {
  return canonicalJson(buildDelimitedReviewIntentPayload(rawStage, review));
}

export async function computeDelimitedReviewIntentDigest(
  rawStage: {
    readonly rawByteSha256: string;
    readonly delimiter: DelimitedDelimiter;
    readonly blankLinePolicy: BlankLinePolicy;
  },
  review: StagedReviewEvaluation,
): Promise<string> {
  return digest(buildDelimitedReviewIntentPayload(rawStage, review));
}

/**
 * Lossless canonical review-intent identity for WP04 F7 enrichment selection commits.
 */
export function buildEnrichmentReviewIntentPayload(input: {
  readonly taskId: string;
  readonly taskDigest: string;
  readonly baseLibraryRevision: number;
  readonly selectedItems: readonly EnrichmentSelectedProposalItem[];
}): EnrichmentReviewIntentPayload {
  const sortedItems = [...input.selectedItems].sort((a, b) => {
    const ka = `${a.targetConceptId ?? ''}\u0000${a.operation}\u0000${a.text}`;
    const kb = `${b.targetConceptId ?? ''}\u0000${b.operation}\u0000${b.text}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return deepFreeze({
    kind: ENRICHMENT_REVIEW_INTENT_VERSION,
    taskId: input.taskId,
    taskDigest: input.taskDigest,
    baseLibraryRevision: input.baseLibraryRevision,
    selectedItems: sortedItems,
  });
}

export function computeEnrichmentReviewIntentCanonical(input: {
  readonly taskId: string;
  readonly taskDigest: string;
  readonly baseLibraryRevision: number;
  readonly selectedItems: readonly EnrichmentSelectedProposalItem[];
}): string {
  return canonicalJson(buildEnrichmentReviewIntentPayload(input));
}

export async function computeEnrichmentReviewIntentDigest(input: {
  readonly taskId: string;
  readonly taskDigest: string;
  readonly baseLibraryRevision: number;
  readonly selectedItems: readonly EnrichmentSelectedProposalItem[];
}): Promise<string> {
  return digest(buildEnrichmentReviewIntentPayload(input));
}

/**
 * Generates and serializes a validated pre-commit portable backup bound explicitly to the
 * exact proposal digest, batch ID, review-intent digest, and current snapshot revision.
 * Enforces existing `MAX_BACKUP_FILE_BYTES` (16 MiB) limit fail-closed.
 */
export async function createValidatedPreCommitBackupOffer(params: {
  readonly snapshot: LibrarySnapshot;
  readonly proposalDigest: string;
  readonly batchId: string;
  readonly reviewIntentDigest: string;
  readonly filenamePrefix: string;
  readonly now?: string;
}): Promise<ValidatedPreCommitBackupOffer> {
  const envelope = await createBackup(params.snapshot);
  const serializedBackup = serializeBackupFile(envelope);
  const byteLength = new TextEncoder().encode(serializedBackup).byteLength;
  const now = params.now ?? new Date().toISOString();
  const stamp = now.replace(/[:.]/g, '-');
  const filename = `${params.filenamePrefix}-rev${envelope.snapshot.libraryRevision}-${stamp}.json`;

  const proof: PreCommitBackupProof = Object.freeze({
    proposalDigest: params.proposalDigest,
    batchId: params.batchId,
    reviewIntentDigest: params.reviewIntentDigest,
    snapshotRevision: envelope.snapshot.libraryRevision,
    backupDigest: envelope.digest,
    filename,
    byteLength,
    offeredAt: now,
  });

  return Object.freeze({
    proof,
    serializedBackup,
    filename,
  });
}

/**
 * Fail-closed verification gate executed inside commit handlers (not solely via UI disabled props).
 * Shared by both WP03 Data Operations (H1/H2) and WP04 Enrichment Approval (F7).
 */
export function verifyPreCommitCommitAuthorization(
  input: CommitAuthorizationCheckInput,
): CommitAuthorizationResult {
  if (!input.freshnessConfirmed) {
    return {
      ok: false,
      reason:
        'Library revision freshness is unconfirmed after background updates. Reload latest snapshot before committing.',
    };
  }

  if (!input.plannedProposal) {
    return {
      ok: false,
      reason: 'No active reviewed proposal is available to commit.',
    };
  }

  if (!input.authoritativeSnapshot) {
    return {
      ok: false,
      reason: 'Current authoritative library snapshot is unavailable.',
    };
  }

  if (
    input.plannedProposal.baseLibraryRevision !== input.authoritativeSnapshot.libraryRevision
  ) {
    return {
      ok: false,
      reason: `Proposal targets library revision ${input.plannedProposal.baseLibraryRevision}, but authoritative snapshot is at revision ${input.authoritativeSnapshot.libraryRevision}. Rebuild the proposal against the latest revision.`,
    };
  }

  if (
    !input.expectedReviewIntentDigest ||
    !input.actualReviewIntentDigest ||
    input.expectedReviewIntentDigest !== input.actualReviewIntentDigest
  ) {
    return {
      ok: false,
      reason:
        'Reviewed staging decisions, mapping, or context changed after the proposal was built. Rebuild the proposal before committing.',
    };
  }

  if (!input.backupProof) {
    return {
      ok: false,
      reason:
        'A validated pre-commit portable backup offer bound to this exact proposal and library revision is required before acknowledgment or commit.',
    };
  }

  if (
    input.backupProof.proposalDigest !== input.plannedProposal.digest ||
    input.backupProof.batchId !== input.plannedProposal.batchId
  ) {
    return {
      ok: false,
      reason:
        'Existing pre-commit backup offer does not match the current reviewed proposal. Offer a fresh pre-commit backup for this batch.',
    };
  }

  if (input.backupProof.reviewIntentDigest !== input.actualReviewIntentDigest) {
    return {
      ok: false,
      reason:
        'Existing pre-commit backup offer is stale because review decisions or mapping changed. Offer a fresh backup.',
    };
  }

  if (input.backupProof.snapshotRevision !== input.authoritativeSnapshot.libraryRevision) {
    return {
      ok: false,
      reason: `Pre-commit backup offer was generated at revision ${input.backupProof.snapshotRevision}, but current library revision is ${input.authoritativeSnapshot.libraryRevision}. Offer a fresh pre-commit backup.`,
    };
  }

  if (!input.preCommitAckChecked) {
    return {
      ok: false,
      reason:
        'Explicit user acknowledgment of the pre-commit backup offer and metadata limitations is required before committing.',
    };
  }

  return { ok: true };
}
