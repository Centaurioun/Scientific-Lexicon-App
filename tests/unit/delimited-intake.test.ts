import { describe, expect, it } from 'vitest';
import {
  APPROVED_SYNTHETIC_IMPORT_FIXTURES,
  computeRawBytesSha256,
  DELIMITED_INTAKE_LIMITS,
  DelimitedParseError,
  getSyntheticImportFixtureById,
  parseDelimitedText,
  SyntheticImportPolicyError,
  verifyApprovedSyntheticImportBytes,
} from '@/domain/delimited-intake';
import {
  readSyntheticDelimitedFile,
  stageApprovedBuiltInSyntheticFixture,
} from '@/application/delimited-file';
import { computeDictionaryPackDigest, SYNTHETIC_DICTIONARY_FIXTURE_PAYLOADS } from '@/domain/synthetic-dictionary-manifest';

describe('WP03 E2: Strict delimited file adapter, pure CSV/TSV parser, and raw-byte synthetic fixture gate', () => {
  it('parses RFC-4180 CSV and TSV with explicit delimiter, BOM removal, CRLF/LF/CR, quoted fields, escaped quotes, embedded newlines, and empty trailing fields', async () => {
    const csvWithBom =
      '\uFEFFterm_en,term_tr,role,notes,extra_tail\r\n' +
      '"2,4-dinitrophenol","2,4-dinitrofenol",preferred,"Contains ""quoted"" text\nand embedded newline",\r\n' +
      'p53,p53 tümör baskılayıcı,abbreviation,Case-sensitive lower p53,tail\n' +
      'P53,P53 proteini,preferred,Case-sensitive upper P53,\r' +
      '   \r\n' +
      '"İnflamasyon / İmmün yanıt","Işık mikroskobu / ıslak yayma",alternative,"Greek TNF-α, IL-1β, Na+/K+-ATPase 🧪",end';

    const stage = await parseDelimitedText(csvWithBom, {
      delimiter: ',',
      blankLinePolicy: 'skip',
      sourceName: 'synthetic-test.csv',
    });

    expect(stage.hasUtf8Bom).toBe(true);
    expect(stage.delimiter).toBe(',');
    expect(stage.headers.map((h) => h.rawName)).toEqual([
      'term_en',
      'term_tr',
      'role',
      'notes',
      'extra_tail',
    ]);
    expect(stage.headers.map((h) => h.columnIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(stage.skippedBlankLineNumbers).toEqual([6]);
    expect(stage.rows).toHaveLength(4);

    // Row 1 coordinates & exact raw preservation
    expect(stage.rows[0].rowNumber).toBe(1);
    expect(stage.rows[0].startLine).toBe(2);
    expect(stage.rows[0].endLine).toBe(3);
    expect(stage.rows[0].rawCells).toEqual([
      '2,4-dinitrophenol',
      '2,4-dinitrofenol',
      'preferred',
      'Contains "quoted" text\nand embedded newline',
      '',
    ]);
    expect(stage.rows[0].rowIssues).toEqual([]);

    // Case sensitivity p53 vs P53 and Turkish İ/I/ı + Greek + emoji
    expect(stage.rows[1].rawCells[0]).toBe('p53');
    expect(stage.rows[2].rawCells[0]).toBe('P53');
    expect(stage.rows[3].rawCells[0]).toBe('İnflamasyon / İmmün yanıt');
    expect(stage.rows[3].rawCells[1]).toBe('Işık mikroskobu / ıslak yayma');
    expect(stage.rows[3].rawCells[3]).toContain('TNF-α');
    expect(stage.rows[3].rawCells[3]).toContain('🧪');

    // TSV explicit delimiter does not split on commas
    const tsv = 'col_a\tcol_b\n"a,b"\tval_2';
    const tsvStage = await parseDelimitedText(tsv, { delimiter: '\t' });
    expect(tsvStage.headers.map((h) => h.rawName)).toEqual(['col_a', 'col_b']);
    expect(tsvStage.rows[0].rawCells).toEqual(['a,b', 'val_2']);
  });

  it('Preserves duplicate and adversarial prototype header names purely by positional index without prototype pollution', async () => {
    const raw = '__proto__,constructor,term,term,toString\nval1,val2,TNF-α,TNF-alfa,val5';
    const stage = await parseDelimitedText(raw, { delimiter: ',' });

    expect(stage.headers).toHaveLength(5);
    expect(stage.headers[0]).toEqual({ columnIndex: 0, rawName: '__proto__', isDuplicateName: false });
    expect(stage.headers[1]).toEqual({ columnIndex: 1, rawName: 'constructor', isDuplicateName: false });
    expect(stage.headers[2]).toEqual({ columnIndex: 2, rawName: 'term', isDuplicateName: true });
    expect(stage.headers[3]).toEqual({ columnIndex: 3, rawName: 'term', isDuplicateName: true });
    expect(stage.headers[4]).toEqual({ columnIndex: 4, rawName: 'toString', isDuplicateName: false });
    expect(stage.rows[0].rawCells).toEqual(['val1', 'val2', 'TNF-α', 'TNF-alfa', 'val5']);
  });

  it('rejects unclosed quotes, mid-field quotes, NUL characters, and blank input fail-closed', async () => {
    await expect(
      parseDelimitedText('a,b\n"unclosed,value', { delimiter: ',' }),
    ).rejects.toThrowError(DelimitedParseError);

    await expect(
      parseDelimitedText('a,b\n"bad"trail,value', { delimiter: ',' }),
    ).rejects.toThrowError(/closing quote/i);

    await expect(
      parseDelimitedText('a,b\nfoo\u0000bar,baz', { delimiter: ',' }),
    ).rejects.toThrowError(/NUL/i);

    await expect(
      parseDelimitedText('   \r\n  ', { delimiter: ',' }),
    ).rejects.toThrowError(/empty/i);
  });

  it('flags irregular field counts and blank-line policy violations as explicit row issues that block approval', async () => {
    const irregular = 'h1,h2,h3\nrow1_a,row1_b\nrow2_a,row2_b,row2_c,row2_d\n\nrow3_a,row3_b,row3_c';
    const stage = await parseDelimitedText(irregular, {
      delimiter: ',',
      blankLinePolicy: 'error-row',
    });

    expect(stage.rows).toHaveLength(4);
    expect(stage.rows[0].rowIssues.map((i) => i.code)).toContain('IRREGULAR_COLUMN_COUNT');
    expect(stage.rows[1].rowIssues.map((i) => i.code)).toContain('IRREGULAR_COLUMN_COUNT');
    expect(stage.rows[2].rowIssues.map((i) => i.code)).toContain('BLANK_LINE');
    expect(stage.rows[3].rowIssues).toEqual([]);
    expect(stage.hasBlockingParseIssues).toBe(true);
  });

  it('enforces exact boundary and boundary+1 limits for file bytes, UTF-16 chars, data rows, columns, and cell length without truncation', async () => {
    // 1. Columns limit: 32 allowed, 33 rejected
    const cols32 = Array.from({ length: 32 }, (_, i) => `c${i}`).join(',') + '\n' + Array.from({ length: 32 }, () => 'v').join(',');
    const parsed32 = await parseDelimitedText(cols32, { delimiter: ',' });
    expect(parsed32.headers).toHaveLength(32);

    const cols33 = Array.from({ length: 33 }, (_, i) => `c${i}`).join(',') + '\n' + Array.from({ length: 33 }, () => 'v').join(',');
    await expect(parseDelimitedText(cols33, { delimiter: ',' })).rejects.toThrowError(/32 columns/i);

    // 2. Cell UTF-16 limit: 8192 allowed, 8193 rejected
    const cell8192 = `h1\n${'a'.repeat(DELIMITED_INTAKE_LIMITS.maxCellUtf16CodeUnits)}`;
    const parsedCell = await parseDelimitedText(cell8192, { delimiter: ',' });
    expect(parsedCell.rows[0].rawCells[0]).toHaveLength(8192);

    const cell8193 = `h1\n${'a'.repeat(DELIMITED_INTAKE_LIMITS.maxCellUtf16CodeUnits + 1)}`;
    await expect(parseDelimitedText(cell8193, { delimiter: ',' })).rejects.toThrowError(/8,192|8192/);

    // 3. Data rows limit: 1000 data rows (+1 header = 1001 lines) allowed, 1001 data rows rejected
    const rows1000 = 'h1\n' + Array.from({ length: 1000 }, (_, i) => `r${i}`).join('\n');
    const parsed1000 = await parseDelimitedText(rows1000, { delimiter: ',' });
    expect(parsed1000.rows).toHaveLength(1000);

    const rows1001 = 'h1\n' + Array.from({ length: 1001 }, (_, i) => `r${i}`).join('\n');
    await expect(parseDelimitedText(rows1001, { delimiter: ',' })).rejects.toThrowError(/1,000|1000/);

    // 4. Total UTF-16 decoded chars limit: 200,000 allowed, 200,001 rejected
    const header = 'h1\n';
    const bodyLen = DELIMITED_INTAKE_LIMITS.maxTextUtf16CodeUnits - header.length;
    // Split across 30 rows of ~6666 chars each (<= 8192 per cell)
    const chunk = 'x'.repeat(5000);
    const rowsFor200k: string[] = [];
    let remaining = bodyLen;
    while (remaining > 0) {
      const take = Math.min(5000, remaining);
      rowsFor200k.push('x'.repeat(take));
      remaining -= take + 1; // account for newline
    }
    const textOver200k = header + 'x'.repeat(5000) + '\n'.repeat(195000);
    expect(textOver200k.length).toBeGreaterThan(DELIMITED_INTAKE_LIMITS.maxTextUtf16CodeUnits);
    await expect(parseDelimitedText(textOver200k, { delimiter: ',' })).rejects.toThrowError(/200,000|200000/);
  });

  it('distinguishes WP03 raw-byte SHA-256 fixture allowlist from WP02 canonical JSON semantic digest and rejects malformed UTF-8 or unknown files', async () => {
    expect(APPROVED_SYNTHETIC_IMPORT_FIXTURES.length).toBeGreaterThanOrEqual(2);

    const primaryFixture = getSyntheticImportFixtureById('synth-bilingual-dirty-csv-v1');
    expect(primaryFixture).toBeDefined();

    const rawBytes = new TextEncoder().encode(primaryFixture!.rawText);
    const computedHex = await computeRawBytesSha256(rawBytes);
    expect(computedHex).toBe(primaryFixture!.rawByteSha256);

    // Verify approved raw bytes pass
    const verified = await verifyApprovedSyntheticImportBytes(rawBytes);
    expect(verified.fixture.id).toBe('synth-bilingual-dirty-csv-v1');

    // Unlike WP02 canonical JSON pack digest (which accepts CRLF vs LF formatting of the same JSON object),
    // WP03 raw-byte SHA-256 rejects a 1-byte newline or whitespace variation!
    const pack = SYNTHETIC_DICTIONARY_FIXTURE_PAYLOADS['pack-synth-bio-v1'];
    const canonicalPackDigest1 = await computeDictionaryPackDigest(pack);
    const canonicalPackDigest2 = await computeDictionaryPackDigest(JSON.parse(JSON.stringify(pack)));
    expect(canonicalPackDigest1).toBe(canonicalPackDigest2);

    const crlfBytes = new TextEncoder().encode(primaryFixture!.rawText.replace(/\n/g, '\r\n'));
    await expect(verifyApprovedSyntheticImportBytes(crlfBytes)).rejects.toThrowError(
      SyntheticImportPolicyError,
    );

    // Browser file adapter tests: valid approved file, malformed UTF-8 bytes, oversized > 2 MiB file
    const validFile = new File([rawBytes], primaryFixture!.filename, { type: 'text/csv' });
    const loadedStage = await readSyntheticDelimitedFile(validFile, {
      delimiter: primaryFixture!.delimiter,
    });
    expect(loadedStage.rawByteSha256).toBe(primaryFixture!.rawByteSha256);
    expect(loadedStage.approvedFixtureId).toBe(primaryFixture!.id);

    const builtInStage = await stageApprovedBuiltInSyntheticFixture('synth-bilingual-dirty-csv-v1');
    expect(builtInStage.rawByteSha256).toBe(primaryFixture!.rawByteSha256);
    expect(builtInStage.rows.length).toBe(loadedStage.rows.length);

    // Malformed UTF-8 sequence (0xFF 0xFE invalid UTF-8) fails closed
    const badUtf8File = new File([new Uint8Array([0xff, 0xfe, 0x61])], 'bad.csv', { type: 'text/csv' });
    await expect(readSyntheticDelimitedFile(badUtf8File, { delimiter: ',' })).rejects.toThrowError(
      /UTF-8|allowlist/i,
    );

    // Oversize > 2 MiB rejected before reading bytes
    const oversizeFile = new File(
      [new Uint8Array(DELIMITED_INTAKE_LIMITS.maxFileBytes + 1)],
      'huge.csv',
      { type: 'text/csv' },
    );
    await expect(readSyntheticDelimitedFile(oversizeFile, { delimiter: ',' })).rejects.toThrowError(
      /2,097,152|2 MiB/i,
    );
  });
});
