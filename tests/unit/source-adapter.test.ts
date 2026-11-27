import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSourceRegistryEntry,
  listSourceRegistryEntries,
  SOURCE_REGISTRY_ENTRIES,
} from '@/domain/source-registry';
import {
  lookupSyntheticSourceEvidence,
  verifySyntheticSourceEntries,
  SYNTHETIC_LEXICON_DATASET_SHA256,
  SYNTHETIC_LEXICON_ENTRIES,
} from '@/adapters/sources/synthetic-source-adapter';
import { selectEnrichmentTargets } from '@/application/enrichment-tasks';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

const TS = '2026-11-27T12:00:00.000Z';

function makeSnapshot(): LibrarySnapshot {
  return {
    ...createEmptySnapshot(),
    libraryRevision: 2,
    concepts: [
      { id: 'c-sulcus', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c-pd-1', revision: 1, createdAt: TS, updatedAt: TS },
      { id: 'c-pd-2', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c-p53-lower', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c-P53-upper', revision: 0, createdAt: TS, updatedAt: TS },
    ],
    expressions: [
      {
        id: 'e-1',
        conceptId: 'c-sulcus',
        revision: 0,
        text: 'gingival sulcus',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-2',
        conceptId: 'c-pd-1',
        revision: 0,
        text: 'PD',
        language: { kind: 'language', tag: 'en' },
        role: 'abbreviation',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-3',
        conceptId: 'c-pd-2',
        revision: 0,
        text: 'PD',
        language: { kind: 'language', tag: 'en' },
        role: 'abbreviation',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-4',
        conceptId: 'c-p53-lower',
        revision: 0,
        text: 'p53',
        language: { kind: 'shared' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-5',
        conceptId: 'c-P53-upper',
        revision: 0,
        text: 'P53',
        language: { kind: 'shared' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    provenance: [
      { id: 'p-1', expressionId: 'e-1', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-2', expressionId: 'e-2', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-3', expressionId: 'e-3', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-4', expressionId: 'e-4', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-5', expressionId: 'e-5', kind: 'manual', createdAt: TS, source: null },
    ],
  };
}

describe('WP04 F3: Typed source registry & offline synthetic adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists 1 enabled offline synthetic source and explicit disabled/conditional dossiers separating license metadata from legal rights verification', () => {
    const entries = listSourceRegistryEntries();
    const enabled = entries.filter((e) => e.enabled);
    expect(enabled.length).toBe(1);
    expect(enabled[0].sourceId).toBe('synth-bilingual-lexicon-v1');
    expect(enabled[0].mode).toBe('synthetic-offline');
    expect(enabled[0].rightsVerified).toBe(false);

    const disabledIds = SOURCE_REGISTRY_ENTRIES.filter((e) => !e.enabled).map((e) => e.sourceId);
    expect(disabledIds).toEqual(
      expect.arrayContaining([
        'nlm-mesh',
        'nlm-specialist',
        'obo-foundry-subset',
        'umls-metathesaurus',
        'pubtator3',
        'tdk-sozluk',
        'tuba-terimler',
        'tbt-terim',
      ]),
    );
    for (const entry of entries.filter((e) => !e.enabled)) {
      expect(entry.disabledReason.length).toBeGreaterThan(10);
      expect(entry.rightsVerified).toBe(false);
    }
    expect(getSourceRegistryEntry('unknown-source-id')).toBeNull();
  });

  it('rejects unknown, disabled/remote, tampered dataset, or missing-metadata entries without making any network fetch calls', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('Network fetch is strictly forbidden in offline adapter');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const snapshot = makeSnapshot();
    const selection = selectEnrichmentTargets(
      snapshot,
      [{ conceptId: 'c-sulcus', expectedConceptRevision: 0 }],
      'missing-tr',
    );

    await expect(
      lookupSyntheticSourceEvidence(snapshot, selection, { sourceId: 'nlm-mesh' }),
    ).rejects.toThrow(/disabled|conditional/i);

    await expect(
      lookupSyntheticSourceEvidence(snapshot, selection, { sourceId: 'unknown-id' }),
    ).rejects.toThrow(/unknown|allowlist/i);

    const tamperedEntries = SYNTHETIC_LEXICON_ENTRIES.map((entry, idx) =>
      idx === 0 ? { ...entry, candidateText: 'TAMPERED_TERM' } : entry,
    );
    await expect(
      verifySyntheticSourceEntries(tamperedEntries, SYNTHETIC_LEXICON_DATASET_SHA256),
    ).rejects.toThrow(/digest|tamper|checksum/i);

    const missingMetadataEntries = SYNTHETIC_LEXICON_ENTRIES.map((entry, idx) =>
      idx === 0 ? { ...entry, sourceRelease: '' } : entry,
    );
    await expect(
      verifySyntheticSourceEntries(missingMetadataEntries, SYNTHETIC_LEXICON_DATASET_SHA256),
    ).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('matches exact Unicode/case targets deterministically, surfaces ambiguous multiple candidates without auto-linking, and performs zero canonical writes', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const snapshot = makeSnapshot();
    const beforeSnapshotJson = JSON.stringify(snapshot);

    const selection = selectEnrichmentTargets(
      snapshot,
      [
        { conceptId: 'c-sulcus', expectedConceptRevision: 0 },
        { conceptId: 'c-pd-1', expectedConceptRevision: 1 },
        { conceptId: 'c-pd-2', expectedConceptRevision: 0 },
        { conceptId: 'c-p53-lower', expectedConceptRevision: 0 },
        { conceptId: 'c-P53-upper', expectedConceptRevision: 0 },
      ],
      'missing-tr',
    );

    const result = await lookupSyntheticSourceEvidence(snapshot, selection, {
      sourceId: 'synth-bilingual-lexicon-v1',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.sourceId).toBe('synth-bilingual-lexicon-v1');
    expect(result.fixtureDigest).toBe(SYNTHETIC_LEXICON_DATASET_SHA256);
    expect(result.rightsVerified).toBe(false);

    // c-sulcus matches synthetic 'gingival sulcus' -> 'dişeti oluğu'
    const sulcusCandidates = result.candidates.filter((c) => c.targetConceptId === 'c-sulcus');
    expect(sulcusCandidates.length).toBeGreaterThanOrEqual(1);
    expect(sulcusCandidates[0].candidateText).toBe('dişeti oluğu');
    expect(sulcusCandidates[0].verificationStatus).toBe('synthetic-unverified');
    expect(sulcusCandidates[0].sourceUri).toContain('synth://');

    // Ambiguous abbreviation PD surfaces multiple independent candidates without merging or auto-linking
    const pdCandidates = result.candidates.filter((c) => c.targetConceptId === 'c-pd-1');
    expect(pdCandidates.length).toBeGreaterThanOrEqual(2);
    expect(result.ambiguousTargetConceptIds).toEqual(expect.arrayContaining(['c-pd-1', 'c-pd-2']));

    // Exact Unicode/case preserved: p53 and P53 stay distinct
    const lowerP53 = result.candidates.filter((c) => c.targetConceptId === 'c-p53-lower');
    const upperP53 = result.candidates.filter((c) => c.targetConceptId === 'c-P53-upper');
    expect(lowerP53.every((c) => c.matchedQuerySurface === 'p53')).toBe(true);
    expect(upperP53.every((c) => c.matchedQuerySurface === 'P53')).toBe(true);
    if (lowerP53.length > 0 && upperP53.length > 0) {
      expect(lowerP53[0].candidateText).not.toBe(upperP53[0].candidateText);
    }

    // Zero canonical writes
    expect(JSON.stringify(snapshot)).toBe(beforeSnapshotJson);
  });
});
