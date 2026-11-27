import { deepFreeze } from './changes';

export type SourceAdapterMode = 'synthetic-offline' | 'future-conditional-disabled';

export interface SourceRegistryEntry {
  readonly sourceId: string;
  readonly displayName: string;
  readonly mode: SourceAdapterMode;
  readonly enabled: boolean;
  readonly sourceRelease: string;
  readonly licenseLabel: string;
  readonly rightsVerified: boolean;
  readonly referenceUri: string;
  readonly disabledReason: string;
  readonly pendingGates: readonly string[];
}

/**
 * Typed source registry (WP04 F3 & F10).
 * Separates descriptive license metadata from legal/scientific verification (`rightsVerified: false`),
 * enables strictly 1 offline project-owned synthetic fixture adapter, and explicitly blocks
 * conditional/remote biomedical & Turkish terminology candidates until rights/API/terms gates pass.
 */
export const SOURCE_REGISTRY_ENTRIES: readonly SourceRegistryEntry[] = deepFreeze([
  {
    sourceId: 'synth-bilingual-lexicon-v1',
    displayName: 'TermForge Synthetic Bilingual Fixture v1 (Offline)',
    mode: 'synthetic-offline',
    enabled: true,
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    rightsVerified: false,
    referenceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1',
    disabledReason: '',
    pendingGates: [
      'Synthetic test corpus only; replace only under G4 real-data clearance',
    ],
  },
  {
    sourceId: 'nlm-mesh',
    displayName: 'NLM Medical Subject Headings (MeSH)',
    mode: 'future-conditional-disabled',
    enabled: false,
    sourceRelease: 'pending-qualification',
    licenseLabel: 'NLM MeSH Terms / Attribution Metadata (unverified here)',
    rightsVerified: false,
    referenceUri: 'https://www.nlm.nih.gov/mesh/',
    disabledReason:
      'Disabled under synthetic gate: NLM distribution rights, release pinning, and local artifact/API terms require G4 owner clearance.',
    pendingGates: [
      'Rights & attribution sign-off',
      'Release version pinning & checksum',
      'Offline package or approved proxy policy',
    ],
  },
  {
    sourceId: 'nlm-specialist',
    displayName: 'NLM SPECIALIST Lexicon',
    mode: 'future-conditional-disabled',
    enabled: false,
    sourceRelease: 'pending-qualification',
    licenseLabel: 'UMLS / NLM SPECIALIST Terms (unverified here)',
    rightsVerified: false,
    referenceUri: 'https://www.nlm.nih.gov/research/umls/new_users/online_learning/LEX_001.html',
    disabledReason:
      'Disabled under synthetic gate: UMLS/NLM redistribution limits, artifact size, and license terms not cleared.',
    pendingGates: [
      'NLM/UMLS distribution terms review',
      'Indexed local morphological/variant boundary design',
    ],
  },
  {
    sourceId: 'obo-foundry-subset',
    displayName: 'Selected OBO Foundry Ontologies',
    mode: 'future-conditional-disabled',
    enabled: false,
    sourceRelease: 'pending-qualification',
    licenseLabel: 'Per-ontology license (CC-BY/CC0 claimed upstream; unverified here)',
    rightsVerified: false,
    referenceUri: 'https://obofoundry.org/',
    disabledReason:
      'Disabled under synthetic gate: per-ontology license/version audit and attribution preservation not cleared.',
    pendingGates: [
      'Per-ontology rights & attribution ledger',
      'IRI & obsolete-term policy',
    ],
  },
  {
    sourceId: 'umls-metathesaurus',
    displayName: 'UMLS Metathesaurus (Opt-In)',
    mode: 'future-conditional-disabled',
    enabled: false,
    sourceRelease: 'pending-qualification',
    licenseLabel: 'UMLS Metathesaurus License Agreement (restricted opt-in)',
    rightsVerified: false,
    referenceUri: 'https://www.nlm.nih.gov/research/umls/',
    disabledReason:
      'Disabled under synthetic gate: requires individual UTS license credentials, backend/secret architecture, and SNOMED/restrictive subset filtering.',
    pendingGates: [
      'UTS user license & credential boundary',
      'Server-side secret/proxy architecture',
      'Subset restriction compliance',
    ],
  },
  {
    sourceId: 'pubtator3',
    displayName: 'NCBI PubTator 3 Public Literature Annotations',
    mode: 'future-conditional-disabled',
    enabled: false,
    sourceRelease: 'pending-qualification',
    licenseLabel: 'NCBI Public API Notice (rate limits/availability unverified)',
    rightsVerified: false,
    referenceUri: 'https://www.ncbi.nlm.nih.gov/research/pubtator3/',
    disabledReason:
      'Disabled under synthetic gate: remote HTTP requests forbidden; PMID/DOI transmission requires explicit user privacy consent & rate-limit proxy.',
    pendingGates: [
      'Data minimization & outbound PMID/DOI consent',
      'Rate-limit & retry architecture',
    ],
  },
  {
    sourceId: 'tdk-sozluk',
    displayName: 'TDK Güncel Türkçe Sözlük / Terim Sözlükleri',
    mode: 'future-conditional-disabled',
    enabled: false,
    sourceRelease: 'pending-qualification',
    licenseLabel: 'Institutional Turkish terminology rights pending verification',
    rightsVerified: false,
    referenceUri: 'https://sozluk.gov.tr/',
    disabledReason:
      'Disabled under synthetic gate: no approved institutional dump/API contract or redistribution rights clearance.',
    pendingGates: [
      'Institutional permission & attribution rules',
      'Versioned snapshot / API SLA',
    ],
  },
  {
    sourceId: 'tuba-terimler',
    displayName: 'TÜBA Bilim Terimleri Sözlüğü',
    mode: 'future-conditional-disabled',
    enabled: false,
    sourceRelease: 'pending-qualification',
    licenseLabel: 'Institutional academic terminology terms pending verification',
    rightsVerified: false,
    referenceUri: 'https://terim.tuba.gov.tr/',
    disabledReason:
      'Disabled under synthetic gate: institutional rights, citation requirements, and stable snapshot format not cleared.',
    pendingGates: [
      'Institutional clearance & citation policy',
      'Stable machine-readable distribution',
    ],
  },
  {
    sourceId: 'tbt-terim',
    displayName: 'TBT (Turkish Terminology Resource Candidate)',
    mode: 'future-conditional-disabled',
    enabled: false,
    sourceRelease: 'pending-qualification',
    licenseLabel: 'Turkish terminology candidate terms pending verification',
    rightsVerified: false,
    referenceUri: 'urn:termforge:candidate:tbt-terim',
    disabledReason:
      'Disabled under synthetic gate: source version, license clearance, and verified local distribution missing.',
    pendingGates: [
      'Authoritative release provenance',
      'License & scientific domain scoping',
    ],
  },
]);

export function listSourceRegistryEntries(): readonly SourceRegistryEntry[] {
  return SOURCE_REGISTRY_ENTRIES;
}

export function getSourceRegistryEntry(sourceId: string): SourceRegistryEntry | null {
  return SOURCE_REGISTRY_ENTRIES.find((entry) => entry.sourceId === sourceId) ?? null;
}
