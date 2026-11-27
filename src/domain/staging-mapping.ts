import { z } from 'zod';
import { canonicalJson, deepFreeze } from './changes';
import type { PositionalHeaderColumn, RawDelimitedStage } from './delimited-intake';
import {
  EXPRESSION_ROLES,
  ExpressionRoleSchema,
  LanguageTagSchema,
  LanguageUseSchema,
  type ExpressionRole,
  type LanguageUse,
} from './schema';

export const STAGING_MAPPING_SCHEMA_VERSION = 'wp03-staging-mapping-v1' as const;

export const StagingTextTransformSchema = z.enum([
  'none',
  'trim-exterior',
  'trim-collapse-spaces',
]);
export type StagingTextTransform = z.infer<typeof StagingTextTransformSchema>;

export const MissingLanguagePolicySchema = z.enum(['error', 'undetermined']);
export type MissingLanguagePolicy = z.infer<typeof MissingLanguagePolicySchema>;

export const MissingRolePolicySchema = z.enum(['error', 'unspecified']);
export type MissingRolePolicy = z.infer<typeof MissingRolePolicySchema>;

export const LanguageColumnSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('column'),
      columnIndex: z.number().int().min(0).max(31),
      missingPolicy: MissingLanguagePolicySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('fixed'),
      value: LanguageUseSchema,
    })
    .strict(),
]);
export type LanguageColumnSource = z.infer<typeof LanguageColumnSourceSchema>;

export const RoleColumnSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('column'),
      columnIndex: z.number().int().min(0).max(31),
      missingPolicy: MissingRolePolicySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('fixed'),
      value: ExpressionRoleSchema,
    })
    .strict(),
]);
export type RoleColumnSource = z.infer<typeof RoleColumnSourceSchema>;

export const StagingMappingSpecSchema = z
  .object({
    mappingVersion: z.literal(STAGING_MAPPING_SCHEMA_VERSION),
    termColumnIndex: z.number().int().min(0).max(31),
    languageSource: LanguageColumnSourceSchema,
    roleSource: RoleColumnSourceSchema,
    groupKeyColumnIndex: z.number().int().min(0).max(31).nullable(),
    textTransform: StagingTextTransformSchema,
  })
  .strict();
export type StagingMappingSpec = z.infer<typeof StagingMappingSpecSchema>;

export type StagingIssueSeverity = 'error' | 'warning' | 'info';

export type StagingRowIssueCode =
  | 'IRREGULAR_COLUMN_COUNT'
  | 'BLANK_LINE'
  | 'BLANK_TERM_TEXT'
  | 'MISSING_LANGUAGE'
  | 'INVALID_LANGUAGE_TAG'
  | 'MISSING_ROLE'
  | 'INVALID_EXPRESSION_ROLE'
  | 'FORMULA_LIKE_TEXT'
  | 'REPEATED_PUNCTUATION_WARNING'
  | 'UNTRIMMED_WHITESPACE_ADVISORY'
  | 'TEXT_TRANSFORM_APPLIED';

export interface StagingRowIssue {
  readonly code: StagingRowIssueCode;
  readonly severity: StagingIssueSeverity;
  readonly message: string;
}

export interface StagedMappedRow {
  readonly rowId: string; // deterministic session row identifier ("row-1", "row-2", ...)
  readonly rowNumber: number; // 1-based data row index
  readonly startLine: number;
  readonly endLine: number;
  readonly rawCells: readonly string[];
  readonly rawTermText: string;
  readonly stagedTermText: string;
  readonly wasTransformed: boolean;
  readonly rawLanguageCell: string | null;
  readonly stagedLanguage: LanguageUse | null;
  readonly rawRoleCell: string | null;
  readonly stagedRole: ExpressionRole | null;
  readonly rawGroupKeyCell: string | null;
  readonly groupKey: string | null;
  readonly unmappedCellCount: number;
  readonly issues: readonly StagingRowIssue[];
  readonly isValidForPlanning: boolean;
}

export interface UnmappedColumnLossSummary {
  readonly columnIndex: number;
  readonly rawName: string;
  readonly nonEmptyRowCount: number;
}

export interface StagedMappedTable {
  readonly mappingVersion: typeof STAGING_MAPPING_SCHEMA_VERSION;
  readonly sourceName: string;
  readonly sourceRawByteSha256: string;
  readonly baseLibraryRevision: number;
  readonly mapping: StagingMappingSpec;
  readonly headers: readonly PositionalHeaderColumn[];
  readonly duplicateHeaderColumns: readonly PositionalHeaderColumn[];
  readonly unmappedColumns: readonly UnmappedColumnLossSummary[];
  readonly rows: readonly StagedMappedRow[];
  readonly validRowCount: number;
  readonly invalidRowCount: number;
  readonly transformedRowCount: number;
  readonly formulaWarningRowCount: number;
  readonly hasBlockingParseIssues: boolean;
}

const FORMULA_TRIGGER_RE = /^[ \t\r\n]*[=+\-@]/;
const REPEATED_PUNCTUATION_RE = /(?:-{2,}|[,.;:/]{2,})/;

export function validateStagingMappingSpec(
  input: unknown,
  totalColumns: number,
): StagingMappingSpec {
  const spec = StagingMappingSpecSchema.parse(input);
  if (spec.termColumnIndex >= totalColumns) {
    throw new Error(
      `Term column index (${spec.termColumnIndex}) is out of bounds for table with ${totalColumns} columns.`,
    );
  }
  if (spec.languageSource.kind === 'column' && spec.languageSource.columnIndex >= totalColumns) {
    throw new Error(
      `Language column index (${spec.languageSource.columnIndex}) is out of bounds for table with ${totalColumns} columns.`,
    );
  }
  if (spec.roleSource.kind === 'column' && spec.roleSource.columnIndex >= totalColumns) {
    throw new Error(
      `Role column index (${spec.roleSource.columnIndex}) is out of bounds for table with ${totalColumns} columns.`,
    );
  }
  if (spec.groupKeyColumnIndex !== null && spec.groupKeyColumnIndex >= totalColumns) {
    throw new Error(
      `Group key column index (${spec.groupKeyColumnIndex}) is out of bounds for table with ${totalColumns} columns.`,
    );
  }
  return spec;
}

function applyTextTransform(
  rawText: string,
  transform: StagingTextTransform,
): { stagedText: string; wasTransformed: boolean } {
  if (transform === 'none') {
    return { stagedText: rawText, wasTransformed: false };
  }
  if (transform === 'trim-exterior') {
    const trimmed = rawText.trim();
    return { stagedText: trimmed, wasTransformed: trimmed !== rawText };
  }
  // 'trim-collapse-spaces': trim exterior whitespace and collapse redundant ordinary ASCII spaces (0x20)
  // while preserving Unicode characters, case, punctuation, and intentional internal linebreaks if any.
  const collapsed = rawText.trim().replace(/ {2,}/g, ' ');
  return { stagedText: collapsed, wasTransformed: collapsed !== rawText };
}

function parseLanguageCell(
  rawCell: string,
  missingPolicy: MissingLanguagePolicy,
): { value: LanguageUse | null; issue: StagingRowIssue | null } {
  const trimmed = rawCell.trim();
  if (trimmed.length === 0) {
    if (missingPolicy === 'undetermined') {
      return { value: { kind: 'undetermined' }, issue: null };
    }
    return {
      value: null,
      issue: {
        code: 'MISSING_LANGUAGE',
        severity: 'error',
        message: 'Language cell is empty and missing-language policy is set to reject.',
      },
    };
  }

  if (trimmed === 'shared') {
    return { value: { kind: 'shared' }, issue: null };
  }
  if (trimmed === 'undetermined') {
    return { value: { kind: 'undetermined' }, issue: null };
  }

  const parsedTag = LanguageTagSchema.safeParse(trimmed);
  if (parsedTag.success) {
    return {
      value: { kind: 'language', tag: parsedTag.data },
      issue: null,
    };
  }

  return {
    value: null,
    issue: {
      code: 'INVALID_LANGUAGE_TAG',
      severity: 'error',
      message: `Unsupported language designation "${trimmed}". Allowed values: en, en-US, en-GB, tr, shared, undetermined.`,
    },
  };
}

function parseRoleCell(
  rawCell: string,
  missingPolicy: MissingRolePolicy,
): { value: ExpressionRole | null; issue: StagingRowIssue | null } {
  const trimmed = rawCell.trim();
  if (trimmed.length === 0) {
    if (missingPolicy === 'unspecified') {
      return { value: 'unspecified', issue: null };
    }
    return {
      value: null,
      issue: {
        code: 'MISSING_ROLE',
        severity: 'error',
        message: 'Expression role cell is empty and missing-role policy is set to reject.',
      },
    };
  }

  const parsedRole = ExpressionRoleSchema.safeParse(trimmed);
  if (parsedRole.success) {
    return { value: parsedRole.data, issue: null };
  }

  return {
    value: null,
    issue: {
      code: 'INVALID_EXPRESSION_ROLE',
      severity: 'error',
      message: `Unsupported expression role "${trimmed}". Allowed roles: ${EXPRESSION_ROLES.join(', ')}.`,
    },
  };
}

/**
 * Pure staging transformation and validation function (WP03 E3).
 * Maps positional columns from `RawDelimitedStage` into a strict, immutable `StagedMappedTable`
 * with explicit before/after transformation flags, validation issues, and an unmapped-column loss summary.
 */
export function applyStagingMapping(
  rawStage: RawDelimitedStage,
  mappingInput: StagingMappingSpec,
  baseLibraryRevision: number,
): StagedMappedTable {
  const mapping = validateStagingMappingSpec(mappingInput, rawStage.headers.length);

  const mappedColumnIndices = new Set<number>([mapping.termColumnIndex]);
  if (mapping.languageSource.kind === 'column') {
    mappedColumnIndices.add(mapping.languageSource.columnIndex);
  }
  if (mapping.roleSource.kind === 'column') {
    mappedColumnIndices.add(mapping.roleSource.columnIndex);
  }
  if (mapping.groupKeyColumnIndex !== null) {
    mappedColumnIndices.add(mapping.groupKeyColumnIndex);
  }

  const unmappedHeaderCols = rawStage.headers.filter(
    (h) => !mappedColumnIndices.has(h.columnIndex),
  );

  const unmappedNonEmptyCounts = new Map<number, number>();
  for (const col of unmappedHeaderCols) {
    unmappedNonEmptyCounts.set(col.columnIndex, 0);
  }

  const mappedRows: StagedMappedRow[] = [];
  let validRowCount = 0;
  let invalidRowCount = 0;
  let transformedRowCount = 0;
  let formulaWarningRowCount = 0;

  for (const rawRow of rawStage.rows) {
    const issues: StagingRowIssue[] = [];

    for (const parseIssue of rawRow.rowIssues) {
      issues.push({
        code: parseIssue.code,
        severity: 'error',
        message: parseIssue.message,
      });
    }

    let unmappedCellCount = 0;
    for (const col of unmappedHeaderCols) {
      const cellVal = rawRow.rawCells[col.columnIndex] ?? '';
      if (cellVal.trim().length > 0) {
        unmappedCellCount += 1;
        unmappedNonEmptyCounts.set(
          col.columnIndex,
          (unmappedNonEmptyCounts.get(col.columnIndex) ?? 0) + 1,
        );
      }
    }

    const rawTermText = rawRow.rawCells[mapping.termColumnIndex] ?? '';
    const { stagedText: stagedTermText, wasTransformed } = applyTextTransform(
      rawTermText,
      mapping.textTransform,
    );

    if (wasTransformed) {
      transformedRowCount += 1;
      issues.push({
        code: 'TEXT_TRANSFORM_APPLIED',
        severity: 'info',
        message: `Text transformation (${mapping.textTransform}) changed raw value "${rawTermText}" to "${stagedTermText}".`,
      });
    } else if (rawTermText.trim() !== rawTermText || / {2,}/.test(rawTermText)) {
      issues.push({
        code: 'UNTRIMMED_WHITESPACE_ADVISORY',
        severity: 'warning',
        message:
          'Term text contains leading, trailing, or repeated spaces while text transform is set to "none".',
      });
    }

    if (stagedTermText.trim().length === 0) {
      issues.push({
        code: 'BLANK_TERM_TEXT',
        severity: 'error',
        message: 'Term text is empty or whitespace-only.',
      });
    } else {
      if (FORMULA_TRIGGER_RE.test(stagedTermText)) {
        formulaWarningRowCount += 1;
        issues.push({
          code: 'FORMULA_LIKE_TEXT',
          severity: 'warning',
          message:
            'Term starts with a spreadsheet formula trigger character (=, +, -, @). Kept as inert literal text; never evaluated.',
        });
      }
      if (REPEATED_PUNCTUATION_RE.test(stagedTermText)) {
        issues.push({
          code: 'REPEATED_PUNCTUATION_WARNING',
          severity: 'warning',
          message: 'Term contains repeated hyphens or punctuation; review before approval.',
        });
      }
    }

    // Language mapping
    let rawLanguageCell: string | null = null;
    let stagedLanguage: LanguageUse | null = null;
    if (mapping.languageSource.kind === 'fixed') {
      stagedLanguage = mapping.languageSource.value;
    } else {
      rawLanguageCell = rawRow.rawCells[mapping.languageSource.columnIndex] ?? '';
      const parsedLang = parseLanguageCell(rawLanguageCell, mapping.languageSource.missingPolicy);
      stagedLanguage = parsedLang.value;
      if (parsedLang.issue) {
        issues.push(parsedLang.issue);
      }
    }

    // Role mapping
    let rawRoleCell: string | null = null;
    let stagedRole: ExpressionRole | null = null;
    if (mapping.roleSource.kind === 'fixed') {
      stagedRole = mapping.roleSource.value;
    } else {
      rawRoleCell = rawRow.rawCells[mapping.roleSource.columnIndex] ?? '';
      const parsedRole = parseRoleCell(rawRoleCell, mapping.roleSource.missingPolicy);
      stagedRole = parsedRole.value;
      if (parsedRole.issue) {
        issues.push(parsedRole.issue);
      }
    }

    // Optional group key mapping (only when user explicitly chooses a column)
    let rawGroupKeyCell: string | null = null;
    let groupKey: string | null = null;
    if (mapping.groupKeyColumnIndex !== null) {
      rawGroupKeyCell = rawRow.rawCells[mapping.groupKeyColumnIndex] ?? '';
      const trimmedGroup = rawGroupKeyCell.trim();
      groupKey = trimmedGroup.length > 0 ? trimmedGroup : null;
    }

    const hasBlockingError = issues.some((i) => i.severity === 'error');
    const isValidForPlanning =
      !hasBlockingError &&
      stagedTermText.trim().length > 0 &&
      stagedLanguage !== null &&
      stagedRole !== null;

    if (isValidForPlanning) {
      validRowCount += 1;
    } else {
      invalidRowCount += 1;
    }

    mappedRows.push({
      rowId: `row-${rawRow.rowNumber}`,
      rowNumber: rawRow.rowNumber,
      startLine: rawRow.startLine,
      endLine: rawRow.endLine,
      rawCells: rawRow.rawCells,
      rawTermText,
      stagedTermText,
      wasTransformed,
      rawLanguageCell,
      stagedLanguage,
      rawRoleCell,
      stagedRole,
      rawGroupKeyCell,
      groupKey,
      unmappedCellCount,
      issues,
      isValidForPlanning,
    });
  }

  const unmappedColumns: UnmappedColumnLossSummary[] = unmappedHeaderCols.map((col) => ({
    columnIndex: col.columnIndex,
    rawName: col.rawName,
    nonEmptyRowCount: unmappedNonEmptyCounts.get(col.columnIndex) ?? 0,
  }));

  const duplicateHeaderColumns = rawStage.headers.filter((h) => h.isDuplicateName);

  return deepFreeze({
    mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
    sourceName: rawStage.sourceName,
    sourceRawByteSha256: rawStage.rawByteSha256,
    baseLibraryRevision,
    mapping,
    headers: rawStage.headers,
    duplicateHeaderColumns,
    unmappedColumns,
    rows: mappedRows,
    validRowCount,
    invalidRowCount,
    transformedRowCount,
    formulaWarningRowCount,
    hasBlockingParseIssues: rawStage.hasBlockingParseIssues,
  });
}

/**
 * Deterministic fingerprint over source raw digest, base library revision, and mapping configuration.
 * Any change to source file, column mapping, transform mode, or library revision invalidates previous
 * staging decisions and change proposals.
 */
export function computeStagingSessionFingerprint(table: StagedMappedTable): string {
  return canonicalJson({
    mappingVersion: table.mappingVersion,
    sourceRawByteSha256: table.sourceRawByteSha256,
    baseLibraryRevision: table.baseLibraryRevision,
    mapping: table.mapping,
  });
}
