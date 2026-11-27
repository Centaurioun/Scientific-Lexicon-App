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
  languageMatchesFilter,
  parseLibrarySnapshot,
  type Expression,
  type ExpressionRole,
  type LibrarySnapshot,
} from '@/domain/schema';

export type LookupMode = 'substring' | 'exact' | 'prefix' | 'case-insensitive-view';
export type LibraryLanguageFilter = 'all' | 'en' | 'tr' | 'shared' | 'undetermined';

export interface LookupOptions {
  query?: string;
  mode?: LookupMode;
  language?: LibraryLanguageFilter;
  role?: 'all' | ExpressionRole;
}

export interface HomonymSibling {
  sharedSurface: string;
  conceptId: string;
}

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

function matchesQueryByMode(expr: Expression, query: string, mode: LookupMode): boolean {
  if (query.length === 0) return true;
  switch (mode) {
    case 'substring':
      return expr.text.includes(query);
    case 'exact':
      return expr.text === query;
    case 'prefix':
      return expr.text.startsWith(query);
    case 'case-insensitive-view': {
      // Search-only case folding; never alters stored canonical expression text.
      // Respect Turkish dotted/dotless I/İ/ı rules when evaluating Turkish expressions.
      if (expr.language.kind === 'language' && expr.language.tag === 'tr') {
        return expr.text.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr'));
      }
      return expr.text.toLowerCase().includes(query.toLowerCase());
    }
  }
}

/**
 * Pure read-only terminology lookup with explicit mode selection, language/role filters,
 * and deterministic UTF-16 code-unit sorting. Never normalizes or mutates stored expressions.
 */
export function lookupExpressions(
  snapshot: LibrarySnapshot,
  options: LookupOptions = {},
): Expression[] {
  const query = options.query ?? '';
  const mode: LookupMode = options.mode ?? 'substring';
  const language: LibraryLanguageFilter = options.language ?? 'all';
  const role: 'all' | ExpressionRole = options.role ?? 'all';

  const matched = snapshot.expressions.filter((expr) => {
    if (language === 'undetermined') {
      if (expr.language.kind !== 'undetermined') return false;
    } else if (!languageMatchesFilter(expr.language, language)) {
      return false;
    }
    if (role !== 'all' && expr.role !== role) {
      return false;
    }
    return matchesQueryByMode(expr, query, mode);
  });

  return matched.sort((a, b) => {
    const byText = compareCodeUnits(a.text, b.text);
    if (byText !== 0) return byText;
    return compareCodeUnits(a.id, b.id);
  });
}

/**
 * Finds other concepts in the snapshot that share an exact expression surface with `conceptId`
 * (e.g. homonym abbreviations like "PD"). Read-only inspection helper; never merges concepts.
 */
export function findHomonymSiblings(
  snapshot: LibrarySnapshot,
  conceptId: string,
): HomonymSibling[] {
  const ownSurfaces = new Set(
    snapshot.expressions.filter((e) => e.conceptId === conceptId).map((e) => e.text),
  );
  if (ownSurfaces.size === 0) return [];

  const seen = new Set<string>();
  const siblings: HomonymSibling[] = [];
  for (const expr of snapshot.expressions) {
    if (expr.conceptId === conceptId) continue;
    if (!ownSurfaces.has(expr.text)) continue;
    const key = `${expr.text}\u0000${expr.conceptId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    siblings.push({ sharedSurface: expr.text, conceptId: expr.conceptId });
  }

  return siblings.sort((a, b) => {
    const bySurface = compareCodeUnits(a.sharedSurface, b.sharedSurface);
    if (bySurface !== 0) return bySurface;
    return compareCodeUnits(a.conceptId, b.conceptId);
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
