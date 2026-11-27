import { describe, expect, it } from 'vitest';
import { formatExport, selectExportRows, type ExportSelection } from '@/application/exchange';
import type { ExtractionRun } from '@/domain/extraction';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

const TS = '2026-11-26T12:00:00.000Z';

describe('deterministic presentation exports (C1)', () => {
  const snapshot: LibrarySnapshot = {
    ...createEmptySnapshot(),
    libraryRevision: 3,
    concepts: [
      { id: 'c1', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c2', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c3', revision: 0, createdAt: TS, updatedAt: TS },
    ],
    expressions: [
      {
        id: 'e1',
        conceptId: 'c1',
        revision: 0,
        text: '=1+1',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e2',
        conceptId: 'c2',
        revision: 0,
        text: '2,4-dinitrophenol',
        language: { kind: 'shared' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e3',
        conceptId: 'c3',
        revision: 0,
        text: 'TNF-α | IL-1',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    provenance: [
      { id: 'p1', expressionId: 'e1', kind: 'manual', createdAt: TS, source: null },
      { id: 'p2', expressionId: 'e2', kind: 'manual', createdAt: TS, source: null },
      { id: 'p3', expressionId: 'e3', kind: 'manual', createdAt: TS, source: null },
    ],
  };

  it('protects CSV against formula injection (including leading whitespace), quotes commas cleanly, escapes Markdown pipes, and never mutates stored forms', () => {
    const selection: ExportSelection = {
      scope: 'library-expressions',
      sort: 'alphabetical',
      language: 'all',
      includeKnown: true,
    };
    const rows = selectExportRows(snapshot, null, selection);
    const csv = formatExport(rows, 'csv');

    expect(csv).toContain("'=1+1");
    expect(csv).toContain('"2,4-dinitrophenol"');
    expect(csv).toContain('TNF-α | IL-1');
    // Stored canonical expression text untouched
    expect(snapshot.expressions[0].text).toBe('=1+1');

    // Also test leading-whitespace formula payload
    const wsCsv = formatExport(
      [{ id: 'r1', conceptId: null, text: '  +SUM(A1)', language: 'en', frequency: 1, state: 'new-candidate' }],
      'csv',
    );
    expect(wsCsv).toContain("'\x20\x20+SUM(A1)");

    const md = formatExport(rows, 'md');
    expect(md).toContain('TNF-α \\| IL-1');

    const jsonStr = formatExport(rows, 'json');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.format).toBe('termforge-export');
    expect(parsed.version).toBe(1);
    expect(parsed.rows).toHaveLength(3);

    const txt = formatExport(rows, 'txt');
    expect(txt.split('\n')).toHaveLength(3);
  });

  it('never infers missing Turkish translations, orders frequency with null last, and handles current-run grouping, known filter, and unresolved conceptId null', () => {
    // Filtering concepts to Turkish when none exist yields 0 rows (no invented tr!)
    const trConcepts = selectExportRows(snapshot, null, {
      scope: 'library-concepts',
      sort: 'alphabetical',
      language: 'tr',
      includeKnown: true,
    });
    expect(trConcepts).toEqual([]);

    // Library frequency without retained runs is null (not 0)
    const libFreq = selectExportRows(snapshot, null, {
      scope: 'library-concepts',
      sort: 'frequency',
      language: 'all',
      includeKnown: true,
    });
    expect(libFreq.every((r) => r.frequency === null)).toBe(true);

    // Current run grouping + includeKnown filter + unresolved conceptId null
    const run: ExtractionRun = {
      id: 'run-1',
      text: 'TNF-α and TNF-α plus PD and newterm',
      algorithmVersion: 's1-grammar-1+s1-boundary-v1',
      libraryRevision: 3,
      occurrences: [
        {
          id: 'occ:0:5',
          start: 0,
          end: 5,
          surface: 'TNF-α',
          expressionIds: ['e3'],
          conceptIds: ['c3'],
          state: 'known-form',
          resolvedConceptId: 'c3',
        },
        {
          id: 'occ:10:15',
          start: 10,
          end: 15,
          surface: 'TNF-α',
          expressionIds: ['e3'],
          conceptIds: ['c3'],
          state: 'known-form',
          resolvedConceptId: 'c3',
        },
        {
          id: 'occ:21:23',
          start: 21,
          end: 23,
          surface: 'PD',
          expressionIds: [],
          conceptIds: ['c1', 'c2'],
          state: 'ambiguous',
          resolvedConceptId: null,
        },
        {
          id: 'occ:28:35',
          start: 28,
          end: 35,
          surface: 'newterm',
          expressionIds: [],
          conceptIds: [],
          state: 'new-candidate',
          resolvedConceptId: null,
        },
      ],
    };

    const allRunRows = selectExportRows(snapshot, run, {
      scope: 'current-run',
      sort: 'frequency',
      language: 'all',
      includeKnown: true,
    });
    expect(allRunRows).toHaveLength(3);
    expect(allRunRows[0]).toMatchObject({ text: 'TNF-α', frequency: 2, conceptId: 'c3' });
    const pdRow = allRunRows.find((r) => r.text === 'PD');
    expect(pdRow?.conceptId).toBeNull();
    expect(pdRow?.frequency).toBe(1);

    const unknownOnly = selectExportRows(snapshot, run, {
      scope: 'current-run',
      sort: 'alphabetical',
      language: 'all',
      includeKnown: false,
    });
    expect(unknownOnly.map((r) => r.text)).toEqual(['PD', 'newterm']);
  });
});
