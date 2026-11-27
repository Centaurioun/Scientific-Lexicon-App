import type { Occurrence } from './schema';

export type RankMode = 'source-order' | 'frequency' | 'c-value';

export interface CandidateGroup {
  key: string;
  surface: string;
  occurrenceIds: string[];
  firstStart: number;
  firstEnd: number;
  frequency: number;
  tokenCount: number;
  state: Occurrence['state'];
  conceptIds: string[];
  expressionIds: string[];
}

export interface RankingFeatures {
  frequency: number;
  tokenCount: number;
  nestedContainerCount: number;
  nestedContainerFreqSum: number;
  nestedContainerSurfaces: string[];
  formulaDescription: string;
  formulaDetails: string;
}

export interface RankedCandidate {
  group: CandidateGroup;
  rankMode: RankMode;
  /** Exact canonical multiword C-value when rankMode === 'c-value' and tokenCount >= 2; null for unigrams or non-scored modes. */
  score: number | null;
  unigramGroup: boolean;
  features: RankingFeatures;
}
