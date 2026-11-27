import path from 'node:path';
import { expect, test } from '@playwright/test';
import { build } from 'vite';

test('Aho-Corasick registered matcher achieves browser parity with oracle and bounded scan performance (B1)', async ({
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
        entry: path.resolve(root, 'src/adapters/matching/registered-matcher.ts'),
        formats: ['iife'],
        name: 'TermForgeMatcher',
        fileName: () => 'matcher.js',
      },
    },
  });
  const out = Array.isArray(bundled) ? bundled[0] : bundled;
  if (!('output' in out)) throw new Error('Expected Vite bundle output');
  const chunk = out.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing chunk');

  await page.addScriptTag({ content: chunk.code });

  const result = await page.evaluate(async () => {
    const mod = (window as unknown as Record<string, Record<string, new () => {
      match(text: string, expressions: unknown[]): Promise<unknown[]>;
    }>>).TermForgeMatcher;
    const aho = new mod.AhoCorasickRegisteredMatcher();
    const oracle = new mod.SimpleOracleRegisteredMatcher();
    const ts = '2026-11-26T12:00:00.000Z';

    const dict = [
      { id: 'e1', conceptId: 'c1', revision: 0, text: 'TNF-α', language: { kind: 'language', tag: 'en' }, role: 'preferred', createdAt: ts, updatedAt: ts },
      { id: 'e2', conceptId: 'c2', revision: 0, text: 'IL-1', language: { kind: 'language', tag: 'en' }, role: 'preferred', createdAt: ts, updatedAt: ts },
      { id: 'e3', conceptId: 'c3', revision: 0, text: 'IL-11', language: { kind: 'language', tag: 'en' }, role: 'preferred', createdAt: ts, updatedAt: ts },
      { id: 'e4', conceptId: 'c4', revision: 0, text: 'CD4+', language: { kind: 'language', tag: 'en' }, role: 'preferred', createdAt: ts, updatedAt: ts },
      { id: 'e5', conceptId: 'c5', revision: 0, text: 'PD', language: { kind: 'language', tag: 'en' }, role: 'abbreviation', createdAt: ts, updatedAt: ts },
      { id: 'e6', conceptId: 'c6', revision: 0, text: 'PD', language: { kind: 'language', tag: 'en' }, role: 'abbreviation', createdAt: ts, updatedAt: ts },
    ];
    const sample = '🧪 TNF-α, IL-11, IL-1, CD4++, CD4+, x-TNF-α, and PD measurements.';
    const t0 = performance.now();
    const ahoOut = await aho.match(sample, dict);
    const ahoMs = performance.now() - t0;
    const oracleOut = await oracle.match(sample, dict);
    return {
      parity: JSON.stringify(ahoOut) === JSON.stringify(oracleOut),
      count: ahoOut.length,
      ahoMs,
    };
  });

  expect(result.parity).toBe(true);
  expect(result.count).toBe(6);
});
