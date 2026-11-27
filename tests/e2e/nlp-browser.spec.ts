import path from 'node:path';
import { expect, test } from '@playwright/test';
import { build } from 'vite';

test('Wink NLP adapter runs locally in browser with exact UTF-16 spans and zero external model downloads (B2)', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:3100') && !url.startsWith('http://localhost:')) {
      externalRequests.push(url);
    }
  });

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
        entry: path.resolve(root, 'src/adapters/nlp/wink-engine.ts'),
        formats: ['iife'],
        name: 'TermForgeNlp',
        fileName: () => 'nlp.js',
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
      analyze(text: string): Promise<Array<{ start: number; end: number; surface: string; sentenceId: number }>>;
    }>>).TermForgeNlp;
    const engine = new mod.WinkNlpEngine();
    const sample = '🧪 TNF-α and NF-κB act on CD4+ cells. İltihap ve ısı observed.';
    const tokens = await engine.analyze(sample);
    const exactMatch = tokens.every((t) => sample.slice(t.start, t.end) === t.surface);
    const sentences = new Set(tokens.map((t) => t.sentenceId)).size;
    return { count: tokens.length, exactMatch, sentences };
  });

  expect(result.count).toBeGreaterThan(8);
  expect(result.exactMatch).toBe(true);
  expect(result.sentences).toBeGreaterThanOrEqual(2);
  expect(externalRequests).toEqual([]);
});
