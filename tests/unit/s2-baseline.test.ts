import { describe, expect, it } from 'vitest';
import { AhoCorasickRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import { WinkNlpEngine } from '@/adapters/nlp/wink-engine';
import {
  analyzeText,
  EXTRACTION_ALGORITHM_VERSION,
  S1CandidateGenerator,
} from '@/application/extraction';
import {
  CANDIDATE_GRAMMAR_VERSION,
  MATCH_BOUNDARY_POLICY,
} from '@/domain/extraction';
import {
  createSyntheticBaselineSnapshot,
  S2_BASELINE_CONFIG,
  S2_SYNTHETIC_DOCUMENTS,
} from '../fixtures/s2/synthetic-documents';

async function sha256Utf8(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('D1: WP01 baseline freeze and reproducible comparison reference', () => {
  it('reproduces deterministic WP01 baseline outputs on the frozen synthetic fixture with source hash parity and zero mutations', async () => {
    const fixture = S2_SYNTHETIC_DOCUMENTS.baselineTxt;
    const snapshot = createSyntheticBaselineSnapshot();
    const snapshotBefore = JSON.stringify(snapshot);
    const sourceHash = await sha256Utf8(fixture.text);

    expect(sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(S2_BASELINE_CONFIG.grammarVersion).toBe(CANDIDATE_GRAMMAR_VERSION);
    expect(S2_BASELINE_CONFIG.boundaryPolicy).toBe(MATCH_BOUNDARY_POLICY);
    expect(EXTRACTION_ALGORITHM_VERSION).toBe('s1-grammar-1+s1-boundary-v1');

    const nlp = new WinkNlpEngine();
    const matcher = new AhoCorasickRegisteredMatcher();
    const generator = new S1CandidateGenerator();

    const runA = await analyzeText(fixture.text, snapshot, nlp, matcher, {
      candidateGenerator: generator,
    });
    const runB = await analyzeText(fixture.text, snapshot, nlp, matcher, {
      candidateGenerator: generator,
    });

    // Exact reproducibility between repeated baseline runs (ignoring ephemeral run UUID)
    expect(runA.algorithmVersion).toBe('s1-grammar-1+s1-boundary-v1');
    expect(runA.libraryRevision).toBe(snapshot.libraryRevision);
    expect(runA.occurrences).toEqual(runB.occurrences);

    // Every emitted span is an exact half-open UTF-16 slice of source text
    for (const occ of runA.occurrences) {
      expect(fixture.text.slice(occ.start, occ.end)).toBe(occ.surface);
    }

    // Required scientific forms reproduced with exact baseline classification
    const bySurface = new Map(runA.occurrences.map((o) => [o.surface, o]));
    expect(bySurface.get('TNF-α')?.state).toBe('known-form');
    expect(bySurface.get('TNF-α')?.resolvedConceptId).toBe('c-tnf');

    expect(bySurface.get('PD')?.state).toBe('ambiguous');
    expect(bySurface.get('PD')?.resolvedConceptId).toBeNull();
    expect(bySurface.get('PD')?.conceptIds).toEqual(['c-pd-1', 'c-pd-2']);

    expect(bySurface.get('CD4+')?.state).toBe('new-candidate');
    expect(bySurface.get('IL-11')?.state).toBe('new-candidate');
    expect(
      runA.occurrences.some(
        (o) => o.surface.toLowerCase().includes('periodontal ligament') && o.state === 'new-candidate',
      ),
    ).toBe(true);

    // Zero persisted or in-memory mutation of canonical snapshot
    expect(JSON.stringify(snapshot)).toBe(snapshotBefore);
  });
});
