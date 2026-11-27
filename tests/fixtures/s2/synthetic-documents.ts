import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

export const S2_FIXTURE_TIMESTAMP = '2026-11-27T00:00:00.000Z';

export interface SyntheticFixtureSpec {
  id: string;
  title: string;
  format: 'txt' | 'markdown';
  text: string;
  sha256: string;
}

export const S2_BASELINE_CONFIG = Object.freeze({
  referenceMode: 's1-baseline',
  parserVersion: 'txt-utf8-v1',
  grammarVersion: 's1-grammar-1',
  boundaryPolicy: 's1-boundary-v1',
  rankingMode: 'source-order',
  candidateLimit: 5_000,
});

export const S2_SYNTHETIC_BASELINE_TEXT =
  'Periodontal ligament fibroblasts respond to TNF-α, CD4+, PD, and IL-11 signaling in synthetic assay S2-BASE-01.';

/**
 * Deterministic SHA-256 of S2_SYNTHETIC_BASELINE_TEXT (UTF-8), verified at test runtime
 * via Web Crypto digest so any accidental fixture drift is caught immediately.
 */
export const S2_SYNTHETIC_DOCUMENTS = {
  baselineTxt: {
    id: 'syn-doc-baseline-01',
    title: 'Synthetic Baseline Periodontology Excerpt',
    format: 'txt' as const,
    text: S2_SYNTHETIC_BASELINE_TEXT,
  },
  scientificRichTxt: {
    id: 'syn-doc-sci-02',
    title: 'Synthetic Scientific Grammar Fixture',
    format: 'txt' as const,
    text: [
      'Tumor necrosis factor alpha (TNF-α) and periodontal ligament-derived stem cells regulate p53 and P53.',
      'Na+/K+-ATPase activity shifts alongside HLA-B and HLA-B27 expression after 2,4-dinitrophenol exposure.',
      'Gram staining revealed loss of heterozygosity (LOH) in PD cohorts (Smith et al., 2026).',
      'Turkish exact forms I, İltihap, and ısı remain literal without Turkish NLP.',
    ].join('\n'),
  },
  structuredMarkdown: {
    id: 'syn-doc-md-03',
    title: 'Synthetic Structured Markdown Fixture',
    format: 'markdown' as const,
    text: [
      '# Inflammatory Signaling in TNF-α Assays',
      '',
      'See [synthetic protocol](https://example.invalid/TNF-α-link) for CD4+ cell counts and `inline_code_TNF-α` handling.',
      '',
      '- Periodontal ligament stem cells',
      '- Na+/K+-ATPase pump',
      '',
      '| Marker | Notes |',
      '| --- | --- |',
      '| HLA-B27 | Escaped \\| pipe and 🧬 emoji |',
      '',
      '```ts',
      'const ignoredFenceTerm = "TNF-α and CD4+ inside code fence";',
      '```',
      '',
      'Final paragraph references IL-11 and PD.',
    ].join('\r\n'),
  },
} as const;

export function createSyntheticBaselineSnapshot(): LibrarySnapshot {
  const empty = createEmptySnapshot();
  return {
    ...empty,
    libraryRevision: 3,
    concepts: [
      { id: 'c-tnf', revision: 0, createdAt: S2_FIXTURE_TIMESTAMP, updatedAt: S2_FIXTURE_TIMESTAMP },
      { id: 'c-pd-1', revision: 0, createdAt: S2_FIXTURE_TIMESTAMP, updatedAt: S2_FIXTURE_TIMESTAMP },
      { id: 'c-pd-2', revision: 0, createdAt: S2_FIXTURE_TIMESTAMP, updatedAt: S2_FIXTURE_TIMESTAMP },
    ],
    expressions: [
      {
        id: 'e-tnf-en',
        conceptId: 'c-tnf',
        revision: 0,
        text: 'TNF-α',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: S2_FIXTURE_TIMESTAMP,
        updatedAt: S2_FIXTURE_TIMESTAMP,
      },
      {
        id: 'e-pd-1',
        conceptId: 'c-pd-1',
        revision: 0,
        text: 'PD',
        language: { kind: 'language', tag: 'en' },
        role: 'abbreviation',
        createdAt: S2_FIXTURE_TIMESTAMP,
        updatedAt: S2_FIXTURE_TIMESTAMP,
      },
      {
        id: 'e-pd-2',
        conceptId: 'c-pd-2',
        revision: 0,
        text: 'PD',
        language: { kind: 'language', tag: 'en' },
        role: 'abbreviation',
        createdAt: S2_FIXTURE_TIMESTAMP,
        updatedAt: S2_FIXTURE_TIMESTAMP,
      },
    ],
    provenance: [
      { id: 'p-1', expressionId: 'e-tnf-en', kind: 'manual', createdAt: S2_FIXTURE_TIMESTAMP, source: null },
      { id: 'p-2', expressionId: 'e-pd-1', kind: 'manual', createdAt: S2_FIXTURE_TIMESTAMP, source: null },
      { id: 'p-3', expressionId: 'e-pd-2', kind: 'manual', createdAt: S2_FIXTURE_TIMESTAMP, source: null },
    ],
  };
}
