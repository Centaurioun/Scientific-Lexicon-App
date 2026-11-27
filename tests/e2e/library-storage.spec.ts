import path from 'node:path';
import { expect, test } from '@playwright/test';
import { build } from 'vite';

async function bundleBrowserHarness(entryRelativePath: string): Promise<string> {
  const root = process.cwd();
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: {
        '@': path.resolve(root, 'src'),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.resolve(root, entryRelativePath),
        formats: ['iife'],
        name: 'TermForgeHarness',
        fileName: () => 'harness.js',
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) {
    throw new Error('Expected RollupOutput from Vite bundle');
  }
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') {
    throw new Error('Missing JS chunk in bundled browser harness');
  }
  return chunk.code;
}

test('Dexie repository enforces all atomic transaction and integrity invariants in real browser IndexedDB (A4)', async ({
  page,
}) => {
  await page.goto('/');
  const code = await bundleBrowserHarness('tests/browser/storage-harness.ts');
  await page.addScriptTag({ content: code });

  const report = await page.evaluate(async () => {
    const fn = (window as unknown as Record<string, (db: string) => Promise<Record<string, unknown>>>)
      .__runDexieStorageInvariants;
    return fn(`termforge-test-a4-${Date.now()}`);
  });

  expect(report).toMatchObject({
    emptyRevision: 0,
    afterCreateRevision: 1,
    formCountAfterAdd: 2,
    pdConceptCount: 2,
    orphanStatus: 'invalid',
    duplicateIdStatus: 'conflict',
    replayStatus: 'replay',
    replayRevision: 1,
    conflictStatus: 'conflict',
    staleStatus: 'stale',
    duplicateOpStatus: 'conflict',
    protectedTextStatus: 'protected',
    protectedLanguageStatus: 'protected',
    abortedStatus: 'aborted',
    snapshotUnchangedAfterAbort: true,
    twoConnectionStaleStatus: 'stale',
  });
});
