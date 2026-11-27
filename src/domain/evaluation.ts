export interface GoldSpan {
  start: number;
  end: number;
  conceptKey?: string;
  unknown: boolean;
  nested: boolean;
}

export interface GoldDocument {
  id: string;
  text: string;
  spans: GoldSpan[];
}

export interface PredictedSpan {
  start: number;
  end: number;
  surface?: string;
  conceptKey?: string | null;
  rank?: number;
}

export interface PredictedDocument {
  id: string;
  spans: PredictedSpan[];
  /** Optional explicit reviewer/pipeline rejections to measure false-rejection count against gold. */
  rejectedSpans?: PredictedSpan[];
  elapsedMs?: number;
}

export interface AtKMetric {
  k: number;
  precisionAtK: number | null;
  recallAtK: number | null;
  hits: number;
  evaluatedCount: number;
}

export interface ConceptLevelMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface DocumentEvaluation {
  documentId: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  unknownFound: number;
  unknownTotal: number;
  nestedFound: number;
  nestedTotal: number;
  falseRejectionCount: number;
  elapsedMs: number | null;
}

export interface WorkloadSummary {
  documentCount: number;
  totalGoldSpans: number;
  totalPredictedSpans: number;
  totalElapsedMs: number | null;
  /**
   * Synthetic algorithmic workload proxy (total unique predicted spans reviewed per document).
   * Explicitly NOT a human-measured annotation time or clinical study metric.
   */
  syntheticReviewerLoadProxy: number;
}

export interface EvaluationResult {
  tp: number;
  fp: number;
  fn: number;
  microPrecision: number | null;
  microRecall: number | null;
  microF1: number | null;
  macroPrecision: number | null;
  macroRecall: number | null;
  macroF1: number | null;
  unknownRecall: number | null;
  unknownFound: number;
  unknownTotal: number;
  nestedRecall: number | null;
  nestedFound: number;
  nestedTotal: number;
  falseRejectionCount: number;
  conceptLevel: ConceptLevelMetrics | null;
  atK: AtKMetric[];
  workloadSummary: WorkloadSummary;
  perDocument: DocumentEvaluation[];
}

export interface LeakageCheckReport {
  overlappingDocIds: string[];
  overlappingConceptKeys: string[];
  hasLeakage: boolean;
}
