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

describe('D11: Controlled factorial synthetic grammar and ranking comparison', () => {
  it('runs the same synthetic corpus under every grammar/ranking combination', async () => {
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

    const runConfiguration = async (
      grammarMode: 's1-grammar-1' | 's2-grammar-2',
      rankMode: 'source-order' | 'frequency' | 'c-value',
    ) => {
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
          onStageTimings: (t) => { elapsedMs = t.totalMs; },
        });

        for (const occ of run.occurrences) {
          if (occ.state === 'known-form') totalKnown += 1;
          else if (occ.state === 'ambiguous') totalAmbiguous += 1;
          else if (occ.state === 'new-candidate') totalNew += 1;
        }
        totalHypotheses += run.hypotheses?.length ?? 0;

        const ranked = rankCandidates(run.occurrences, rankMode, run.tokens);
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
      return { grammarMode, rankMode, metrics, totalKnown, totalAmbiguous, totalNew, totalHypotheses };
    };

    // Warm the local NLP model once so every configuration uses matched warm runs.
    await nlp.analyze('Synthetic warm-up sentence for controlled comparison.');
    const configurations = [];
    for (const grammarMode of ['s1-grammar-1', 's2-grammar-2'] as const) {
      for (const rankMode of ['source-order', 'frequency', 'c-value'] as const) {
        configurations.push(await runConfiguration(grammarMode, rankMode));
      }
    }

    console.log(
      'WP02_SYNTHETIC_COMPARISON_JSON=' +
        JSON.stringify(configurations.map(({ grammarMode, rankMode, metrics, totalKnown, totalAmbiguous, totalNew, totalHypotheses }) => ({
          grammarMode, rankMode, tp: metrics.tp, fp: metrics.fp, fn: metrics.fn,
          microPrecision: metrics.microPrecision, microRecall: metrics.microRecall, microF1: metrics.microF1,
          macroPrecision: metrics.macroPrecision, macroRecall: metrics.macroRecall, macroF1: metrics.macroF1,
          unknownRecall: metrics.unknownRecall, nestedRecall: metrics.nestedRecall, atK: metrics.atK,
          totalKnown, totalAmbiguous, totalNew, totalHypotheses, workload: metrics.workloadSummary,
        }))),
    );

    expect(configurations).toHaveLength(6);
    for (const rankMode of ['source-order', 'frequency', 'c-value'] as const) {
      const s1 = configurations.find((c) => c.grammarMode === 's1-grammar-1' && c.rankMode === rankMode)!;
      const s2 = configurations.find((c) => c.grammarMode === 's2-grammar-2' && c.rankMode === rankMode)!;
      // Span metrics are independent of ranking mode; each grammar is compared under the same ranker.
      expect(s1.metrics.tp).toBe(configurations[0].metrics.tp);
      expect(s2.metrics.tp).toBe(configurations[3].metrics.tp);
      expect(s2.metrics.unknownRecall!).toBeGreaterThan(s1.metrics.unknownRecall!);
      expect(s2.totalKnown).toBe(s1.totalKnown);
      expect(s2.totalAmbiguous).toBe(s1.totalAmbiguous);
      expect(s2.totalHypotheses).toBeGreaterThanOrEqual(2);
    }
    // Canonical snapshot never mutated
    expect(snapshot.libraryRevision).toBe(3);
  });
});
