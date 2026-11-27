import { describe, expect, it } from 'vitest';
import { AhoCorasickRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import {
  analyzeText,
  MAX_TEXT_UTF16_LENGTH,
  MAX_TXT_FILE_BYTES,
  S1CandidateGenerator,
  selectCandidates,
} from '@/application/extraction';
import type { NlpEngine, Token } from '@/domain/extraction';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';
import { readTxt } from '@/features/extraction/read-text';

const TS = '2026-11-26T12:00:00.000Z';

describe('unknown scientific candidate discovery and unified extraction run (B3)', () => {
  const fixtureText = 'Periodontal ligament stem cells express TNF-α.';

  // Fixed synthetic token fixture as specified in B3 Step 1
  const fixedTokens: Token[] = [
    { start: 0, end: 11, surface: 'Periodontal', pos: 'ADJ', sentenceId: 0 },
    { start: 12, end: 20, surface: 'ligament', pos: 'NOUN', sentenceId: 0 },
    { start: 21, end: 25, surface: 'stem', pos: 'NOUN', sentenceId: 0 },
    { start: 26, end: 31, surface: 'cells', pos: 'NOUN', sentenceId: 0 },
    { start: 32, end: 39, surface: 'express', pos: 'VERB', sentenceId: 0 },
    { start: 40, end: 43, surface: 'TNF', pos: 'PROPN', sentenceId: 0 },
    { start: 43, end: 44, surface: '-', pos: 'PUNCT', sentenceId: 0 },
    { start: 44, end: 45, surface: 'α', pos: 'OTHER', sentenceId: 0 },
    { start: 45, end: 46, surface: '.', pos: 'PUNCT', sentenceId: 0 },
  ];

  const fixedNlp: NlpEngine = {
    async analyze() {
      return fixedTokens;
    },
  };

  it('discovers multiword scientific noun phrases and scientific symbols on an empty library', async () => {
    const empty = createEmptySnapshot();
    const matcher = new AhoCorasickRegisteredMatcher();
    const run = await analyzeText(fixtureText, empty, fixedNlp, matcher);

    const surfaces = run.occurrences.map((o) => o.surface);
    expect(surfaces).toContain('Periodontal ligament stem cells');
    expect(surfaces).toContain('TNF-α');
    expect(surfaces).not.toContain('TNF');
    expect(run.occurrences.every((o) => fixtureText.slice(o.start, o.end) === o.surface)).toBe(true);
    expect(run.occurrences.every((o) => o.state === 'new-candidate')).toBe(true);

    // No duplicate (start, end) spans
    const spanKeys = run.occurrences.map((o) => `${o.start}:${o.end}`);
    expect(new Set(spanKeys).size).toBe(spanKeys.length);
  });

  it('does not suppress longer unknown candidates when a nested known expression matches', async () => {
    const snapshot: LibrarySnapshot = {
      ...createEmptySnapshot(),
      libraryRevision: 1,
      concepts: [{ id: 'c-pdl', revision: 0, createdAt: TS, updatedAt: TS }],
      expressions: [
        {
          id: 'e-pdl',
          conceptId: 'c-pdl',
          revision: 0,
          text: 'ligament',
          language: { kind: 'language', tag: 'en' },
          role: 'preferred',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
      provenance: [{ id: 'p1', expressionId: 'e-pdl', kind: 'manual', createdAt: TS, source: null }],
    };

    const run = await analyzeText(
      fixtureText,
      snapshot,
      fixedNlp,
      new AhoCorasickRegisteredMatcher(),
    );
    const known = selectCandidates(run, 'known-form');
    const discovered = selectCandidates(run, 'new-candidate');

    expect(known.map((o) => o.surface)).toContain('ligament');
    expect(discovered.map((o) => o.surface)).toContain('Periodontal ligament stem cells');
    expect(discovered.map((o) => o.surface)).toContain('TNF-α');
  });

  it('excludes numeric-only spans and never produces cross-sentence spans', async () => {
    const text = 'Sample 2026 cells. Bone matrix grows.';
    const tokens: Token[] = [
      { start: 0, end: 6, surface: 'Sample', pos: 'NOUN', sentenceId: 0 },
      { start: 7, end: 11, surface: '2026', pos: 'NUM', sentenceId: 0 },
      { start: 12, end: 17, surface: 'cells', pos: 'NOUN', sentenceId: 0 },
      { start: 17, end: 18, surface: '.', pos: 'PUNCT', sentenceId: 0 },
      { start: 19, end: 23, surface: 'Bone', pos: 'NOUN', sentenceId: 1 },
      { start: 24, end: 30, surface: 'matrix', pos: 'NOUN', sentenceId: 1 },
      { start: 31, end: 36, surface: 'grows', pos: 'VERB', sentenceId: 1 },
      { start: 36, end: 37, surface: '.', pos: 'PUNCT', sentenceId: 1 },
    ];
    const gen = new S1CandidateGenerator();
    const spans = await gen.generate(text, tokens);
    const surfaces = spans.map((s) => s.surface);

    expect(surfaces).not.toContain('2026');
    expect(surfaces.some((s) => s.includes('cells. Bone'))).toBe(false);
    expect(surfaces).toContain('Bone matrix');
    for (const s of spans) {
      expect(text.slice(s.start, s.end)).toBe(s.surface);
    }
  });

  it('preserves candidate output across many repeated scientific-symbol spans', async () => {
    const termCount = 40_000;
    const text = Array.from({ length: termCount }, () => 'CD4+').join(' ');
    const tokens: Token[] = Array.from({ length: termCount }, (_, index) => {
      const start = index * 5;
      return { start, end: start + 4, surface: 'CD4+', pos: 'NOUN', sentenceId: 0 };
    });
    const started = performance.now();
    const actual = await new S1CandidateGenerator().generate(text, tokens);
    const elapsedMs = performance.now() - started;

    const expected: Array<{ start: number; end: number; surface: string }> = [];
    for (let i = 0; i < tokens.length; i += 1) {
      for (let j = i; j < Math.min(tokens.length, i + 8); j += 1) {
        const start = tokens[i].start;
        const end = tokens[j].end;
        expected.push({ start, end, surface: text.slice(start, end) });
      }
    }
    expected.sort(
      (left, right) => left.start - right.start || right.end - left.end,
    );
    console.info(`Synthetic candidate generation: ${termCount} repeated symbols in ${elapsedMs.toFixed(2)} ms`);
    expect(actual).toHaveLength(319_972);
    expect(actual).toEqual(expected);
  });

  it('yields during candidate generation so cancellation can stop remaining work', async () => {
    const termCount = 4_000;
    const text = Array.from({ length: termCount }, () => 'CD4+').join(' ');
    const tokens: Token[] = Array.from({ length: termCount }, (_, index) => {
      const start = index * 5;
      return { start, end: start + 4, surface: 'CD4+', pos: 'NOUN', sentenceId: 0 };
    });
    const controller = new AbortController();
    const generate = new S1CandidateGenerator().generate.bind(new S1CandidateGenerator()) as unknown as (
      source: string,
      sourceTokens: readonly Token[],
      signal: AbortSignal,
    ) => Promise<unknown>;
    const pending = generate(text, tokens, controller.signal);
    setTimeout(() => controller.abort(), 0);

    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('enforces 2 MiB file cap, 200k UTF-16 text cap, fatal UTF-8 decoding, and cancellation without silent truncation', async () => {
    const empty = createEmptySnapshot();
    const matcher = new AhoCorasickRegisteredMatcher();

    // Oversize UTF-16 text rejected
    const tooLong = 'a'.repeat(MAX_TEXT_UTF16_LENGTH + 1);
    await expect(analyzeText(tooLong, empty, fixedNlp, matcher)).rejects.toThrow(/limit|200/i);

    // Oversize TXT file > 2 MiB rejected
    const fakeBigFile = {
      name: 'oversize.txt',
      size: MAX_TXT_FILE_BYTES + 1,
      async arrayBuffer() {
        return new ArrayBuffer(0);
      },
    };
    await expect(readTxt(fakeBigFile)).rejects.toThrow(/2 MiB|size|limit/i);

    // Invalid UTF-8 bytes rejected fatally
    const badUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
    const badFile = {
      name: 'bad.txt',
      size: badUtf8.byteLength,
      async arrayBuffer() {
        return badUtf8.buffer;
      },
    };
    await expect(readTxt(badFile)).rejects.toThrow(/UTF-8/i);

    // Valid UTF-8 TXT file decoded cleanly with Unicode preserved
    const validBytes = new TextEncoder().encode('TNF-α and CD4+');
    const validFile = {
      name: 'valid.txt',
      size: validBytes.byteLength,
      async arrayBuffer() {
        return validBytes.buffer;
      },
    };
    expect(await readTxt(validFile)).toBe('TNF-α and CD4+');

    // Aborted signal cancels analysis cleanly
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzeText(fixtureText, empty, fixedNlp, matcher, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
  });
});
