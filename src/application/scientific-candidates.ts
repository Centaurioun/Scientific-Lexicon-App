import {
  compareSpans,
  type CandidateGenerationOptions,
  type CandidateGenerator,
  type CanonicalPos,
  type Span,
  type Token,
} from '@/domain/extraction';
import {
  S2_CANDIDATE_GRAMMAR_VERSION,
  type AcronymExpansionHypothesis,
  type CandidateEvidence,
  type CandidateReasonTag,
} from '@/domain/candidate-evidence';
import { isSpanEligibleInDocument, type ParsedDocument } from '@/domain/document-input';
import { DEFAULT_PROCESSING_LIMITS, OccurrenceLimitTracker } from '@/domain/processing-limits';

export { S2_CANDIDATE_GRAMMAR_VERSION };

const START_POS = new Set<CanonicalPos>(['ADJ', 'NOUN', 'PROPN']);
const END_POS = new Set<CanonicalPos>(['NOUN', 'PROPN']);
const INTERNAL_POS = new Set<CanonicalPos>(['ADJ', 'NOUN', 'PROPN', 'ADP', 'DET']);
const MAX_PHRASE_TOKENS = 10;
const GENERATION_YIELD_INTERVAL = 2_048;

const HAS_LETTER_RE = /\p{L}/u;
const HAS_DIGIT_RE = /\p{N}/u;
const HAS_GREEK_RE = /\p{Script=Greek}/u;
const HAS_SCIENTIFIC_SYMBOL_RE = /[+/]/;

/**
 * Matches bounded scientific symbols including chemical/ion/gene notations such as:
 * p53, P53, Na+/K+-ATPase, HLA-B, HLA-B27, TNF-α, 2,4-dinitrophenol, CD4+, IL-11.
 */
const S2_RAW_SYMBOL_RE =
  /[\p{L}\p{M}\p{N}]+(?:(?:[-+/]{1,2}|,(?=\p{N}))[\p{L}\p{M}\p{N}]+)*\+{0,2}/gu;

const BIBLIOGRAPHIC_NOISE_RE = /^(?:et\s+al\.?|ibid\.?|op\.?\s*cit\.?)$/i;
const LEADING_OR_TRAILING_ET_AL_RE = /(?:^|\s)et\s+al\.?(?:\s|$)/i;

const SCIENTIFIC_HYPHEN_MODIFIER_RE =
  /^[\p{L}\p{M}\p{N}]+-(?:derived|induced|mediated|associated|dependent|independent|related|like|binding|positive|negative|resistant|sensitive|specific|producing|expressing|treated|rich|free|based|driven|linked|coupled|activated|regulated|targeted)$/iu;

const SCIENTIFIC_GERUND_OR_NOMINAL_HEAD_RE =
  /(?:ing|tion|sion|sis|ity|ism|ase|ome|oma|itis|osis|pathy|scopy|graphy|metry|cyte|blast|gen|in)$/i;

const SCIENTIFIC_CONNECTOR_WORDS = new Set(['of', 'in', 'for', 'to', 'on', 'with']);

const ACRONYM_PAIR_RE = /\(([A-Za-z\p{Script=Greek}0-9][A-Za-z\p{Script=Greek}0-9\-+/]{1,13})\)/gu;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Scientific candidate generation was aborted.', 'AbortError');
  }
}

function isQualifiedScientificSymbol(surface: string): boolean {
  if (!HAS_LETTER_RE.test(surface)) return false;
  if (BIBLIOGRAPHIC_NOISE_RE.test(surface)) return false;
  if (HAS_DIGIT_RE.test(surface)) return true;
  if (HAS_GREEK_RE.test(surface)) return true;
  if (HAS_SCIENTIFIC_SYMBOL_RE.test(surface)) return true;
  if (surface.includes('-') && /\p{Lu}/u.test(surface)) return true;
  return false;
}

function isBibliographicNoise(surface: string): boolean {
  const trimmed = surface.trim();
  return BIBLIOGRAPHIC_NOISE_RE.test(trimmed) || LEADING_OR_TRAILING_ET_AL_RE.test(trimmed);
}

function isPlausibleAcronym(raw: string): boolean {
  if (raw.length < 2 || raw.length > 14) return false;
  if (/^\d+$/.test(raw)) return false;
  // Require at least one uppercase letter or Greek letter and at least 2 alphanumeric/Greek chars
  const hasUpperOrGreek = /\p{Lu}|\p{Script=Greek}/u.test(raw);
  const letterCount = (raw.match(/[\p{L}\p{Script=Greek}]/gu) ?? []).length;
  return hasUpperOrGreek && letterCount >= 2;
}

/**
 * Checks whether the letters of `acronym` match initials/subsequence of `longFormWords`
 * in order (case-insensitive check used strictly to hypothesize linkage — never alters
 * stored literal strings or merges concepts).
 */
function matchesAcronymInitials(acronym: string, longFormWords: readonly string[]): boolean {
  if (longFormWords.length < 2 || longFormWords.length > 9) return false;
  // Normalize acronym letters (keep ASCII/Latin letters; map Greek α/β/γ to word match)
  const greekWordMap: Record<string, string> = {
    α: 'alpha',
    β: 'beta',
    γ: 'gamma',
    δ: 'delta',
    κ: 'kappa',
  };

  const parts: string[] = [];
  for (const ch of acronym) {
    if (ch in greekWordMap) {
      parts.push(greekWordMap[ch]);
    } else if (/\p{L}/u.test(ch)) {
      parts.push(ch.toLowerCase());
    }
  }
  if (parts.length < 2) return false;

  const wordsLower = longFormWords.map((w) => w.toLowerCase());
  // First letter of acronym must match first letter of first word in long form
  if (!wordsLower[0].startsWith(parts[0][0])) return false;

  let pIdx = 0;
  let wIdx = 0;
  while (pIdx < parts.length && wIdx < wordsLower.length) {
    const part = parts[pIdx];
    const word = wordsLower[wIdx];
    if (part.length > 1) {
      if (word === part || word.startsWith(part)) {
        pIdx += 1;
        wIdx += 1;
        continue;
      }
    } else if (word.startsWith(part)) {
      pIdx += 1;
      wIdx += 1;
      continue;
    }
    // Allow skipping short function words like "of", "the", "and", "in", "for"
    if (SCIENTIFIC_CONNECTOR_WORDS.has(word) || word === 'the' || word === 'and') {
      wIdx += 1;
      continue;
    }
    // Also allow matching subsequent letters inside the previous matched word (e.g., "TNF" from "Tumor necrosis factor" or "IL" from "interleukin")
    if (wIdx > 0 && wordsLower[wIdx - 1].includes(part)) {
      pIdx += 1;
      continue;
    }
    wIdx += 1;
  }

  // Must match all acronym components and use the last word of the long form
  return pIdx === parts.length;
}

export interface ScientificCandidateResult {
  spans: Span[];
  evidenceBySpan: Map<string, CandidateEvidence>;
  hypotheses: AcronymExpansionHypothesis[];
}

export class S2ScientificCandidateGenerator implements CandidateGenerator {
  async generate(
    text: string,
    tokens: readonly Token[],
    options: CandidateGenerationOptions = {},
  ): Promise<Span[]> {
    const result = await this.generateWithEvidence(text, tokens, options);
    return result.spans;
  }

  async generateWithEvidence(
    text: string,
    tokens: readonly Token[],
    options: CandidateGenerationOptions = {},
  ): Promise<ScientificCandidateResult> {
    const tracker =
      options.occurrenceTracker ??
      new OccurrenceLimitTracker(DEFAULT_PROCESSING_LIMITS.maxCandidateOccurrences);
    const parsedDocument: ParsedDocument | undefined = options.parsedDocument;
    throwIfAborted(options.signal);

    const bySpan = new Map<string, Span>();
    const evidenceBySpan = new Map<string, CandidateEvidence>();
    const hypotheses: AcronymExpansionHypothesis[] = [];

    const isEligible = (start: number, end: number): boolean => {
      if (start < 0 || end <= start || end > text.length) return false;
      if (parsedDocument && !isSpanEligibleInDocument(start, end, parsedDocument)) {
        return false;
      }
      return true;
    };

    const addSpanWithEvidence = (
      start: number,
      end: number,
      reason: CandidateReasonTag,
      posPattern?: string,
      hypothesis?: AcronymExpansionHypothesis,
    ): Span | null => {
      if (!isEligible(start, end)) return null;
      const surface = text.slice(start, end);
      if (surface.trim().length === 0 || !HAS_LETTER_RE.test(surface)) return null;
      if (surface.includes('\n') || surface.includes('\r')) return null;
      if (isBibliographicNoise(surface)) return null;

      const key = `${start}:${end}`;
      let span = bySpan.get(key);
      if (!span) {
        tracker.add(start, end);
        span = { start, end, surface };
        bySpan.set(key, span);
      }

      const existing = evidenceBySpan.get(key);
      if (existing) {
        if (!existing.reasons.includes(reason)) {
          existing.reasons.push(reason);
        }
        if (posPattern && !existing.posPattern) {
          existing.posPattern = posPattern;
        }
        if (hypothesis && !existing.abbreviationHypothesis) {
          existing.abbreviationHypothesis = hypothesis;
        }
      } else {
        evidenceBySpan.set(key, {
          spanKey: key,
          start,
          end,
          surface,
          grammarVersion: S2_CANDIDATE_GRAMMAR_VERSION,
          reasons: [reason],
          ...(posPattern ? { posPattern } : {}),
          ...(hypothesis ? { abbreviationHypothesis: hypothesis } : {}),
        });
      }
      return span;
    };

    let processedSinceYield = 0;
    const checkpoint = async () => {
      processedSinceYield += 1;
      if (processedSinceYield >= GENERATION_YIELD_INTERVAL) {
        processedSinceYield = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        throwIfAborted(options.signal);
      }
    };

    // 1. Bounded scientific symbol spans (exact UTF-16 slices)
    const symbolSpans: Span[] = [];
    const symbolRegex = new RegExp(S2_RAW_SYMBOL_RE.source, S2_RAW_SYMBOL_RE.flags);
    let symMatch = symbolRegex.exec(text);
    while (symMatch !== null) {
      const surface = symMatch[0];
      const start = symMatch.index;
      const end = start + surface.length;
      if (isQualifiedScientificSymbol(surface) && isEligible(start, end)) {
        const added = addSpanWithEvidence(start, end, 'scientific-symbol');
        if (added) {
          symbolSpans.push(added);
        }
      }
      await checkpoint();
      symMatch = symbolRegex.exec(text);
    }

    const isStrictSubSpanOfSymbol = (start: number, end: number): boolean => {
      let low = 0;
      let high = symbolSpans.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (symbolSpans[middle].start <= start) low = middle + 1;
        else high = middle;
      }
      const symbol = symbolSpans[low - 1];
      return Boolean(
        symbol &&
          symbol.start <= start &&
          end <= symbol.end &&
          (start > symbol.start || end < symbol.end),
      );
    };

    // Build contiguous-word-with-hyphen groupings over tokens so hyphenated scientific modifiers
    // (whether split as ["ligament", "-", "derived"] or kept as ["ligament-derived"]) work identically.
    const isHyphenToken = (tok: Token | undefined): boolean =>
      Boolean(tok && (tok.surface === '-' || tok.surface === '–'));

    const isScientificParticipleModifier = (index: number): { endIndex: number } | null => {
      const tok = tokens[index];
      if (!tok) return null;
      if (SCIENTIFIC_HYPHEN_MODIFIER_RE.test(tok.surface)) {
        return { endIndex: index };
      }
      if (
        index + 2 < tokens.length &&
        tokens[index + 1].sentenceId === tok.sentenceId &&
        tokens[index + 2].sentenceId === tok.sentenceId &&
        isHyphenToken(tokens[index + 1]) &&
        tokens[index + 1].start === tok.end &&
        tokens[index + 2].start === tokens[index + 1].end
      ) {
        const combined = text.slice(tok.start, tokens[index + 2].end);
        if (SCIENTIFIC_HYPHEN_MODIFIER_RE.test(combined)) {
          return { endIndex: index + 2 };
        }
      }
      return null;
    };

    // 2. Scientific POS & compound noun-phrase grammar (bounded within sentence & eligible section)
    for (let i = 0; i < tokens.length; i += 1) {
      await checkpoint();
      const startToken = tokens[i];
      if (!isEligible(startToken.start, startToken.end)) continue;

      const startMod = isScientificParticipleModifier(i);
      const canStart = START_POS.has(startToken.pos) || startMod !== null;
      if (!canStart) continue;

      // Skip starting directly on lowercase "et" when followed by "al"
      if (
        startToken.surface.toLowerCase() === 'et' &&
        tokens[i + 1]?.surface.toLowerCase().startsWith('al')
      ) {
        continue;
      }

      const sentenceId = startToken.sentenceId;
      const maxEndIndex = Math.min(tokens.length, i + MAX_PHRASE_TOKENS);
      let sawHyphenCompound = startMod !== null;
      let sawOfPhrase = false;

      for (let j = i; j < maxEndIndex; j += 1) {
        const curr = tokens[j];
        if (curr.sentenceId !== sentenceId) break;
        if (!isEligible(startToken.start, curr.end)) break;

        // Allow hyphenated scientific participle modifier sequence (e.g., ligament-derived)
        const modMatch = isScientificParticipleModifier(j);
        if (modMatch) {
          sawHyphenCompound = true;
          j = modMatch.endIndex;
          continue;
        }

        // Allow tight hyphen inside compound (e.g. non-small, cross-linked)
        if (
          j > i &&
          isHyphenToken(curr) &&
          j + 1 < maxEndIndex &&
          tokens[j + 1].sentenceId === sentenceId &&
          curr.start === tokens[j - 1].end &&
          tokens[j + 1].start === curr.end &&
          (START_POS.has(tokens[j + 1].pos) || tokens[j + 1].pos === 'VERB')
        ) {
          sawHyphenCompound = true;
          continue;
        }

        const currLower = curr.surface.toLowerCase();
        const isAllowedAdp =
          curr.pos === 'ADP' && SCIENTIFIC_CONNECTOR_WORDS.has(currLower) && j > i;
        if (isAllowedAdp) {
          sawOfPhrase = true;
        }

        // Eponym + gerund/scientific nominal head (e.g. "Gram staining", "Western blotting")
        const isEponymHead =
          j === i + 1 &&
          (startToken.pos === 'PROPN' || /^\p{Lu}\p{Ll}+$/u.test(startToken.surface)) &&
          (curr.pos === 'NOUN' ||
            (curr.pos === 'VERB' && SCIENTIFIC_GERUND_OR_NOMINAL_HEAD_RE.test(curr.surface)));

        if (isEponymHead) {
          const spanStart = startToken.start;
          const spanEnd = curr.end;
          if (!isStrictSubSpanOfSymbol(spanStart, spanEnd)) {
            const posPattern = tokens
              .slice(i, j + 1)
              .map((t) => t.pos)
              .join('+');
            addSpanWithEvidence(spanStart, spanEnd, 'eponym-term', posPattern);
          }
          continue;
        }

        const isPrenominalNominalVerb =
          curr.pos === 'VERB' &&
          j + 1 < maxEndIndex &&
          tokens[j + 1].sentenceId === sentenceId &&
          END_POS.has(tokens[j + 1].pos) &&
          !/^(?:is|are|was|were|be|been|being|have|has|had|do|does|did|can|could|may|might|must|shall|should|will|would)$/i.test(
            curr.surface,
          ) &&
          !/(?:ed|es)$/i.test(curr.surface) &&
          /^[a-z]{3,}$/i.test(curr.surface);

        if (j > i) {
          const validInternal =
            INTERNAL_POS.has(curr.pos) ||
            (curr.pos === 'VERB' && SCIENTIFIC_GERUND_OR_NOMINAL_HEAD_RE.test(curr.surface)) ||
            isPrenominalNominalVerb;
          if (!validInternal) {
            break;
          }
          // Reject arbitrary non-scientific ADP inside NP
          if (curr.pos === 'ADP' && !SCIENTIFIC_CONNECTOR_WORDS.has(currLower)) {
            break;
          }
        }

        const isValidEnd =
          END_POS.has(curr.pos) ||
          (j > i &&
            curr.pos === 'VERB' &&
            SCIENTIFIC_GERUND_OR_NOMINAL_HEAD_RE.test(curr.surface) &&
            (sawHyphenCompound || sawOfPhrase || startToken.pos === 'PROPN'));

        if (isValidEnd && !isStrictSubSpanOfSymbol(startToken.start, curr.end)) {
          const spanStart = startToken.start;
          const spanEnd = curr.end;
          const posPattern = tokens
            .slice(i, j + 1)
            .map((t) => t.pos)
            .join('+');

          let primaryReason: CandidateReasonTag = 'pos-np';
          if (sawHyphenCompound) {
            primaryReason = 'compound-hyphen';
          } else if (sawOfPhrase) {
            primaryReason = 'biomedical-of-phrase';
          } else if (
            j > i &&
            startToken.pos === 'PROPN' &&
            !/^\p{Lu}+$/u.test(startToken.surface)
          ) {
            primaryReason = 'eponym-term';
          }

          addSpanWithEvidence(spanStart, spanEnd, primaryReason, posPattern);
          if (sawHyphenCompound && sawOfPhrase) {
            addSpanWithEvidence(spanStart, spanEnd, 'biomedical-of-phrase', posPattern);
          }
        }
      }
    }

    // 3. Bounded acronym–long-form hypothesis extraction (strictly hypothesis-only)
    const acronymRegex = new RegExp(ACRONYM_PAIR_RE.source, ACRONYM_PAIR_RE.flags);
    let acMatch = acronymRegex.exec(text);
    while (acMatch !== null) {
      await checkpoint();
      const acronym = acMatch[1];
      const parenStart = acMatch.index;
      const acronymStart = parenStart + 1;
      const acronymEnd = acronymStart + acronym.length;

      if (isPlausibleAcronym(acronym) && isEligible(acronymStart, acronymEnd)) {
        // Inspect tokens immediately preceding "(" in the same sentence and eligible section
        const precedingTokens: Token[] = [];
        for (let t = tokens.length - 1; t >= 0; t -= 1) {
          const tok = tokens[t];
          if (tok.end > parenStart) continue;
          if (precedingTokens.length === 0) {
            // Ensure only whitespace separates last word and "("
            const gap = text.slice(tok.end, parenStart);
            if (!/^\s+$/.test(gap)) break;
            if (tok.pos === 'PUNCT') break;
            precedingTokens.unshift(tok);
          } else {
            const first = precedingTokens[0];
            if (tok.sentenceId !== first.sentenceId) break;
            if (tok.pos === 'PUNCT') break;
            const gap = text.slice(tok.end, first.start);
            if (/[.,;:!?\n\r()]/.test(gap)) break;
            precedingTokens.unshift(tok);
            if (precedingTokens.length >= 9) break;
          }
        }

        // Find shortest/tightest valid long-form suffix ending right before "("
        let matchedLongFormSpan: Span | null = null;
        for (let startIdx = precedingTokens.length - 2; startIdx >= 0; startIdx -= 1) {
          const windowTokens = precedingTokens.slice(startIdx);
          // Long form must start with a content word (not DET/ADP/conjunction)
          const firstTok = windowTokens[0];
          const firstLower = firstTok.surface.toLowerCase();
          if (
            firstTok.pos === 'DET' ||
            firstTok.pos === 'ADP' ||
            firstLower === 'and' ||
            firstLower === 'or'
          ) {
            continue;
          }
          const words = windowTokens.map((t) => t.surface);
          if (matchesAcronymInitials(acronym, words)) {
            const lfStart = firstTok.start;
            const lfEnd = windowTokens[windowTokens.length - 1].end;
            if (isEligible(lfStart, lfEnd)) {
              matchedLongFormSpan = {
                start: lfStart,
                end: lfEnd,
                surface: text.slice(lfStart, lfEnd),
              };
              break;
            }
          }
        }

        if (matchedLongFormSpan) {
          const hypothesis: AcronymExpansionHypothesis = {
            acronymSpan: { start: acronymStart, end: acronymEnd, surface: acronym },
            longFormSpan: matchedLongFormSpan,
            acronym,
            longForm: matchedLongFormSpan.surface,
            status: 'hypothesis-only',
          };
          hypotheses.push(hypothesis);
          addSpanWithEvidence(
            acronymStart,
            acronymEnd,
            'acronym-expansion-hypothesis',
            undefined,
            hypothesis,
          );
          addSpanWithEvidence(
            matchedLongFormSpan.start,
            matchedLongFormSpan.end,
            'acronym-expansion-hypothesis',
            undefined,
            hypothesis,
          );
        }
      }
      acMatch = acronymRegex.exec(text);
    }

    throwIfAborted(options.signal);
    return {
      spans: Array.from(bySpan.values()).sort(compareSpans),
      evidenceBySpan,
      hypotheses,
    };
  }
}
