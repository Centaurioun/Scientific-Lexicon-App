import { describe, expect, it } from 'vitest';
import {
  AHOCORASICK_TABLE_ADAPTER_VERSION,
  AhoCorasickRegisteredMatcher,
  assertCompatibleAutomatonShape,
  AutomatonShapeError,
  SimpleOracleRegisteredMatcher,
} from '@/adapters/matching/registered-matcher';
import {
  BrowserLocalNlpEngine,
  LARGE_INPUT_WORKER_REQUIRED_CHARS,
  WinkNlpEngine,
  WorkerUnavailableForLargeInputError,
} from '@/adapters/nlp/wink-engine';
import { analyzeText, type ExtractionStageTimings } from '@/application/extraction';
import {
  DEFAULT_PROCESSING_LIMITS,
  MAX_CANDIDATE_OCCURRENCES,
  OccurrenceLimitExceededError,
} from '@/domain/processing-limits';
import { createEmptySnapshot, type Expression, type LibrarySnapshot } from '@/domain/schema';

function makeExpression(id: string, conceptId: string, text: string): Expression {
  const now = '2026-11-27T00:00:00Z';
  return {
    id,
    conceptId,
    revision: 1,
    text,
    language: { kind: 'shared' },
    role: 'preferred',
    createdAt: now,
    updatedAt: now,
  };
}

describe('D7: Performance, automaton guard, worker fallback guard, and cancellation hardening', () => {
  it('validates pinned Aho-Corasick internal table shape and fails closed on incompatible shapes', () => {
    expect(AHOCORASICK_TABLE_ADAPTER_VERSION).toBe('ahocorasick-1.0.2-tables-v1');
    expect(() => assertCompatibleAutomatonShape(null)).toThrow(AutomatonShapeError);
    expect(() => assertCompatibleAutomatonShape({})).toThrow(AutomatonShapeError);
    expect(() =>
      assertCompatibleAutomatonShape({ gotoFn: {}, failure: {}, output: {} }),
    ).toThrow(AutomatonShapeError);
    expect(() =>
      assertCompatibleAutomatonShape({ gotoFn: { 0: {} }, failure: {}, output: {} }),
    ).not.toThrow();
  });

  it('maintains exact parity between AhoCorasickRegisteredMatcher and SimpleOracleRegisteredMatcher', async () => {
    const expressions = [
      makeExpression('e-1', 'c-1', 'TNF-α'),
      makeExpression('e-2', 'c-2', 'HLA-B'),
      makeExpression('e-3', 'c-3', 'HLA-B27'),
      makeExpression('e-4', 'c-4', 'PD'),
      makeExpression('e-5', 'c-5', 'PD'),
      makeExpression('e-6', 'c-6', 'İstanbul'),
    ];
    const text =
      'TNF-α, x-TNF-α, HLA-B, HLA-B27, PD, and İstanbul appeared alongside non-matching TNF-α2.';

    const ac = new AhoCorasickRegisteredMatcher();
    const oracle = new SimpleOracleRegisteredMatcher();
    const [acResult, oracleResult] = await Promise.all([
      ac.match(text, expressions),
      oracle.match(text, expressions),
    ]);
    expect(acResult).toEqual(oracleResult);
  });

  it('bounds 5,000 and 10,000 occurrence workloads cleanly and rejects limit + 1 with zero partial results', async () => {
    const matcher = new AhoCorasickRegisteredMatcher();
    const expr = makeExpression('e-tok', 'c-tok', 'IL-11');
    // 5,000 distinct occurrences
    const text5k = Array.from({ length: 5_000 }, () => 'IL-11').join(' ');
    const snapshot: LibrarySnapshot = {
      ...createEmptySnapshot(),
      libraryRevision: 1,
      concepts: [{ id: 'c-tok', revision: 1, createdAt: '2026-11-27T00:00:00Z', updatedAt: '2026-11-27T00:00:00Z' }],
      expressions: [expr],
    };

    const timings: ExtractionStageTimings[] = [];
    const fastNlp = { async analyze() { return []; } };
    const run5k = await analyzeText(text5k, snapshot, fastNlp, matcher, {
      grammarMode: 's2-grammar-2',
      limits: { ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 5_000 },
      onStageTimings: (t) => timings.push(t),
    });

    expect(run5k.occurrences).toHaveLength(5_000);
    expect(timings).toHaveLength(1);
    expect(timings[0].totalMs).toBeGreaterThanOrEqual(0);

    // 5,001 exceeds 5,000 limit cleanly
    const text5001 = `${text5k} IL-11`;
    await expect(
      analyzeText(text5001, snapshot, fastNlp, matcher, {
        grammarMode: 's2-grammar-2',
        limits: { ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: 5_000 },
      }),
    ).rejects.toThrow(OccurrenceLimitExceededError);

    // 10,000 passes at hard ceiling
    const text10k = Array.from({ length: MAX_CANDIDATE_OCCURRENCES }, () => 'IL-11').join(' ');
    const run10k = await analyzeText(text10k, snapshot, fastNlp, matcher, {
      grammarMode: 's2-grammar-2',
      limits: { ...DEFAULT_PROCESSING_LIMITS, maxCandidateOccurrences: MAX_CANDIDATE_OCCURRENCES },
    });
    expect(run10k.occurrences).toHaveLength(MAX_CANDIDATE_OCCURRENCES);
  });

  it('aborts cleanly mid-pipeline when AbortSignal triggers without returning partial results', async () => {
    const matcher = new AhoCorasickRegisteredMatcher();
    const nlp = new WinkNlpEngine();
    const text = Array.from({ length: 400 }, () => 'Periodontal ligament-derived stem cells express TNF-α.').join(' ');
    const controller = new AbortController();

    const promise = analyzeText(text, createEmptySnapshot(), nlp, matcher, {
      grammarMode: 's2-grammar-2',
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toThrow(/aborted/i);
  });

  it('refuses silent synchronous main-thread fallback on large browser inputs when Worker is unavailable', async () => {
    const engine = new BrowserLocalNlpEngine({
      requireWorkerAboveChars: LARGE_INPUT_WORKER_REQUIRED_CHARS,
      simulateBrowserWithoutWorker: true,
    });

    const largeText = 'Periodontal ligament '.repeat(
      Math.ceil((LARGE_INPUT_WORKER_REQUIRED_CHARS + 500) / 'Periodontal ligament '.length),
    );
    await expect(engine.analyze(largeText)).rejects.toThrow(WorkerUnavailableForLargeInputError);

    // Small inputs still work cleanly when fallback is allowed
    const smallTokens = await engine.analyze('TNF-α regulates inflammation.');
    expect(smallTokens.length).toBeGreaterThan(0);
  });
});
