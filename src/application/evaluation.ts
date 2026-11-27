import { compareCodeUnits } from '@/domain/schema';
import type {
  AtKMetric,
  ConceptLevelMetrics,
  DocumentEvaluation,
  EvaluationResult,
  GoldDocument,
  GoldSpan,
  LeakageCheckReport,
  PredictedDocument,
  PredictedSpan,
} from '@/domain/evaluation';

function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function computeF1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  const sum = precision + recall;
  if (sum <= 0) return 0;
  return (2 * precision * recall) / sum;
}

function meanOfNonNull(values: readonly (number | null)[]): number | null {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v !== null) {
      sum += v;
      count += 1;
    }
  }
  return safeRatio(sum, count);
}

function spanKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function validateEvaluationSpan(
  span: { start: number; end: number },
  text: string,
  kind: string,
  documentId: string,
): void {
  if (
    !Number.isSafeInteger(span.start) ||
    !Number.isSafeInteger(span.end) ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end > text.length
  ) {
    throw new RangeError(
      `Invalid ${kind} span [${span.start}, ${span.end}) in document "${documentId}" (UTF-16 length ${text.length}); offsets must be safe integers within the document.`,
    );
  }
}

function normalizedConceptKey(key: string | null | undefined): string | undefined {
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

export interface EvaluateExtractionOptions {
  kValues?: readonly number[];
}

/**
 * Evaluates predicted extraction spans against gold half-open UTF-16 span annotations.
 * - Exact half-open span matching per document (no lowercase folding or fuzzy offset tolerance).
 * - Deduplicates duplicate spans per document before TP/FP/FN calculation.
 * - Returns null (never 0 or NaN) for empty denominators.
 * - Computes micro and macro P/R/F1 separately, plus unknown/nested recall, false rejections,
 *   optional concept-level metrics (only when gold conceptKey mappings exist), and precision/recall@K.
 */
export function evaluateExtraction(
  goldDocs: readonly GoldDocument[],
  predictedDocs: readonly PredictedDocument[],
  options: EvaluateExtractionOptions = {},
): EvaluationResult {
  const kValues = options.kValues ?? [5, 10, 20];
  const seenK = new Set<number>();
  for (const k of kValues) {
    if (!Number.isSafeInteger(k) || k <= 0) {
      throw new RangeError(`Evaluation K values must be positive safe integers (received ${String(k)}).`);
    }
    if (seenK.has(k)) throw new RangeError(`Duplicate evaluation K value: ${k}.`);
    seenK.add(k);
  }
  const goldDocIds = new Set<string>();
  for (const gDoc of goldDocs) {
    if (!gDoc.id || goldDocIds.has(gDoc.id)) {
      throw new Error(`Duplicate gold document ID or empty gold document ID: "${gDoc.id}".`);
    }
    goldDocIds.add(gDoc.id);
  }
  const predictedByDocId = new Map<string, PredictedDocument>();
  for (const pDoc of predictedDocs) {
    if (!pDoc.id || predictedByDocId.has(pDoc.id)) {
      throw new Error(`Duplicate predicted document ID or empty predicted document ID: "${pDoc.id}".`);
    }
    if (!goldDocIds.has(pDoc.id)) {
      throw new Error(`Predicted document "${pDoc.id}" has no matching gold document.`);
    }
    if (pDoc.elapsedMs !== undefined && (!Number.isFinite(pDoc.elapsedMs) || pDoc.elapsedMs < 0)) {
      throw new RangeError(`Elapsed time for document "${pDoc.id}" must be finite and nonnegative.`);
    }
    predictedByDocId.set(pDoc.id, pDoc);
  }

  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;
  let totalUnknownFound = 0;
  let totalUnknownTotal = 0;
  let totalNestedFound = 0;
  let totalNestedTotal = 0;
  let totalFalseRejections = 0;
  let totalGoldSpans = 0;
  let totalPredictedSpans = 0;
  let totalElapsedMs = 0;
  let sawElapsed = false;

  let conceptGoldPresent = false;
  let conceptTp = 0;
  let conceptFp = 0;
  let conceptFn = 0;

  const atKAccum = new Map<number, { hits: number; evaluated: number; goldTotal: number }>();
  for (const k of kValues) {
    if (k > 0) {
      atKAccum.set(k, { hits: 0, evaluated: 0, goldTotal: 0 });
    }
  }

  const perDocument: DocumentEvaluation[] = [];

  for (const gDoc of goldDocs) {
    const pDoc = predictedByDocId.get(gDoc.id);

    // Deduplicate gold spans by exact half-open offset key
    const goldMap = new Map<string, GoldSpan>();
    for (const span of gDoc.spans) {
      validateEvaluationSpan(span, gDoc.text, 'gold', gDoc.id);
      const key = spanKey(span.start, span.end);
      const previous = goldMap.get(key);
      if (previous && (
        previous.unknown !== span.unknown ||
        previous.nested !== span.nested ||
        normalizedConceptKey(previous.conceptKey) !== normalizedConceptKey(span.conceptKey)
      )) {
        throw new Error(`Conflicting duplicate gold annotation for span [${span.start}, ${span.end}) in document "${gDoc.id}".`);
      }
      if (!previous) {
        goldMap.set(key, span);
      }
      if (span.conceptKey !== undefined && span.conceptKey.length > 0) {
        conceptGoldPresent = true;
      }
    }

    // Deduplicate predicted spans in original ranked order
    const predMap = new Map<string, PredictedSpan>();
    const orderedUniquePreds: PredictedSpan[] = [];
    for (const span of pDoc?.spans ?? []) {
      validateEvaluationSpan(span, gDoc.text, 'predicted', gDoc.id);
      const key = spanKey(span.start, span.end);
      const previous = predMap.get(key);
      if (previous && normalizedConceptKey(previous.conceptKey) !== normalizedConceptKey(span.conceptKey)) {
        throw new Error(`Conflicting duplicate predicted concept mapping for span [${span.start}, ${span.end}) in document "${gDoc.id}".`);
      }
      if (!previous) {
        predMap.set(key, span);
        orderedUniquePreds.push(span);
      }
    }

    let docTp = 0;
    let docFp = 0;
    let docFn = 0;
    let docUnknownFound = 0;
    let docUnknownTotal = 0;
    let docNestedFound = 0;
    let docNestedTotal = 0;

    for (const [key, gSpan] of goldMap.entries()) {
      const matchedPred = predMap.get(key);
      if (gSpan.unknown) docUnknownTotal += 1;
      if (gSpan.nested) docNestedTotal += 1;

      if (matchedPred) {
        docTp += 1;
        if (gSpan.unknown) docUnknownFound += 1;
        if (gSpan.nested) docNestedFound += 1;
      } else {
        docFn += 1;
      }

      if (gSpan.conceptKey !== undefined && gSpan.conceptKey.length > 0) {
        if (matchedPred && matchedPred.conceptKey === gSpan.conceptKey) {
          conceptTp += 1;
        } else {
          conceptFn += 1;
          if (matchedPred && matchedPred.conceptKey) {
            conceptFp += 1;
          }
        }
      }
    }

    for (const [key, pred] of predMap.entries()) {
      if (!goldMap.has(key)) {
        docFp += 1;
        if (pred.conceptKey) {
          conceptFp += 1;
        }
      }
    }

    // Explicit false rejections (gold spans placed in rejectedSpans)
    const rejectedKeys = new Set<string>();
    for (const rej of pDoc?.rejectedSpans ?? []) {
      validateEvaluationSpan(rej, gDoc.text, 'rejected', gDoc.id);
      rejectedKeys.add(spanKey(rej.start, rej.end));
    }
    let docFalseRejections = 0;
    for (const key of goldMap.keys()) {
      if (rejectedKeys.has(key)) {
        docFalseRejections += 1;
      }
    }

    // Precision@K / Recall@K accumulation
    for (const [k, acc] of atKAccum.entries()) {
      const topK = orderedUniquePreds.slice(0, k);
      let hits = 0;
      for (const pred of topK) {
        if (goldMap.has(spanKey(pred.start, pred.end))) {
          hits += 1;
        }
      }
      acc.hits += hits;
      acc.evaluated += topK.length;
      acc.goldTotal += goldMap.size;
    }

    const docPrecision = safeRatio(docTp, docTp + docFp);
    const docRecall = safeRatio(docTp, docTp + docFn);
    const docF1 = computeF1(docPrecision, docRecall);

    if (typeof pDoc?.elapsedMs === 'number') {
      totalElapsedMs += pDoc.elapsedMs;
      sawElapsed = true;
    }

    totalTp += docTp;
    totalFp += docFp;
    totalFn += docFn;
    totalUnknownFound += docUnknownFound;
    totalUnknownTotal += docUnknownTotal;
    totalNestedFound += docNestedFound;
    totalNestedTotal += docNestedTotal;
    totalFalseRejections += docFalseRejections;
    totalGoldSpans += goldMap.size;
    totalPredictedSpans += predMap.size;

    perDocument.push({
      documentId: gDoc.id,
      tp: docTp,
      fp: docFp,
      fn: docFn,
      precision: docPrecision,
      recall: docRecall,
      f1: docF1,
      unknownFound: docUnknownFound,
      unknownTotal: docUnknownTotal,
      nestedFound: docNestedFound,
      nestedTotal: docNestedTotal,
      falseRejectionCount: docFalseRejections,
      elapsedMs: typeof pDoc?.elapsedMs === 'number' ? pDoc.elapsedMs : null,
    });
  }

  const microPrecision = safeRatio(totalTp, totalTp + totalFp);
  const microRecall = safeRatio(totalTp, totalTp + totalFn);
  const microF1 = computeF1(microPrecision, microRecall);

  const macroPrecision = meanOfNonNull(perDocument.map((d) => d.precision));
  const macroRecall = meanOfNonNull(perDocument.map((d) => d.recall));
  const macroF1 = meanOfNonNull(perDocument.map((d) => d.f1));

  let conceptLevel: ConceptLevelMetrics | null = null;
  if (conceptGoldPresent) {
    const cPrec = safeRatio(conceptTp, conceptTp + conceptFp);
    const cRec = safeRatio(conceptTp, conceptTp + conceptFn);
    conceptLevel = {
      tp: conceptTp,
      fp: conceptFp,
      fn: conceptFn,
      precision: cPrec,
      recall: cRec,
      f1: computeF1(cPrec, cRec),
    };
  }

  const atK: AtKMetric[] = Array.from(atKAccum.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([k, acc]) => ({
      k,
      precisionAtK: safeRatio(acc.hits, acc.evaluated),
      recallAtK: safeRatio(acc.hits, acc.goldTotal),
      hits: acc.hits,
      evaluatedCount: acc.evaluated,
    }));

  return {
    tp: totalTp,
    fp: totalFp,
    fn: totalFn,
    microPrecision,
    microRecall,
    microF1,
    macroPrecision,
    macroRecall,
    macroF1,
    unknownRecall: safeRatio(totalUnknownFound, totalUnknownTotal),
    unknownFound: totalUnknownFound,
    unknownTotal: totalUnknownTotal,
    nestedRecall: safeRatio(totalNestedFound, totalNestedTotal),
    nestedFound: totalNestedFound,
    nestedTotal: totalNestedTotal,
    falseRejectionCount: totalFalseRejections,
    conceptLevel,
    atK,
    workloadSummary: {
      documentCount: goldDocs.length,
      totalGoldSpans,
      totalPredictedSpans,
      totalElapsedMs: sawElapsed ? totalElapsedMs : null,
      syntheticReviewerLoadProxy:
        goldDocs.length > 0 ? totalPredictedSpans / goldDocs.length : 0,
    },
    perDocument,
  };
}

/**
 * Checks dev vs holdout benchmark splits for document-ID or concept-key leakage.
 */
export function checkSplitLeakage(
  devDocs: readonly GoldDocument[],
  holdoutDocs: readonly GoldDocument[],
): LeakageCheckReport {
  const devDocIds = new Set(devDocs.map((d) => d.id));
  const devConceptKeys = new Set<string>();
  for (const doc of devDocs) {
    for (const span of doc.spans) {
      if (span.conceptKey) devConceptKeys.add(span.conceptKey);
    }
  }

  const overlappingDocIds: string[] = [];
  const overlappingConceptSet = new Set<string>();

  for (const doc of holdoutDocs) {
    if (devDocIds.has(doc.id)) {
      overlappingDocIds.push(doc.id);
    }
    for (const span of doc.spans) {
      if (span.conceptKey && devConceptKeys.has(span.conceptKey)) {
        overlappingConceptSet.add(span.conceptKey);
      }
    }
  }

  overlappingDocIds.sort(compareCodeUnits);
  const overlappingConceptKeys = Array.from(overlappingConceptSet).sort(compareCodeUnits);

  return {
    overlappingDocIds,
    overlappingConceptKeys,
    hasLeakage: overlappingDocIds.length > 0 || overlappingConceptKeys.length > 0,
  };
}
