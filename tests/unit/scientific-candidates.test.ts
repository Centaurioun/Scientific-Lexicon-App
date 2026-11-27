import { describe, expect, it } from 'vitest';
import { AhoCorasickRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import { WinkNlpEngine } from '@/adapters/nlp/wink-engine';
import { parseMarkdownDocument } from '@/adapters/documents/markdown';
import { analyzeText, S1CandidateGenerator } from '@/application/extraction';
import {
  S2_CANDIDATE_GRAMMAR_VERSION,
  S2ScientificCandidateGenerator,
} from '@/application/scientific-candidates';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';
import { OccurrenceLimitExceededError, OccurrenceLimitTracker } from '@/domain/processing-limits';

function createScientificLibrarySnapshot(): LibrarySnapshot {
  const now = '2026-11-27T00:00:00Z';
  return {
    schemaVersion: 1,
    libraryRevision: 3,
    concepts: [
      { id: 'c-pd-1', revision: 1, createdAt: now, updatedAt: now },
      { id: 'c-pd-2', revision: 1, createdAt: now, updatedAt: now },
      { id: 'c-tr', revision: 1, createdAt: now, updatedAt: now },
    ],
    expressions: [
      {
        id: 'e-pd-1',
        conceptId: 'c-pd-1',
        revision: 1,
        text: 'PD',
        language: { kind: 'shared' },
        role: 'abbreviation',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-pd-2',
        conceptId: 'c-pd-2',
        revision: 1,
        text: 'PD',
        language: { kind: 'shared' },
        role: 'abbreviation',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-tr-1',
        conceptId: 'c-tr',
        revision: 1,
        text: 'İstanbul',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-tr-2',
        conceptId: 'c-tr',
        revision: 1,
        text: 'ışık',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        createdAt: now,
        updatedAt: now,
      },
    ],
    assertions: [],
    provenance: [],
    documents: [],
    runs: [],
    batches: [],
    audit: [],
  };
}

describe('D4: Scientific grammar v2 and explainable candidate evidence', () => {
  const nlp = new WinkNlpEngine();
  const matcher = new AhoCorasickRegisteredMatcher();

  it('extracts biomedical compounds, hyphenated forms, chemical symbols, eponyms, and of-phrases with exact UTF-16 spans and evidence', async () => {
    const text =
      'Periodontal ligament-derived stem cells expressed p53 and P53 alongside Na+/K+-ATPase, HLA-B, HLA-B27, TNF-α, and 2,4-dinitrophenol. Gram staining and loss of heterozygosity were reported by Smith et al. in 2024.';

    const tokens = await nlp.analyze(text);
    const generator = new S2ScientificCandidateGenerator();
    const result = await generator.generateWithEvidence(text, tokens);
    const surfaces = new Set(result.spans.map((s) => s.surface));

    // Exact UTF-16 slice invariant on every emitted span
    for (const span of result.spans) {
      expect(text.slice(span.start, span.end)).toBe(span.surface);
      const ev = result.evidenceBySpan.get(`${span.start}:${span.end}`);
      expect(ev).toBeDefined();
      expect(ev?.grammarVersion).toBe(S2_CANDIDATE_GRAMMAR_VERSION);
      expect(ev?.reasons.length).toBeGreaterThan(0);
    }

    // Case-sensitive gene/protein symbols preserved separately
    expect(surfaces.has('p53')).toBe(true);
    expect(surfaces.has('P53')).toBe(true);

    // Chemical/biomedical symbols & nested HLA-B / HLA-B27 preserved
    expect(surfaces.has('Na+/K+-ATPase')).toBe(true);
    expect(surfaces.has('HLA-B')).toBe(true);
    expect(surfaces.has('HLA-B27')).toBe(true);
    expect(surfaces.has('TNF-α')).toBe(true);
    expect(surfaces.has('2,4-dinitrophenol')).toBe(true);

    // Eponym, of-phrase, and hyphenated biomedical participle compound
    expect(surfaces.has('Gram staining')).toBe(true);
    expect(surfaces.has('loss of heterozygosity')).toBe(true);
    expect(surfaces.has('Periodontal ligament-derived stem cells')).toBe(true);

    // Bibliographic citation noise excluded without blanket-deleting normal words
    expect(surfaces.has('et al.')).toBe(false);
    expect(surfaces.has('et al')).toBe(false);

    // Evidence tags explain why compounds/eponyms/of-phrases were generated
    const compoundSpan = result.spans.find(
      (s) => s.surface === 'Periodontal ligament-derived stem cells',
    )!;
    expect(
      result.evidenceBySpan.get(`${compoundSpan.start}:${compoundSpan.end}`)?.reasons,
    ).toContain('compound-hyphen');

    const ofSpan = result.spans.find((s) => s.surface === 'loss of heterozygosity')!;
    expect(result.evidenceBySpan.get(`${ofSpan.start}:${ofSpan.end}`)?.reasons).toContain(
      'biomedical-of-phrase',
    );

    const gramSpan = result.spans.find((s) => s.surface === 'Gram staining')!;
    expect(result.evidenceBySpan.get(`${gramSpan.start}:${gramSpan.end}`)?.reasons).toContain(
      'eponym-term',
    );
  });

  it('detects bounded acronym-long-form pairs strictly as hypothesis-only evidence without automatic synonym or concept creation', async () => {
    const text =
      'Tumor necrosis factor alpha (TNF-α) and loss of heterozygosity (LOH) are evaluated separately.';
    const tokens = await nlp.analyze(text);
    const generator = new S2ScientificCandidateGenerator();
    const result = await generator.generateWithEvidence(text, tokens);

    expect(result.hypotheses.length).toBeGreaterThanOrEqual(2);
    const tnfHyp = result.hypotheses.find((h) => h.acronym === 'TNF-α');
    expect(tnfHyp).toBeDefined();
    expect(tnfHyp?.status).toBe('hypothesis-only');
    expect(tnfHyp?.longForm).toBe('Tumor necrosis factor alpha');
    expect(text.slice(tnfHyp!.acronymSpan.start, tnfHyp!.acronymSpan.end)).toBe('TNF-α');
    expect(text.slice(tnfHyp!.longFormSpan.start, tnfHyp!.longFormSpan.end)).toBe(
      'Tumor necrosis factor alpha',
    );

    const lohHyp = result.hypotheses.find((h) => h.acronym === 'LOH');
    expect(lohHyp).toBeDefined();
    expect(lohHyp?.status).toBe('hypothesis-only');
    expect(lohHyp?.longForm).toBe('loss of heterozygosity');

    // Evidence attaches hypothesis to both acronym and long-form spans
    const tnfEv = result.evidenceBySpan.get(
      `${tnfHyp!.acronymSpan.start}:${tnfHyp!.acronymSpan.end}`,
    );
    expect(tnfEv?.reasons).toContain('acronym-expansion-hypothesis');
    expect(tnfEv?.abbreviationHypothesis?.status).toBe('hypothesis-only');
  });

  it('preserves PD homonyms, exact Turkish casing (I/İ/ı), empty-library usability, and S1 baseline isolation', async () => {
    const snapshot = createScientificLibrarySnapshot();
    const text =
      'PD was evaluated in İstanbul under ışık while I and i remain distinct from İ and ı.';

    const s2Run = await analyzeText(text, snapshot, nlp, matcher, {
      grammarMode: 's2-grammar-2',
    });

    expect(s2Run.algorithmVersion).toBe('s2-grammar-2+s1-boundary-v1');
    const pdOcc = s2Run.occurrences.find((o) => o.surface === 'PD');
    expect(pdOcc?.state).toBe('ambiguous');
    expect(pdOcc?.conceptIds).toEqual(['c-pd-1', 'c-pd-2']);
    expect(pdOcc?.resolvedConceptId).toBeNull();

    // Exact Turkish case preservation: İstanbul & ışık matched, uppercase/ASCII I not folded into İstanbul
    expect(
      s2Run.occurrences.some((o) => o.surface === 'İstanbul' && o.state === 'known-form'),
    ).toBe(true);
    expect(s2Run.occurrences.some((o) => o.surface === 'ışık' && o.state === 'known-form')).toBe(
      true,
    );

    // S1 baseline mode remains completely untouched and default
    const s1DefaultRun = await analyzeText(text, snapshot, nlp, matcher);
    expect(s1DefaultRun.algorithmVersion).toBe('s1-grammar-1+s1-boundary-v1');

    // Empty library still yields scientific candidates in S2
    const emptyRun = await analyzeText(
      'Na+/K+-ATPase and loss of heterozygosity appear in Periodontal ligament-derived stem cells.',
      createEmptySnapshot(),
      nlp,
      matcher,
      { grammarMode: 's2-grammar-2' },
    );
    const emptySurfaces = new Set(emptyRun.occurrences.map((o) => o.surface));
    expect(emptySurfaces.has('Na+/K+-ATPase')).toBe(true);
    expect(emptySurfaces.has('loss of heterozygosity')).toBe(true);
    expect(emptySurfaces.has('Periodontal ligament-derived stem cells')).toBe(true);
  });

  it('never emits candidates crossing Markdown sections or overlapping fenced code, inline code, or link URLs', async () => {
    const md = [
      '# Periodontal ligament',
      '',
      'See [Na+/K+-ATPase](https://example.org/loss-of-heterozygosity) and `HLA-B27` code.',
      '',
      '```ts',
      'const marker = "TNF-α";',
      '```',
      '',
      'Gram staining confirmed loss of heterozygosity.',
    ].join('\n');

    const parsedDoc = parseMarkdownDocument(md);
    const run = await analyzeText(parsedDoc.text, createEmptySnapshot(), nlp, matcher, {
      grammarMode: 's2-grammar-2',
      parsedDocument: parsedDoc,
    });

    // No occurrence overlaps any excluded range or spans across sections
    for (const occ of run.occurrences) {
      for (const ex of parsedDoc.excludedRanges) {
        const overlaps = occ.start < ex.end && occ.end > ex.start;
        expect(overlaps).toBe(false);
      }
      expect(occ.surface).not.toContain('\n');
    }

    const surfaces = new Set(run.occurrences.map((o) => o.surface));
    expect(surfaces.has('Na+/K+-ATPase')).toBe(true);
    expect(surfaces.has('Gram staining')).toBe(true);
    expect(surfaces.has('loss of heterozygosity')).toBe(true);
    // Excluded inside inline code / fenced code / link destination
    expect(surfaces.has('HLA-B27')).toBe(false);
    expect(surfaces.has('TNF-α')).toBe(false);
    expect(surfaces.has('https')).toBe(false);
  });

  it('enforces shared OccurrenceLimitTracker and AbortSignal cleanly', async () => {
    const text =
      'Periodontal ligament-derived stem cells express p53, P53, Na+/K+-ATPase, HLA-B, HLA-B27, TNF-α, 2,4-dinitrophenol, Gram staining, and loss of heterozygosity.';
    const tokens = await nlp.analyze(text);
    const generator = new S2ScientificCandidateGenerator();

    // Limit enforcement
    const tinyTracker = new OccurrenceLimitTracker(3);
    await expect(
      generator.generate(text, tokens, { occurrenceTracker: tinyTracker }),
    ).rejects.toThrow(OccurrenceLimitExceededError);

    // Abort enforcement
    const controller = new AbortController();
    controller.abort();
    await expect(
      generator.generate(text, tokens, { signal: controller.signal }),
    ).rejects.toThrow(/aborted/i);

    // S1 generator stays independent
    const s1 = new S1CandidateGenerator();
    const s1Spans = await s1.generate(text, tokens);
    expect(s1Spans.length).toBeGreaterThan(0);
  });
});
