import path from 'node:path';
import { expect, test } from '@playwright/test';
import { build } from 'vite';

test('atomic empty-target restore enforces all integrity, rollback, concurrency, and cache invalidation invariants in browser IndexedDB (C3)', async ({
  page,
}) => {
  await page.goto('/');

  const root = process.cwd();
  const bundled = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@': path.resolve(root, 'src') } },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.resolve(root, 'tests/browser/restore-harness.ts'),
        formats: ['iife'],
        name: 'TermForgeRestore',
        fileName: () => 'restore.js',
      },
    },
  });
  const out = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in out)) throw new Error('Expected Vite bundle output');
  const chunk = out.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing chunk');

  await page.addScriptTag({ content: chunk.code });

  const report = await page.evaluate(async () => {
    const fn = (window as unknown as Record<string, (p: string) => Promise<Record<string, unknown>>>)
      .__runRestoreInvariants;
    return fn(`termforge-c3-${Date.now()}`);
  });

  expect(report).toEqual({
    exactSnapshotMatch: true,
    nonEmptyRestoreStatus: 'conflict',
    wrongApprovalStatus: 'invalid',
    abortRestoreStatus: 'aborted',
    targetStillEmptyAfterAbort: true,
    concurrentSuccessCount: 1,
    concurrentConflictCount: 1,
    concurrentEmptyBackupSuccessCount: 1,
    concurrentEmptyBackupConflictCount: 1,
    emptyBackupStateIntact: true,
    corruptedMetadataStatus: 'invalid',
    corruptedMetadataPreserved: true,
    matcherInvalidatedAfterRestore: true,
  });
});
