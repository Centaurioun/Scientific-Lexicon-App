import { describe, expect, it } from 'vitest';
import { AhoCorasickRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import { WinkNlpEngine } from '@/adapters/nlp/wink-engine';
import { parseMarkdownDocument } from '@/adapters/documents/markdown';
import { analyzeText } from '@/application/extraction';
import { lookupDictionaryPack } from '@/application/dictionary-lookup';
import {
  DictionaryPackValidationError,
  MAX_DICTIONARY_PACK_BYTES,
  parseDictionaryPack,
  parseDictionaryPackJson,
} from '@/domain/dictionary-pack';
import {
  clearSessionDictionaryPack,
  getSessionDictionaryPack,
  setSessionDictionaryPack,
} from '@/features/extraction/dictionary-pack-store';
import { createEmptySnapshot } from '@/domain/schema';
import { OccurrenceLimitExceededError, OccurrenceLimitTracker } from '@/domain/processing-limits';

function createValidSyntheticPackPayload() {
  return {
    format: 'termforge-dictionary-pack',
    version: 1,
    id: 'pack-synth-bio-v1',
    name: 'Synthetic Biomedical Reference Pack',
    source: {
      authority: 'Synthetic Test Authority',
      uri: 'https://example.invalid/synth-bio-v1',
      release: '2026.11-synthetic',
      license: 'CC0-1.0-Synthetic-Fixture',
    },
    entries: [
      {
        id: 'pack-e-1',
        text: 'PD',
        language: { kind: 'shared' as const },
        externalId: 'SYNTH:0001',
      },
      {
        id: 'pack-e-2',
        text: 'PD',
        language: { kind: 'shared' as const },
        externalId: 'SYNTH:0002',
      },
      {
        id: 'pack-e-3',
        text: 'Na+/K+-ATPase',
        language: { kind: 'shared' as const },
        externalId: 'SYNTH:0003',
      },
      {
        id: 'pack-e-4',
        text: 'periodontal ligament',
        language: { kind: 'language' as const, tag: 'en' as const },
        externalId: 'SYNTH:0004',
      },
    ],
  };
}

describe('D6: Local dictionary pack staging, validation, and read-only lookup', () => {
  const nlp = new WinkNlpEngine();
  const matcher = new AhoCorasickRegisteredMatcher();

  it('validates a well-formed synthetic pack and rejects duplicate IDs, missing provenance, tampered fields, and oversized files', () => {
    const valid = parseDictionaryPack(createValidSyntheticPackPayload());
    expect(valid.id).toBe('pack-synth-bio-v1');
    expect(valid.entries).toHaveLength(4);

    // Duplicate entry IDs rejected
    const dup = createValidSyntheticPackPayload();
    dup.entries[1].id = dup.entries[0].id;
    expect(() => parseDictionaryPack(dup)).toThrow(DictionaryPackValidationError);

    // Missing source license rejected
    const noLicense = createValidSyntheticPackPayload();
    // @ts-expect-error testing runtime rejection of missing license
    delete noLicense.source.license;
    expect(() => parseDictionaryPack(noLicense)).toThrow(DictionaryPackValidationError);

    // Tampered unknown field rejected (strict schema)
    const tampered = { ...createValidSyntheticPackPayload(), injectedCanonicalWrite: true };
    expect(() => parseDictionaryPack(tampered)).toThrow(DictionaryPackValidationError);

    // Oversized JSON rejected before parse
    const oversize = ' '.repeat(MAX_DICTIONARY_PACK_BYTES + 16);
    expect(() => parseDictionaryPackJson(oversize)).toThrow(DictionaryPackValidationError);
  });

  it('matches multiple entry IDs on the same surface as unverified read-only suggestions and respects Markdown excluded ranges', async () => {
    const pack = parseDictionaryPack(createValidSyntheticPackPayload());
    const md = 'PD and Na+/K+-ATPase appear here, while `PD` inside code is ignored.';
    const parsedDoc = parseMarkdownDocument(md);

    const suggestions = await lookupDictionaryPack(parsedDoc.text, pack, {
      parsedDocument: parsedDoc,
    });

    // Only the first PD (outside inline code) and Na+/K+-ATPase match
    const pdMatches = suggestions.filter((s) => s.surface === 'PD');
    expect(pdMatches).toHaveLength(1);
    expect(pdMatches[0].status).toBe('unverified-pack-suggestion');
    expect(pdMatches[0].entries.map((e) => e.id)).toEqual(['pack-e-1', 'pack-e-2']);
    expect(pdMatches[0].authority).toBe('Synthetic Test Authority');
    expect(pdMatches[0].license).toBe('CC0-1.0-Synthetic-Fixture');

    expect(suggestions.some((s) => s.surface === 'Na+/K+-ATPase')).toBe(true);
  });

  it('keeps dictionary pack hints strictly read-only (never known-form or DB mutation) and enforces shared OccurrenceLimitTracker', async () => {
    const pack = parseDictionaryPack(createValidSyntheticPackPayload());
    const snapshot = createEmptySnapshot();
    const text = 'PD regulates Na+/K+-ATPase inside periodontal ligament tissue.';

    const run = await analyzeText(text, snapshot, nlp, matcher, {
      grammarMode: 's2-grammar-2',
      dictionaryPack: pack,
      useDictionaryPackAsDiscoveryHints: true,
    });

    // Library snapshot revision unchanged & zero canonical records mutated
    expect(snapshot.libraryRevision).toBe(0);
    expect(snapshot.concepts).toHaveLength(0);
    expect(snapshot.expressions).toHaveLength(0);

    // Pack matches are NEVER elevated to known-form
    expect(run.occurrences.some((o) => o.state === 'known-form')).toBe(false);
    expect(run.packSuggestionsBySpan).toBeDefined();

    const pdOcc = run.occurrences.find((o) => o.surface === 'PD');
    expect(pdOcc).toBeDefined();
    expect(pdOcc?.state).toBe('new-candidate');
    expect(pdOcc?.conceptIds).toEqual([]);
    const pdKey = `${pdOcc!.start}:${pdOcc!.end}`;
    expect(run.packSuggestionsBySpan?.get(pdKey)?.[0].entries).toHaveLength(2);
    expect(run.evidenceBySpan?.get(pdKey)?.reasons).toContain('dictionary-pack-hint');

    // Discovery hints share the OccurrenceLimitTracker
    const tinyTracker = new OccurrenceLimitTracker(1);
    await expect(
      lookupDictionaryPack(text, pack, { occurrenceTracker: tinyTracker }),
    ).rejects.toThrow(OccurrenceLimitExceededError);
  });

  it('stores active dictionary pack strictly in RAM-only session store', () => {
    clearSessionDictionaryPack();
    expect(getSessionDictionaryPack()).toBeNull();
    const pack = parseDictionaryPack(createValidSyntheticPackPayload());
    setSessionDictionaryPack(pack);
    expect(getSessionDictionaryPack()?.id).toBe(pack.id);
    clearSessionDictionaryPack();
    expect(getSessionDictionaryPack()).toBeNull();
  });
});
