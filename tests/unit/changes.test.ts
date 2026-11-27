import { describe, expect, it, vi } from 'vitest';
import {
  canonicalJson,
  digest,
  type Approval,
  type ChangePayload,
  type ProposedChange,
} from '@/domain/changes';
import {
  applyChange,
  approveChange,
  findExpressions,
  proposeChange,
} from '@/application/library';
import type { LibraryRepository } from '@/domain/repository';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

const TS = '2026-11-26T12:00:00.000Z';

function makeCreateConceptPayload(overrides?: Partial<ChangePayload>): ChangePayload {
  return {
    schemaVersion: 1,
    batchId: 'batch-1',
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
          text: 'TNF-α',
          language: { kind: 'language', tag: 'en' },
          role: 'preferred',
          createdAt: TS,
          updatedAt: TS,
        },
        provenance: {
          id: 'p1',
          expressionId: 'e1',
          kind: 'manual',
          createdAt: TS,
          source: null,
        },
      },
    ],
    ...overrides,
  };
}

describe('approved change envelope and preview (A3)', () => {
  it('produces identical SHA-256 digests regardless of object key order, while array order changes the digest', async () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(await digest({ b: 1, a: 2 })).toBe(await digest({ a: 2, b: 1 }));
    expect(await digest({ items: [1, 2] })).not.toBe(await digest({ items: [2, 1] }));
  });

  it('rejects non-JSON values in canonicalJson and digest', async () => {
    expect(() => canonicalJson({ bad: undefined })).toThrow();
    expect(() => canonicalJson({ bad: Number.NaN })).toThrow();
    expect(() => canonicalJson({ bad: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson({ bad: new Date() })).toThrow();
    await expect(digest({ bad: () => 1 })).rejects.toThrow();
  });

  it('rejects duplicate opId, blank expression, and non-JSON payloads during proposal', async () => {
    const empty = createEmptySnapshot();

    const dupPayload: ChangePayload = {
      schemaVersion: 1,
      batchId: 'batch-dup',
      baseLibraryRevision: 0,
      ops: [
        makeCreateConceptPayload().ops[0],
        {
          kind: 'createConcept',
          opId: 'op-1',
          concept: { id: 'c2', revision: 0, createdAt: TS, updatedAt: TS },
          firstExpression: {
            id: 'e2',
            conceptId: 'c2',
            revision: 0,
            text: 'IL-1',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: TS,
            updatedAt: TS,
          },
          provenance: {
            id: 'p2',
            expressionId: 'e2',
            kind: 'manual',
            createdAt: TS,
            source: null,
          },
        },
      ],
    };
    await expect(proposeChange(empty, dupPayload)).rejects.toThrow(/duplicate.*opId/i);

    const blankPayload = makeCreateConceptPayload();
    if (blankPayload.ops[0].kind === 'createConcept') {
      blankPayload.ops[0].firstExpression.text = '   ';
    }
    await expect(proposeChange(empty, blankPayload)).rejects.toThrow();

    const nonJsonPayload = {
      ...makeCreateConceptPayload(),
      extraDate: new Date(),
    } as unknown as ChangePayload;
    await expect(proposeChange(empty, nonJsonPayload)).rejects.toThrow();
  });

  it('freezes proposal immutably, does not implicitly approve on preview, and blocks tampered payload or mismatched approval without calling repository', async () => {
    const empty = createEmptySnapshot();
    const payload = makeCreateConceptPayload();
    const proposal = await proposeChange(empty, payload);

    // No implicit approval property on preview
    expect('approval' in proposal).toBe(false);
    expect(proposal.preview.length).toBeGreaterThan(0);

    // Mutating original input object does not affect frozen proposal
    if (payload.ops[0].kind === 'createConcept') {
      payload.ops[0].firstExpression.text = 'MUTATED';
    }
    expect(
      proposal.payload.ops[0].kind === 'createConcept'
        ? proposal.payload.ops[0].firstExpression.text
        : null,
    ).toBe('TNF-α');
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(Object.isFrozen(proposal.payload)).toBe(true);

    const approval = approveChange(proposal);
    expect(approval.batchId).toBe(proposal.payload.batchId);
    expect(approval.digest).toBe(proposal.digest);
    expect(approval.actor).toBe('local-user');

    const applySpy = vi.fn(async () => ({ status: 'applied' as const, revision: 1 }));
    const fakeRepo: LibraryRepository = {
      snapshot: async () => empty,
      apply: applySpy,
    };

    // Tampered payload after preview
    const tamperedProposal: ProposedChange = {
      ...proposal,
      payload: {
        ...proposal.payload,
        ops: [
          {
            kind: 'createConcept',
            opId: 'op-1',
            concept: { id: 'c1', revision: 0, createdAt: TS, updatedAt: TS },
            firstExpression: {
              id: 'e1',
              conceptId: 'c1',
              revision: 0,
              text: 'TAMPERED',
              language: { kind: 'language', tag: 'en' },
              role: 'preferred',
              createdAt: TS,
              updatedAt: TS,
            },
            provenance: {
              id: 'p1',
              expressionId: 'e1',
              kind: 'manual',
              createdAt: TS,
              source: null,
            },
          },
        ],
      },
    };
    const tamperedRes = await applyChange(fakeRepo, tamperedProposal, approval);
    expect(tamperedRes.status).toBe('invalid');
    expect(applySpy).not.toHaveBeenCalled();

    // Mismatched approval batchId
    const badBatchApproval: Approval = { ...approval, batchId: 'wrong-batch' };
    const badBatchRes = await applyChange(fakeRepo, proposal, badBatchApproval);
    expect(badBatchRes.status).toBe('invalid');
    expect(applySpy).not.toHaveBeenCalled();

    // Mismatched approval digest
    const badDigestApproval: Approval = {
      ...approval,
      digest: '0'.repeat(64),
    };
    const badDigestRes = await applyChange(fakeRepo, proposal, badDigestApproval);
    expect(badDigestRes.status).toBe('invalid');
    expect(applySpy).not.toHaveBeenCalled();

    // Valid proposal + approval invokes repo once
    const okRes = await applyChange(fakeRepo, proposal, approval);
    expect(okRes).toEqual({ status: 'applied', revision: 1 });
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it('finds expressions with exact case-sensitive literal substring and deterministic sort', () => {
    const snap: LibrarySnapshot = {
      ...createEmptySnapshot(),
      libraryRevision: 1,
      concepts: [{ id: 'c1', revision: 0, createdAt: TS, updatedAt: TS }],
      expressions: [
        {
          id: 'e2',
          conceptId: 'c1',
          revision: 0,
          text: 'p53',
          language: { kind: 'language', tag: 'en' },
          role: 'preferred',
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'e1',
          conceptId: 'c1',
          revision: 0,
          text: 'P53',
          language: { kind: 'language', tag: 'en' },
          role: 'alternative',
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'e3',
          conceptId: 'c1',
          revision: 0,
          text: 'p53',
          language: { kind: 'shared' },
          role: 'unspecified',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    };

    expect(findExpressions(snap, 'p53').map((e) => e.id)).toEqual(['e2', 'e3']);
    expect(findExpressions(snap, 'P53').map((e) => e.id)).toEqual(['e1']);
    expect(findExpressions(snap, '').map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });
});
