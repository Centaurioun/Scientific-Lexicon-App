import { compareCodeUnits, type Expression, type Occurrence } from './schema';
import type { OccurrenceLimitTracker } from './processing-limits';
import type { ParsedDocument } from './document-input';
import type { AcronymExpansionHypothesis, CandidateEvidence } from './candidate-evidence';
import type { DictionaryPackSuggestion } from './dictionary-pack';

export const MATCH_BOUNDARY_POLICY = 's1-boundary-v1';
export const CANDIDATE_GRAMMAR_VERSION = 's1-grammar-1';

export interface Span {
  start: number;
  end: number;
  surface: string;
}

export type CanonicalPos =
  | 'NOUN'
  | 'PROPN'
  | 'ADJ'
  | 'ADP'
  | 'DET'
  | 'VERB'
  | 'NUM'
  | 'SYM'
  | 'PUNCT'
  | 'OTHER';

export interface Token extends Span {
  pos: CanonicalPos;
  sentenceId: number;
}

export interface NlpEngine {
  analyze(text: string): Promise<Token[]>;
}

export interface RegisteredMatcher {
  match(
    text: string,
    expressions: readonly Expression[],
    options?: MatcherOptions,
  ): Promise<Occurrence[]>;
}

export interface MatcherOptions {
  occurrenceTracker?: OccurrenceLimitTracker;
  signal?: AbortSignal;
  parsedDocument?: ParsedDocument;
}

export interface CandidateGenerationOptions {
  occurrenceTracker?: OccurrenceLimitTracker;
  signal?: AbortSignal;
  parsedDocument?: ParsedDocument;
}

export interface CandidateGenerator {
  generate(
    text: string,
    tokens: readonly Token[],
    options?: CandidateGenerationOptions,
  ): Promise<Span[]>;
}

export interface ExtractionRun {
  id: string;
  text: string;
  algorithmVersion: string;
  libraryRevision: number;
  occurrences: Occurrence[];
  /** Session-only explainable candidate evidence keyed by "start:end". Never persisted. */
  evidenceBySpan?: ReadonlyMap<string, CandidateEvidence>;
  /** Session-only bounded acronym–long-form hypotheses. Never persisted or auto-merged. */
  hypotheses?: readonly AcronymExpansionHypothesis[];
  /** Session-only parsed document metadata (format, sections, excluded ranges, warnings). Never persisted. */
  parsedDocument?: ParsedDocument;
  /** Session-only read-only dictionary pack suggestions keyed by "start:end". Never persisted. */
  packSuggestionsBySpan?: ReadonlyMap<string, DictionaryPackSuggestion[]>;
}

export type ReviewIntent = 'create-concept' | 'link-form' | 'reject' | 'resolve-existing';

export type CandidateFilter =
  | 'all'
  | 'known-form'
  | 'new-candidate'
  | 'possible-new-form'
  | 'ambiguous';

const DISALLOWED_ADJACENT_RE = /^[\p{L}\p{M}\p{N}_+]$/u;

function codePointBefore(text: string, index: number): string | null {
  if (index <= 0) return null;
  const prevUnit = text.charCodeAt(index - 1);
  // Check for UTF-16 trailing surrogate pair
  if (prevUnit >= 0xdc00 && prevUnit <= 0xdfff && index >= 2) {
    const leadUnit = text.charCodeAt(index - 2);
    if (leadUnit >= 0xd800 && leadUnit <= 0xdbff) {
      return text.slice(index - 2, index);
    }
  }
  return text.slice(index - 1, index);
}

function codePointAt(text: string, index: number): string | null {
  if (index >= text.length) return null;
  const cp = text.codePointAt(index);
  if (cp === undefined) return null;
  return String.fromCodePoint(cp);
}

export function isDisallowedBoundaryChar(char: string | null): boolean {
  if (char === null) return false;
  return DISALLOWED_ADJACENT_RE.test(char);
}

export interface BoundaryCheckResult {
  allowed: boolean;
  provisionalHyphen: boolean;
}

/**
 * Approved S1 scientific boundary policy:
 * - Adjacent Unicode letter (\p{L}), mark (\p{M}), number (\p{N}), underscore (_), or plus (+) disallows literal match.
 * - Adjacent hyphen (-) attached to a word/symbol token is treated as a provisional separator:
 *   x-TNF-α matches TNF-α as a candidate (possible-new-form) without resolving scientific identity.
 */
export function checkScientificBoundary(
  text: string,
  start: number,
  end: number,
): BoundaryCheckResult {
  const left = codePointBefore(text, start);
  const right = codePointAt(text, end);

  if (isDisallowedBoundaryChar(left) || isDisallowedBoundaryChar(right)) {
    return { allowed: false, provisionalHyphen: false };
  }

  let provisionalHyphen = false;
  if (left === '-' && start >= 2) {
    const beforeHyphen = codePointBefore(text, start - 1);
    if (isDisallowedBoundaryChar(beforeHyphen)) {
      provisionalHyphen = true;
    }
  }
  if (right === '-' && end + 1 < text.length) {
    const afterHyphen = codePointAt(text, end + 1);
    if (isDisallowedBoundaryChar(afterHyphen)) {
      provisionalHyphen = true;
    }
  }

  return { allowed: true, provisionalHyphen };
}

export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.start !== b.start) return a.start - b.start;
  const lenDiff = b.end - b.start - (a.end - a.start);
  if (lenDiff !== 0) return lenDiff;
  return compareCodeUnits(a.id, b.id);
}

export function compareSpans(a: Span, b: Span): number {
  if (a.start !== b.start) return a.start - b.start;
  const lenDiff = b.end - b.start - (a.end - a.start);
  if (lenDiff !== 0) return lenDiff;
  return compareCodeUnits(a.surface, b.surface);
}

export function makeOccurrenceId(start: number, end: number): string {
  return `occ:${start}:${end}`;
}
