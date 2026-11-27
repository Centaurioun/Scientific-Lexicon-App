import { describe, expect, it } from 'vitest';
import {
  findExpressions,
  findHomonymSiblings,
  lookupExpressions,
} from '@/application/library';
import type { LibrarySnapshot } from '@/domain/schema';

function createLookupSnapshot(): LibrarySnapshot {
  const now = '2026-11-27T00:00:00Z';
  return {
    schemaVersion: 1,
    libraryRevision: 4,
    concepts: [
      { id: 'c-pd-1', revision: 1, createdAt: now, updatedAt: now },
      { id: 'c-pd-2', revision: 1, createdAt: now, updatedAt: now },
      { id: 'c-p53-gene', revision: 1, createdAt: now, updatedAt: now },
      { id: 'c-p53-prot', revision: 1, createdAt: now, updatedAt: now },
      { id: 'c-hla-1', revision: 1, createdAt: now, updatedAt: now },
      { id: 'c-hla-2', revision: 1, createdAt: now, updatedAt: now },
      { id: 'c-tr-1', revision: 1, createdAt: now, updatedAt: now },
      { id: 'c-tnf', revision: 1, createdAt: now, updatedAt: now },
    ],
    expressions: [
      {
        id: 'e-pd-1',
        conceptId: 'c-pd-1',
        revision: 1,
        text: 'PD',
        language: { kind: 'shared' },
        role: 'abbreviation',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-pd-1-full',
        conceptId: 'c-pd-1',
        revision: 1,
        text: 'probing depth',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-pd-2',
        conceptId: 'c-pd-2',
        revision: 1,
        text: 'PD',
        language: { kind: 'shared' },
        role: 'abbreviation',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-pd-2-full',
        conceptId: 'c-pd-2',
        revision: 1,
        text: 'Parkinson disease',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-p53-lo',
        conceptId: 'c-p53-gene',
        revision: 1,
        text: 'p53',
        language: { kind: 'shared' },
        role: 'preferred',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-p53-hi',
        conceptId: 'c-p53-prot',
        revision: 1,
        text: 'P53',
        language: { kind: 'shared' },
        role: 'preferred',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-hla-b',
        conceptId: 'c-hla-1',
        revision: 1,
        text: 'HLA-B',
        language: { kind: 'shared' },
        role: 'preferred',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-hla-b27',
        conceptId: 'c-hla-2',
        revision: 1,
        text: 'HLA-B27',
        language: { kind: 'shared' },
        role: 'preferred',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-tr-ist',
        conceptId: 'c-tr-1',
        revision: 1,
        text: 'İstanbul',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-tr-isik',
        conceptId: 'c-tr-1',
        revision: 1,
        text: 'ışık',
        language: { kind: 'language', tag: 'tr' },
        role: 'alternative',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'e-tnf',
        conceptId: 'c-tnf',
        revision: 1,
        text: 'TNF-α',
        language: { kind: 'shared' },
        role: 'abbreviation',
        createdAt: now,
        updatedAt: now,
      },
    ],
    assertions: [],
    provenance: [],
    documents: [],
    runs: [],
    batches: [],
    audit: [],
  };
}

describe('D9: Improved terminology lookup modes and homonym navigation', () => {
  it('preserves default case-sensitive literal substring lookup for p53/P53, Greek, and Turkish', () => {
    const snapshot = createLookupSnapshot();
    const beforeRevision = snapshot.libraryRevision;

    expect(findExpressions(snapshot, 'p53').map((e) => e.text)).toEqual(['p53']);
    expect(lookupExpressions(snapshot, { query: 'p53', mode: 'substring' }).map((e) => e.text)).toEqual([
      'p53',
    ]);
    expect(lookupExpressions(snapshot, { query: 'TNF-α', mode: 'exact' }).map((e) => e.text)).toEqual([
      'TNF-α',
    ]);
    expect(lookupExpressions(snapshot, { query: 'İstanbul', mode: 'exact' }).map((e) => e.text)).toEqual([
      'İstanbul',
    ]);
    expect(lookupExpressions(snapshot, { query: 'ışık', mode: 'exact' }).map((e) => e.text)).toEqual([
      'ışık',
    ]);

    // Exact mode distinguishes HLA-B from HLA-B27; prefix mode matches both
    expect(lookupExpressions(snapshot, { query: 'HLA-B', mode: 'exact' }).map((e) => e.text)).toEqual([
      'HLA-B',
    ]);
    expect(lookupExpressions(snapshot, { query: 'HLA-B', mode: 'prefix' }).map((e) => e.text)).toEqual([
      'HLA-B',
      'HLA-B27',
    ]);

    expect(snapshot.libraryRevision).toBe(beforeRevision);
  });

  it('supports opt-in case-insensitive view mode without mutating stored case or collapsing concepts', () => {
    const snapshot = createLookupSnapshot();

    const matches = lookupExpressions(snapshot, {
      query: 'p53',
      mode: 'case-insensitive-view',
    });
    expect(matches.map((e) => e.text)).toEqual(['P53', 'p53']);
    expect(matches.map((e) => e.conceptId)).toEqual(['c-p53-prot', 'c-p53-gene']);

    // Turkish-aware opt-in view matches İstanbul from "istanbul" and ışık from "IŞIK" while keeping stored forms exact
    const trIst = lookupExpressions(snapshot, {
      query: 'istanbul',
      mode: 'case-insensitive-view',
      language: 'tr',
    });
    expect(trIst.map((e) => e.text)).toEqual(['İstanbul']);

    const trIsik = lookupExpressions(snapshot, {
      query: 'IŞIK',
      mode: 'case-insensitive-view',
      language: 'tr',
    });
    expect(trIsik.map((e) => e.text)).toEqual(['ışık']);

    // Canonical stored strings remain untouched
    expect(snapshot.expressions.find((e) => e.id === 'e-tr-ist')?.text).toBe('İstanbul');
    expect(snapshot.expressions.find((e) => e.id === 'e-p53-lo')?.text).toBe('p53');
  });

  it('surfaces distinct PD homonym sibling concepts for navigation without merging or mutating', () => {
    const snapshot = createLookupSnapshot();
    const pdExact = lookupExpressions(snapshot, { query: 'PD', mode: 'exact' });
    expect(pdExact.map((e) => e.conceptId)).toEqual(['c-pd-1', 'c-pd-2']);

    const siblingsOfPd1 = findHomonymSiblings(snapshot, 'c-pd-1');
    expect(siblingsOfPd1).toEqual([
      { sharedSurface: 'PD', conceptId: 'c-pd-2' },
    ]);
    expect(snapshot.libraryRevision).toBe(4);
  });
});
