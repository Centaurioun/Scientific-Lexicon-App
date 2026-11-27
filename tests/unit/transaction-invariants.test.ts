import { describe, expect, it } from 'vitest';
import {
  evaluateChangeOnSnapshot,
  type Approval,
  type ChangePayload,
} from '@/domain/changes';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

const TS = '2026-11-26T12:00:00.000Z';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const DIGEST_D = 'd'.repeat(64);
const DIGEST_E = 'e'.repeat(64);

function makeApproval(batchId: string, d: string): Approval {
  return { batchId, digest: d, actor: 'local-user', approvedAt: TS };
}

describe('transaction and repository invariants (A4)', () => {
  it('enforces create, add expression, duplicate PD under two concepts, idempotent replay, changed-digest conflict, stale revision, duplicate opId, and protected assertion rules', () => {
    const empty = createEmptySnapshot();

    // 1. Create concept + first form -> revision 1
    const p1: ChangePayload = {
      schemaVersion: 1,
      batchId: 'b1',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-1',
          concept: { id: 'c1', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e1',
            conceptId: 'c1',
            revision: 0,
            text: 'PD',
            language: { kind: 'language', tag: 'en' },
            role: 'abbreviation',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p1', expressionId: 'e1', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    };
    const r1 = evaluateChangeOnSnapshot(empty, p1, makeApproval('b1', DIGEST_A));
    expect(r1.kind).toBe('apply');
    if (r1.kind !== 'apply') throw new Error('expected apply');
    expect(r1.nextRevision).toBe(1);
    const snap1: LibrarySnapshot = r1.nextSnapshot;

    // 2. Replay same batchId + same digest -> replay without revision bump
    const replay = evaluateChangeOnSnapshot(snap1, p1, makeApproval('b1', DIGEST_A));
    expect(replay).toEqual({ kind: 'replay', revision: 1 });

    // 3. Same batchId + different digest -> conflict
    const conflict = evaluateChangeOnSnapshot(snap1, p1, makeApproval('b1', DIGEST_B));
    expect(conflict.kind).toBe('error');
    if (conflict.kind === 'error') expect(conflict.result.status).toBe('conflict');

    // 4. Stale baseLibraryRevision -> stale
    const stalePayload: ChangePayload = {
      ...p1,
      batchId: 'b-stale',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-stale',
          concept: { id: 'c-stale', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e-stale',
            conceptId: 'c-stale',
            revision: 0,
            text: 'IL-1',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p-stale', expressionId: 'e-stale', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    };
    const staleRes = evaluateChangeOnSnapshot(snap1, stalePayload, makeApproval('b-stale', DIGEST_B));
    expect(staleRes.kind).toBe('error');
    if (staleRes.kind === 'error') expect(staleRes.result.status).toBe('stale');

    // 5. Duplicate opId across batches -> conflict
    const dupOpPayload: ChangePayload = {
      schemaVersion: 1,
      batchId: 'b-dupop',
      baseLibraryRevision: 1,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-1',
          concept: { id: 'c2', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e2',
            conceptId: 'c2',
            revision: 0,
            text: 'PD',
            language: { kind: 'language', tag: 'en' },
            role: 'abbreviation',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p2', expressionId: 'e2', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    };
    const dupOpRes = evaluateChangeOnSnapshot(snap1, dupOpPayload, makeApproval('b-dupop', DIGEST_B));
    expect(dupOpRes.kind).toBe('error');
    if (dupOpRes.kind === 'error') expect(dupOpRes.result.status).toBe('conflict');

    // 6. Second concept with identical surface "PD" + add expression to c1
    const p2: ChangePayload = {
      schemaVersion: 1,
      batchId: 'b2',
      baseLibraryRevision: 1,
      ops: [
        {
          kind: 'createConcept',
          opId: 'op-2',
          concept: { id: 'c2', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e2',
            conceptId: 'c2',
            revision: 0,
            text: 'PD',
            language: { kind: 'language', tag: 'en' },
            role: 'abbreviation',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p2', expressionId: 'e2', kind: 'manual', createdAt: TS, source: null },
        },
        {
          kind: 'addExpression',
          opId: 'op-3',
          expectedConceptRevision: 0,
          expression: {
            id: 'e3',
            conceptId: 'c1',
            revision: 0,
            text: 'ceplerde sondalama derinliği',
            language: { kind: 'language', tag: 'tr' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: { id: 'p3', expressionId: 'e3', kind: 'manual', createdAt: TS, source: null },
        },
      ],
    };
    const r2 = evaluateChangeOnSnapshot(snap1, p2, makeApproval('b2', DIGEST_B));
    expect(r2.kind).toBe('apply');
    if (r2.kind !== 'apply') throw new Error('expected apply');
    const snap2 = r2.nextSnapshot;
    expect(snap2.expressions.filter((e) => e.text === 'PD')).toHaveLength(2);
    expect(snap2.expressions.filter((e) => e.conceptId === 'c1')).toHaveLength(2);

    // 7. Assert user-confirmed on e1, then attempt to edit e1 text or language -> protected!
    const p3: ChangePayload = {
      schemaVersion: 1,
      batchId: 'b3',
      baseLibraryRevision: 2,
      ops: [
        {
          kind: 'assertExpression',
          opId: 'op-4',
          id: 'e1',
          expectedRevision: 0,
          assertion: {
            id: 'a1',
            expressionId: 'e1',
            field: 'text',
            value: 'PD',
            recordRevision: 1,
            kind: 'user-confirmed',
            actor: 'local-user',
            assertedAt: TS,
          },
        },
      ],
    };
    const r3 = evaluateChangeOnSnapshot(snap2, p3, makeApproval('b3', DIGEST_C));
    expect(r3.kind).toBe('apply');
    if (r3.kind !== 'apply') throw new Error('expected apply');
    const snap3 = r3.nextSnapshot;

    const editProtectedText: ChangePayload = {
      schemaVersion: 1,
      batchId: 'b4',
      baseLibraryRevision: 3,
      ops: [
        {
          kind: 'editExpression',
          opId: 'op-5',
          id: 'e1',
          expectedRevision: 1,
          text: 'Probing Depth',
          language: { kind: 'language', tag: 'en' },
          role: 'abbreviation',
        },
      ],
    };
    const r4 = evaluateChangeOnSnapshot(snap3, editProtectedText, makeApproval('b4', DIGEST_D));
    expect(r4.kind).toBe('error');
    if (r4.kind === 'error') expect(r4.result.status).toBe('protected');

    const editProtectedLang: ChangePayload = {
      schemaVersion: 1,
      batchId: 'b5',
      baseLibraryRevision: 3,
      ops: [
        {
          kind: 'editExpression',
          opId: 'op-6',
          id: 'e1',
          expectedRevision: 1,
          text: 'PD',
          language: { kind: 'language', tag: 'tr' },
          role: 'abbreviation',
        },
      ],
    };
    const r5 = evaluateChangeOnSnapshot(snap3, editProtectedLang, makeApproval('b5', DIGEST_E));
    expect(r5.kind).toBe('error');
    if (r5.kind === 'error') expect(r5.result.status).toBe('protected');
  });
});
