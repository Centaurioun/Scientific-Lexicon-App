import type { Span } from './extraction';

export const S2_CANDIDATE_GRAMMAR_VERSION = 's2-grammar-2';

export type CandidateGrammarMode = 's1-grammar-1' | 's2-grammar-2';

export type CandidateReasonTag =
  | 'pos-np'
  | 'scientific-symbol'
  | 'compound-hyphen'
  | 'biomedical-of-phrase'
  | 'eponym-term'
  | 'acronym-expansion-hypothesis'
  | 'dictionary-pack-hint';

export interface AcronymExpansionHypothesis {
  acronymSpan: Span;
  longFormSpan: Span;
  acronym: string;
  longForm: string;
  /** Strictly non-canonical hypothesis; never implies automatic synonym or concept merge. */
  status: 'hypothesis-only';
}

export interface CandidateEvidence {
  spanKey: string;
  start: number;
  end: number;
  surface: string;
  grammarVersion: CandidateGrammarMode;
  reasons: CandidateReasonTag[];
  posPattern?: string;
  abbreviationHypothesis?: AcronymExpansionHypothesis;
}

const REASON_LABELS: Record<CandidateReasonTag, string> = {
  'pos-np': 'POS noun phrase',
  'scientific-symbol': 'Scientific symbol/formula',
  'compound-hyphen': 'Hyphenated scientific compound',
  'biomedical-of-phrase': 'Biomedical prepositional phrase',
  'eponym-term': 'Eponymous scientific term',
  'acronym-expansion-hypothesis': 'Acronym–long-form (hypothesis only)',
  'dictionary-pack-hint': 'Dictionary pack hint (unverified)',
};

export function formatCandidateReason(tag: CandidateReasonTag): string {
  return REASON_LABELS[tag];
}
