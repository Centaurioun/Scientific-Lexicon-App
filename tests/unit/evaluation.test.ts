import { describe, expect, it } from 'vitest';
import { checkSplitLeakage, evaluateExtraction } from '@/application/evaluation';
import type { GoldDocument, PredictedDocument } from '@/domain/evaluation';

describe('D10: Independent evaluation harness and split-leakage verification', () => {
  it('computes exact TP, FP, FN, micro/macro P/R/F1 on hand-verified predicted {A, B} vs gold {A, C}', () => {
    const gold: GoldDocument[] = [
      {
        id: 'doc-1',
        text: 'Alpha Beta Gamma',
        spans: [
          { start: 0, end: 5, unknown: false, nested: false }, // A
          { start: 11, end: 16, unknown: true, nested: false }, // C
        ],
      },
    ];
    const predicted: PredictedDocument[] = [
      {
        id: 'doc-1',
        spans: [
          { start: 0, end: 5, surface: 'Alpha' }, // A
          { start: 6, end: 10, surface: 'Beta' }, // B
          // Duplicate span A must be deduplicated, not double-counted
          { start: 0, end: 5, surface: 'Alpha' },
        ],
        elapsedMs: 12.5,
      },
    ];

    const result = evaluateExtraction(gold, predicted, { kValues: [1, 2] });
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(1);
    expect(result.fn).toBe(1);
    expect(result.microPrecision).toBeCloseTo(0.5, 10);
    expect(result.microRecall).toBeCloseTo(0.5, 10);
    expect(result.microF1).toBeCloseTo(0.5, 10);
    expect(result.macroPrecision).toBeCloseTo(0.5, 10);
    expect(result.macroRecall).toBeCloseTo(0.5, 10);
    expect(result.macroF1).toBeCloseTo(0.5, 10);
    expect(result.unknownRecall).toBe(0);
    expect(result.nestedRecall).toBeNull(); // 0 nested gold spans -> null, not 0 or NaN
    expect(result.conceptLevel).toBeNull(); // no conceptKeys provided -> null
    expect(result.atK).toEqual([
      { k: 1, precisionAtK: 1, recallAtK: 0.5, hits: 1, evaluatedCount: 1 },
      { k: 2, precisionAtK: 0.5, recallAtK: 0.5, hits: 1, evaluatedCount: 2 },
    ]);
  });

  it('distinguishes micro vs macro metrics, tracks unknown/nested recall, false rejections, and concept-level scoring', () => {
    const gold: GoldDocument[] = [
      {
        id: 'doc-1',
        text: 'HLA-B27 and TNF-α in stem cells',
        spans: [
          { start: 0, end: 5, conceptKey: 'C1', unknown: false, nested: true }, // HLA-B
          { start: 0, end: 7, conceptKey: 'C2', unknown: true, nested: false }, // HLA-B27
          { start: 12, end: 17, conceptKey: 'C3', unknown: false, nested: false }, // TNF-α
        ],
      },
      {
        id: 'doc-2',
        text: 'Gram staining',
        spans: [{ start: 0, end: 13, conceptKey: 'C4', unknown: true, nested: false }],
      },
    ];

    const predicted: PredictedDocument[] = [
      {
        id: 'doc-1',
        spans: [
          { start: 0, end: 5, conceptKey: 'C1' }, // TP (nested)
          { start: 0, end: 7, conceptKey: 'C2' }, // TP (unknown)
          { start: 12, end: 17, conceptKey: 'C_WRONG' }, // Span TP, concept mismatch!
        ],
        rejectedSpans: [{ start: 0, end: 7 }], // 1 false rejection
      },
      {
        id: 'doc-2',
        spans: [], // 0 predicted on doc-2 -> P is null, R is 0, F1 is null
      },
    ];

    const result = evaluateExtraction(gold, predicted);
    // Total TP=3, FP=0, FN=1 => microP=1.0, microR=0.75, microF1=6/7
    expect(result.tp).toBe(3);
    expect(result.fp).toBe(0);
    expect(result.fn).toBe(1);
    expect(result.microPrecision).toBe(1);
    expect(result.microRecall).toBeCloseTo(0.75, 10);
    expect(result.microF1).toBeCloseTo(6 / 7, 10);

    // Macro recall averages doc-1 (1.0) and doc-2 (0.0) => 0.5 (distinct from micro 0.75!)
    expect(result.macroRecall).toBeCloseTo(0.5, 10);
    expect(result.unknownRecall).toBeCloseTo(0.5, 10);
    expect(result.nestedRecall).toBe(1);
    expect(result.falseRejectionCount).toBe(1);

    // Concept-level scoring: 2 exact (span + conceptKey) matches, 1 wrong conceptKey (1 FP + 1 FN), 1 missing doc-2 (1 FN)
    expect(result.conceptLevel).not.toBeNull();
    expect(result.conceptLevel?.tp).toBe(2);
    expect(result.conceptLevel?.fp).toBe(1);
    expect(result.conceptLevel?.fn).toBe(2);
  });

  it('returns null (never NaN or 0) on empty denominators and detects dev/holdout split leakage', () => {
    const emptyResult = evaluateExtraction(
      [{ id: 'empty', text: 'Nothing here.', spans: [] }],
      [{ id: 'empty', spans: [] }],
    );
    expect(emptyResult.microPrecision).toBeNull();
    expect(emptyResult.microRecall).toBeNull();
    expect(emptyResult.microF1).toBeNull();
    expect(emptyResult.unknownRecall).toBeNull();
    expect(emptyResult.nestedRecall).toBeNull();

    const leakage = checkSplitLeakage(
      [
        {
          id: 'doc-shared',
          text: 'TNF-α',
          spans: [{ start: 0, end: 5, conceptKey: 'C-TNF', unknown: false, nested: false }],
        },
      ],
      [
        {
          id: 'doc-shared',
          text: 'TNF-α',
          spans: [{ start: 0, end: 5, conceptKey: 'C-TNF', unknown: false, nested: false }],
        },
      ],
    );
    expect(leakage.hasLeakage).toBe(true);
    expect(leakage.overlappingDocIds).toEqual(['doc-shared']);
    expect(leakage.overlappingConceptKeys).toEqual(['C-TNF']);
  });

  it('fails closed on inconsistent duplicate gold labels, invalid spans, duplicate documents, and invalid K values', () => {
    const base: GoldDocument = {
      id: 'doc',
      text: 'TNF-α',
      spans: [{ start: 0, end: 5, conceptKey: 'C1', unknown: false, nested: false }],
    };
    const predicted: PredictedDocument = { id: 'doc', spans: [{ start: 0, end: 5 }] };

    expect(() => evaluateExtraction([base], [{ ...predicted, spans: [{ start: 0.5, end: 5 }] }]))
      .toThrow(/safe integer/i);
    expect(() => evaluateExtraction([base], [{ ...predicted, spans: [
      { start: 0, end: 5, conceptKey: 'C1' }, { start: 0, end: 5, conceptKey: 'C2' },
    ] }])).toThrow(/conflicting duplicate predicted concept/i);
    expect(() => evaluateExtraction([
      { ...base, spans: [...base.spans, { ...base.spans[0], unknown: true }] },
    ], [predicted])).toThrow(/conflicting duplicate gold/i);
    expect(() => evaluateExtraction([base, base], [predicted])).toThrow(/duplicate gold document/i);
    expect(() => evaluateExtraction([base], [predicted, predicted])).toThrow(/duplicate predicted document/i);
    expect(() => evaluateExtraction([base], [predicted], { kValues: [0] })).toThrow(/positive safe integer/i);
    expect(() => evaluateExtraction([base], [predicted], { kValues: [1.5] })).toThrow(/positive safe integer/i);
    expect(() => evaluateExtraction([base], [predicted], { kValues: [1, 1] })).toThrow(/duplicate evaluation K/i);
    expect(() => evaluateExtraction([base], [{ ...predicted, spans: [{ start: 0, end: 6 }] }]))
      .toThrow(/predicted span/i);
    expect(() => evaluateExtraction([base], [{ id: 'extra', spans: [] }])).toThrow(/no matching gold/i);
  });
});
