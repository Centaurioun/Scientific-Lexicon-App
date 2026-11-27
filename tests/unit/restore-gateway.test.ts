import { describe, expect, it, vi } from 'vitest';
import { approveRestore, restoreEmptyLibrary } from '@/application/library';
import { createBackup } from '@/domain/backup';
import type { RecoveryRepository } from '@/domain/repository';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

const TS = '2026-11-26T12:00:00.000Z';

describe('controlled restore gateway (C3)', () => {
  const snap: LibrarySnapshot = {
    ...createEmptySnapshot(),
    libraryRevision: 1,
    concepts: [{ id: 'c1', revision: 0, createdAt: TS, updatedAt: TS }],
    expressions: [
      {
        id: 'e1',
        conceptId: 'c1',
        revision: 0,
        text: 'TNF-α',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    provenance: [{ id: 'p1', expressionId: 'e1', kind: 'manual', createdAt: TS, source: null }],
  };

  it('rejects wrong approval digest and tampered backup before invoking repository', async () => {
    const backup = await createBackup(snap);
    const approval = approveRestore(backup);
    const restoreSpy = vi.fn(async () => ({ status: 'applied' as const, revision: 1 }));
    const fakeRepo: RecoveryRepository = {
      snapshot: async () => createEmptySnapshot(),
      apply: async () => ({ status: 'invalid', reason: 'unused' }),
      restoreEmpty: restoreSpy,
    };

    const badDigest = await restoreEmptyLibrary(fakeRepo, backup, {
      ...approval,
      digest: '0'.repeat(64),
    });
    expect(badDigest.status).toBe('invalid');
    expect(restoreSpy).not.toHaveBeenCalled();

    const tampered = {
      ...backup,
      snapshot: { ...backup.snapshot, libraryRevision: 99 },
    };
    const badBackup = await restoreEmptyLibrary(fakeRepo, tampered, approval);
    expect(badBackup.status).toBe('invalid');
    expect(restoreSpy).not.toHaveBeenCalled();

    const ok = await restoreEmptyLibrary(fakeRepo, backup, approval);
    expect(ok).toEqual({ status: 'applied', revision: 1 });
    expect(restoreSpy).toHaveBeenCalledTimes(1);
  });
});
