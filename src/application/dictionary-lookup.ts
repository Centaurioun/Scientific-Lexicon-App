import AhoCorasick from 'ahocorasick';
import { assertCompatibleAutomatonShape } from '@/adapters/matching/registered-matcher';
import { checkScientificBoundary } from '@/domain/extraction';
import { isSpanEligibleInDocument, type ParsedDocument } from '@/domain/document-input';
import {
  type DictionaryPack,
  type DictionaryPackEntry,
  type DictionaryPackSuggestion,
} from '@/domain/dictionary-pack';
import { compareCodeUnits } from '@/domain/schema';
import type { OccurrenceLimitTracker } from '@/domain/processing-limits';

const LOOKUP_YIELD_INTERVAL = 2_048;

export interface DictionaryLookupOptions {
  parsedDocument?: ParsedDocument;
  occurrenceTracker?: OccurrenceLimitTracker;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Dictionary pack lookup was aborted.', 'AbortError');
  }
}

/**
 * Performs exact, case-sensitive, scientific-boundary-respecting lookup of a session-only
 * DictionaryPack against analyzed text. Never mutates canonical state or invents concept IDs.
 */
export async function lookupDictionaryPack(
  text: string,
  pack: DictionaryPack,
  options: DictionaryLookupOptions = {},
): Promise<DictionaryPackSuggestion[]> {
  throwIfAborted(options.signal);
  if (text.length === 0 || pack.entries.length === 0) {
    return [];
  }

  const byText = new Map<string, DictionaryPackEntry[]>();
  for (const entry of pack.entries) {
    const bucket = byText.get(entry.text);
    if (bucket) {
      bucket.push(entry);
    } else {
      byText.set(entry.text, [entry]);
    }
  }

  const patterns = Array.from(byText.keys());
  const automaton = new AhoCorasick(patterns);
  const machine = assertCompatibleAutomatonShape(automaton);

  const bySpan = new Map<
    string,
    { start: number; end: number; surface: string; entries: Map<string, DictionaryPackEntry> }
  >();

  let state = 0;
  let processed = 0;

  for (let i = 0; i < text.length; i += 1) {
    throwIfAborted(options.signal);
    const char = text[i];
    while (state > 0 && !(char in machine.gotoFn[state])) {
      state = machine.failure[state];
    }

    if (char in machine.gotoFn[state]) {
      state = machine.gotoFn[state][char];
      const matchedPatterns = machine.output[state] ?? [];
      for (const pattern of matchedPatterns) {
        const end = i + 1;
        const start = end - pattern.length;
        if (start < 0 || end > text.length) continue;

        const slice = text.slice(start, end);
        if (slice !== pattern) continue;

        if (
          options.parsedDocument &&
          !isSpanEligibleInDocument(start, end, options.parsedDocument)
        ) {
          continue;
        }

        const boundary = checkScientificBoundary(text, start, end);
        if (!boundary.allowed) continue;

        const entries = byText.get(pattern);
        if (!entries || entries.length === 0) continue;

        const spanKey = `${start}:${end}`;
        if (options.occurrenceTracker) {
          options.occurrenceTracker.add(start, end);
        }

        let bucket = bySpan.get(spanKey);
        if (!bucket) {
          bucket = {
            start,
            end,
            surface: slice,
            entries: new Map<string, DictionaryPackEntry>(),
          };
          bySpan.set(spanKey, bucket);
        }
        for (const entry of entries) {
          bucket.entries.set(entry.id, entry);
        }

        processed += 1;
        if (processed >= LOOKUP_YIELD_INTERVAL) {
          processed = 0;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          throwIfAborted(options.signal);
        }
      }
    }

    if ((i + 1) % LOOKUP_YIELD_INTERVAL === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      throwIfAborted(options.signal);
    }
  }

  throwIfAborted(options.signal);

  const suggestions: DictionaryPackSuggestion[] = [];
  for (const item of bySpan.values()) {
    suggestions.push({
      start: item.start,
      end: item.end,
      surface: item.surface,
      packId: pack.id,
      packName: pack.name,
      authority: pack.source.authority,
      release: pack.source.release,
      license: pack.source.license,
      entries: Array.from(item.entries.values()).sort((a, b) => compareCodeUnits(a.id, b.id)),
      status: 'unverified-pack-suggestion',
    });
  }

  return suggestions.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return compareCodeUnits(a.surface, b.surface);
  });
}
