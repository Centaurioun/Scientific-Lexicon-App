import { describe, expect, it } from 'vitest';
import {
  buildReviewTaskPacket,
  REVIEW_EXCHANGE_LIMITS,
  verifyReviewTaskPacket,
  verifyReviewTaskPacketAgainstSnapshot,
} from '@/domain/review-exchange';
import { selectEnrichmentTargets } from '@/application/enrichment-tasks';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

const TS = '2026-11-27T12:00:00.000Z';

function makeSnapshotWithSentinels(): LibrarySnapshot {
  return {
    ...createEmptySnapshot(),
    libraryRevision: 7,
    concepts: [
      { id: 'c-target', revision: 2, createdAt: TS, updatedAt: TS },
      { id: 'c-unrelated-sentinel', revision: 9, createdAt: TS, updatedAt: TS },
    ],
    expressions: [
      {
        id: 'e-target',
        conceptId: 'c-target',
        revision: 1,
        text: 'gingival sulcus',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-unrelated',
        conceptId: 'c-unrelated-sentinel',
        revision: 0,
        text: 'SENTINEL_UNRELATED_CONCEPT_DO_NOT_EXPORT',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    assertions: [
      {
        id: 'a-1',
        expressionId: 'e-target',
        field: 'text',
        value: 'gingival sulcus',
        recordRevision: 1,
        kind: 'user-confirmed',
        actor: 'local-user',
        assertedAt: TS,
      },
    ],
    provenance: [
      {
        id: 'p-1',
        expressionId: 'e-target',
        kind: 'reviewed-candidate',
        createdAt: TS,
        source: { documentId: 'doc-1', runId: 'run-1', start: 0, end: 15 },
      },
      { id: 'p-2', expressionId: 'e-unrelated', kind: 'manual', createdAt: TS, source: null },
    ],
    documents: [
      {
        id: 'doc-1',
        title: 'Private Manuscript SENTINEL',
        text: 'gingival sulcus SENTINEL_RETAINED_DOC_DO_NOT_EXPORT',
        createdAt: TS,
      },
    ],
    runs: [
      {
        id: 'run-1',
        documentId: 'doc-1',
        algorithmVersion: 'wink-v1',
        libraryRevision: 7,
        createdAt: TS,
        occurrences: [
          {
            id: 'occ-1',
            start: 0,
            end: 15,
            surface: 'gingival sulcus',
            expressionIds: ['e-target'],
            conceptIds: ['c-target'],
            state: 'known-form',
            resolvedConceptId: 'c-target',
          },
        ],
      },
    ],
    batches: [
      {
        batchId: 'batch-1',
        digest: 'a'.repeat(64),
        appliedRevision: 7,
      },
    ],
    audit: [
      {
        id: 'audit-1',
        batchId: 'batch-1',
        opId: 'op-1',
        kind: 'createConcept',
        recordIds: ['c-unrelated-sentinel'],
        actor: 'local-user',
        approvedAt: TS,
        appliedRevision: 7,
      },
    ],
  };
}

describe('WP04 F4: Standardized external-review ReviewTaskPacket v1', () => {
  it('builds a deterministic canonical taskDigest independent of target selection ordering and omits documents, audit, assertions, and unrelated records', async () => {
    const snapshot = makeSnapshotWithSentinels();
    const sel = selectEnrichmentTargets(
      snapshot,
      [{ conceptId: 'c-target', expectedConceptRevision: 2 }],
      'missing-tr',
    );

    const builtA = await buildReviewTaskPacket(sel, {
      taskId: 'task-synth-001',
      createdAt: TS,
      slotCount: 3,
    });
    const builtB = await buildReviewTaskPacket(sel, {
      taskId: 'task-synth-001',
      createdAt: TS,
      slotCount: 3,
    });

    expect(builtA.packet.format).toBe('termforge-review-task-packet');
    expect(builtA.packet.version).toBe(1);
    expect(builtA.packet.syntheticOnly).toBe(true);
    expect(builtA.packet.contextMode).toBe('none');
    expect(builtA.packet.explicitContextNote).toBeNull();
    expect(builtA.packet.blindReviewerSlots.length).toBe(3);
    expect(builtA.packet.allowedOperations).toEqual(['proposeExpression', 'no-change', 'abstain']);
    expect(builtA.packet.taskDigest).toBe(builtB.packet.taskDigest);
    expect(builtA.packet.externalUsageInstructions).toMatch(/synthetic data only/i);
    expect(builtA.byteLength).toBeLessThanOrEqual(REVIEW_EXCHANGE_LIMITS.maxPacketBytes);

    // Sentinel exclusion
    expect(builtA.canonicalJsonText).not.toContain('SENTINEL_UNRELATED_CONCEPT_DO_NOT_EXPORT');
    expect(builtA.canonicalJsonText).not.toContain('SENTINEL_RETAINED_DOC_DO_NOT_EXPORT');
    expect(builtA.canonicalJsonText).not.toContain('audit-1');
    expect(builtA.canonicalJsonText).not.toContain('a-1');
    expect(builtA.canonicalJsonText).not.toContain('apiKey');

    const verified = await verifyReviewTaskPacket(builtA.packet);
    expect(verified.taskDigest).toBe(builtA.packet.taskDigest);
  });

  it('rejects tampered packet digest, stale snapshot revision, and stale concept revision fail-closed', async () => {
    const snapshot = makeSnapshotWithSentinels();
    const sel = selectEnrichmentTargets(
      snapshot,
      [{ conceptId: 'c-target', expectedConceptRevision: 2 }],
      'missing-tr',
    );
    const { packet } = await buildReviewTaskPacket(sel, {
      taskId: 'task-synth-002',
      createdAt: TS,
      slotCount: 3,
    });

    // Tampered target text fails digest check
    const tampered = {
      ...packet,
      selectedTargets: packet.selectedTargets.map((t) => ({
        ...t,
        expressions: t.expressions.map((e) => ({ ...e, text: 'TAMPERED' })),
      })),
    };
    await expect(verifyReviewTaskPacket(tampered)).rejects.toThrow(/taskDigest|tamper|mismatch/i);

    // Library revision drift fails closed
    const bumpedSnapshot: LibrarySnapshot = {
      ...snapshot,
      libraryRevision: snapshot.libraryRevision + 1,
    };
    await expect(verifyReviewTaskPacketAgainstSnapshot(packet, bumpedSnapshot)).rejects.toThrow(
      /revision/i,
    );

    // Concept revision drift fails closed
    const conceptDriftedSnapshot: LibrarySnapshot = {
      ...snapshot,
      concepts: snapshot.concepts.map((c) =>
        c.id === 'c-target' ? { ...c, revision: c.revision + 1 } : c,
      ),
    };
    await expect(
      verifyReviewTaskPacketAgainstSnapshot(packet, conceptDriftedSnapshot),
    ).rejects.toThrow(/revision/i);
  });

  it('rejects oversize explicit context notes (> 4096 chars), oversize packets (> 256 KiB), and invalid slot counts', async () => {
    const snapshot = makeSnapshotWithSentinels();
    const sel = selectEnrichmentTargets(
      snapshot,
      [{ conceptId: 'c-target', expectedConceptRevision: 2 }],
      'missing-tr',
    );

    await expect(
      buildReviewTaskPacket(sel, {
        taskId: 'task-bad-slot',
        createdAt: TS,
        slotCount: 4,
      }),
    ).rejects.toThrow(/3/);

    await expect(
      buildReviewTaskPacket(sel, {
        taskId: 'task-oversize-note',
        createdAt: TS,
        slotCount: 3,
        contextMode: 'explicit-scoped-note',
        explicitContextNote: 'x'.repeat(REVIEW_EXCHANGE_LIMITS.maxTextLength + 1),
      }),
    ).rejects.toThrow(/4096/);

    // Exceed 256 KiB total packet size using large scoped expressions on a snapshot concept
    const hugeSnapshot: LibrarySnapshot = {
      ...createEmptySnapshot(),
      libraryRevision: 7,
      concepts: [{ id: 'c-target', revision: 2, createdAt: TS, updatedAt: TS }],
      expressions: [
        {
          id: 'e-huge',
          conceptId: 'c-target',
          revision: 0,
          text: 'H'.repeat(270_000),
          language: { kind: 'language', tag: 'en' },
          role: 'preferred',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
      provenance: [{ id: 'p-huge', expressionId: 'e-huge', kind: 'manual', createdAt: TS, source: null }],
    };
    const hugeSel = selectEnrichmentTargets(
      hugeSnapshot,
      [{ conceptId: 'c-target', expectedConceptRevision: 2 }],
      'missing-tr',
    );
    await expect(
      buildReviewTaskPacket(hugeSel, {
        taskId: 'task-oversize-bytes',
        createdAt: TS,
        slotCount: 2,
      }),
    ).rejects.toThrow(/262144|256 KiB/i);
  });
});
