import { z } from 'zod';
import { canonicalJson, cloneAndFreezeJson, digest } from './changes';
import {
  LibrarySnapshotBaseSchema,
  parseLibrarySnapshot,
  Sha256HexSchema,
  UtcIsoTimestampSchema,
  type LibrarySnapshot,
} from './schema';

export const BACKUP_FORMAT = 'termforge-backup' as const;
export const BACKUP_VERSION = 1 as const;
export const MAX_BACKUP_FILE_BYTES = 16 * 1024 * 1024; // 16 MiB bounded backup parse limit

export const BackupEnvelopeSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    snapshot: LibrarySnapshotBaseSchema,
    digest: Sha256HexSchema,
  })
  .strict();

export type BackupEnvelope = z.infer<typeof BackupEnvelopeSchema>;

export const RestoreApprovalSchema = z
  .object({
    digest: Sha256HexSchema,
    actor: z.literal('local-user'),
    approvedAt: UtcIsoTimestampSchema,
  })
  .strict();

export type RestoreApproval = z.infer<typeof RestoreApprovalSchema>;

export function parseRestoreApproval(input: unknown): RestoreApproval {
  canonicalJson(input);
  return RestoreApprovalSchema.parse(input);
}

export async function createBackup(snapshot: LibrarySnapshot): Promise<BackupEnvelope> {
  const validatedSnapshot = parseLibrarySnapshot(snapshot);
  const frozenSnapshot = cloneAndFreezeJson(validatedSnapshot);
  const snapshotDigest = await digest(frozenSnapshot);
  return Object.freeze({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    snapshot: frozenSnapshot,
    digest: snapshotDigest,
  });
}

export async function validateBackup(input: unknown): Promise<BackupEnvelope> {
  // Enforce strict JSON-safety before schema parsing
  canonicalJson(input);

  const envelope = BackupEnvelopeSchema.parse(input);
  const validatedSnapshot = parseLibrarySnapshot(envelope.snapshot);
  const recomputedDigest = await digest(validatedSnapshot);

  if (recomputedDigest !== envelope.digest) {
    throw new Error(
      `Backup SHA-256 digest mismatch: expected ${envelope.digest}, computed ${recomputedDigest}.`,
    );
  }

  return cloneAndFreezeJson({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    snapshot: validatedSnapshot,
    digest: recomputedDigest,
  });
}

export async function parseBackupFileText(rawText: string): Promise<BackupEnvelope> {
  const bytes = new TextEncoder().encode(rawText).byteLength;
  if (bytes > MAX_BACKUP_FILE_BYTES) {
    throw new Error(
      `Backup file exceeds the ${(MAX_BACKUP_FILE_BYTES / (1024 * 1024)).toFixed(0)} MiB maximum parse limit.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `Backup file is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}.`,
    );
  }

  return validateBackup(parsed);
}
