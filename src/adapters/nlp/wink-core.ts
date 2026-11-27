import winkNLP, { type ItemSentence, type WinkMethods } from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import type { CanonicalPos, NlpEngine, Token } from '@/domain/extraction';

export class OffsetReconstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OffsetReconstructionError';
  }
}

export interface RawWinkToken {
  value: string;
  pos: string;
  sentenceId: number;
  precedingSpaces: string;
}

const GAP_ALLOWED_RE = /^[\s\u200B-\u200D\uFEFF]*$/;

export function mapWinkPosToCanonical(rawPos: string): CanonicalPos {
  switch (rawPos) {
    case 'NOUN':
      return 'NOUN';
    case 'PROPN':
      return 'PROPN';
    case 'ADJ':
      return 'ADJ';
    case 'ADP':
      return 'ADP';
    case 'DET':
      return 'DET';
    case 'VERB':
    case 'AUX':
      return 'VERB';
    case 'NUM':
      return 'NUM';
    case 'SYM':
      return 'SYM';
    case 'PUNCT':
      return 'PUNCT';
    default:
      return 'OTHER';
  }
}

/**
 * Reconstructs exact half-open UTF-16 token spans against original source text.
 * Fails explicitly with OffsetReconstructionError if any token cannot be aligned
 * or if non-whitespace characters are skipped.
 */
export function reconstructTokenSpans(text: string, rawTokens: readonly RawWinkToken[]): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  for (let i = 0; i < rawTokens.length; i += 1) {
    const raw = rawTokens[i];
    if (!raw.value || raw.value.length === 0) {
      throw new OffsetReconstructionError(`Empty token surface encountered at token index ${i}.`);
    }

    let start = -1;
    const expectedStart = cursor + raw.precedingSpaces.length;

    if (
      text.startsWith(raw.precedingSpaces, cursor) &&
      text.startsWith(raw.value, expectedStart)
    ) {
      start = expectedStart;
    } else {
      const found = text.indexOf(raw.value, cursor);
      if (found === -1) {
        throw new OffsetReconstructionError(
          `Unable to locate token "${raw.value}" at or after UTF-16 offset ${cursor}.`,
        );
      }
      const gap = text.slice(cursor, found);
      if (!GAP_ALLOWED_RE.test(gap)) {
        throw new OffsetReconstructionError(
          `Unexpected non-whitespace gap between UTF-16 offsets ${cursor} and ${found} before token "${raw.value}".`,
        );
      }
      start = found;
    }

    const end = start + raw.value.length;
    if (end <= start || end > text.length) {
      throw new OffsetReconstructionError(
        `Invalid reconstructed span [${start}, ${end}) for token "${raw.value}".`,
      );
    }

    const slice = text.slice(start, end);
    if (slice !== raw.value) {
      throw new OffsetReconstructionError(
        `Reconstructed slice "${slice}" does not match token surface "${raw.value}" at [${start}, ${end}).`,
      );
    }

    tokens.push({
      start,
      end,
      surface: slice,
      pos: mapWinkPosToCanonical(raw.pos),
      sentenceId: raw.sentenceId,
    });
    cursor = end;
  }

  return mergeSplitUnicodeWordTokens(text, tokens);
}

const UNICODE_WORD_FRAGMENT_RE = /^[\p{L}\p{M}]+$/u;

function mergeSplitUnicodeWordTokens(text: string, tokens: readonly Token[]): Token[] {
  if (tokens.length <= 1) return [...tokens];

  const merged: Token[] = [tokens[0]];
  for (let i = 1; i < tokens.length; i += 1) {
    const prev = merged[merged.length - 1];
    const curr = tokens[i];
    if (
      prev.sentenceId === curr.sentenceId &&
      prev.end === curr.start &&
      UNICODE_WORD_FRAGMENT_RE.test(prev.surface) &&
      UNICODE_WORD_FRAGMENT_RE.test(curr.surface)
    ) {
      const surface = text.slice(prev.start, curr.end);
      merged[merged.length - 1] = {
        start: prev.start,
        end: curr.end,
        surface,
        pos: prev.pos !== 'OTHER' ? prev.pos : curr.pos,
        sentenceId: prev.sentenceId,
      };
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

let cachedWinkInstance: WinkMethods | null = null;

function getWinkInstance(): WinkMethods {
  if (!cachedWinkInstance) {
    cachedWinkInstance = winkNLP(model);
  }
  return cachedWinkInstance;
}

const NON_TERMINAL_ABBREVS = new Set([
  'Dr',
  'Mr',
  'Mrs',
  'Ms',
  'Prof',
  'Fig',
  'Figs',
  'Tab',
  'Ref',
  'Refs',
  'No',
  'Vol',
  'al',
  'vs',
  'etc',
  'approx',
  'inc',
  'ed',
  'eds',
  'p',
  'pp',
]);

function shouldSplitAfterSentencePunct(
  values: readonly string[],
  spaces: readonly string[],
  index: number,
): boolean {
  const token = values[index];
  if (index + 1 >= values.length) return false;

  const nextSpace = spaces[index + 1];
  if (!nextSpace || nextSpace.length === 0) return false;

  const isStandalonePunct = token === '.' || token === '!' || token === '?';
  const isAttachedSymbolPeriod =
    /^[A-Z]\.$/.test(token) && spaces[index] === '' && index > 0;

  if (!isStandalonePunct && !isAttachedSymbolPeriod) return false;
  if (nextSpace.includes('\n')) return true;

  if (isStandalonePunct) {
    const prev = index > 0 ? values[index - 1] : '';
    if (NON_TERMINAL_ABBREVS.has(prev)) return false;

    const prevPrev = index > 1 ? values[index - 2] : '';
    if (prev.length === 1 && /^[A-Z]$/.test(prev) && prevPrev !== '-') {
      return false;
    }
  }

  const nextVal = values[index + 1];
  return /^[\p{Lu}\p{N}]/u.test(nextVal);
}

export class WinkNlpEngine implements NlpEngine {
  async analyze(text: string): Promise<Token[]> {
    if (text.trim().length === 0) {
      return [];
    }

    const nlp = getWinkInstance();
    const doc = nlp.readDoc(text);
    const rawTokens: RawWinkToken[] = [];

    let sentenceIndex = 0;
    doc.sentences().each((sentence: ItemSentence) => {
      const sentenceTokens = sentence.tokens();
      const values = sentenceTokens.out(nlp.its.value);
      const posTags = sentenceTokens.out(nlp.its.pos);
      const spaces = sentenceTokens.out(nlp.its.precedingSpaces);

      if (values.length !== posTags.length || values.length !== spaces.length) {
        throw new OffsetReconstructionError(
          `Wink token attribute arrays diverged in sentence ${sentenceIndex}.`,
        );
      }

      for (let i = 0; i < values.length; i += 1) {
        rawTokens.push({
          value: values[i],
          pos: posTags[i],
          sentenceId: sentenceIndex,
          precedingSpaces: spaces[i],
        });
        if (shouldSplitAfterSentencePunct(values, spaces, i)) {
          sentenceIndex += 1;
        }
      }
      sentenceIndex += 1;
    });

    return reconstructTokenSpans(text, rawTokens);
  }
}
