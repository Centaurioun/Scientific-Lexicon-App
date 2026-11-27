import { z } from 'zod';

export const TXT_PARSER_VERSION = 'txt-utf8-v1';
export const MARKDOWN_PARSER_VERSION = 'md-conservative-v1';

export const DocumentFormatSchema = z.enum(['txt', 'markdown', 'docx']);
export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;

export const DocumentSectionKindSchema = z.enum([
  'heading',
  'paragraph',
  'list',
  'table',
  'code',
  'other',
]);
export type DocumentSectionKind = z.infer<typeof DocumentSectionKindSchema>;

export const DocumentSectionSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    kind: DocumentSectionKindSchema,
    label: z.string().min(1).optional(),
  })
  .strict()
  .refine((s) => s.end > s.start, { message: 'DocumentSection end must exceed start.' });

export type DocumentSection = z.infer<typeof DocumentSectionSchema>;

export const ExcludedRangeReasonSchema = z.enum([
  'code-fence',
  'inline-code',
  'link-destination',
  'table-separator',
  'markup-syntax',
]);
export type ExcludedRangeReason = z.infer<typeof ExcludedRangeReasonSchema>;

export const ExcludedRangeSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    reason: ExcludedRangeReasonSchema,
  })
  .strict()
  .refine((r) => r.end > r.start, { message: 'ExcludedRange end must exceed start.' });

export type ExcludedRange = z.infer<typeof ExcludedRangeSchema>;

export const ParsedDocumentSchema = z
  .object({
    format: DocumentFormatSchema,
    text: z.string(),
    parserVersion: z.string().min(1),
    sections: z.array(DocumentSectionSchema),
    excludedRanges: z.array(ExcludedRangeSchema),
    warnings: z.array(z.string()),
  })
  .strict();

export type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;

export function validateParsedDocument(doc: ParsedDocument): ParsedDocument {
  const parsed = ParsedDocumentSchema.parse(doc);
  const len = parsed.text.length;

  let prevEnd = 0;
  for (const sec of parsed.sections) {
    if (sec.end > len) {
      throw new RangeError(
        `DocumentSection [${sec.start}, ${sec.end}) exceeds analyzed text length ${len}.`,
      );
    }
    if (sec.start < prevEnd) {
      throw new RangeError(
        `DocumentSection [${sec.start}, ${sec.end}) overlaps or is out of order after offset ${prevEnd}.`,
      );
    }
    prevEnd = sec.end;
  }

  for (const ex of parsed.excludedRanges) {
    if (ex.end > len) {
      throw new RangeError(
        `ExcludedRange [${ex.start}, ${ex.end}) exceeds analyzed text length ${len}.`,
      );
    }
  }

  return parsed;
}

/**
 * Finds the containing section index for a half-open span [start, end) using binary search.
 * Returns -1 if the span does not lie completely within a single section.
 */
export function findContainingSectionIndex(
  start: number,
  end: number,
  sections: readonly DocumentSection[],
): number {
  let low = 0;
  let high = sections.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const sec = sections[mid];
    if (start < sec.start) {
      high = mid - 1;
    } else if (start >= sec.end) {
      low = mid + 1;
    } else {
      return end <= sec.end ? mid : -1;
    }
  }
  return -1;
}

/**
 * Checks whether [start, end) is strictly inside a single non-code section
 * and does not overlap any excluded Markdown range (code fence, inline code, link URL, etc.).
 */
export function isSpanEligibleInDocument(
  start: number,
  end: number,
  doc: ParsedDocument,
): boolean {
  if (start < 0 || end <= start || end > doc.text.length) return false;

  if (doc.sections.length > 0) {
    const secIndex = findContainingSectionIndex(start, end, doc.sections);
    if (secIndex === -1) return false;
    if (doc.sections[secIndex].kind === 'code') return false;
  }

  // Binary search sorted excluded ranges for any overlap
  const excluded = doc.excludedRanges;
  let low = 0;
  let high = excluded.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const ex = excluded[mid];
    if (end <= ex.start) {
      high = mid - 1;
    } else if (start >= ex.end) {
      low = mid + 1;
    } else {
      return false;
    }
  }

  return true;
}
