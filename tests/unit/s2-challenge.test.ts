import { describe, expect, it } from 'vitest';
import { parseMarkdownDocument } from '@/adapters/documents/markdown';
import { AhoCorasickRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import { WinkNlpEngine } from '@/adapters/nlp/wink-core';
import { analyzeText } from '@/application/extraction';
import { S2ScientificCandidateGenerator } from '@/application/scientific-candidates';
import { isSpanEligibleInDocument } from '@/domain/document-input';
import { createEmptySnapshot, type Expression, type LibrarySnapshot } from '@/domain/schema';

function makeExpression(id: string, conceptId: string, text: string): Expression {
  const now = '2026-11-27T00:00:00Z';
  return {
    id,
    conceptId,
    revision: 1,
    text,
    language: { kind: 'shared' },
    role: 'preferred',
    createdAt: now,
    updatedAt: now,
  };
}

describe('QC04: Markdown parser and S2 scientific grammar adversarial challenge suite', () => {
  const nlp = new WinkNlpEngine();
  const matcher = new AhoCorasickRegisteredMatcher();

  it('handles single-line triple-backtick inline code without swallowing the rest of the document as an unclosed fence', async () => {
    const md = [
      '```inline_code_symbol``` precedes IL-1β in this paragraph.',
      '',
      'Subsequent paragraph mentions TNF-α clearly.',
    ].join('\n');

    const parsed = parseMarkdownDocument(md);
    // Must NOT treat ```inline_code_symbol``` as an unclosed block code fence
    expect(parsed.sections.some((s) => s.kind === 'code')).toBe(false);
    expect(parsed.excludedRanges.some((r) => r.reason === 'inline-code')).toBe(true);
    expect(parsed.warnings.some((w) => /unclosed fenced code/i.test(w))).toBe(false);

    const run = await analyzeText(md, createEmptySnapshot(), nlp, matcher, {
      grammarMode: 's2-grammar-2',
      parsedDocument: parsed,
    });

    const surfaces = new Set(run.occurrences.map((o) => o.surface));
    expect(surfaces.has('inline_code_symbol')).toBe(false);
    expect(surfaces.has('IL-1β')).toBe(true);
    expect(surfaces.has('TNF-α')).toBe(true);
  });

  it('handles malformed Markdown, escaped syntax, nested backticks, indented/unclosed fences, links, tables, lists, headings, and CRLF/CR/LF', async () => {
    const md = [
      '# Section 1: \\*Escaped\\* \\[Brackets\\] and [TGF-β1](https://example.invalid/TNF-α)',
      '',
      'Nested backticks: ``use `Ca2+` inside`` while IFN-γ remains eligible.',
      'Escaped link punctuation: value\\](not_a_url_NF-κB) and unclosed [broken](https://example.invalid/open',
      '',
      '| Marker \\| Name | Reading |',
      '| --- | --- |',
      '| α-SMA | β2-microglobulin |',
      '',
      '- First list item Na+/K+-ATPase',
      '- Second list item 2,4-dinitrophenol',
      '',
      '```ts',
      '    ```', // 4-space indented backticks must NOT close a CommonMark fence
      'const hidden = "HIDDEN_FENCE_SYMBOL";',
      '```',
      '',
      'Post-fence paragraph: IL-6 and e\u0301moji 🧬 signaling.',
    ].join('\r\n');

    const parsed = parseMarkdownDocument(md);
    expect(parsed.warnings.some((w) => /unclosed.*link/i.test(w))).toBe(true);

    const run = await analyzeText(md, createEmptySnapshot(), nlp, matcher, {
      grammarMode: 's2-grammar-2',
      parsedDocument: parsed,
    });

    // Exact UTF-16 slice and eligibility invariants on every occurrence
    for (const occ of run.occurrences) {
      expect(md.slice(occ.start, occ.end)).toBe(occ.surface);
      expect(isSpanEligibleInDocument(occ.start, occ.end, parsed)).toBe(true);
    }

    const surfaces = new Set(run.occurrences.map((o) => o.surface));
    expect(surfaces.has('TGF-β1')).toBe(true);
    expect(surfaces.has('IFN-γ')).toBe(true);
    expect(surfaces.has('α-SMA')).toBe(true);
    expect(surfaces.has('β2-microglobulin')).toBe(true);
    expect(surfaces.has('Na+/K+-ATPase')).toBe(true);
    expect(surfaces.has('2,4-dinitrophenol')).toBe(true);
    expect(surfaces.has('IL-6')).toBe(true);

    // Excluded content must never leak into extracted spans
    expect(surfaces.has('TNF-α')).toBe(false); // only inside link destination URL
    expect(surfaces.has('Ca2+')).toBe(false); // only inside nested backtick inline code
    expect(surfaces.has('HIDDEN_FENCE_SYMBOL')).toBe(false); // inside fenced code block after 4-space decoy

    // Also verify CR-only line endings produce exact slices
    const crMd = '# Heading\r\rCa2+ flux and NF-κB activation.';
    const crParsed = parseMarkdownDocument(crMd);
    const crRun = await analyzeText(crMd, createEmptySnapshot(), nlp, matcher, {
      grammarMode: 's2-grammar-2',
      parsedDocument: crParsed,
    });
    for (const occ of crRun.occurrences) {
      expect(crMd.slice(occ.start, occ.end)).toBe(occ.surface);
      expect(isSpanEligibleInDocument(occ.start, occ.end, crParsed)).toBe(true);
    }
    expect(crRun.occurrences.some((o) => o.surface === 'Ca2+')).toBe(true);
    expect(crRun.occurrences.some((o) => o.surface === 'NF-κB')).toBe(true);
  });

  it('rejects ParsedDocument metadata mismatch fail-closed', async () => {
    const parsed = parseMarkdownDocument('# Heading\n\nTNF-α expression.');
    await expect(
      analyzeText('# Heading\n\nIL-6 expression.', createEmptySnapshot(), nlp, matcher, {
        grammarMode: 's2-grammar-2',
        parsedDocument: parsed,
      }),
    ).rejects.toThrow(/ParsedDocument\.text must exactly match/i);
  });

  it('rejects false acronym pairings while preserving valid scientific acronym-long-form hypotheses', async () => {
    const text = [
      'The active beta (AAB) and active assay (AAA) failed specificity.',
      'Tumor necrosis factor assay (TNF) must not absorb unrelated trailing words.',
      'Tumor necrosis factor alpha (TNF-α) and polymerase chain reaction (PCR) are valid pairs.',
      'Interleukin-6 (IL-6) and periodontal ligament stem cells (PDLSC) are documented.',
    ].join(' ');

    const tokens = await nlp.analyze(text);
    const gen = new S2ScientificCandidateGenerator();
    const detailed = await gen.generateWithEvidence(text, tokens);

    const pairs = detailed.hypotheses.map((h) => `${h.acronym} => ${h.longForm}`);
    expect(pairs).not.toContain('AAB => active beta');
    expect(pairs).not.toContain('AAA => active assay');
    expect(pairs).not.toContain('TNF => Tumor necrosis factor assay');

    expect(pairs).toContain('TNF-α => Tumor necrosis factor alpha');
    expect(pairs).toContain('PCR => polymerase chain reaction');
    expect(pairs).toContain('PDLSC => periodontal ligament stem cells');
  });

  it('preserves chemical/molecular boundaries, compounds, eponyms, nested terms, homonyms, and suppresses bibliographic noise', async () => {
    const snapshot: LibrarySnapshot = {
      ...createEmptySnapshot(),
      libraryRevision: 3,
      concepts: [
        { id: 'c-pd-1', revision: 1, createdAt: '2026-11-27T00:00:00Z', updatedAt: '2026-11-27T00:00:00Z' },
        { id: 'c-pd-2', revision: 1, createdAt: '2026-11-27T00:00:00Z', updatedAt: '2026-11-27T00:00:00Z' },
      ],
      expressions: [
        makeExpression('e-pd-1', 'c-pd-1', 'PD'),
        makeExpression('e-pd-2', 'c-pd-2', 'PD'),
      ],
    };

    const text =
      'Smith et al. reported Ca2+, IL-1β, IFN-γ, NF-κB, α-SMA, β2-microglobulin, Na+/K+-ATPase, 2,4-dinitrophenol, Gram staining, Western blotting, alveolar bone resorption, periodontal ligament-derived stem cells, and PD (ibid.).';

    const run = await analyzeText(text, snapshot, nlp, matcher, {
      grammarMode: 's2-grammar-2',
    });

    const surfaces = new Set(run.occurrences.map((o) => o.surface));
    for (const expected of [
      'Ca2+',
      'IL-1β',
      'IFN-γ',
      'NF-κB',
      'α-SMA',
      'β2-microglobulin',
      'Na+/K+-ATPase',
      '2,4-dinitrophenol',
      'Gram staining',
      'Western blotting',
      'alveolar bone resorption',
      'bone resorption',
      'periodontal ligament-derived stem cells',
      'ligament-derived stem cells',
    ]) {
      expect(surfaces.has(expected), `Expected surface "${expected}"`).toBe(true);
    }

    // Bibliographic noise suppressed
    expect(surfaces.has('et al.')).toBe(false);
    expect(surfaces.has('et al')).toBe(false);
    expect(surfaces.has('ibid.')).toBe(false);
    expect(surfaces.has('ibid')).toBe(false);

    // Homonym remains explicitly ambiguous (never auto-resolved)
    const pdOcc = run.occurrences.find((o) => o.surface === 'PD');
    expect(pdOcc?.state).toBe('ambiguous');
    expect(pdOcc?.conceptIds).toEqual(['c-pd-1', 'c-pd-2']);
    expect(pdOcc?.resolvedConceptId).toBeNull();
  });

  it('satisfies exact UTF-16 slice, exclusion, section, and determinism invariants across 60 deterministic generated fuzz documents', async () => {
    let seed = 0x5f3759df;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(nextRand() * arr.length)];

    const fragments = [
      '# Heading TNF-α and IL-1β',
      '```inline_code_x``` then Ca2+ and α-SMA',
      '``nested `code` tick`` before Na+/K+-ATPase',
      'Link [β2-microglobulin](https://example.invalid/NF-κB) with IFN-γ',
      'Unclosed [link](https://example.invalid/open',
      'Escaped \\*bold\\* and \\[tag\\] and pipe\\|cell',
      '| Marker | Value |\n| --- | --- |\n| 2,4-dinitrophenol | IL-6 |',
      '- List item Gram staining\n- Second item Western blotting',
      '```\nconst hidden = "TNF-α";\n```',
      '~~~\nconst tildeHidden = "IL-1β";\n~~~',
      'Active assay (AAA) versus polymerase chain reaction (PCR) 🧬 e\u0301.',
      'Smith et al. noted periodontal ligament-derived stem cells.',
    ];
    const separators = ['\n', '\n\n', '\r\n', '\r\n\r\n', '\r'];

    for (let trial = 0; trial < 60; trial += 1) {
      const partCount = 2 + (trial % 4);
      const parts: string[] = [];
      for (let p = 0; p < partCount; p += 1) {
        parts.push(pick(fragments));
      }
      const docText = parts.join(pick(separators));
      const parsed = parseMarkdownDocument(docText);

      const runA = await analyzeText(docText, createEmptySnapshot(), nlp, matcher, {
        grammarMode: 's2-grammar-2',
        parsedDocument: parsed,
      });

      for (const occ of runA.occurrences) {
        expect(docText.slice(occ.start, occ.end)).toBe(occ.surface);
        expect(occ.surface.includes('\n')).toBe(false);
        expect(occ.surface.includes('\r')).toBe(false);
        expect(isSpanEligibleInDocument(occ.start, occ.end, parsed)).toBe(true);
      }

      if (trial < 10) {
        const runB = await analyzeText(docText, createEmptySnapshot(), nlp, matcher, {
          grammarMode: 's2-grammar-2',
          parsedDocument: parsed,
        });
        expect(runB.occurrences).toEqual(runA.occurrences);
      }
    }
  });
});
