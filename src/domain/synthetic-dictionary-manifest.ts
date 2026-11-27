import { deepFreeze, digest } from './changes';
import {
  DictionaryPackValidationError,
  type DictionaryPack,
} from './dictionary-pack';

export const SYNTHETIC_DICTIONARY_POLICY_VERSION = 'wp02-synthetic-allowlist-v1';

/**
 * Thrown when a schema-valid dictionary pack is rejected by the bounded WP02
 * synthetic-only qualification allowlist (either not in the project-owned
 * manifest or its canonical SHA-256 content digest does not match).
 *
 * Policy note: This bounded allowlist enforces synthetic-only qualification.
 * It is NOT legal rights verification for arbitrary third-party dictionaries.
 */
export class DictionaryPackPolicyError extends DictionaryPackValidationError {
  readonly packId: string;
  readonly actualSha256: string;

  constructor(message: string, packId: string, actualSha256: string) {
    super(message);
    this.name = 'DictionaryPackPolicyError';
    this.packId = packId;
    this.actualSha256 = actualSha256;
  }
}

export interface SyntheticDictionaryManifestEntry {
  readonly id: string;
  readonly name: string;
  readonly contentSha256: string;
  readonly purpose: string;
}

export const SYNTHETIC_DICTIONARY_FIXTURE_PAYLOADS = deepFreeze({
  'pack-synth-bio-v1': {
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
  },
  'synthetic-pack-one': {
    format: 'termforge-dictionary-pack',
    version: 1,
    id: 'synthetic-pack-one',
    name: 'First synthetic pack',
    source: {
      authority: 'Synthetic fixture',
      uri: 'https://example.invalid/synthetic-pack',
      release: 'fixture-v1',
      license: 'synthetic-only',
    },
    entries: [
      {
        id: 'synthetic-pack-one-entry',
        text: 'Na+/K+-ATPase',
        language: { kind: 'shared' as const },
      },
    ],
  },
  'synthetic-pack-two': {
    format: 'termforge-dictionary-pack',
    version: 1,
    id: 'synthetic-pack-two',
    name: 'Delayed synthetic pack',
    source: {
      authority: 'Synthetic fixture',
      uri: 'https://example.invalid/synthetic-pack',
      release: 'fixture-v1',
      license: 'synthetic-only',
    },
    entries: [
      {
        id: 'synthetic-pack-two-entry',
        text: 'Na+/K+-ATPase',
        language: { kind: 'shared' as const },
      },
    ],
  },
  'pack-synth-sentinel-v1': {
    format: 'termforge-dictionary-pack',
    version: 1,
    id: 'pack-synth-sentinel-v1',
    name: 'Synthetic Privacy Sentinel Pack',
    source: {
      authority: 'Synthetic Privacy Audit Fixture',
      uri: 'https://example.invalid/synth-privacy-sentinel-v1',
      release: '2026.11-synthetic',
      license: 'CC0-1.0-Synthetic-Fixture',
    },
    entries: [
      {
        id: 'sentinel-e-1',
        text: 'SYNTH_PACK_SENTINEL_7F3A',
        language: { kind: 'shared' as const },
        externalId: 'SYNTH-PRIV:0001',
      },
      {
        id: 'sentinel-e-2',
        text: 'Na+/K+-ATPase',
        language: { kind: 'shared' as const },
        externalId: 'SYNTH-PRIV:0002',
      },
    ],
  },
}) as Readonly<Record<string, DictionaryPack>>;

/**
 * Immutable project-owned synthetic fixture manifest (QC01).
 * Activation requires exact SHA-256 digest match over canonical JSON content;
 * self-declared filename, pack ID, URI, authority, or license is insufficient.
 */
export const APPROVED_SYNTHETIC_DICTIONARY_PACKS: readonly SyntheticDictionaryManifestEntry[] =
  deepFreeze([
    {
      id: 'pack-synth-bio-v1',
      name: 'Synthetic Biomedical Reference Pack',
      contentSha256: 'b94a37e434dff8894a90d138d5bd3a32ac6541e525989d1b359e24fbc07bdb48',
      purpose: 'Primary WP02 synthetic biomedical lookup and multi-ID suggestion fixture.',
    },
    {
      id: 'synthetic-pack-one',
      name: 'First synthetic pack',
      contentSha256: '6d0e2b12b05372c265d1a1e700e6cc297678b951840eef0ba45025251cc3433c',
      purpose: 'Synthetic upload overlap and clear-race qualification fixture (1 of 2).',
    },
    {
      id: 'synthetic-pack-two',
      name: 'Delayed synthetic pack',
      contentSha256: 'e94410eca04ba73d64208837980f394578a9b0a7c4891150ec4cb9eb46bb9e0f',
      purpose: 'Synthetic upload overlap and clear-race qualification fixture (2 of 2).',
    },
    {
      id: 'pack-synth-sentinel-v1',
      name: 'Synthetic Privacy Sentinel Pack',
      contentSha256: 'a3d3aeb6954ef96ff28304d8157b4778fae0146deb08cd577162f9ff0e5aa59f',
      purpose: 'Synthetic sentinel pack for session-only privacy and backup isolation verification.',
    },
  ]);

const MANIFEST_BY_ID = new Map<string, SyntheticDictionaryManifestEntry>(
  APPROVED_SYNTHETIC_DICTIONARY_PACKS.map((entry) => [entry.id, entry]),
);

export async function computeDictionaryPackDigest(pack: DictionaryPack): Promise<string> {
  return digest(pack);
}

/**
 * Verifies that a schema-valid DictionaryPack matches an immutable project-owned
 * synthetic fixture manifest entry by exact pack ID AND canonical SHA-256 content digest.
 * Fails closed on any unknown pack or any 1-character content/metadata tamper.
 */
export async function verifyApprovedSyntheticDictionaryPack(pack: DictionaryPack): Promise<{
  entry: SyntheticDictionaryManifestEntry;
  contentSha256: string;
}> {
  const actualSha256 = await computeDictionaryPackDigest(pack);
  const manifestEntry = MANIFEST_BY_ID.get(pack.id);

  if (!manifestEntry) {
    throw new DictionaryPackPolicyError(
      `Dictionary pack "${pack.id}" is not in the approved WP02 synthetic fixture allowlist (${SYNTHETIC_DICTIONARY_POLICY_VERSION}). Arbitrary third-party packs are blocked during synthetic qualification; self-declared metadata does not grant activation.`,
      pack.id,
      actualSha256,
    );
  }

  if (manifestEntry.contentSha256 !== actualSha256) {
    throw new DictionaryPackPolicyError(
      `Dictionary pack "${pack.id}" failed exact SHA-256 content digest verification (expected ${manifestEntry.contentSha256.slice(0, 12)}…, computed ${actualSha256.slice(0, 12)}…). Tampered or modified packs are rejected before activation.`,
      pack.id,
      actualSha256,
    );
  }

  return { entry: manifestEntry, contentSha256: actualSha256 };
}
