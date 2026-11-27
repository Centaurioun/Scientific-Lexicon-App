import { deepFreeze } from './changes';

export const DELIMITED_INTAKE_SCHEMA_VERSION = 'wp03-delimited-stage-v1' as const;
export const SYNTHETIC_IMPORT_POLICY_VERSION = 'wp03-synthetic-raw-allowlist-v1' as const;

export const DELIMITED_INTAKE_LIMITS = deepFreeze({
  maxFileBytes: 2 * 1024 * 1024, // 2 MiB (2,097,152 bytes)
  maxTextUtf16CodeUnits: 200_000, // 200,000 UTF-16 code units
  maxDataRows: 1_000, // 1,000 data rows (header row excluded)
  maxColumns: 32, // 32 positional columns
  maxCellUtf16CodeUnits: 8_192, // 8,192 UTF-16 code units per cell
  maxAtomicChangeOperations: 250, // max 250 operations in one reviewed atomic ChangePayload
});

export type DelimitedDelimiter = ',' | '\t';
export type BlankLinePolicy = 'skip' | 'error-row';

export class DelimitedParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line = 1, column = 1) {
    super(message);
    this.name = 'DelimitedParseError';
    this.line = line;
    this.column = column;
  }
}

export class SyntheticImportPolicyError extends Error {
  readonly actualSha256: string;

  constructor(message: string, actualSha256: string) {
    super(message);
    this.name = 'SyntheticImportPolicyError';
    this.actualSha256 = actualSha256;
  }
}

export interface PositionalHeaderColumn {
  readonly columnIndex: number;
  readonly rawName: string;
  readonly isDuplicateName: boolean;
}

export type RawRowParseIssueCode = 'IRREGULAR_COLUMN_COUNT' | 'BLANK_LINE';

export interface RawRowParseIssue {
  readonly code: RawRowParseIssueCode;
  readonly message: string;
  readonly blocking: true;
}

export interface RawStagedRow {
  readonly rowNumber: number; // 1-based data row index (excluding header)
  readonly startLine: number; // 1-based physical line in decoded text
  readonly endLine: number; // 1-based physical line in decoded text
  readonly startOffset: number; // 0-based UTF-16 offset after optional BOM removal
  readonly endOffset: number; // 0-based UTF-16 end offset after optional BOM removal
  readonly rawCells: readonly string[];
  readonly rowIssues: readonly RawRowParseIssue[];
}

export interface RawDelimitedStage {
  readonly schemaVersion: typeof DELIMITED_INTAKE_SCHEMA_VERSION;
  readonly sourceName: string;
  readonly delimiter: DelimitedDelimiter;
  readonly blankLinePolicy: BlankLinePolicy;
  readonly hasUtf8Bom: boolean;
  readonly rawByteLength: number;
  readonly rawByteSha256: string;
  readonly decodedUtf16Length: number;
  readonly headers: readonly PositionalHeaderColumn[];
  readonly rows: readonly RawStagedRow[];
  readonly skippedBlankLineNumbers: readonly number[];
  readonly hasBlockingParseIssues: boolean;
  readonly approvedFixtureId: string | null;
}

export interface ParseDelimitedOptions {
  delimiter: DelimitedDelimiter;
  blankLinePolicy?: BlankLinePolicy;
  sourceName?: string;
  rawByteLength?: number;
  rawByteSha256?: string;
  approvedFixtureId?: string | null;
}

export async function computeRawBytesSha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', copy);
  const arr = new Uint8Array(hashBuffer);
  let hex = '';
  for (let i = 0; i < arr.length; i += 1) {
    hex += arr[i].toString(16).padStart(2, '0');
  }
  return hex;
}

interface ParsedPhysicalRecord {
  readonly cells: string[];
  readonly startLine: number;
  readonly endLine: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly isBlankUnquotedLine: boolean;
}

/**
 * Pure, deterministic RFC-4180 style CSV/TSV parser with explicit delimiter,
 * exact UTF-16 offset and physical line coordinate tracking, and strict limit checks.
 */
export async function parseDelimitedText(
  rawInputText: string,
  options: ParseDelimitedOptions,
): Promise<RawDelimitedStage> {
  const delimiter = options.delimiter;
  if (delimiter !== ',' && delimiter !== '\t') {
    throw new DelimitedParseError('Delimiter must be explicitly specified as comma (",") or tab ("\\t").');
  }

  const blankLinePolicy: BlankLinePolicy = options.blankLinePolicy ?? 'skip';
  const sourceName = options.sourceName ?? 'session-delimited-input';

  if (rawInputText.includes('\u0000')) {
    const nulIdx = rawInputText.indexOf('\u0000');
    throw new DelimitedParseError(
      `Delimited source contains a NUL byte/character at UTF-16 offset ${nulIdx}; binary or corrupted files are rejected.`,
      1,
      nulIdx + 1,
    );
  }

  const hasUtf8Bom = rawInputText.charCodeAt(0) === 0xfeff;
  const text = hasUtf8Bom ? rawInputText.slice(1) : rawInputText;

  if (text.length > DELIMITED_INTAKE_LIMITS.maxTextUtf16CodeUnits) {
    throw new DelimitedParseError(
      `Decoded delimited text length (${text.length.toLocaleString('en-US')} UTF-16 code units) exceeds the maximum allowed ${DELIMITED_INTAKE_LIMITS.maxTextUtf16CodeUnits.toLocaleString('en-US')} UTF-16 code units.`,
    );
  }

  const encodedBytes =
    options.rawByteLength !== undefined
      ? null
      : new TextEncoder().encode(rawInputText);
  const rawByteLength = options.rawByteLength ?? encodedBytes!.byteLength;

  if (rawByteLength > DELIMITED_INTAKE_LIMITS.maxFileBytes) {
    throw new DelimitedParseError(
      `Delimited input size (${rawByteLength.toLocaleString('en-US')} bytes) exceeds the 2 MiB (${DELIMITED_INTAKE_LIMITS.maxFileBytes.toLocaleString('en-US')} bytes) maximum limit.`,
    );
  }

  if (text.trim().length === 0) {
    throw new DelimitedParseError('Delimited input is empty or contains only whitespace.');
  }

  const records: ParsedPhysicalRecord[] = [];
  const len = text.length;
  let pos = 0;
  let currentLine = 1;
  let currentCol = 1;

  while (pos < len) {
    const recordStartOffset = pos;
    const recordStartLine = currentLine;
    const cells: string[] = [];
    let hadQuotedCellInRecord = false;

    while (true) {
      let cell = '';
      if (pos < len && text[pos] === '"') {
        hadQuotedCellInRecord = true;
        const quoteOpenLine = currentLine;
        const quoteOpenCol = currentCol;
        pos += 1;
        currentCol += 1;

        let closed = false;
        while (pos < len) {
          const ch = text[pos];
          if (ch === '"') {
            if (pos + 1 < len && text[pos + 1] === '"') {
              cell += '"';
              pos += 2;
              currentCol += 2;
              if (cell.length > DELIMITED_INTAKE_LIMITS.maxCellUtf16CodeUnits) {
                throw new DelimitedParseError(
                  `Cell at line ${quoteOpenLine} exceeds maximum cell length of ${DELIMITED_INTAKE_LIMITS.maxCellUtf16CodeUnits.toLocaleString('en-US')} UTF-16 code units.`,
                  quoteOpenLine,
                  quoteOpenCol,
                );
              }
              continue;
            }
            // Closing quote
            pos += 1;
            currentCol += 1;
            closed = true;
            break;
          }

          if (ch === '\r') {
            if (pos + 1 < len && text[pos + 1] === '\n') {
              cell += '\r\n';
              pos += 2;
            } else {
              cell += '\r';
              pos += 1;
            }
            currentLine += 1;
            currentCol = 1;
          } else if (ch === '\n') {
            cell += '\n';
            pos += 1;
            currentLine += 1;
            currentCol = 1;
          } else {
            cell += ch;
            pos += 1;
            currentCol += 1;
          }

          if (cell.length > DELIMITED_INTAKE_LIMITS.maxCellUtf16CodeUnits) {
            throw new DelimitedParseError(
              `Cell at line ${quoteOpenLine} exceeds maximum cell length of ${DELIMITED_INTAKE_LIMITS.maxCellUtf16CodeUnits.toLocaleString('en-US')} UTF-16 code units.`,
              quoteOpenLine,
              quoteOpenCol,
            );
          }
        }

        if (!closed) {
          throw new DelimitedParseError(
            `Unclosed quoted field starting at line ${quoteOpenLine}, column ${quoteOpenCol}.`,
            quoteOpenLine,
            quoteOpenCol,
          );
        }

        // After closing quote, next character must be delimiter, CR, LF, or EOF
        if (pos < len && text[pos] !== delimiter && text[pos] !== '\r' && text[pos] !== '\n') {
          throw new DelimitedParseError(
            `Unexpected character "${text[pos]}" after closing quote at line ${currentLine}, column ${currentCol}.`,
            currentLine,
            currentCol,
          );
        }
      } else {
        // Unquoted field
        const cellStartLine = currentLine;
        const cellStartCol = currentCol;
        while (pos < len) {
          const ch = text[pos];
          if (ch === delimiter || ch === '\r' || ch === '\n') {
            break;
          }
          if (ch === '"') {
            throw new DelimitedParseError(
              `Unexpected quote character inside unquoted field at line ${currentLine}, column ${currentCol}.`,
              currentLine,
              currentCol,
            );
          }
          cell += ch;
          pos += 1;
          currentCol += 1;
          if (cell.length > DELIMITED_INTAKE_LIMITS.maxCellUtf16CodeUnits) {
            throw new DelimitedParseError(
              `Cell at line ${cellStartLine} exceeds maximum cell length of ${DELIMITED_INTAKE_LIMITS.maxCellUtf16CodeUnits.toLocaleString('en-US')} UTF-16 code units.`,
              cellStartLine,
              cellStartCol,
            );
          }
        }
      }

      cells.push(cell);
      if (cells.length > DELIMITED_INTAKE_LIMITS.maxColumns) {
        throw new DelimitedParseError(
          `Record at line ${recordStartLine} has more than the maximum allowed ${DELIMITED_INTAKE_LIMITS.maxColumns} columns.`,
          recordStartLine,
          1,
        );
      }

      if (pos < len && text[pos] === delimiter) {
        pos += 1;
        currentCol += 1;
        continue;
      }

      // End of record (CR, CRLF, LF, or EOF)
      const recordEndOffset = pos;
      const recordEndLine = currentLine;

      if (pos < len) {
        if (text[pos] === '\r') {
          if (pos + 1 < len && text[pos + 1] === '\n') {
            pos += 2;
          } else {
            pos += 1;
          }
        } else if (text[pos] === '\n') {
          pos += 1;
        }
        currentLine += 1;
        currentCol = 1;
      }

      const isBlankUnquotedLine =
        !hadQuotedCellInRecord && cells.length === 1 && cells[0].trim().length === 0;

      records.push({
        cells,
        startLine: recordStartLine,
        endLine: recordEndLine,
        startOffset: recordStartOffset,
        endOffset: recordEndOffset,
        isBlankUnquotedLine,
      });
      break;
    }
  }

  // Locate header record (first non-blank record)
  let headerRecordIdx = -1;
  const skippedBlankLineNumbers: number[] = [];

  for (let i = 0; i < records.length; i += 1) {
    if (records[i].isBlankUnquotedLine) {
      skippedBlankLineNumbers.push(records[i].startLine);
      continue;
    }
    headerRecordIdx = i;
    break;
  }

  if (headerRecordIdx === -1) {
    throw new DelimitedParseError('Delimited input contains no header row.');
  }

  const headerRecord = records[headerRecordIdx];
  const headerCount = headerRecord.cells.length;
  if (headerCount === 0 || headerCount > DELIMITED_INTAKE_LIMITS.maxColumns) {
    throw new DelimitedParseError(
      `Header column count (${headerCount}) must be between 1 and ${DELIMITED_INTAKE_LIMITS.maxColumns}.`,
      headerRecord.startLine,
      1,
    );
  }

  // Count duplicate header names purely by value without using plain object keys
  const nameCounts = new Map<string, number>();
  for (const rawName of headerRecord.cells) {
    nameCounts.set(rawName, (nameCounts.get(rawName) ?? 0) + 1);
  }

  const headers: PositionalHeaderColumn[] = headerRecord.cells.map((rawName, columnIndex) => ({
    columnIndex,
    rawName,
    isDuplicateName: (nameCounts.get(rawName) ?? 0) > 1,
  }));

  const rows: RawStagedRow[] = [];
  let hasBlockingParseIssues = false;

  for (let i = headerRecordIdx + 1; i < records.length; i += 1) {
    const rec = records[i];
    if (rec.isBlankUnquotedLine) {
      if (blankLinePolicy === 'skip') {
        skippedBlankLineNumbers.push(rec.startLine);
        continue;
      }
      // blankLinePolicy === 'error-row'
      const rowNumber = rows.length + 1;
      if (rowNumber > DELIMITED_INTAKE_LIMITS.maxDataRows) {
        throw new DelimitedParseError(
          `Delimited input exceeds the maximum allowed ${DELIMITED_INTAKE_LIMITS.maxDataRows.toLocaleString('en-US')} data rows (header excluded).`,
          rec.startLine,
          1,
        );
      }
      hasBlockingParseIssues = true;
      rows.push({
        rowNumber,
        startLine: rec.startLine,
        endLine: rec.endLine,
        startOffset: rec.startOffset,
        endOffset: rec.endOffset,
        rawCells: rec.cells,
        rowIssues: [
          {
            code: 'BLANK_LINE',
            message: `Line ${rec.startLine} is blank and blank-line policy is set to error-row.`,
            blocking: true,
          },
        ],
      });
      continue;
    }

    const rowNumber = rows.length + 1;
    if (rowNumber > DELIMITED_INTAKE_LIMITS.maxDataRows) {
      throw new DelimitedParseError(
        `Delimited input exceeds the maximum allowed ${DELIMITED_INTAKE_LIMITS.maxDataRows.toLocaleString('en-US')} data rows (header excluded).`,
        rec.startLine,
        1,
      );
    }

    const rowIssues: RawRowParseIssue[] = [];
    if (rec.cells.length !== headerCount) {
      hasBlockingParseIssues = true;
      rowIssues.push({
        code: 'IRREGULAR_COLUMN_COUNT',
        message: `Row ${rowNumber} (line ${rec.startLine}) has ${rec.cells.length} fields, but the header defines ${headerCount} columns.`,
        blocking: true,
      });
    }

    rows.push({
      rowNumber,
      startLine: rec.startLine,
      endLine: rec.endLine,
      startOffset: rec.startOffset,
      endOffset: rec.endOffset,
      rawCells: rec.cells,
      rowIssues,
    });
  }

  const rawByteSha256 =
    options.rawByteSha256 ??
    (await computeRawBytesSha256(encodedBytes ?? new TextEncoder().encode(rawInputText)));

  return deepFreeze({
    schemaVersion: DELIMITED_INTAKE_SCHEMA_VERSION,
    sourceName,
    delimiter,
    blankLinePolicy,
    hasUtf8Bom,
    rawByteLength,
    rawByteSha256,
    decodedUtf16Length: text.length,
    headers,
    rows,
    skippedBlankLineNumbers,
    hasBlockingParseIssues,
    approvedFixtureId: options.approvedFixtureId ?? null,
  });
}

export interface SyntheticImportFixtureEntry {
  readonly id: string;
  readonly name: string;
  readonly filename: string;
  readonly delimiter: DelimitedDelimiter;
  readonly purpose: string;
  readonly rawText: string;
  readonly rawByteSha256: string;
}

const PRIMARY_DIRTY_BILINGUAL_CSV_TEXT = [
  'concept_group,term_text,lang_tag,role_tag,legacy_source_note,unmapped_reviewer_code',
  'GRP-PD-1,probing depth,en,preferred,Synthetic periodontal measurement concept,UNMAPPED_SENTINEL_ALPHA_901',
  'GRP-PD-1,PD,en,abbreviation,Abbreviation homonym candidate 1,UNMAPPED_SENTINEL_ALPHA_901',
  'GRP-PD-1,sondalama derinliği,tr,preferred,Turkish preferred equivalent,UNMAPPED_SENTINEL_ALPHA_901',
  'GRP-PD-2,Parkinson disease,en,preferred,Distinct neurological concept sharing PD,UNMAPPED_SENTINEL_BETA_902',
  'GRP-PD-2,PD,en,abbreviation,Abbreviation homonym candidate 2,UNMAPPED_SENTINEL_BETA_902',
  'GRP-DNP,"2,4-dinitrophenol",en,preferred,"Quoted chemical with comma and ""inner quotes""",UNMAPPED_SENTINEL_GAMMA_903',
  'GRP-DNP,"2,4-dinitrofenol",tr,preferred,Turkish chemical form,UNMAPPED_SENTINEL_GAMMA_903',
  'GRP-P53-GENE,p53,shared,abbreviation,Lower-case gene symbol p53,UNMAPPED_SENTINEL_DELTA_904',
  'GRP-P53-PROT,P53,shared,preferred,Upper-case protein symbol P53,UNMAPPED_SENTINEL_DELTA_904',
  'GRP-TR-CASE,"  İnflamasyon / İmmün yanıt  ",tr,preferred,Leading/trailing spaces for optional trim review,UNMAPPED_SENTINEL_EPSILON_905',
  'GRP-TR-DOTLESS,Işık mikroskobu / ıslak yayma,tr,alternative,Turkish I and dotless ı preservation,UNMAPPED_SENTINEL_EPSILON_905',
  'GRP-FORMULA,=SUM(A1:B2)+TNF-α,en,alternative,Formula-leading scientific string kept inert,UNMAPPED_SENTINEL_ZETA_906',
].join('\n');

const SECONDARY_TSV_FIXTURE_TEXT = [
  'group_key\tsurface_form\tlanguage\trole\tinternal_comment',
  'TSV-ATP\tNa+/K+-ATPase\tshared\tpreferred\tSynthetic pump symbol with plus and slash',
  'TSV-ATP\tsodyum-potasyum ATPaz\ttr\tpreferred\tTurkish counterpart',
  'TSV-CYT\tTNF-α\tshared\tabbreviation\tGreek alpha cytokine',
  'TSV-CYT\tIL-1β\tshared\tabbreviation\tGreek beta cytokine 🧪',
].join('\n');

const PRIVACY_DRILL_CSV_FIXTURE_TEXT = [
  'grp,term,lang,role,raw_only_unmapped_secret',
  'G-PRIV-1,SYNTH_APPROVED_IMPORT_TERM_E8,en,preferred,SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST',
  'G-PRIV-1,sentetik onaylı terim E8,tr,preferred,SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST',
  'G-PRIV-SKIP,SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST,en,alternative,SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST',
].join('\n');

/**
 * Immutable project-owned synthetic import fixture allowlist (WP03 Cycle 4 & E2).
 *
 * Distinction from WP02 dictionary packs:
 * - WP02 dictionary packs verify SHA-256 over `canonicalJson(pack)` (semantic JSON content).
 * - WP03 delimited intake verifies SHA-256 over the exact raw UTF-8 file bytes (`rawByteSha256`)
 *   before staging in the product UI, blocking arbitrary real/personal spreadsheet uploads while G4 is NOT READY.
 */
export const APPROVED_SYNTHETIC_IMPORT_FIXTURES: readonly SyntheticImportFixtureEntry[] = deepFreeze([
  {
    id: 'synth-bilingual-dirty-csv-v1',
    name: 'Synthetic Dirty Bilingual Periodontology & Biomedical CSV (12 rows)',
    filename: 'synthetic-dirty-bilingual-v1.csv',
    delimiter: ',',
    purpose:
      'Primary WP03 synthetic CSV fixture exercising EN/TR/shared grouping, PD homonyms, 2,4-dinitrophenol comma/quote escaping, p53/P53 case sensitivity, Turkish İ/I/ı, optional trim, formula-leading string, and unmapped column loss reporting.',
    rawText: PRIMARY_DIRTY_BILINGUAL_CSV_TEXT,
    rawByteSha256: '2c32a9172329bf215b45205a8fdf1a933b04e1bc96c1545de28a118309297650',
  },
  {
    id: 'synth-bilingual-symbols-tsv-v1',
    name: 'Synthetic Biomedical Symbols & Greek TSV (4 rows)',
    filename: 'synthetic-biomedical-symbols-v1.tsv',
    delimiter: '\t',
    purpose:
      'Secondary WP03 synthetic TSV fixture exercising tab delimiter, Na+/K+-ATPase, Greek TNF-α / IL-1β, emoji, and bilingual concept grouping.',
    rawText: SECONDARY_TSV_FIXTURE_TEXT,
    rawByteSha256: '6a96849087e3e52006570e83d8ce8bf5310c841c290567e9debaa53fe60a796d',
  },
  {
    id: 'synth-privacy-recovery-drill-csv-v1',
    name: 'Synthetic Privacy & Recovery Drill CSV (3 rows)',
    filename: 'synthetic-privacy-drill-v1.csv',
    delimiter: ',',
    purpose:
      'Dedicated E8 privacy and recovery drill fixture containing approved expressions, a skipped row sentinel, and an unmapped column sentinel.',
    rawText: PRIVACY_DRILL_CSV_FIXTURE_TEXT,
    rawByteSha256: '901a0e7fa0dadbc09532f392719e02de28dd559a0991217e1e6fcfb3afe2e967',
  },
]);

const FIXTURE_BY_ID = new Map<string, SyntheticImportFixtureEntry>(
  APPROVED_SYNTHETIC_IMPORT_FIXTURES.map((f) => [f.id, f]),
);

const FIXTURE_BY_SHA256 = new Map<string, SyntheticImportFixtureEntry>(
  APPROVED_SYNTHETIC_IMPORT_FIXTURES.map((f) => [f.rawByteSha256, f]),
);

export function getSyntheticImportFixtureById(id: string): SyntheticImportFixtureEntry | undefined {
  return FIXTURE_BY_ID.get(id);
}

export async function verifyApprovedSyntheticImportBytes(bytes: Uint8Array): Promise<{
  fixture: SyntheticImportFixtureEntry;
  rawByteSha256: string;
}> {
  if (bytes.byteLength > DELIMITED_INTAKE_LIMITS.maxFileBytes) {
    throw new DelimitedParseError(
      `Selected file (${bytes.byteLength.toLocaleString('en-US')} bytes) exceeds the 2 MiB (${DELIMITED_INTAKE_LIMITS.maxFileBytes.toLocaleString('en-US')} bytes) maximum limit.`,
    );
  }
  const actualSha256 = await computeRawBytesSha256(bytes);
  const fixture = FIXTURE_BY_SHA256.get(actualSha256);
  if (!fixture) {
    throw new SyntheticImportPolicyError(
      `Delimited file raw-byte SHA-256 (${actualSha256.slice(0, 16)}…) is not in the approved WP03 synthetic fixture allowlist (${SYNTHETIC_IMPORT_POLICY_VERSION}). Real personal spreadsheets and unapproved files are blocked while Gate G4 is NOT READY.`,
      actualSha256,
    );
  }
  return { fixture, rawByteSha256: actualSha256 };
}
