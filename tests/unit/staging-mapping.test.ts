import { describe, expect, it } from 'vitest';
import { parseDelimitedText } from '@/domain/delimited-intake';
import {
  applyStagingMapping,
  computeStagingSessionFingerprint,
  STAGING_MAPPING_SCHEMA_VERSION,
  validateStagingMappingSpec,
  type StagingMappingSpec,
} from '@/domain/staging-mapping';

describe('WP03 E3: Explicit mapping, transformation, validation, and unmapped/loss reporting', () => {
  it('maps positional columns with explicit language/role rules, optional group key, before/after trim transform, and unmapped column loss reporting', async () => {
    const rawCsv = [
      'grp_code,term_val,lang_code,role_code,reviewer_note,extra_id',
      'G1,"  probing depth  ",en,preferred,Periodontal note,101',
      'G1,"sondalama   derinliği",tr,,Missing role row,102',
      'G2,"Na+/K+-ATPase",shared,abbreviation,Shared symbol,103',
      ',p53,,abbreviation,Missing group and language,104',
    ].join('\n');

    const rawStage = await parseDelimitedText(rawCsv, { delimiter: ',' });

    const mappingNoTrim: StagingMappingSpec = {
      mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
      termColumnIndex: 1,
      languageSource: { kind: 'column', columnIndex: 2, missingPolicy: 'undetermined' },
      roleSource: { kind: 'column', columnIndex: 3, missingPolicy: 'unspecified' },
      groupKeyColumnIndex: 0,
      textTransform: 'none',
    };

    const mappedRaw = applyStagingMapping(rawStage, mappingNoTrim, 3);
    expect(mappedRaw.baseLibraryRevision).toBe(3);
    expect(mappedRaw.unmappedColumns.map((c) => ({ index: c.columnIndex, name: c.rawName, nonEmptyCount: c.nonEmptyRowCount }))).toEqual([
      { index: 4, name: 'reviewer_note', nonEmptyCount: 4 },
      { index: 5, name: 'extra_id', nonEmptyCount: 4 },
    ]);

    // Without trim transform, leading/trailing spaces are preserved verbatim and flagged advisory
    expect(mappedRaw.rows[0].rawTermText).toBe('  probing depth  ');
    expect(mappedRaw.rows[0].stagedTermText).toBe('  probing depth  ');
    expect(mappedRaw.rows[0].wasTransformed).toBe(false);
    expect(mappedRaw.rows[0].issues.map((i) => i.code)).toContain('UNTRIMMED_WHITESPACE_ADVISORY');

    // Now enable explicit trim-collapse-spaces transform
    const mappingWithTrim: StagingMappingSpec = {
      ...mappingNoTrim,
      textTransform: 'trim-collapse-spaces',
    };
    const mappedTrimmed = applyStagingMapping(rawStage, mappingWithTrim, 3);

    expect(mappedTrimmed.rows[0].rawTermText).toBe('  probing depth  ');
    expect(mappedTrimmed.rows[0].stagedTermText).toBe('probing depth');
    expect(mappedTrimmed.rows[0].wasTransformed).toBe(true);
    expect(mappedTrimmed.rows[0].issues.map((i) => i.code)).toContain('TEXT_TRANSFORM_APPLIED');

    // Row 2 had redundant internal spaces collapsed + missing role defaulted to 'unspecified' via explicit policy
    expect(mappedTrimmed.rows[1].rawTermText).toBe('sondalama   derinliği');
    expect(mappedTrimmed.rows[1].stagedTermText).toBe('sondalama derinliği');
    expect(mappedTrimmed.rows[1].stagedRole).toBe('unspecified');
    expect(mappedTrimmed.rows[1].stagedLanguage).toEqual({ kind: 'language', tag: 'tr' });
    expect(mappedTrimmed.rows[1].groupKey).toBe('G1');

    // Row 4 had missing group key -> null, and missing language -> undetermined via explicit policy
    expect(mappedTrimmed.rows[3].groupKey).toBeNull();
    expect(mappedTrimmed.rows[3].stagedLanguage).toEqual({ kind: 'undetermined' });
    expect(mappedTrimmed.rows[3].stagedTermText).toBe('p53');
  });

  it('flags blank terms, unknown language tags, unknown roles, missing required language/role when policy is error, formula-leading strings, and parse issues', async () => {
    const dirtyCsv = [
      'term,lang,role,unmapped_col',
      '   ,en,preferred,u1',
      'TNF-α,fr-FR,preferred,u2',
      'IL-1β,en,synonym-unknown,u3',
      'CD4+,,,u4',
      '"=cmd|""/c calc""!A0",en,alternative,u5',
      '"2,4-dinitrophenol",en-GB,orthographic,u6',
    ].join('\n');

    const rawStage = await parseDelimitedText(dirtyCsv, { delimiter: ',' });
    const strictMapping: StagingMappingSpec = {
      mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
      termColumnIndex: 0,
      languageSource: { kind: 'column', columnIndex: 1, missingPolicy: 'error' },
      roleSource: { kind: 'column', columnIndex: 2, missingPolicy: 'error' },
      groupKeyColumnIndex: null,
      textTransform: 'trim-exterior',
    };

    const mapped = applyStagingMapping(rawStage, strictMapping, 0);

    // Row 1: blank term -> blocking error
    expect(mapped.rows[0].issues.some((i) => i.code === 'BLANK_TERM_TEXT' && i.severity === 'error')).toBe(true);
    expect(mapped.rows[0].isValidForPlanning).toBe(false);

    // Row 2: unknown language tag fr-FR -> blocking error
    expect(mapped.rows[1].issues.some((i) => i.code === 'INVALID_LANGUAGE_TAG' && i.severity === 'error')).toBe(true);
    expect(mapped.rows[1].isValidForPlanning).toBe(false);

    // Row 3: unknown role synonym-unknown -> blocking error
    expect(mapped.rows[2].issues.some((i) => i.code === 'INVALID_EXPRESSION_ROLE' && i.severity === 'error')).toBe(true);
    expect(mapped.rows[2].isValidForPlanning).toBe(false);

    // Row 4: missing language & role when missingPolicy === 'error' -> blocking errors
    expect(mapped.rows[3].issues.some((i) => i.code === 'MISSING_LANGUAGE' && i.severity === 'error')).toBe(true);
    expect(mapped.rows[3].issues.some((i) => i.code === 'MISSING_ROLE' && i.severity === 'error')).toBe(true);
    expect(mapped.rows[3].isValidForPlanning).toBe(false);

    // Row 5: formula-leading text is preserved verbatim as inert string, with FORMULA_LIKE_TEXT warning
    expect(mapped.rows[4].stagedTermText).toBe('=cmd|"/c calc"!A0');
    expect(mapped.rows[4].issues.some((i) => i.code === 'FORMULA_LIKE_TEXT' && i.severity === 'warning')).toBe(true);
    expect(mapped.rows[4].isValidForPlanning).toBe(true);

    // Row 6: valid en-GB orthographic form with comma
    expect(mapped.rows[5].stagedTermText).toBe('2,4-dinitrophenol');
    expect(mapped.rows[5].stagedLanguage).toEqual({ kind: 'language', tag: 'en-GB' });
    expect(mapped.rows[5].stagedRole).toBe('orthographic');
    expect(mapped.rows[5].isValidForPlanning).toBe(true);
  });

  it('handles duplicate headers, adversarial object keys, fixed language/role rules, and invalidates session fingerprint on file, mapping, or revision change', async () => {
    const raw = [
      '__proto__,term,term,constructor',
      'G-PROTO,İnflamasyon,IGNORED_SECOND_TERM,toString',
      'G-PROTO,Işık mikroskobu,IGNORED_2,valueOf',
    ].join('\n');

    const rawStage = await parseDelimitedText(raw, { delimiter: ',' });

    const specA: StagingMappingSpec = {
      mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
      termColumnIndex: 1,
      languageSource: { kind: 'fixed', value: { kind: 'language', tag: 'tr' } },
      roleSource: { kind: 'fixed', value: 'preferred' },
      groupKeyColumnIndex: 0,
      textTransform: 'none',
    };

    const stageA = applyStagingMapping(rawStage, specA, 5);
    expect(stageA.duplicateHeaderColumns.map((c) => c.columnIndex)).toEqual([1, 2]);
    expect(stageA.rows[0].stagedTermText).toBe('İnflamasyon');
    expect(stageA.rows[1].stagedTermText).toBe('Işık mikroskobu');
    expect(stageA.unmappedColumns.map((c) => c.columnIndex)).toEqual([2, 3]);

    // Changing mapping or baseLibraryRevision changes the deterministic session fingerprint
    const specB: StagingMappingSpec = {
      ...specA,
      termColumnIndex: 2,
    };
    const stageB = applyStagingMapping(rawStage, specB, 5);
    const stageA_rev6 = applyStagingMapping(rawStage, specA, 6);

    const fpA = computeStagingSessionFingerprint(stageA);
    const fpB = computeStagingSessionFingerprint(stageB);
    const fpARev6 = computeStagingSessionFingerprint(stageA_rev6);

    expect(fpA).not.toBe(fpB);
    expect(fpA).not.toBe(fpARev6);

    // Out-of-range column index for this 4-column table (index 10 <= 31) is rejected by validateStagingMappingSpec
    expect(() =>
      validateStagingMappingSpec(
        {
          ...specA,
          termColumnIndex: 10,
        },
        rawStage.headers.length,
      ),
    ).toThrowError(/out of bounds/i);
  });
});
