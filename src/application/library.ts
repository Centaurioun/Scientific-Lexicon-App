import {
  parseRestoreApproval,
  validateBackup,
  type BackupEnvelope,
  type RestoreApproval,
} from '@/domain/backup';
import {
  buildChangePreview,
  cloneAndFreezeJson,
  digest,
  parseApproval,
  parseChangePayload,
  type Approval,
  type ApplyResult,
  type ChangePayload,
  type ProposedChange,
} from '@/domain/changes';
import type { LibraryRepository, RecoveryRepository } from '@/domain/repository';
import {
  compareCodeUnits,
  parseLibrarySnapshot,
  type Expression,
  type LibrarySnapshot,
} from '@/domain/schema';

export async function listLibrary(repo: LibraryRepository): Promise<LibrarySnapshot> {
  const snapshot = await repo.snapshot();
  return parseLibrarySnapshot(snapshot);
}

export function findExpressions(snapshot: LibrarySnapshot, query: string): Expression[] {
  const matched =
    query.length === 0
      ? [...snapshot.expressions]
      : snapshot.expressions.filter((expr) => expr.text.includes(query));

  return matched.sort((a, b) => {
    const byText = compareCodeUnits(a.text, b.text);
    if (byText !== 0) return byText;
    return compareCodeUnits(a.id, b.id);
  });
}

export async function proposeChange(
  snapshot: LibrarySnapshot,
  payload: ChangePayload,
): Promise<ProposedChange> {
  const validSnapshot = parseLibrarySnapshot(snapshot);
  const validPayload = parseChangePayload(payload);
  const frozenPayload = cloneAndFreezeJson(validPayload);
  const payloadDigest = await digest(frozenPayload);
  const preview = Object.freeze(buildChangePreview(validSnapshot, frozenPayload));

  return Object.freeze({
    payload: frozenPayload,
    digest: payloadDigest,
    preview,
  });
}

export function approveChange(proposal: ProposedChange): Approval {
  if (!proposal || typeof proposal !== 'object') {
    throw new Error('Proposal is required for explicit user approval.');
  }
  const validPayload = parseChangePayload(proposal.payload);
  return Object.freeze({
    batchId: validPayload.batchId,
    digest: proposal.digest,
    actor: 'local-user' as const,
    approvedAt: new Date().toISOString(),
  });
}

export async function applyChange(
  repo: LibraryRepository,
  proposal: ProposedChange,
  approval: Approval,
): Promise<ApplyResult> {
  let validPayload: ChangePayload;
  let validApproval: Approval;
  try {
    validPayload = parseChangePayload(proposal?.payload);
    validApproval = parseApproval(approval);
  } catch (error) {
    return {
      status: 'invalid',
      reason: error instanceof Error ? error.message : 'Invalid proposal or approval shape.',
    };
  }

  let recomputedDigest: string;
  try {
    recomputedDigest = await digest(validPayload);
  } catch (error) {
    return {
      status: 'invalid',
      reason: error instanceof Error ? error.message : 'Failed to digest proposal payload.',
    };
  }

  if (recomputedDigest !== proposal.digest) {
    return {
      status: 'invalid',
      reason: 'Proposal payload digest mismatch; payload appears modified after preview.',
    };
  }

  if (validApproval.batchId !== validPayload.batchId) {
    return {
      status: 'invalid',
      reason: `Approval batchId "${validApproval.batchId}" does not match payload batchId "${validPayload.batchId}".`,
    };
  }

  if (validApproval.digest !== recomputedDigest) {
    return {
      status: 'invalid',
      reason: 'Approval digest does not match canonical proposal digest.',
    };
  }

  const frozenProposal: ProposedChange = Object.freeze({
    payload: cloneAndFreezeJson(validPayload),
    digest: recomputedDigest,
    preview: Object.freeze([...proposal.preview]),
  });

  return repo.apply(frozenProposal, validApproval);
}

export function approveRestore(backup: BackupEnvelope): RestoreApproval {
  if (!backup || typeof backup !== 'object' || typeof backup.digest !== 'string') {
    throw new Error('Validated BackupEnvelope is required before approving restore.');
  }
  return Object.freeze({
    digest: backup.digest,
    actor: 'local-user' as const,
    approvedAt: new Date().toISOString(),
  });
}

export async function restoreEmptyLibrary(
  repo: RecoveryRepository,
  backup: BackupEnvelope,
  approval: RestoreApproval,
): Promise<ApplyResult> {
  let validatedBackup: BackupEnvelope;
  let validApproval: RestoreApproval;
  try {
    validatedBackup = await validateBackup(backup);
    validApproval = parseRestoreApproval(approval);
  } catch (error) {
    return {
      status: 'invalid',
      reason: error instanceof Error ? error.message : 'Invalid backup envelope or restore approval.',
    };
  }

  if (validApproval.digest !== validatedBackup.digest) {
    return {
      status: 'invalid',
      reason: 'Restore approval digest does not match validated backup digest.',
    };
  }

  return repo.restoreEmpty(validatedBackup, validApproval);
}
