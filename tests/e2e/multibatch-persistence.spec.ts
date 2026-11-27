import path from 'node:path';
import { expect, test } from '@playwright/test';
import { build } from 'vite';

async function bundleBrowserHarness(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.resolve(process.cwd(), 'tests/browser/multibatch-persistence-harness.ts'),
        formats: ['iife'],
        name: 'TermForgeHarness',
        fileName: () => 'harness.js',
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Expected RollupOutput from Vite bundle');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing browser harness chunk');
  return chunk.code;
}

test('multi-operation applied result persists the exact validated snapshot and revisions atomically', async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ content: await bundleBrowserHarness() });
  const report = await page.evaluate(async () => {
    const fn = (window as unknown as Record<string, (db: string) => Promise<Record<string, unknown>>>)
      .__runMultiBatchPersistence;
    return fn(`termforge-multibatch-${Date.now()}`);
  });

  expect(report).toMatchObject({
    status: 'applied',
    parity: true,
    libraryRevision: 1,
    conceptRevision: 3,
    addedExpressionRevision: 2,
    assertionProtectsValue: true,
    retainedSourceCleanup: true,
    abortStatus: 'aborted',
    abortSnapshotUnchanged: true,
  });
});
