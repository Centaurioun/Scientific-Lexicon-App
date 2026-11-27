import type { BackupEnvelope, RestoreApproval } from './backup';
import type { Approval, ApplyResult, ProposedChange } from './changes';
import type { LibrarySnapshot } from './schema';

export interface LibraryRepository {
  snapshot(): Promise<LibrarySnapshot>;
  apply(proposal: ProposedChange, approval: Approval): Promise<ApplyResult>;
}

export interface RecoveryRepository extends LibraryRepository {
  restoreEmpty(backup: BackupEnvelope, approval: RestoreApproval): Promise<ApplyResult>;
}
