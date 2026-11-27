import { describe, expect, it } from 'vitest';
import {
  buildChangePreview,
  digest,
  evaluateChangeOnSnapshot,
  type ChangePayload,
} from '@/domain/changes';
import { createEmptySnapshot } from '@/domain/schema';

const TS = '2026-11-26T12:00:00.000Z';
const MARKER = 'PRIVATE-SYNTHETIC-123';

describe('source retention and privacy invariants (B5)', () => {
  it('stores no raw document text or source pointers when saving from session-only review', async () => {
    const empty = createEmptySnapshot();
    const payload: ChangePayload = {
      schemaVersion: 1,
      batchId: 'b-session',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-session-1',
          concept: { id: 'c1', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e1',
            conceptId: 'c1',
            revision: 0,
            text: 'TNF-α',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: {
            id: 'p1',
            expressionId: 'e1',
            kind: 'reviewed-candidate',
            createdAt: TS,
            source: null,
          },
        },
      ],
    };

    const preview = buildChangePreview(empty, payload);
    const d = await digest(payload);
    const res = evaluateChangeOnSnapshot(empty, payload, {
      batchId: payload.batchId,
      digest: d,
      actor: 'local-user',
      approvedAt: TS,
    });

    expect(res.kind).toBe('apply');
    if (res.kind !== 'apply') throw new Error('expected apply');

    const serialized = JSON.stringify({ snapshot: res.nextSnapshot, preview });
    expect(serialized).not.toContain(MARKER);
    expect(res.nextSnapshot.documents).toEqual([]);
    expect(res.nextSnapshot.runs).toEqual([]);
    expect(res.nextSnapshot.provenance[0].source).toBeNull();
  });

  it('retains consented source with valid span, never leaks raw text in preview/audit/batches, and clears source + runs + provenance pointers atomically on deletion while preserving concept', async () => {
    const empty = createEmptySnapshot();
    const docText = `Context ${MARKER} shows TNF-α expression.`;
    const start = docText.indexOf('TNF-α');
    const end = start + 'TNF-α'.length;

    const retainAndCreate: ChangePayload = {
      schemaVersion: 1,
      batchId: 'b-retain',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'retainDocument',
          opId: 'op-ret-1',
          document: {
            id: 'doc-1',
            title: 'Synthetic Case Note',
            text: docText,
            createdAt: TS,
          },
          run: {
            id: 'run-1',
            documentId: 'doc-1',
            algorithmVersion: 's1-grammar-1+s1-boundary-v1',
            libraryRevision: 0,
            createdAt: TS,
            occurrences: [
              {
                id: `occ:${start}:${end}`,
                start,
                end,
                surface: 'TNF-α',
                expressionIds: [],
                conceptIds: [],
                state: 'new-candidate',
                resolvedConceptId: null,
              },
            ],
          },
        },
        {
          kind: 'createConcept',
          opId: 'op-ret-2',
          concept: { id: 'c1', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e1',
            conceptId: 'c1',
            revision: 0,
            text: 'TNF-α',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: {
            id: 'p1',
            expressionId: 'e1',
            kind: 'reviewed-candidate',
            createdAt: TS,
            source: { documentId: 'doc-1', runId: 'run-1', start, end },
          },
        },
      ],
    };

    const preview = buildChangePreview(empty, retainAndCreate);
    expect(preview.join('\n')).not.toContain(MARKER);

    const d1 = await digest(retainAndCreate);
    const res1 = evaluateChangeOnSnapshot(empty, retainAndCreate, {
      batchId: 'b-retain',
      digest: d1,
      actor: 'local-user',
      approvedAt: TS,
    });
    expect(res1.kind).toBe('apply');
    if (res1.kind !== 'apply') throw new Error('expected apply');

    const snapWithSource = res1.nextSnapshot;
    expect(snapWithSource.documents).toHaveLength(1);
    expect(snapWithSource.runs).toHaveLength(1);
    expect(snapWithSource.provenance[0].source).toEqual({
      documentId: 'doc-1',
      runId: 'run-1',
      start,
      end,
    });
    // Audit and batch metadata must never contain raw document text
    expect(JSON.stringify(snapWithSource.audit)).not.toContain(MARKER);
    expect(JSON.stringify(snapWithSource.batches)).not.toContain(MARKER);

    // Now delete retained source atomically
    const deletePayload: ChangePayload = {
      schemaVersion: 1,
      batchId: 'b-delete-doc',
      baseLibraryRevision: snapWithSource.libraryRevision,
      ops: [{ kind: 'deleteRetainedDocument', opId: 'op-del-1', id: 'doc-1' }],
    };
    const d2 = await digest(deletePayload);
    const res2 = evaluateChangeOnSnapshot(snapWithSource, deletePayload, {
      batchId: 'b-delete-doc',
      digest: d2,
      actor: 'local-user',
      approvedAt: TS,
    });
    expect(res2.kind).toBe('apply');
    if (res2.kind !== 'apply') throw new Error('expected apply');

    const snapAfterDelete = res2.nextSnapshot;
    expect(snapAfterDelete.documents).toEqual([]);
    expect(snapAfterDelete.runs).toEqual([]);
    expect(snapAfterDelete.concepts).toHaveLength(1);
    expect(snapAfterDelete.expressions).toHaveLength(1);
    expect(snapAfterDelete.provenance[0].kind).toBe('reviewed-candidate');
    expect(snapAfterDelete.provenance[0].source).toBeNull();
    expect(JSON.stringify(snapAfterDelete)).not.toContain(MARKER);
  });
});
