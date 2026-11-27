import { describe, expect, it } from 'vitest';
import { AhoCorasickRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import {
  analyzeText,
  MAX_TEXT_UTF16_LENGTH,
  MAX_TXT_FILE_BYTES,
  S1CandidateGenerator,
  selectCandidates,
  validateInputText,
} from '@/application/extraction';
import type { NlpEngine, Token } from '@/domain/extraction';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';
import { readTxt } from '@/features/extraction/read-text';
import {
  DEFAULT_PROCESSING_LIMITS,
  OccurrenceLimitExceededError,
  OccurrenceLimitTracker,
} from '@/domain/processing-limits';

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

  it('measures bounded generation at the minimum, default, and hard candidate limits', async () => {
    const measurements: Array<{ limit: number; elapsedMs: number }> = [];
    for (const limit of [100, 5_000, 10_000]) {
      const text = 'CD4+. '.repeat(limit);
      const tokens: Token[] = Array.from({ length: limit }, (_, index) => ({
        start: index * 6,
        end: index * 6 + 4,
        surface: 'CD4+',
        pos: 'NOUN',
        sentenceId: index,
      }));
      const started = performance.now();
      const actual = await new S1CandidateGenerator().generate(text, tokens, {
        occurrenceTracker: new OccurrenceLimitTracker(limit),
      });
      measurements.push({ limit, elapsedMs: performance.now() - started });
      expect(actual).toHaveLength(limit);
      expect(actual[0].surface).toBe('CD4+');
      expect(actual.at(-1)?.surface).toBe('CD4+');
    }
    console.info(`Synthetic candidate generation by configured limit: ${JSON.stringify(measurements)}`);
  });

  it('yields during candidate generation so cancellation can stop remaining work', async () => {
    const termCount = 4_000;
    const text = Array.from({ length: termCount }, () => 'CD4+').join(' ');
    const tokens: Token[] = Array.from({ length: termCount }, (_, index) => {
      const start = index * 5;
      return { start, end: start + 4, surface: 'CD4+', pos: 'NOUN', sentenceId: 0 };
    });
    const controller = new AbortController();
    const pending = new S1CandidateGenerator().generate(text, tokens, { signal: controller.signal });
    setTimeout(() => controller.abort(), 0);

    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects below, at, and above configured text and TXT byte limits exactly', async () => {
    const textLimits = { ...DEFAULT_PROCESSING_LIMITS, maxTextUtf16CodeUnits: 3 };
    expect(() => validateInputText('abc', textLimits)).not.toThrow();
    expect(() => validateInputText('abcd', textLimits)).toThrow(/3 UTF-16/);
    expect(() => validateInputText('ab', textLimits)).not.toThrow();

    let readCount = 0;
    const exactFile = {
      name: 'exact.txt',
      size: 2,
      async arrayBuffer() {
        readCount += 1;
        return new TextEncoder().encode('ab').buffer;
      },
    };
    const smallFileLimits = { ...DEFAULT_PROCESSING_LIMITS, maxTxtInputBytes: 2, maxTextUtf16CodeUnits: 2 };
    expect(await readTxt(exactFile, smallFileLimits)).toBe('ab');
    expect(readCount).toBe(1);
    const oversizedFile = { ...exactFile, size: 3 };
    await expect(readTxt(oversizedFile, smallFileLimits)).rejects.toThrow(/2 byte/);
    expect(readCount).toBe(1); // size rejected before file contents are read
  });

  it('enforces distinct occurrence bounds below, exactly at, and above the configured cap', async () => {
    const makeInput = (count: number) => {
      const text = 'CD4+. '.repeat(count);
      const tokens: Token[] = Array.from({ length: count }, (_, index) => ({
        start: index * 6,
        end: index * 6 + 4,
        surface: 'CD4+',
        pos: 'NOUN',
        sentenceId: index,
      }));
      return { text, tokens };
    };
    const generator = new S1CandidateGenerator();
    const limit = 100;

    const below = makeInput(limit - 1);
    expect((await generator.generate(below.text, below.tokens, { occurrenceTracker: new OccurrenceLimitTracker(limit) }))).toHaveLength(limit - 1);

    const exact = makeInput(limit);
    expect((await generator.generate(exact.text, exact.tokens, { occurrenceTracker: new OccurrenceLimitTracker(limit) }))).toHaveLength(limit);

    const above = makeInput(limit + 1);
    const tracker = new OccurrenceLimitTracker(limit);
    await expect(generator.generate(above.text, above.tokens, { occurrenceTracker: tracker })).rejects.toBeInstanceOf(
      OccurrenceLimitExceededError,
    );
    expect(tracker.count).toBe(limit); // stopped on the next distinct span
  });

  it('deduplicates known/unknown emissions while retaining nested and ambiguous spans in a combined budget', async () => {
    const tracker = new OccurrenceLimitTracker(2);
    const pd = await new AhoCorasickRegisteredMatcher().match(
      'PD. TNF-α.',
      [
        { id: 'e-pd1', conceptId: 'c1', revision: 0, text: 'PD', language: { kind: 'language', tag: 'en' }, role: 'preferred', createdAt: TS, updatedAt: TS },
        { id: 'e-pd2', conceptId: 'c2', revision: 0, text: 'PD', language: { kind: 'language', tag: 'en' }, role: 'abbreviation', createdAt: TS, updatedAt: TS },
      ],
      { occurrenceTracker: tracker },
    );
    expect(pd).toHaveLength(1);
    expect(pd[0].state).toBe('ambiguous');
    expect(pd[0].conceptIds).toEqual(['c1', 'c2']);

    const text = 'PD. TNF-α.';
    const tokens: Token[] = [
      { start: 0, end: 2, surface: 'PD', pos: 'NOUN', sentenceId: 0 },
      { start: 2, end: 3, surface: '.', pos: 'PUNCT', sentenceId: 0 },
      { start: 4, end: 7, surface: 'TNF', pos: 'PROPN', sentenceId: 1 },
      { start: 7, end: 8, surface: '-', pos: 'PUNCT', sentenceId: 1 },
      { start: 8, end: 9, surface: 'α', pos: 'OTHER', sentenceId: 1 },
      { start: 9, end: 10, surface: '.', pos: 'PUNCT', sentenceId: 1 },
    ];
    const unknown = await new S1CandidateGenerator().generate(text, tokens, { occurrenceTracker: tracker });
    expect(unknown.map((span) => span.surface)).toEqual(['PD', 'TNF-α']);
    expect(tracker.count).toBe(2); // duplicate PD counted once, TNF-α is a distinct span
  });

  it('applies one configured cap to grouped known and unknown spans in the unified run', async () => {
    const pdExpressions = [
      { id: 'e-pd1', conceptId: 'c1', revision: 0, text: 'PD', language: { kind: 'language' as const, tag: 'en' as const }, role: 'preferred' as const, createdAt: TS, updatedAt: TS },
      { id: 'e-pd2', conceptId: 'c2', revision: 0, text: 'PD', language: { kind: 'language' as const, tag: 'en' as const }, role: 'abbreviation' as const, createdAt: TS, updatedAt: TS },
    ];
    const snapshot = { ...createEmptySnapshot(), libraryRevision: 1, expressions: pdExpressions } as LibrarySnapshot;
    const nlp: NlpEngine = {
      async analyze(text) {
        const tokens: Token[] = [];
        for (let start = 0, sentenceId = 0; start < text.length; sentenceId += 1) {
          const pdStart = text.indexOf('PD', start);
          const cdStart = text.indexOf('CD4+', start);
          const found = [pdStart, cdStart].filter((value) => value >= 0).sort((a, b) => a - b)[0];
          if (found === undefined) break;
          const surface = text.startsWith('PD', found) ? 'PD' : 'CD4+';
          tokens.push({ start: found, end: found + surface.length, surface, pos: 'NOUN', sentenceId });
          start = found + surface.length + 2;
        }
        return tokens;
      },
    };
    const limits = { ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 100 };
    const exactlyAtLimit = await analyzeText('PD. CD4+.', snapshot, nlp, new AhoCorasickRegisteredMatcher(), { limits });
    expect(exactlyAtLimit.occurrences).toHaveLength(2);
    expect(exactlyAtLimit.occurrences.find((item) => item.surface === 'PD')?.state).toBe('ambiguous');
    expect(exactlyAtLimit.occurrences.find((item) => item.surface === 'CD4+')?.state).toBe('new-candidate');

    await expect(
      analyzeText('PD. CD4+. '.repeat(51), snapshot, nlp, new AhoCorasickRegisteredMatcher(), { limits }),
    ).rejects.toBeInstanceOf(OccurrenceLimitExceededError);
  });

  it('stops over-limit registered matching before invoking NLP', async () => {
    let nlpCallCount = 0;
    const nlp: NlpEngine = {
      async analyze() {
        nlpCallCount += 1;
        return [];
      },
    };
    const expression = {
      id: 'e-pd',
      conceptId: 'c-pd',
      revision: 0,
      text: 'PD',
      language: { kind: 'language' as const, tag: 'en' as const },
      role: 'preferred' as const,
      createdAt: TS,
      updatedAt: TS,
    };
    const snapshot = { ...createEmptySnapshot(), expressions: [expression] } as LibrarySnapshot;
    const limits = { ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 100 };
    await expect(
      analyzeText('PD. '.repeat(101), snapshot, nlp, new AhoCorasickRegisteredMatcher(), { limits }),
    ).rejects.toBeInstanceOf(OccurrenceLimitExceededError);
    expect(nlpCallCount).toBe(0);
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
