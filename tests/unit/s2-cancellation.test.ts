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

  it('propagates AbortSignal into NlpEngine.analyze during analyzeText', async () => {
    const matcher = new AhoCorasickRegisteredMatcher();
    const receivedSignals: Array<AbortSignal | undefined> = [];
    const spyingNlp = {
      async analyze(_text: string, signal?: AbortSignal) {
        receivedSignals.push(signal);
        return [];
      },
    };
    const controller = new AbortController();
    await analyzeText('TNF-α expression.', createEmptySnapshot(), spyingNlp, matcher, {
      signal: controller.signal,
    });
    expect(receivedSignals).toHaveLength(1);
    expect(receivedSignals[0]).toBe(controller.signal);
  });

  it('handles concurrent worker requests, single-request abort re-dispatch, stale IDs, and zero listener leaks', async () => {
    class MockWorker {
      readonly posted: Array<{ id: number; text: string }> = [];
      readonly listeners = new Map<string, Set<(event: unknown) => void>>();
      terminated = false;
      throwOnPostMessage = false;

      addEventListener(type: string, listener: (event: unknown) => void) {
        let set = this.listeners.get(type);
        if (!set) {
          set = new Set();
          this.listeners.set(type, set);
        }
        set.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void) {
        this.listeners.get(type)?.delete(listener);
      }

      postMessage(msg: { id: number; text: string }) {
        if (this.throwOnPostMessage) {
          throw new Error('postMessage clone failure');
        }
        this.posted.push(msg);
      }

      terminate() {
        this.terminated = true;
      }

      emit(type: string, event: unknown) {
        for (const fn of [...(this.listeners.get(type) ?? [])]) {
          fn(event);
        }
      }

      listenerCount(): number {
        let total = 0;
        for (const set of this.listeners.values()) total += set.size;
        return total;
      }
    }

    const createdWorkers: MockWorker[] = [];
    const engine = new BrowserLocalNlpEngine({
      requireWorkerAboveChars: 50,
      workerFactory: () => {
        const w = new MockWorker();
        createdWorkers.push(w);
        return w as unknown as Worker;
      },
    });

    // 1. Concurrent requests: aborting req1 terminates worker1 and re-dispatches req2 to worker2
    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = engine.analyze('First alpha sentence.', c1.signal);
    const p2 = engine.analyze('Second beta sentence.', c2.signal);

    expect(createdWorkers).toHaveLength(1);
    expect(createdWorkers[0].posted).toHaveLength(2);
    const req2Id = createdWorkers[0].posted[1].id;

    c1.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    expect(createdWorkers[0].terminated).toBe(true);
    expect(createdWorkers[0].listenerCount()).toBe(0);

    // req2 must be re-dispatched onto a fresh worker and settle cleanly
    expect(createdWorkers).toHaveLength(2);
    expect(createdWorkers[1].posted).toHaveLength(1);
    expect(createdWorkers[1].posted[0].id).toBe(req2Id);

    // Stale message ID is ignored without crashing or settling req2
    createdWorkers[1].emit('message', {
      data: { id: 999_999, ok: true, tokens: [] },
    });

    const expectedToken = {
      start: 0,
      end: 6,
      surface: 'Second',
      pos: 'ADJ' as const,
      sentenceId: 0,
    };
    createdWorkers[1].emit('message', {
      data: { id: req2Id, ok: true, tokens: [expectedToken] },
    });
    await expect(p2).resolves.toEqual([expectedToken]);

    // 2. terminate() settles all pending requests and cleans up listeners
    const p3 = engine.analyze('Third gamma sentence.');
    engine.terminate();
    await expect(p3).rejects.toMatchObject({ name: 'AbortError' });
    expect(createdWorkers[1].terminated).toBe(true);
    expect(createdWorkers[1].listenerCount()).toBe(0);

    // 3. Large input fails closed on worker runtime error & messageerror without main-thread fallback
    const largeInput = 'Periodontal ligament cells '.repeat(5); // > 50 chars
    const p4 = engine.analyze(largeInput);
    const worker3 = createdWorkers[2];
    worker3.emit('error', new Event('error'));
    await expect(p4).rejects.toThrow(WorkerUnavailableForLargeInputError);
    expect(worker3.terminated).toBe(true);
    expect(worker3.listenerCount()).toBe(0);

    const p5 = engine.analyze(largeInput);
    const worker4 = createdWorkers[3];
    worker4.emit('messageerror', new Event('messageerror'));
    await expect(p5).rejects.toThrow(/Worker|deserialization|unavailable/i);
    expect(worker4.terminated).toBe(true);
    expect(worker4.listenerCount()).toBe(0);

    // 4. Synchronous postMessage throw cleans up and fails closed on large input
    const p6 = engine.analyze('Warm worker.');
    const worker5 = createdWorkers[4];
    worker5.emit('message', {
      data: { id: worker5.posted[0].id, ok: true, tokens: [] },
    });
    await expect(p6).resolves.toEqual([]);
    worker5.throwOnPostMessage = true;
    await expect(engine.analyze(largeInput)).rejects.toThrow(WorkerUnavailableForLargeInputError);
    expect(worker5.listenerCount()).toBe(0);
  });

  it('measures stage breakdown (match/nlp/gen/lookup/rank) across bounded library sizes, concept multiplicity, homonyms, long forms, and dense pack hints', async () => {
    const { rankCandidates } = await import('@/application/ranking');
    const { SYNTHETIC_DICTIONARY_FIXTURE_PAYLOADS } = await import('@/domain/synthetic-dictionary-manifest');
    const matcher = new AhoCorasickRegisteredMatcher();
    const nlp = new WinkNlpEngine();
    const now = '2026-11-27T00:00:00Z';

    const buildLibrary = (conceptCount: number): LibrarySnapshot => {
      const concepts = [];
      const expressions: Expression[] = [];
      for (let i = 0; i < conceptCount; i += 1) {
        const cid = `c-lib-${i}`;
        concepts.push({ id: cid, revision: 1, createdAt: now, updatedAt: now });
        expressions.push(makeExpression(`e-lib-${i}-a`, cid, `SynthMarker-${i}`));
        expressions.push(makeExpression(`e-lib-${i}-b`, cid, `synthetic periodontal marker complex ${i}`));
      }
      // Concept multiplicity + homonym PD + long valid form
      concepts.push({ id: 'c-hom-1', revision: 1, createdAt: now, updatedAt: now });
      concepts.push({ id: 'c-hom-2', revision: 1, createdAt: now, updatedAt: now });
      expressions.push(makeExpression('e-hom-1', 'c-hom-1', 'PD'));
      expressions.push(makeExpression('e-hom-2', 'c-hom-2', 'PD'));
      expressions.push(
        makeExpression(
          'e-long-1',
          'c-hom-1',
          'human periodontal ligament-derived mesenchymal stem cell population',
        ),
      );
      return {
        ...createEmptySnapshot(),
        libraryRevision: conceptCount,
        concepts,
        expressions,
      };
    };

    const unit =
      'SynthMarker-1 and human periodontal ligament-derived mesenchymal stem cell population interacted with Na+/K+-ATPase, periodontal ligament, and PD in chronic inflammation. ';
    const corpus = unit.repeat(25); // ~4,200 UTF-16 chars
    const pack = SYNTHETIC_DICTIONARY_FIXTURE_PAYLOADS['pack-synth-bio-v1'];

    const measurements: Record<string, unknown> = {};
    for (const size of [50, 250]) {
      const snap = buildLibrary(size);
      const timings: ExtractionStageTimings[] = [];
      const run = await analyzeText(corpus, snap, nlp, matcher, {
        grammarMode: 's2-grammar-2',
        dictionaryPack: pack,
        useDictionaryPackAsDiscoveryHints: true,
        onStageTimings: (t) => timings.push(t),
      });
      const rankStart = performance.now();
      const ranked = rankCandidates(run.occurrences, 'c-value', run.tokens);
      const rankMs = performance.now() - rankStart;

      expect(run.occurrences.some((o) => o.surface === 'PD' && o.state === 'ambiguous')).toBe(true);
      expect(
        run.occurrences.some(
          (o) =>
            o.surface === 'human periodontal ligament-derived mesenchymal stem cell population' &&
            o.state === 'known-form',
        ),
      ).toBe(true);
      expect(ranked.length).toBeGreaterThan(0);

      measurements[`concepts_${size}_exprs_${snap.expressions.length}`] = {
        occurrences: run.occurrences.length,
        rankedGroups: ranked.length,
        matchMs: Number(timings[0].matchMs.toFixed(2)),
        nlpMs: Number(timings[0].nlpMs.toFixed(2)),
        candidateGenMs: Number(timings[0].candidateGenMs.toFixed(2)),
        packLookupMs: Number(timings[0].packLookupMs.toFixed(2)),
        rankMs: Number(rankMs.toFixed(2)),
        totalMs: Number((timings[0].totalMs + rankMs).toFixed(2)),
      };
    }

    console.log(`QC06_STAGE_BREAKDOWN=${JSON.stringify(measurements)}`);
  });
});


