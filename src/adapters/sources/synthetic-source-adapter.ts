import { z } from 'zod';
import { deepFreeze, digest } from '@/domain/changes';
import {
  compareCodeUnits,
  ExpressionRoleSchema,
  LanguageUseSchema,
  NonBlankTextSchema,
  OpaqueIdSchema,
  type ExpressionRole,
  type LanguageUse,
  type LibrarySnapshot,
} from '@/domain/schema';
import { getSourceRegistryEntry } from '@/domain/source-registry';
import type { ValidatedEnrichmentSelection } from '@/application/enrichment-tasks';

export const MAX_SOURCE_CANDIDATE_RESULTS = 100 as const;

export const SyntheticSourceEntrySchema = z
  .object({
    entryId: OpaqueIdSchema,
    sourceId: z.literal('synth-bilingual-lexicon-v1'),
    sourceRelease: NonBlankTextSchema,
    licenseLabel: NonBlankTextSchema,
    sourceUri: NonBlankTextSchema,
    matchSurface: NonBlankTextSchema,
    candidateText: NonBlankTextSchema,
    candidateLanguage: LanguageUseSchema,
    candidateRole: ExpressionRoleSchema,
    evidenceSnippet: NonBlankTextSchema,
    limitations: NonBlankTextSchema,
  })
  .strict();

export type SyntheticSourceEntry = z.infer<typeof SyntheticSourceEntrySchema>;

export interface SourceEvidenceCandidate {
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceRelease: string;
  readonly licenseLabel: string;
  readonly rightsVerified: false;
  readonly sourceUri: string;
  readonly fixtureIdentity: string;
  readonly targetConceptId: string;
  readonly targetConceptRevision: number;
  readonly matchedQuerySurface: string;
  readonly candidateText: string;
  readonly candidateLanguage: LanguageUse;
  readonly candidateRole: ExpressionRole;
  readonly evidenceSnippet: string;
  readonly limitations: string;
  readonly verificationStatus: 'synthetic-unverified';
}

export interface SourceEvidenceLookupResult {
  readonly sourceId: string;
  readonly sourceRelease: string;
  readonly fixtureDigest: string;
  readonly rightsVerified: false;
  readonly baseLibraryRevision: number;
  readonly candidates: readonly SourceEvidenceCandidate[];
  readonly ambiguousTargetConceptIds: readonly string[];
  readonly truncated: boolean;
}

export const SYNTHETIC_LEXICON_ENTRIES: readonly SyntheticSourceEntry[] = deepFreeze([
  {
    entryId: 'syn-src-001',
    sourceId: 'synth-bilingual-lexicon-v1',
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    sourceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1/syn-src-001',
    matchSurface: 'gingival sulcus',
    candidateText: 'dişeti oluğu',
    candidateLanguage: { kind: 'language', tag: 'tr' },
    candidateRole: 'preferred',
    evidenceSnippet: 'Synthetic bilingual fixture pairing EN "gingival sulcus" with TR candidate "dişeti oluğu".',
    limitations: 'Synthetic fixture entry for offline workflow verification only; not clinically validated.',
  },
  {
    entryId: 'syn-src-002',
    sourceId: 'synth-bilingual-lexicon-v1',
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    sourceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1/syn-src-002',
    matchSurface: 'dişeti oluğu',
    candidateText: 'gingival sulcus',
    candidateLanguage: { kind: 'language', tag: 'en' },
    candidateRole: 'preferred',
    evidenceSnippet: 'Synthetic bilingual fixture pairing TR "dişeti oluğu" with EN candidate "gingival sulcus".',
    limitations: 'Synthetic fixture entry for offline workflow verification only; not clinically validated.',
  },
  {
    entryId: 'syn-src-003',
    sourceId: 'synth-bilingual-lexicon-v1',
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    sourceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1/syn-src-003',
    matchSurface: 'PD',
    candidateText: 'sondalama derinliği',
    candidateLanguage: { kind: 'language', tag: 'tr' },
    candidateRole: 'preferred',
    evidenceSnippet: 'Homonym candidate 1 for exact surface "PD" (periodontal probing depth sense in synthetic fixture).',
    limitations: 'Abbreviation "PD" is ambiguous across senses; never auto-link without human concept disambiguation.',
  },
  {
    entryId: 'syn-src-004',
    sourceId: 'synth-bilingual-lexicon-v1',
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    sourceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1/syn-src-004',
    matchSurface: 'PD',
    candidateText: 'Parkinson hastalığı',
    candidateLanguage: { kind: 'language', tag: 'tr' },
    candidateRole: 'preferred',
    evidenceSnippet: 'Homonym candidate 2 for exact surface "PD" (neurology disorder sense in synthetic fixture).',
    limitations: 'Abbreviation "PD" is ambiguous across senses; never auto-link without human concept disambiguation.',
  },
  {
    entryId: 'syn-src-005',
    sourceId: 'synth-bilingual-lexicon-v1',
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    sourceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1/syn-src-005',
    matchSurface: 'p53',
    candidateText: 'tümör baskılayıcı p53',
    candidateLanguage: { kind: 'language', tag: 'tr' },
    candidateRole: 'preferred',
    evidenceSnippet: 'Exact lowercase gene symbol "p53" synthetic Turkish candidate.',
    limitations: 'Case-sensitive exact token match; do not conflate with uppercase protein symbol "P53".',
  },
  {
    entryId: 'syn-src-006',
    sourceId: 'synth-bilingual-lexicon-v1',
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    sourceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1/syn-src-006',
    matchSurface: 'P53',
    candidateText: 'P53 proteini',
    candidateLanguage: { kind: 'language', tag: 'tr' },
    candidateRole: 'preferred',
    evidenceSnippet: 'Exact uppercase protein symbol "P53" synthetic Turkish candidate.',
    limitations: 'Case-sensitive exact token match; distinct from lowercase gene symbol "p53".',
  },
  {
    entryId: 'syn-src-007',
    sourceId: 'synth-bilingual-lexicon-v1',
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    sourceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1/syn-src-007',
    matchSurface: 'dental plaque',
    candidateText: 'diş plağı',
    candidateLanguage: { kind: 'language', tag: 'tr' },
    candidateRole: 'preferred',
    evidenceSnippet: 'Synthetic bilingual fixture pairing EN "dental plaque" with TR candidate "diş plağı".',
    limitations: 'Synthetic fixture entry for offline workflow verification only.',
  },
  {
    entryId: 'syn-src-008',
    sourceId: 'synth-bilingual-lexicon-v1',
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    sourceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1/syn-src-008',
    matchSurface: 'probing depth',
    candidateText: 'sondalama derinliği',
    candidateLanguage: { kind: 'language', tag: 'tr' },
    candidateRole: 'preferred',
    evidenceSnippet: 'Synthetic bilingual fixture pairing EN "probing depth" with TR candidate "sondalama derinliği".',
    limitations: 'Synthetic fixture entry for offline workflow verification only.',
  },
  {
    entryId: 'syn-src-009',
    sourceId: 'synth-bilingual-lexicon-v1',
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    sourceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1/syn-src-009',
    matchSurface: 'calculus',
    candidateText: 'diş taşı',
    candidateLanguage: { kind: 'language', tag: 'tr' },
    candidateRole: 'preferred',
    evidenceSnippet: 'Synthetic bilingual fixture pairing EN "calculus" with TR dental candidate "diş taşı".',
    limitations: 'Homonym note: "calculus" also carries mathematics/renal senses outside dental domain.',
  },
  {
    entryId: 'syn-src-010',
    sourceId: 'synth-bilingual-lexicon-v1',
    sourceRelease: 'synth-fixture-2026.11',
    licenseLabel: 'Project-owned synthetic test fixture (non-authoritative)',
    sourceUri: 'synth://termforge/fixtures/bilingual-lexicon-v1/syn-src-010',
    matchSurface: 'H2O2',
    candidateText: 'hydrogen peroxide',
    candidateLanguage: { kind: 'language', tag: 'en' },
    candidateRole: 'preferred',
    evidenceSnippet: 'Synthetic formula expansion EN candidate for shared formula "H2O2".',
    limitations: 'Synthetic fixture entry for offline workflow verification only.',
  },
]);

export const SYNTHETIC_LEXICON_DATASET_SHA256 =
  'ae7a60ae586364aaeb119a5cd2a79039d9a523b338cc2e443901db17edf89f62' as const;

export async function verifySyntheticSourceEntries(
  entries: readonly SyntheticSourceEntry[],
  expectedSha256: string = SYNTHETIC_LEXICON_DATASET_SHA256,
): Promise<readonly SyntheticSourceEntry[]> {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Synthetic source dataset must contain at least one entry.');
  }
  const validated = z.array(SyntheticSourceEntrySchema).parse(entries);
  const actualSha256 = await digest(validated);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Synthetic source dataset checksum mismatch (expected ${expectedSha256}, computed ${actualSha256}). Dataset appears tampered.`,
    );
  }
  return deepFreeze(validated);
}

/**
 * Offline deterministic synthetic evidence adapter (WP04 F3).
 * Never performs network fetches, never mutates LibrarySnapshot, preserves exact
 * Unicode/case identity, and keeps ambiguous multi-sense candidates separate.
 */
export async function lookupSyntheticSourceEvidence(
  snapshot: LibrarySnapshot,
  selection: ValidatedEnrichmentSelection,
  options: {
    readonly sourceId: string;
    readonly entries?: readonly SyntheticSourceEntry[];
    readonly expectedDigest?: string;
    readonly maxCandidates?: number;
  },
): Promise<SourceEvidenceLookupResult> {
  const registryEntry = getSourceRegistryEntry(options.sourceId);
  if (!registryEntry) {
    throw new Error(
      `Unknown source "${options.sourceId}" is not registered in the allowlisted WP04 source registry.`,
    );
  }
  if (!registryEntry.enabled || registryEntry.mode !== 'synthetic-offline') {
    throw new Error(
      `Source "${registryEntry.sourceId}" (${registryEntry.displayName}) is disabled/conditional under the synthetic gate: ${registryEntry.disabledReason}`,
    );
  }

  if (selection.baseLibraryRevision !== snapshot.libraryRevision) {
    throw new Error(
      `Stale enrichment target selection (revision ${selection.baseLibraryRevision}) for snapshot revision ${snapshot.libraryRevision}.`,
    );
  }

  const maxCandidates = options.maxCandidates ?? MAX_SOURCE_CANDIDATE_RESULTS;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > MAX_SOURCE_CANDIDATE_RESULTS) {
    throw new Error(`maxCandidates must be between 1 and ${MAX_SOURCE_CANDIDATE_RESULTS}.`);
  }

  const verifiedEntries = await verifySyntheticSourceEntries(
    options.entries ?? SYNTHETIC_LEXICON_ENTRIES,
    options.expectedDigest ?? SYNTHETIC_LEXICON_DATASET_SHA256,
  );

  // Build exact-surface index without folding Unicode or ASCII case
  const entriesBySurface = new Map<string, SyntheticSourceEntry[]>();
  for (const entry of verifiedEntries) {
    const list = entriesBySurface.get(entry.matchSurface) ?? [];
    list.push(entry);
    entriesBySurface.set(entry.matchSurface, list);
  }

  const conceptMap = new Map(snapshot.concepts.map((c) => [c.id, c]));
  const candidates: SourceEvidenceCandidate[] = [];
  const ambiguousTargetConceptIds: string[] = [];
  let truncated = false;

  const sortedTargets = [...selection.targets].sort((a, b) =>
    compareCodeUnits(a.conceptId, b.conceptId),
  );

  for (const target of sortedTargets) {
    const liveConcept = conceptMap.get(target.conceptId);
    if (!liveConcept || liveConcept.revision !== target.conceptRevision) {
      throw new Error(
        `Target concept ${target.conceptId} changed revision or disappeared before lookup.`,
      );
    }

    const matchedForTarget: SourceEvidenceCandidate[] = [];
    const seenEntryIds = new Set<string>();

    const sortedExpressions = [...target.expressions].sort((a, b) =>
      compareCodeUnits(a.text, b.text),
    );
    for (const expr of sortedExpressions) {
      const surfaceHits = entriesBySurface.get(expr.text) ?? [];
      for (const hit of surfaceHits) {
        if (seenEntryIds.has(hit.entryId)) continue;
        seenEntryIds.add(hit.entryId);
        matchedForTarget.push({
          evidenceId: `${hit.entryId}:${target.conceptId}:r${target.conceptRevision}`,
          sourceId: hit.sourceId,
          sourceRelease: hit.sourceRelease,
          licenseLabel: hit.licenseLabel,
          rightsVerified: false,
          sourceUri: hit.sourceUri,
          fixtureIdentity: SYNTHETIC_LEXICON_DATASET_SHA256,
          targetConceptId: target.conceptId,
          targetConceptRevision: target.conceptRevision,
          matchedQuerySurface: expr.text,
          candidateText: hit.candidateText,
          candidateLanguage: hit.candidateLanguage,
          candidateRole: hit.candidateRole,
          evidenceSnippet: hit.evidenceSnippet,
          limitations: hit.limitations,
          verificationStatus: 'synthetic-unverified',
        });
      }
    }

    if (matchedForTarget.length > 1) {
      ambiguousTargetConceptIds.push(target.conceptId);
    }

    matchedForTarget.sort((a, b) => compareCodeUnits(a.evidenceId, b.evidenceId));
    for (const candidate of matchedForTarget) {
      if (candidates.length >= maxCandidates) {
        truncated = true;
        break;
      }
      candidates.push(candidate);
    }
    if (truncated) break;
  }

  return deepFreeze({
    sourceId: registryEntry.sourceId,
    sourceRelease: registryEntry.sourceRelease,
    fixtureDigest: SYNTHETIC_LEXICON_DATASET_SHA256,
    rightsVerified: false,
    baseLibraryRevision: snapshot.libraryRevision,
    candidates,
    ambiguousTargetConceptIds,
    truncated,
  });
}
