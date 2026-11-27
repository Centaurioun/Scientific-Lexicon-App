import { parseMarkdownDocument } from '@/adapters/documents/markdown';
import { InputLimitError, validateInputText } from '@/application/extraction';
import {
  TXT_PARSER_VERSION,
  validateParsedDocument,
  type DocumentFormat,
  type DocumentSection,
  type ParsedDocument,
} from '@/domain/document-input';
import {
  DEFAULT_PROCESSING_LIMITS,
  parseProcessingLimits,
  type ProcessingLimits,
} from '@/domain/processing-limits';

export interface ReadableDocumentFile {
  name?: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Document reading was aborted.', 'AbortError');
  }
}

export function detectDocumentFormat(filename?: string): DocumentFormat {
  const lower = (filename ?? '').toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return 'txt';
}

export function parsePlainTextDocument(text: string): ParsedDocument {
  const sections: DocumentSection[] = [];
  const blankLineRe = /\r?\n[ \t]*\r?\n+/g;
  let cursor = 0;
  let match = blankLineRe.exec(text);
  while (match !== null) {
    const end = match.index;
    if (end > cursor && text.slice(cursor, end).trim().length > 0) {
      sections.push({ start: cursor, end, kind: 'paragraph' });
    }
    cursor = match.index + match[0].length;
    match = blankLineRe.exec(text);
  }
  if (cursor < text.length && text.slice(cursor).trim().length > 0) {
    sections.push({ start: cursor, end: text.length, kind: 'paragraph' });
  }

  return validateParsedDocument({
    format: 'txt',
    text,
    parserVersion: TXT_PARSER_VERSION,
    sections,
    excludedRanges: [],
    warnings: [],
  });
}

export function parseDocumentText(
  text: string,
  format: 'txt' | 'markdown',
  inputLimits: ProcessingLimits = DEFAULT_PROCESSING_LIMITS,
): ParsedDocument {
  const limits = parseProcessingLimits(inputLimits);
  validateInputText(text, limits);
  if (format === 'markdown') {
    return parseMarkdownDocument(text);
  }
  return parsePlainTextDocument(text);
}

/**
 * Reads a browser-local TXT or Markdown document strictly enforcing configured
 * byte and UTF-16 ceilings, fatal UTF-8 decoding, and cancellation.
 * DOCX input is explicitly rejected unless a browser-local parser passes separate G1 qualification.
 */
export async function readDocument(
  file: ReadableDocumentFile,
  inputLimits: ProcessingLimits = DEFAULT_PROCESSING_LIMITS,
  signal?: AbortSignal,
): Promise<ParsedDocument> {
  throwIfAborted(signal);
  const limits = parseProcessingLimits(inputLimits);
  const format = detectDocumentFormat(file.name);

  if (format === 'docx') {
    throw new InputLimitError(
      'DOCX input is not enabled because no browser-local DOCX parser has passed G1 qualification yet (see docs/qualification/WP02-DOCX-CANDIDATE.md). Use UTF-8 TXT or Markdown instead.',
    );
  }

  if (file.size === 0) {
    throw new InputLimitError(`Selected ${format.toUpperCase()} file is empty.`);
  }
  if (file.size > limits.maxTxtInputBytes) {
    throw new InputLimitError(
      `File exceeds the ${limits.maxTxtInputBytes.toLocaleString('en-US')} byte size limit (${file.size.toLocaleString('en-US')} bytes). File rejected without truncation.`,
    );
  }

  const buffer = await file.arrayBuffer();
  throwIfAborted(signal);

  if (buffer.byteLength > limits.maxTxtInputBytes) {
    throw new InputLimitError(
      `File content exceeds the ${limits.maxTxtInputBytes.toLocaleString('en-US')} byte size limit (${buffer.byteLength.toLocaleString('en-US')} bytes). File rejected without truncation.`,
    );
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let decoded: string;
  try {
    decoded = decoder.decode(buffer);
  } catch {
    throw new InputLimitError(
      'File contains invalid UTF-8 byte sequences and cannot be decoded safely.',
    );
  }

  if (decoded.charCodeAt(0) === 0xfeff) {
    decoded = decoded.slice(1);
  }

  if (decoded.length > limits.maxTextUtf16CodeUnits) {
    throw new InputLimitError(
      `Decoded text exceeds the ${limits.maxTextUtf16CodeUnits.toLocaleString('en-US')} UTF-16 character limit.`,
    );
  }

  throwIfAborted(signal);
  return parseDocumentText(decoded, format, limits);
}
