import { describe, expect, it } from 'vitest';
import {
  OffsetReconstructionError,
  reconstructTokenSpans,
  WinkNlpEngine,
} from '@/adapters/nlp/wink-engine';

describe('local English NLP adapter (B2)', () => {
  const engine = new WinkNlpEngine();

  it('reconstructs exact monotonic UTF-16 offsets and sentence separation across scientific symbols, Greek, emoji, and Turkish text', async () => {
    const text =
      '🧪 Periodontal ligament stem cells express TNF-α and NF-κB. CD4+ T cells track İltihap ve ısı.';
    const tokens = await engine.analyze(text);

    expect(tokens.length).toBeGreaterThan(10);

    let prevEnd = 0;
    const sentenceIds = new Set<number>();
    for (const token of tokens) {
      expect(token.end).toBeGreaterThan(token.start);
      expect(token.start).toBeGreaterThanOrEqual(prevEnd);
      expect(text.slice(token.start, token.end)).toBe(token.surface);
      prevEnd = token.end;
      sentenceIds.add(token.sentenceId);
    }

    expect(sentenceIds.size).toBeGreaterThanOrEqual(2);
    expect(tokens.some((t) => t.surface.includes('α'))).toBe(true);
    expect(tokens.some((t) => t.surface.includes('κ'))).toBe(true);
    expect(tokens.some((t) => t.surface.includes('İltihap'))).toBe(true);
    expect(tokens.some((t) => t.surface.includes('ısı'))).toBe(true);
    expect(tokens.some((t) => t.surface === '+')).toBe(true);
  });

  it('handles empty or whitespace-only input cleanly', async () => {
    expect(await engine.analyze('')).toEqual([]);
    expect(await engine.analyze('   \n\t  ')).toEqual([]);
  });

  it('fails explicitly when exact source offsets cannot be reconstructed', () => {
    expect(() =>
      reconstructTokenSpans('TNF-α expression', [
        { value: 'FABRICATED', pos: 'NOUN', sentenceId: 0, precedingSpaces: '' },
      ]),
    ).toThrow(OffsetReconstructionError);

    expect(() =>
      reconstructTokenSpans('Alpha Beta Gamma', [
        { value: 'Alpha', pos: 'NOUN', sentenceId: 0, precedingSpaces: '' },
        { value: 'Gamma', pos: 'NOUN', sentenceId: 0, precedingSpaces: ' ' },
      ]),
    ).toThrow(OffsetReconstructionError);
  });
});
