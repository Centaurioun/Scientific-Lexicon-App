import type { ExtractionRun } from '@/domain/extraction';
import {
  compareCodeUnits,
  formatLanguageUse,
  isExpressionProtected,
  languageMatchesFilter,
  type Expression,
  type LanguageUse,
  type LibrarySnapshot,
} from '@/domain/schema';

export {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackup,
  MAX_BACKUP_FILE_BYTES,
  parseBackupFileText,
  parseRestoreApproval,
  validateBackup,
  type BackupEnvelope,
  type RestoreApproval,
} from '@/domain/backup';

export type ExportScope = 'library-concepts' | 'library-expressions' | 'current-run';
export type ExportSort = 'alphabetical' | 'frequency';
export type ExportLanguageFilter = 'all' | 'en' | 'tr' | 'shared';
export type ExportFormat = 'txt' | 'md' | 'csv' | 'json';

export interface ExportSelection {
  scope: ExportScope;
  sort: ExportSort;
  language: ExportLanguageFilter;
  includeKnown: boolean;
}

export interface ExportRow {
  id: string;
  conceptId: string | null;
  text: string;
  language: string;
  frequency: number | null;
  state: string;
}

function compareDisplayExpression(a: Expression, b: Expression): number {
  const aPref = a.role === 'preferred' ? 0 : 1;
  const bPref = b.role === 'preferred' ? 0 : 1;
  if (aPref !== bPref) return aPref - bPref;
  const byText = compareCodeUnits(a.text, b.text);
  if (byText !== 0) return byText;
  return compareCodeUnits(a.id, b.id);
}

function compareExportRows(a: ExportRow, b: ExportRow, sort: ExportSort): number {
  if (sort === 'frequency') {
    const aNull = a.frequency === null;
    const bNull = b.frequency === null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && !bNull && a.frequency !== b.frequency) {
      return (b.frequency as number) - (a.frequency as number);
    }
  }
  const byText = compareCodeUnits(a.text, b.text);
  if (byText !== 0) return byText;
  return compareCodeUnits(a.id, b.id);
}

function retainedConceptFrequency(snapshot: LibrarySnapshot, conceptId: string): number | null {
  let count = 0;
  for (const run of snapshot.runs) {
    for (const occ of run.occurrences) {
      if (occ.resolvedConceptId === conceptId) {
        count += 1;
      }
    }
  }
  return count > 0 ? count : null;
}

function retainedExpressionFrequency(
  snapshot: LibrarySnapshot,
  expr: Expression,
): number | null {
  let count = 0;
  for (const run of snapshot.runs) {
    for (const occ of run.occurrences) {
      if (occ.resolvedConceptId === expr.conceptId && occ.expressionIds.includes(expr.id)) {
        count += 1;
      }
    }
  }
  return count > 0 ? count : null;
}

export function selectExportRows(
  snapshot: LibrarySnapshot,
  run: ExtractionRun | null,
  selection: ExportSelection,
): ExportRow[] {
  const rows: ExportRow[] = [];

  if (selection.scope === 'library-concepts') {
    for (const concept of snapshot.concepts) {
      const matchingForms = snapshot.expressions
        .filter(
          (expr) =>
            expr.conceptId === concept.id &&
            languageMatchesFilter(expr.language, selection.language),
        )
        .sort(compareDisplayExpression);

      if (matchingForms.length === 0) {
        // Never invent missing EN/TR translations
        continue;
      }

      const display = matchingForms[0];
      rows.push({
        id: concept.id,
        conceptId: concept.id,
        text: display.text,
        language: formatLanguageUse(display.language),
        frequency: retainedConceptFrequency(snapshot, concept.id),
        state: isExpressionProtected(display, snapshot.assertions) ? 'user-confirmed' : 'unasserted',
      });
    }
  } else if (selection.scope === 'library-expressions') {
    for (const expr of snapshot.expressions) {
      if (!languageMatchesFilter(expr.language, selection.language)) {
        continue;
      }
      rows.push({
        id: expr.id,
        conceptId: expr.conceptId,
        text: expr.text,
        language: formatLanguageUse(expr.language),
        frequency: retainedExpressionFrequency(snapshot, expr),
        state: isExpressionProtected(expr, snapshot.assertions) ? 'user-confirmed' : 'unasserted',
      });
    }
  } else if (selection.scope === 'current-run') {
    if (!run) return [];

    const expressionsById = new Map(snapshot.expressions.map((e) => [e.id, e]));
    const groups = new Map<
      string,
      {
        id: string;
        conceptId: string | null;
        text: string;
        languageUse: LanguageUse;
        frequency: number;
        state: string;
      }
    >();

    for (const occ of run.occurrences) {
      if (!selection.includeKnown && occ.state === 'known-form') {
        continue;
      }

      const sortedConceptIds = [...occ.conceptIds].sort(compareCodeUnits).join(',');
      const sortedExprIds = [...occ.expressionIds].sort(compareCodeUnits).join(',');
      const groupKey = `${occ.surface}\u0000${occ.state}\u0000${occ.resolvedConceptId ?? 'null'}\u0000${sortedConceptIds}\u0000${sortedExprIds}`;

      let languageUse: LanguageUse = { kind: 'language', tag: 'en' };
      if (occ.expressionIds.length === 1) {
        const matchedExpr = expressionsById.get(occ.expressionIds[0]);
        if (matchedExpr) {
          languageUse = matchedExpr.language;
        }
      }

      if (!languageMatchesFilter(languageUse, selection.language)) {
        continue;
      }

      const existing = groups.get(groupKey);
      if (existing) {
        existing.frequency += 1;
      } else {
        groups.set(groupKey, {
          id: `run:${occ.surface}:${occ.state}:${occ.resolvedConceptId ?? 'null'}:${sortedConceptIds || 'none'}`,
          conceptId: occ.resolvedConceptId,
          text: occ.surface,
          languageUse,
          frequency: 1,
          state: occ.state,
        });
      }
    }

    for (const g of groups.values()) {
      rows.push({
        id: g.id,
        conceptId: g.conceptId,
        text: g.text,
        language: formatLanguageUse(g.languageUse),
        frequency: g.frequency,
        state: g.state,
      });
    }
  }

  return rows.sort((a, b) => compareExportRows(a, b, selection.sort));
}

const CSV_FORMULA_TRIGGER_RE = /^[ \t\r\n]*[=+\-@\t\r\n]/;

export function escapeCsvCell(value: string | number | null): string {
  if (value === null) return '';
  let str = String(value);
  if (CSV_FORMULA_TRIGGER_RE.test(str)) {
    str = `'${str}`;
  }
  const needsQuotes =
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r') ||
    str.startsWith(' ') ||
    str.endsWith(' ');
  if (needsQuotes) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeTxtLine(value: string): string {
  return value.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function escapeMarkdownCell(value: string | number | null): string {
  if (value === null) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');
}

export function formatExport(rows: readonly ExportRow[], format: ExportFormat): string {
  switch (format) {
    case 'txt':
      return rows
        .map((row) => {
          const freq = row.frequency === null ? '-' : String(row.frequency);
          const concept = row.conceptId ?? 'unresolved';
          return `${escapeTxtLine(row.text)}\t${escapeTxtLine(row.language)}\t${escapeTxtLine(row.state)}\t${freq}\t${escapeTxtLine(concept)}`;
        })
        .join('\n');

    case 'md': {
      const header = '| ID | Concept ID | Text | Language | Frequency | State |';
      const separator = '| --- | --- | --- | --- | --- | --- |';
      const body = rows.map(
        (row) =>
          `| ${escapeMarkdownCell(row.id)} | ${escapeMarkdownCell(row.conceptId)} | ${escapeMarkdownCell(row.text)} | ${escapeMarkdownCell(row.language)} | ${escapeMarkdownCell(row.frequency)} | ${escapeMarkdownCell(row.state)} |`,
      );
      return [header, separator, ...body].join('\n');
    }

    case 'csv': {
      const header = 'id,conceptId,text,language,frequency,state';
      const lines = rows.map((row) =>
        [
          escapeCsvCell(row.id),
          escapeCsvCell(row.conceptId),
          escapeCsvCell(row.text),
          escapeCsvCell(row.language),
          escapeCsvCell(row.frequency),
          escapeCsvCell(row.state),
        ].join(','),
      );
      return [header, ...lines].join('\r\n');
    }

    case 'json':
      return JSON.stringify(
        {
          format: 'termforge-export',
          version: 1,
          rows,
        },
        null,
        2,
      );
  }
}
