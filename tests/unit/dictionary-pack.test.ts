import { describe, expect, it } from 'vitest';
import { AhoCorasickRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import { WinkNlpEngine } from '@/adapters/nlp/wink-engine';
import { parseMarkdownDocument } from '@/adapters/documents/markdown';
import { analyzeText } from '@/application/extraction';
import { readDictionaryPackFile } from '@/application/dictionary-pack-file';
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
import {
  APPROVED_SYNTHETIC_DICTIONARY_PACKS,
  DictionaryPackPolicyError,
  SYNTHETIC_DICTIONARY_FIXTURE_PAYLOADS,
  verifyApprovedSyntheticDictionaryPack,
} from '@/domain/synthetic-dictionary-manifest';
import { createBackup } from '@/domain/backup';

function createValidSyntheticPackPayload() {
  return structuredClone(SYNTHETIC_DICTIONARY_FIXTURE_PAYLOADS['pack-synth-bio-v1']);
}

describe('D6: Local dictionary pack staging, validation, and read-only lookup', () => {
  const nlp = new WinkNlpEngine();
  const matcher = new AhoCorasickRegisteredMatcher();

  it('validates a well-formed synthetic pack and rejects duplicate IDs, missing provenance, tampered fields, and oversized files', () => {
    const valid = parseDictionaryPack(createValidSyntheticPackPayload());
    expect(valid.id).toBe('pack-synth-bio-v1');
    expect(valid.entries).toHaveLength(4);

    const noUri = createValidSyntheticPackPayload();
    // @ts-expect-error testing runtime rejection of missing required provenance
    delete noUri.source.uri;
    expect(() => parseDictionaryPack(noUri)).toThrow(DictionaryPackValidationError);

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

  it('rejects dictionary lookup metadata whose text differs from the analyzed coordinate source', async () => {
    const pack = parseDictionaryPack(createValidSyntheticPackPayload());
    const parsed = parseMarkdownDocument('PD in the original source.');
    await expect(
      lookupDictionaryPack('different source text', pack, { parsedDocument: parsed }),
    ).rejects.toThrow(/must exactly match/i);
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

  it('rejects oversized pack files before reading and rejects malformed UTF-8', async () => {
    let readCount = 0;
    await expect(
      readDictionaryPackFile({
        size: MAX_DICTIONARY_PACK_BYTES + 1,
        async arrayBuffer() {
          readCount += 1;
          return new ArrayBuffer(0);
        },
      }),
    ).rejects.toThrow(/rejected without reading/i);
    expect(readCount).toBe(0);

    await expect(
      readDictionaryPackFile({
        size: 2,
        async arrayBuffer() {
          return new Uint8Array([0xc3, 0x28]).buffer;
        },
      }),
    ).rejects.toThrow(/invalid UTF-8/i);
  });

  it('bounds dense repeated-surface lookup while sharing entry collections across matching spans', async () => {
    const payload = createValidSyntheticPackPayload();
    payload.entries = Array.from({ length: 100 }, (_, i) => ({
      id: `dense-entry-${i}`,
      text: 'PD',
      language: { kind: 'shared' as const },
      externalId: `SYNTH:${i}`,
    }));
    const pack = parseDictionaryPack(payload);
    const text = Array.from({ length: 2_000 }, () => 'PD').join(' ');
    const suggestions = await lookupDictionaryPack(text, pack);
    expect(suggestions).toHaveLength(2_000);
    expect(suggestions[0].entries).toHaveLength(100);
    expect(suggestions[0].entries).toBe(suggestions.at(-1)?.entries);
  });

  it('enforces QC01 immutable synthetic manifest digest verification on activation and rejects tampered or arbitrary schema-valid packs', async () => {
    const makeJsonFile = (value: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      return {
        size: bytes.byteLength,
        async arrayBuffer() {
          return bytes.slice().buffer;
        },
      };
    };

    // 1. All allowlisted project-owned synthetic fixtures activate cleanly with exact SHA-256 match
    expect(APPROVED_SYNTHETIC_DICTIONARY_PACKS.length).toBeGreaterThanOrEqual(4);
    const approvedPayload = createValidSyntheticPackPayload();
    const loaded = await readDictionaryPackFile(makeJsonFile(approvedPayload));
    expect(loaded.id).toBe('pack-synth-bio-v1');
    const verified = await verifyApprovedSyntheticDictionaryPack(loaded);
    expect(verified.entry.id).toBe('pack-synth-bio-v1');
    expect(verified.contentSha256).toMatch(/^[0-9a-f]{64}$/);

    // 2. Tampered allowlisted pack (identical id, authority, uri, release, license; 1 char altered in entry) rejected
    const tamperedEntry = createValidSyntheticPackPayload();
    tamperedEntry.entries[0].text = 'PD2';
    await expect(readDictionaryPackFile(makeJsonFile(tamperedEntry))).rejects.toThrow(
      DictionaryPackPolicyError,
    );

    // 3. Tampered allowlisted pack metadata (same id, different license) rejected
    const tamperedMeta = createValidSyntheticPackPayload();
    tamperedMeta.source.license = 'CC0-1.0-Tampered';
    await expect(readDictionaryPackFile(makeJsonFile(tamperedMeta))).rejects.toThrow(
      DictionaryPackPolicyError,
    );

    // 4. Arbitrary schema-valid pack with synthetic-looking self-declared URI/license/authority rejected
    const arbitrary = {
      format: 'termforge-dictionary-pack',
      version: 1,
      id: 'arbitrary-external-pack-v1',
      name: 'Arbitrary Schema-Valid Pack',
      source: {
        authority: 'Synthetic Test Authority',
        uri: 'https://example.invalid/synth-bio-v1',
        release: '2026.11-synthetic',
        license: 'CC0-1.0-Synthetic-Fixture',
      },
      entries: [
        {
          id: 'arb-e-1',
          text: 'TNF-α',
          language: { kind: 'shared' as const },
        },
      ],
    };
    // Pure schema parser still parses valid v1 shape for internal stress/unit APIs
    expect(parseDictionaryPack(arbitrary).id).toBe('arbitrary-external-pack-v1');
    // Activation via file loader or policy verifier fails closed
    await expect(readDictionaryPackFile(makeJsonFile(arbitrary))).rejects.toThrow(
      DictionaryPackPolicyError,
    );

    // 5. Backup isolation: staging a sentinel pack in RAM never leaks into canonical backup JSON
    const sentinelPack = await readDictionaryPackFile(
      makeJsonFile(SYNTHETIC_DICTIONARY_FIXTURE_PAYLOADS['pack-synth-sentinel-v1']),
    );
    setSessionDictionaryPack(sentinelPack);
    try {
      const backupJson = JSON.stringify(await createBackup(createEmptySnapshot()));
      expect(backupJson).not.toContain('pack-synth-sentinel-v1');
      expect(backupJson).not.toContain('SYNTH_PACK_SENTINEL_7F3A');
    } finally {
      clearSessionDictionaryPack();
    }
  });
});
