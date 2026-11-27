import { describe, expect, it } from 'vitest';
import { parseMarkdownDocument } from '@/adapters/documents/markdown';
import { analyzeText } from '@/application/extraction';
import { readDocument } from '@/application/document-input';
import {
  isSpanEligibleInDocument,
  MARKDOWN_PARSER_VERSION,
  TXT_PARSER_VERSION,
  validateParsedDocument,
} from '@/domain/document-input';
import { DEFAULT_PROCESSING_LIMITS } from '@/domain/processing-limits';
import { createEmptySnapshot } from '@/domain/schema';
import { S2_SYNTHETIC_DOCUMENTS } from '../fixtures/s2/synthetic-documents';

function makeFakeFile(name: string, content: string | Uint8Array) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer(): Promise<ArrayBuffer> {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    },
  };
}

describe('D2: Structured Markdown and document representation', () => {
  it('parses structured Markdown with exact UTF-16 section slices, CRLF, Greek/emoji, escaped pipes, links, tables, inline code, and fenced code', () => {
    const raw = S2_SYNTHETIC_DOCUMENTS.structuredMarkdown.text;
    const parsed = parseMarkdownDocument(raw);

    expect(parsed.format).toBe('markdown');
    expect(parsed.parserVersion).toBe(MARKDOWN_PARSER_VERSION);
    expect(parsed.text).toBe(raw);
    expect(parsed.sections.length).toBeGreaterThanOrEqual(5);

    // Every section must be a valid non-empty half-open range within parsed.text
    for (const sec of parsed.sections) {
      expect(sec.start).toBeGreaterThanOrEqual(0);
      expect(sec.end).toBeGreaterThan(sec.start);
      expect(sec.end).toBeLessThanOrEqual(parsed.text.length);
    }

    const kinds = new Set(parsed.sections.map((s) => s.kind));
    expect(kinds.has('heading')).toBe(true);
    expect(kinds.has('paragraph')).toBe(true);
    expect(kinds.has('list')).toBe(true);
    expect(kinds.has('table')).toBe(true);
    expect(kinds.has('code')).toBe(true);

    // Heading text TNF-α is eligible
    const headingTnfStart = parsed.text.indexOf('TNF-α');
    expect(isSpanEligibleInDocument(headingTnfStart, headingTnfStart + 'TNF-α'.length, parsed)).toBe(true);

    // Link destination containing TNF-α is EXCLUDED, while link label is eligible
    const linkUrlStart = parsed.text.indexOf('https://example.invalid/TNF-α-link');
    const urlTnfStart = parsed.text.indexOf('TNF-α-link', linkUrlStart);
    expect(isSpanEligibleInDocument(urlTnfStart, urlTnfStart + 'TNF-α'.length, parsed)).toBe(false);
    const linkLabelStart = parsed.text.indexOf('synthetic protocol');
    expect(
      isSpanEligibleInDocument(linkLabelStart, linkLabelStart + 'synthetic protocol'.length, parsed),
    ).toBe(true);

    // Inline code span is EXCLUDED
    const inlineCodeStart = parsed.text.indexOf('inline_code_TNF-α');
    expect(
      isSpanEligibleInDocument(inlineCodeStart, inlineCodeStart + 'inline_code_TNF-α'.length, parsed),
    ).toBe(false);

    // Fenced code content is EXCLUDED
    const fenceTnfStart = parsed.text.indexOf('TNF-α and CD4+ inside code fence');
    expect(isSpanEligibleInDocument(fenceTnfStart, fenceTnfStart + 'TNF-α'.length, parsed)).toBe(false);

    // Table cell with HLA-B27, escaped pipe \|, and 🧬 emoji is preserved accurately
    const hlaStart = parsed.text.indexOf('HLA-B27');
    expect(isSpanEligibleInDocument(hlaStart, hlaStart + 'HLA-B27'.length, parsed)).toBe(true);
    expect(parsed.text).toContain('Escaped \\| pipe and 🧬 emoji');

    // Cross-section span (spanning across heading into paragraph) is rejected
    const crossEnd = parsed.text.indexOf('See [synthetic') + 3;
    expect(isSpanEligibleInDocument(headingTnfStart, crossEnd, parsed)).toBe(false);
  });

  it('reports explicit warnings on malformed unclosed fences and unsupported raw HTML without silently dropping text', () => {
    const malformed = [
      '# Heading',
      '',
      '<div>Raw HTML block with TNF-α</div>',
      '',
      '```python',
      'unclosed_fence_code = "CD4+"',
    ].join('\n');

    const parsed = parseMarkdownDocument(malformed);
    expect(parsed.text).toBe(malformed);
    expect(parsed.warnings.some((w) => /unclosed|malformed.*fence/i.test(w))).toBe(true);
    expect(parsed.warnings.some((w) => /HTML/i.test(w))).toBe(true);
    // Unclosed fence region is treated cautiously as code/excluded
    const cd4Index = parsed.text.indexOf('CD4+');
    expect(isSpanEligibleInDocument(cd4Index, cd4Index + 4, parsed)).toBe(false);
  });

  it('preserves exact Markdown coordinates across CRLF, bare CR, and LF line endings', () => {
    const source = '# TNF-α\r\n\rPeriodontal ligament\n- Gram staining';
    const parsed = parseMarkdownDocument(source);
    expect(parsed.text).toBe(source);
    expect(parsed.sections.map((section) => section.kind)).toEqual(['heading', 'paragraph', 'list']);
    for (const term of ['TNF-α', 'Periodontal ligament', 'Gram staining']) {
      const start = source.indexOf(term);
      expect(parsed.text.slice(start, start + term.length)).toBe(term);
      expect(isSpanEligibleInDocument(start, start + term.length, parsed)).toBe(true);
    }
  });

  it('keeps decomposed combining marks and supplementary-plane characters in UTF-16 coordinate slices', () => {
    const source = '# C\u0301ell 🧬\r\nTNF-α and 𐐷-cell HLA-B27.';
    const parsed = parseMarkdownDocument(source);
    expect(parsed.text).toBe(source);
    for (const surface of ['C\u0301ell', '🧬', 'TNF-α', '𐐷-cell', 'HLA-B27']) {
      const start = source.indexOf(surface);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(parsed.text.slice(start, start + surface.length)).toBe(surface);
      expect(isSpanEligibleInDocument(start, start + surface.length, parsed)).toBe(true);
    }
  });

  it('reads TXT and Markdown files via readDocument with fatal UTF-8 check, byte limits, and AbortSignal', async () => {
    const txtFile = makeFakeFile('sample.txt', 'Periodontal ligament stem cells express TNF-α.');
    const txtDoc = await readDocument(txtFile, DEFAULT_PROCESSING_LIMITS);
    expect(txtDoc.format).toBe('txt');
    expect(txtDoc.parserVersion).toBe(TXT_PARSER_VERSION);
    expect(txtDoc.text).toBe('Periodontal ligament stem cells express TNF-α.');
    expect(txtDoc.sections.length).toBeGreaterThanOrEqual(1);

    const mdFile = makeFakeFile('notes.md', '# Title\n\nCD4+ cells.');
    const mdDoc = await readDocument(mdFile, DEFAULT_PROCESSING_LIMITS);
    expect(mdDoc.format).toBe('markdown');
    expect(mdDoc.sections[0].kind).toBe('heading');

    // Invalid UTF-8 rejected fatally
    const badUtf8 = makeFakeFile('bad.md', new Uint8Array([0xff, 0xfe, 0xfd]));
    await expect(readDocument(badUtf8, DEFAULT_PROCESSING_LIMITS)).rejects.toThrow(/UTF-8/i);

    // Oversize rejected without truncation
    const oversize = makeFakeFile('big.md', 'A'.repeat(200));
    await expect(
      readDocument(oversize, { ...DEFAULT_PROCESSING_LIMITS, maxTxtInputBytes: 50 }),
    ).rejects.toThrow(/size limit|byte/i);

    // Cancelled signal aborts cleanly
    const controller = new AbortController();
    controller.abort();
    await expect(readDocument(mdFile, DEFAULT_PROCESSING_LIMITS, controller.signal)).rejects.toThrow(
      /abort/i,
    );

    // Unqualified DOCX rejected explicitly (D3 gate)
    const fakeDocx = makeFakeFile('paper.docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    await expect(readDocument(fakeDocx, DEFAULT_PROCESSING_LIMITS)).rejects.toThrow(/DOCX|not enabled|qualified/i);
  });

  it('rejects inconsistent coordinate metadata and mismatched analyzed text before extraction', async () => {
    const parsed = parseMarkdownDocument('TNF-α and CD4+.');
    const malformed = {
      ...parsed,
      excludedRanges: [
        { start: 8, end: 10, reason: 'inline-code' as const },
        { start: 0, end: 2, reason: 'link-destination' as const },
      ],
    };
    expect(() => validateParsedDocument(malformed)).toThrow(/out of order|overlaps/i);

    await expect(
      analyzeText('different coordinate text', createEmptySnapshot(), {
        async analyze() { return []; },
      }, {
        async match() { return []; },
      }, { parsedDocument: parsed }),
    ).rejects.toThrow(/must exactly match/i);
  });
});
