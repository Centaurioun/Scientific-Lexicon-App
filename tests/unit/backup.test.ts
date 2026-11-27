import { describe, expect, it } from 'vitest';
import { createBackup, validateBackup } from '@/domain/backup';
import { formatExport, selectExportRows } from '@/application/exchange';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

const TS = '2026-11-26T12:00:00.000Z';

function makeRichSnapshot(): LibrarySnapshot {
  const docText = 'Periodontal TNF-α expression increased.';
  const start = docText.indexOf('TNF-α');
  const end = start + 'TNF-α'.length;

  return {
    schemaVersion: 1,
    libraryRevision: 2,
    concepts: [{ id: 'c1', revision: 1, createdAt: TS, updatedAt: TS }],
    expressions: [
      {
        id: 'e1',
        conceptId: 'c1',
        revision: 1,
        text: 'TNF-α',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e2',
        conceptId: 'c1',
        revision: 0,
        text: 'tümör nekroz faktörü alfa',
        language: { kind: 'language', tag: 'tr' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    assertions: [
      {
        id: 'a1',
        expressionId: 'e1',
        field: 'text',
        value: 'TNF-α',
        recordRevision: 1,
        kind: 'user-confirmed',
        actor: 'local-user',
        assertedAt: TS,
      },
    ],
    provenance: [
      {
        id: 'p1',
        expressionId: 'e1',
        kind: 'reviewed-candidate',
        createdAt: TS,
        source: { documentId: 'doc1', runId: 'run1', start, end },
      },
      {
        id: 'p2',
        expressionId: 'e2',
        kind: 'manual',
        createdAt: TS,
        source: null,
      },
    ],
    documents: [{ id: 'doc1', title: 'Synthetic Study', text: docText, createdAt: TS }],
    runs: [
      {
        id: 'run1',
        documentId: 'doc1',
        algorithmVersion: 's1-grammar-1+s1-boundary-v1',
        libraryRevision: 1,
        createdAt: TS,
        occurrences: [
          {
            id: `occ:${start}:${end}`,
            start,
            end,
            surface: 'TNF-α',
            expressionIds: ['e1'],
            conceptIds: ['c1'],
            state: 'known-form',
            resolvedConceptId: 'c1',
          },
        ],
      },
    ],
    batches: [{ batchId: 'b1', digest: 'a'.repeat(64), appliedRevision: 1 }],
    audit: [
      {
        id: 'audit:b1:op1',
        batchId: 'b1',
        opId: 'op1',
        kind: 'createConcept',
        recordIds: ['c1', 'e1', 'p1'],
        actor: 'local-user',
        approvedAt: TS,
        appliedRevision: 1,
      },
    ],
  };
}

describe('complete portable backup validation (C2)', () => {
  it('creates a termforge-backup v1 envelope and round-trips exact canonical snapshot', async () => {
    const snap = makeRichSnapshot();
    const backup = await createBackup(snap);

    expect(backup.format).toBe('termforge-backup');
    expect(backup.version).toBe(1);
    expect(backup.digest).toMatch(/^[0-9a-f]{64}$/);

    const validated = await validateBackup(JSON.parse(JSON.stringify(backup)));
    expect(validated.snapshot).toEqual(backup.snapshot);
    expect(validated.digest).toBe(backup.digest);
  });

  it('rejects wrong digest, unsupported version, unknown fields, non-JSON, presentation exports, duplicate IDs, orphan expressions, bad spans, and invalid history', async () => {
    const snap = makeRichSnapshot();
    const backup = await createBackup(snap);

    // Wrong digest
    await expect(validateBackup({ ...backup, digest: '0'.repeat(64) })).rejects.toThrow(/digest/i);

    // Unsupported version
    await expect(validateBackup({ ...backup, version: 2 })).rejects.toThrow();

    // Unknown extra field
    await expect(validateBackup({ ...backup, unexpected: true })).rejects.toThrow();

    // Presentation export JSON rejected as backup
    const rows = selectExportRows(snap, null, {
      scope: 'library-expressions',
      sort: 'alphabetical',
      language: 'all',
      includeKnown: true,
    });
    const presentationExport = JSON.parse(formatExport(rows, 'json'));
    await expect(validateBackup(presentationExport)).rejects.toThrow();

    // Non-JSON value rejected
    await expect(validateBackup({ ...backup, badDate: new Date() })).rejects.toThrow();

    // Duplicate IDs rejected
    const dupSnap: LibrarySnapshot = {
      ...snap,
      concepts: [...snap.concepts, snap.concepts[0]],
    };
    await expect(validateBackup({ ...backup, snapshot: dupSnap })).rejects.toThrow(/duplicate/i);

    // Orphan expression rejected
    const orphanSnap: LibrarySnapshot = {
      ...createEmptySnapshot(),
      libraryRevision: 1,
      expressions: [snap.expressions[0]],
    };
    await expect(validateBackup({ ...backup, snapshot: orphanSnap })).rejects.toThrow(/orphan|concept/i);

    // Invalid retained span surface mismatch rejected
    const badSpanSnap: LibrarySnapshot = {
      ...snap,
      documents: [{ ...snap.documents[0], text: 'Completely different text of same length.' }],
    };
    await expect(validateBackup({ ...backup, snapshot: badSpanSnap })).rejects.toThrow(/slice|surface/i);

    // Invalid history (batch appliedRevision > libraryRevision) rejected
    const badHistSnap: LibrarySnapshot = {
      ...snap,
      batches: [{ batchId: 'b9', digest: 'b'.repeat(64), appliedRevision: 99 }],
    };
    await expect(validateBackup({ ...backup, snapshot: badHistSnap })).rejects.toThrow(/revision/i);
  });
});
