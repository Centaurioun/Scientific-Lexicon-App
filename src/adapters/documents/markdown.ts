import {
  MARKDOWN_PARSER_VERSION,
  validateParsedDocument,
  type DocumentSection,
  type ExcludedRange,
  type ParsedDocument,
} from '@/domain/document-input';

interface LineSlice {
  start: number;
  end: number; // end of line content before CR/LF
  rawEnd: number; // end including line terminator
  content: string;
}

function splitLinesWithOffsets(text: string): LineSlice[] {
  const lines: LineSlice[] = [];
  const lineBreak = /\r\n|\r|\n/g;
  let start = 0;
  let match = lineBreak.exec(text);
  while (match) {
    const end = match.index;
    lines.push({ start, end, rawEnd: lineBreak.lastIndex, content: text.slice(start, end) });
    start = lineBreak.lastIndex;
    match = lineBreak.exec(text);
  }
  if (start < text.length) {
    lines.push({ start, end: text.length, rawEnd: text.length, content: text.slice(start) });
  }
  return lines;
}

const HEADING_RE = /^(\s{0,3})(#{1,6})(?:[ \t]+|$)(.*)$/;
const FENCE_OPEN_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const LIST_ITEM_RE = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/;
const TABLE_SEP_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;
const REF_LINK_DEF_RE = /^\s{0,3}\[[^\]]+\]:\s+\S+/;
const RAW_HTML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*)?\/?>/;

function hasUnescapedPipe(line: string): boolean {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '\\' && i + 1 < line.length) {
      i += 1;
      continue;
    }
    if (line[i] === '|') return true;
  }
  return false;
}

function normalizeExcludedRanges(ranges: ExcludedRange[]): ExcludedRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ExcludedRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= prev.end) {
      if (curr.end > prev.end) {
        merged[merged.length - 1] = { start: prev.start, end: curr.end, reason: prev.reason };
      }
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * Scans inline Markdown constructs within a non-code block range [blockStart, blockEnd)
 * to exclude inline code spans (`...`) and link/image URL destinations `](url)` while
 * preserving exact UTF-16 offsets into the immutable analyzed text.
 */
function scanInlineExclusions(
  text: string,
  blockStart: number,
  blockEnd: number,
  excluded: ExcludedRange[],
  warnings: Set<string>,
): void {
  let i = blockStart;
  while (i < blockEnd) {
    const ch = text[i];

    // Escaped character: skip next code unit literally
    if (ch === '\\' && i + 1 < blockEnd) {
      i += 2;
      continue;
    }

    // Inline code span (`...` or ``...``)
    if (ch === '`') {
      let tickLen = 1;
      while (i + tickLen < blockEnd && text[i + tickLen] === '`') {
        tickLen += 1;
      }
      const closer = '`'.repeat(tickLen);
      let searchFrom = i + tickLen;
      let closePos = -1;
      while (searchFrom < blockEnd) {
        const candidate = text.indexOf(closer, searchFrom);
        if (candidate === -1 || candidate + tickLen > blockEnd) break;
        const beforeIsTick = candidate > blockStart && text[candidate - 1] === '`';
        const afterIsTick =
          candidate + tickLen < blockEnd && text[candidate + tickLen] === '`';
        if (!beforeIsTick && !afterIsTick) {
          closePos = candidate;
          break;
        }
        searchFrom = candidate + 1;
      }
      if (closePos !== -1) {
        excluded.push({
          start: i,
          end: closePos + tickLen,
          reason: 'inline-code',
        });
        i = closePos + tickLen;
        continue;
      } else {
        warnings.add(
          'Unclosed inline backtick delimiter detected; analyzed conservatively as literal text.',
        );
        i += tickLen;
        continue;
      }
    }

    // Inline link or image: [label](destination) -> keep label eligible, exclude (destination)
    if (ch === ']' && i + 1 < blockEnd && text[i + 1] === '(') {
      const destStart = i + 1;
      let depth = 0;
      let j = destStart;
      let closed = false;
      while (j < blockEnd) {
        const c = text[j];
        if (c === '\\' && j + 1 < blockEnd) {
          j += 2;
          continue;
        }
        if (c === '\n' || c === '\r') break;
        if (c === '(') depth += 1;
        else if (c === ')') {
          depth -= 1;
          if (depth === 0) {
            excluded.push({
              start: destStart,
              end: j + 1,
              reason: 'link-destination',
            });
            i = j + 1;
            closed = true;
            break;
          }
        }
        j += 1;
      }
      if (closed) continue;
    }

    i += 1;
  }

  const slice = text.slice(blockStart, blockEnd);
  if (RAW_HTML_TAG_RE.test(slice)) {
    warnings.add(
      'Raw HTML syntax detected in Markdown input; analyzed conservatively as literal text without HTML rendering.',
    );
  }
}

/**
 * Conservative dependency-free Markdown structural parser (md-conservative-v1).
 * Preserves immutable literal analyzed text so all UTF-16 offsets are exact and never fabricated.
 */
export function parseMarkdownDocument(text: string): ParsedDocument {
  const lines = splitLinesWithOffsets(text);
  const sections: DocumentSection[] = [];
  const excluded: ExcludedRange[] = [];
  const warnings = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines between sections
    if (line.content.trim().length === 0) {
      i += 1;
      continue;
    }

    // 1. Fenced code block (``` or ~~~)
    const fenceMatch = FENCE_OPEN_RE.exec(line.content);
    if (fenceMatch) {
      const fenceChar = fenceMatch[2][0];
      const fenceLen = fenceMatch[2].length;
      const fenceStart = line.start;
      const info = fenceMatch[3].trim();
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const closeLine = lines[j].content.trim();
        if (
          closeLine.length >= fenceLen &&
          [...closeLine].every((c) => c === fenceChar)
        ) {
          closed = true;
          break;
        }
        j += 1;
      }

      const lastLineIndex = closed ? j : lines.length - 1;
      const fenceEnd = lines[lastLineIndex].end > fenceStart
        ? lines[lastLineIndex].end
        : lines[lastLineIndex].rawEnd;

      if (!closed) {
        warnings.add(
          'Malformed or unclosed fenced code block detected; remaining lines excluded conservatively as code.',
        );
      }

      sections.push({
        start: fenceStart,
        end: fenceEnd,
        kind: 'code',
        label: info ? `Code (${info})` : 'Code block',
      });
      excluded.push({ start: fenceStart, end: fenceEnd, reason: 'code-fence' });
      i = closed ? j + 1 : lines.length;
      continue;
    }

    // 2. ATX Heading (# ... ######)
    const headingMatch = HEADING_RE.exec(line.content);
    if (headingMatch) {
      const level = headingMatch[2].length;
      const label = headingMatch[3].trim();
      sections.push({
        start: line.start,
        end: line.end,
        kind: 'heading',
        label: label ? `H${level}: ${label.slice(0, 48)}` : `H${level}`,
      });
      scanInlineExclusions(text, line.start, line.end, excluded, warnings);
      i += 1;
      continue;
    }

    // 3. Reference-style link definition ([ref]: https://...)
    if (REF_LINK_DEF_RE.test(line.content)) {
      warnings.add(
        'Reference-style link definition detected; link target excluded conservatively.',
      );
      sections.push({
        start: line.start,
        end: line.end,
        kind: 'other',
        label: 'Link reference',
      });
      excluded.push({ start: line.start, end: line.end, reason: 'link-destination' });
      i += 1;
      continue;
    }

    // 4. Pipe table (header + separator row + body rows)
    if (
      i + 1 < lines.length &&
      hasUnescapedPipe(line.content) &&
      TABLE_SEP_RE.test(lines[i + 1].content)
    ) {
      const tableStart = line.start;
      const sepLine = lines[i + 1];
      excluded.push({
        start: sepLine.start,
        end: sepLine.end,
        reason: 'table-separator',
      });

      let j = i + 2;
      while (j < lines.length && lines[j].content.trim().length > 0 && hasUnescapedPipe(lines[j].content)) {
        j += 1;
      }

      const tableEnd = lines[j - 1].end;
      sections.push({
        start: tableStart,
        end: tableEnd,
        kind: 'table',
        label: `Table (${j - i} lines)`,
      });

      // Scan inline exclusions per table row (skipping separator row)
      scanInlineExclusions(text, line.start, line.end, excluded, warnings);
      for (let r = i + 2; r < j; r += 1) {
        scanInlineExclusions(text, lines[r].start, lines[r].end, excluded, warnings);
      }

      i = j;
      continue;
    }

    // 5. List block (each list item is its own section so candidates never span across separate list items)
    if (LIST_ITEM_RE.test(line.content)) {
      sections.push({
        start: line.start,
        end: line.end,
        kind: 'list',
        label: 'List item',
      });
      scanInlineExclusions(text, line.start, line.end, excluded, warnings);
      i += 1;
      continue;
    }

    // 6. Paragraph block (consecutive non-blank, non-special lines)
    const paraStart = line.start;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (
        next.content.trim().length === 0 ||
        FENCE_OPEN_RE.test(next.content) ||
        HEADING_RE.test(next.content) ||
        LIST_ITEM_RE.test(next.content) ||
        REF_LINK_DEF_RE.test(next.content) ||
        (j + 1 < lines.length && hasUnescapedPipe(next.content) && TABLE_SEP_RE.test(lines[j + 1].content))
      ) {
        break;
      }
      j += 1;
    }
    const paraEnd = lines[j - 1].end;
    sections.push({
      start: paraStart,
      end: paraEnd,
      kind: 'paragraph',
    });
    scanInlineExclusions(text, paraStart, paraEnd, excluded, warnings);
    i = j;
  }

  return validateParsedDocument({
    format: 'markdown',
    text,
    parserVersion: MARKDOWN_PARSER_VERSION,
    sections,
    excludedRanges: normalizeExcludedRanges(excluded),
    warnings: Array.from(warnings),
  });
}
