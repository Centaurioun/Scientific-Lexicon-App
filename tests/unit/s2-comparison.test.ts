import { describe, expect, it } from 'vitest';
import { AhoCorasickRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import { WinkNlpEngine } from '@/adapters/nlp/wink-engine';
import { parseDocumentText } from '@/application/document-input';
import { evaluateExtraction } from '@/application/evaluation';
import { analyzeText } from '@/application/extraction';
import { rankCandidates } from '@/application/ranking';
import type { GoldDocument, GoldSpan, PredictedDocument } from '@/domain/evaluation';
import { DEFAULT_PROCESSING_LIMITS } from '@/domain/processing-limits';
import {
  createSyntheticBaselineSnapshot,
  S2_SYNTHETIC_DOCUMENTS,
} from '../fixtures/s2/synthetic-documents';

function spanOf(
  text: string,
  needle: string,
  flags: { unknown: boolean; nested: boolean; conceptKey?: string },
): GoldSpan {
  const start = text.indexOf(needle);
  if (start === -1) {
    throw new Error(`Synthetic fixture needle not found: "${needle}"`);
  }
  return {
    start,
    end: start + needle.length,
    ...flags,
  };
}

describe('D11: Reproducible synthetic S1 vs S2 comparison', () => {
  it('runs identical synthetic corpus, library snapshot, and limits through S1 baseline vs S2 experimental and records deterministic metrics', async () => {
    const nlp = new WinkNlpEngine();
    const matcher = new AhoCorasickRegisteredMatcher();
    const snapshot = createSyntheticBaselineSnapshot();

    const doc1Text = S2_SYNTHETIC_DOCUMENTS.baselineTxt.text;
    const doc2Text = S2_SYNTHETIC_DOCUMENTS.scientificRichTxt.text;
    const doc3Text = S2_SYNTHETIC_DOCUMENTS.structuredMarkdown.text;

    const goldDocs: GoldDocument[] = [
      {
        id: S2_SYNTHETIC_DOCUMENTS.baselineTxt.id,
        text: doc1Text,
        spans: [
          spanOf(doc1Text, 'Periodontal ligament fibroblasts', { unknown: true, nested: false }),
          spanOf(doc1Text, 'Periodontal ligament', { unknown: true, nested: true }),
          spanOf(doc1Text, 'TNF-α', { unknown: false, nested: false }),
          spanOf(doc1Text, 'CD4+', { unknown: true, nested: false }),
          spanOf(doc1Text, 'PD', { unknown: false, nested: false }),
          spanOf(doc1Text, 'IL-11', { unknown: true, nested: false }),
        ],
      },
      {
        id: S2_SYNTHETIC_DOCUMENTS.scientificRichTxt.id,
        text: doc2Text,
        spans: [
          spanOf(doc2Text, 'Tumor necrosis factor alpha', { unknown: true, nested: false }),
          spanOf(doc2Text, 'TNF-α', { unknown: false, nested: false }),
          spanOf(doc2Text, 'periodontal ligament-derived stem cells', { unknown: true, nested: false }),
          spanOf(doc2Text, 'p53', { unknown: true, nested: false }),
          spanOf(doc2Text, 'P53', { unknown: true, nested: false }),
          spanOf(doc2Text, 'Na+/K+-ATPase', { unknown: true, nested: false }),
          spanOf(doc2Text, 'HLA-B', { unknown: true, nested: true }),
          spanOf(doc2Text, 'HLA-B27', { unknown: true, nested: false }),
          spanOf(doc2Text, '2,4-dinitrophenol', { unknown: true, nested: false }),
          spanOf(doc2Text, 'Gram staining', { unknown: true, nested: false }),
          spanOf(doc2Text, 'loss of heterozygosity', { unknown: true, nested: false }),
          spanOf(doc2Text, 'LOH', { unknown: true, nested: false }),
          spanOf(doc2Text, 'PD', { unknown: false, nested: false }),
        ],
      },
      {
        id: S2_SYNTHETIC_DOCUMENTS.structuredMarkdown.id,
        text: doc3Text,
        spans: [
          spanOf(doc3Text, 'TNF-α', { unknown: false, nested: false }),
          spanOf(doc3Text, 'CD4+', { unknown: true, nested: false }),
          spanOf(doc3Text, 'Periodontal ligament stem cells', { unknown: true, nested: false }),
          spanOf(doc3Text, 'Na+/K+-ATPase', { unknown: true, nested: false }),
          spanOf(doc3Text, 'HLA-B27', { unknown: true, nested: false }),
          spanOf(doc3Text, 'IL-11', { unknown: true, nested: false }),
          spanOf(doc3Text, 'PD', { unknown: false, nested: false }),
        ],
      },
    ];

    const fixtures = [
      S2_SYNTHETIC_DOCUMENTS.baselineTxt,
      S2_SYNTHETIC_DOCUMENTS.scientificRichTxt,
      S2_SYNTHETIC_DOCUMENTS.structuredMarkdown,
    ] as const;

    const runMode = async (grammarMode: 's1-grammar-1' | 's2-grammar-2') => {
      const predictedDocs: PredictedDocument[] = [];
      let totalKnown = 0;
      let totalAmbiguous = 0;
      let totalNew = 0;
      let totalHypotheses = 0;

      for (const fixture of fixtures) {
        const parsed = parseDocumentText(fixture.text, fixture.format, DEFAULT_PROCESSING_LIMITS);
        let elapsedMs = 0;
        const run = await analyzeText(parsed.text, snapshot, nlp, matcher, {
          grammarMode,
          parsedDocument: parsed,
          limits: DEFAULT_PROCESSING_LIMITS,
          onStageTimings: (t) => {
            elapsedMs = t.totalMs;
          },
        });

        for (const occ of run.occurrences) {
          if (occ.state === 'known-form') totalKnown += 1;
          else if (occ.state === 'ambiguous') totalAmbiguous += 1;
          else if (occ.state === 'new-candidate') totalNew += 1;
        }
        totalHypotheses += run.hypotheses?.length ?? 0;

        // Rank with C-value for S2 and source-order for S1 (matching baseline vs experimental mode)
        const ranked = rankCandidates(
          run.occurrences,
          grammarMode === 's2-grammar-2' ? 'c-value' : 'source-order',
        );
        const occById = new Map(run.occurrences.map((o) => [o.id, o]));
        const orderedSpans = ranked.flatMap((item) =>
          item.group.occurrenceIds
            .map((id) => occById.get(id))
            .filter((o): o is NonNullable<typeof o> => Boolean(o))
            .map((o) => ({ start: o.start, end: o.end, surface: o.surface })),
        );

        predictedDocs.push({
          id: fixture.id,
          spans: orderedSpans,
          elapsedMs,
        });
      }

      const metrics = evaluateExtraction(goldDocs, predictedDocs, { kValues: [5, 10, 15] });
      return { metrics, totalKnown, totalAmbiguous, totalNew, totalHypotheses };
    };

    const s1 = await runMode('s1-grammar-1');
    const s2 = await runMode('s2-grammar-2');

    console.log(
      'WP02_SYNTHETIC_COMPARISON_JSON=' +
        JSON.stringify({
          s1: {
            tp: s1.metrics.tp,
            fp: s1.metrics.fp,
            fn: s1.metrics.fn,
            microPrecision: s1.metrics.microPrecision,
            microRecall: s1.metrics.microRecall,
            microF1: s1.metrics.microF1,
            macroPrecision: s1.metrics.macroPrecision,
            macroRecall: s1.metrics.macroRecall,
            macroF1: s1.metrics.macroF1,
            unknownRecall: s1.metrics.unknownRecall,
            nestedRecall: s1.metrics.nestedRecall,
            atK: s1.metrics.atK,
            totalKnown: s1.totalKnown,
            totalAmbiguous: s1.totalAmbiguous,
            totalNew: s1.totalNew,
            workload: s1.metrics.workloadSummary,
          },
          s2: {
            tp: s2.metrics.tp,
            fp: s2.metrics.fp,
            fn: s2.metrics.fn,
            microPrecision: s2.metrics.microPrecision,
            microRecall: s2.metrics.microRecall,
            microF1: s2.metrics.microF1,
            macroPrecision: s2.metrics.macroPrecision,
            macroRecall: s2.metrics.macroRecall,
            macroF1: s2.metrics.macroF1,
            unknownRecall: s2.metrics.unknownRecall,
            nestedRecall: s2.metrics.nestedRecall,
            atK: s2.metrics.atK,
            totalKnown: s2.totalKnown,
            totalAmbiguous: s2.totalAmbiguous,
            totalNew: s2.totalNew,
            totalHypotheses: s2.totalHypotheses,
            workload: s2.metrics.workloadSummary,
          },
        }),
    );

    // S2 recovers the scientific compounds/eponyms/of-phrases missed by S1 on this synthetic suite
    expect(s2.metrics.unknownRecall!).toBeGreaterThan(s1.metrics.unknownRecall!);
    expect(s2.metrics.microRecall!).toBeGreaterThan(s1.metrics.microRecall!);
    expect(s2.totalKnown).toBe(s1.totalKnown);
    expect(s2.totalAmbiguous).toBe(s1.totalAmbiguous);
    expect(s2.totalHypotheses).toBeGreaterThanOrEqual(2);
    // Canonical snapshot never mutated
    expect(snapshot.libraryRevision).toBe(3);
  });
});
