import { describe, expect, it } from 'vitest';
import {
  generateSyntheticSimulatedReviewResponses,
  parseAndVerifyReviewResponseBytes,
  REVIEW_RESPONSE_WORKFLOW_DISCLOSURE,
  verifyUploadedSyntheticResponseBytes,
} from '@/application/review-response';
import { lookupSyntheticSourceEvidence } from '@/adapters/sources/synthetic-source-adapter';
import { selectEnrichmentTargets } from '@/application/enrichment-tasks';
import { buildReviewTaskPacket, REVIEW_EXCHANGE_LIMITS, type ReviewResponseV1 } from '@/domain/review-exchange';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';

const TS = '2026-11-27T12:00:00.000Z';

function makeSnapshot(): LibrarySnapshot {
  return {
    ...createEmptySnapshot(),
    libraryRevision: 3,
    concepts: [
      { id: 'c-sulcus', revision: 1, createdAt: TS, updatedAt: TS },
      { id: 'c-other', revision: 0, createdAt: TS, updatedAt: TS },
    ],
    expressions: [
      {
        id: 'e-1',
        conceptId: 'c-sulcus',
        revision: 0,
        text: 'gingival sulcus',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-2',
        conceptId: 'c-other',
        revision: 0,
        text: 'dental plaque',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    provenance: [
      { id: 'p-1', expressionId: 'e-1', kind: 'manual', createdAt: TS, source: null },
      { id: 'p-2', expressionId: 'e-2', kind: 'manual', createdAt: TS, source: null },
    ],
  };
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('WP04 F5: Strict ReviewResponse v1 parsing, validation & synthetic response pathway', () => {
  it('generates deterministic synthetic-simulated responses bound to exact task and validates them cleanly', async () => {
    const snapshot = makeSnapshot();
    const sel = selectEnrichmentTargets(
      snapshot,
      [{ conceptId: 'c-sulcus', expectedConceptRevision: 1 }],
      'missing-tr',
    );
    const evidence = await lookupSyntheticSourceEvidence(snapshot, sel, {
      sourceId: 'synth-bilingual-lexicon-v1',
    });
    const { packet } = await buildReviewTaskPacket(sel, {
      taskId: 'task-f5-001',
      createdAt: TS,
      slotCount: 3,
    });

    const bundle = await generateSyntheticSimulatedReviewResponses(packet, evidence.candidates, {
      scenario: 'consensus-with-source',
      createdAt: TS,
    });

    expect(bundle.responses.length).toBe(3);
    expect(bundle.allowlistedDigests.length).toBe(3);
    expect(REVIEW_RESPONSE_WORKFLOW_DISCLOSURE).toMatch(/synthetic-simulated|G4|arbitrary external/i);

    const accepted: ReviewResponseV1[] = [];
    for (let i = 0; i < bundle.serializedResponses.length; i += 1) {
      const verified = await verifyUploadedSyntheticResponseBytes(
        encode(bundle.serializedResponses[i]),
        packet,
        accepted,
        bundle.allowlistedDigests,
      );
      expect(verified.syntheticSimulation).toBe(true);
      expect(verified.claimedProviderIdentity.selfReportedUnauthenticated).toBe(true);
      accepted.push(verified);
    }
    expect(accepted.length).toBe(3);
  });

  it('rejects malformed UTF-8, oversize bytes (>256 KiB), deep JSON (>16), prototype pollution, unknown keys, and unsupported operations', async () => {
    const snapshot = makeSnapshot();
    const sel = selectEnrichmentTargets(
      snapshot,
      [{ conceptId: 'c-sulcus', expectedConceptRevision: 1 }],
      'missing-tr',
    );
    const { packet } = await buildReviewTaskPacket(sel, {
      taskId: 'task-f5-bad',
      createdAt: TS,
      slotCount: 3,
    });

    // Oversize bytes (> 256 KiB) rejected before parsing
    const huge = new Uint8Array(REVIEW_EXCHANGE_LIMITS.maxResponseBytes + 1);
    await expect(parseAndVerifyReviewResponseBytes(huge, packet, [])).rejects.toThrow(/262144|256 KiB/i);

    // Invalid UTF-8 rejected fail-closed
    const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
    await expect(parseAndVerifyReviewResponseBytes(invalidUtf8, packet, [])).rejects.toThrow(/UTF-8/i);

    // JSON nesting depth > 16 rejected fail-closed
    let nested = '{"a":1}';
    for (let i = 0; i < 20; i += 1) {
      nested = `{"n":${nested}}`;
    }
    await expect(parseAndVerifyReviewResponseBytes(encode(nested), packet, [])).rejects.toThrow(/depth/i);

    // Prototype pollution key rejected
    const protoPayload = `{"__proto__":{"polluted":true},"format":"termforge-review-response"}`;
    await expect(parseAndVerifyReviewResponseBytes(encode(protoPayload), packet, [])).rejects.toThrow(
      /__proto__|prototype|unsafe/i,
    );

    const validBase: ReviewResponseV1 = {
      format: 'termforge-review-response',
      version: 1,
      syntheticSimulation: true,
      taskId: packet.taskId,
      taskDigest: packet.taskDigest,
      baseLibraryRevision: packet.baseLibraryRevision,
      reviewerSlotId: 'slot-1',
      responseId: 'resp-1',
      claimedProviderIdentity: {
        provider: 'synthetic-local-sim',
        model: 'sim-model',
        version: 'v1',
        selfReportedUnauthenticated: true,
      },
      createdAt: TS,
      suggestions: [
        {
          operation: 'proposeExpression',
          targetConceptId: 'c-sulcus',
          expectedConceptRevision: 1,
          text: 'dişeti oluğu',
          language: { kind: 'language', tag: 'tr' },
          role: 'preferred',
          rationale: 'Synthetic rationale.',
          evidenceRefs: [],
        },
      ],
    };

    // Unsupported operation (e.g. assertExpression / replace / delete) rejected
    const assertAttempt = {
      ...validBase,
      suggestions: [{ ...validBase.suggestions[0], operation: 'assertExpression' }],
    };
    await expect(
      parseAndVerifyReviewResponseBytes(encode(JSON.stringify(assertAttempt)), packet, []),
    ).rejects.toThrow();

    // Unknown key / response-supplied canonical expression ID rejected
    const extraIdAttempt = {
      ...validBase,
      suggestions: [{ ...validBase.suggestions[0], canonicalExpressionId: 'e-injected' }],
    };
    await expect(
      parseAndVerifyReviewResponseBytes(encode(JSON.stringify(extraIdAttempt)), packet, []),
    ).rejects.toThrow();

    // Suggested surface > 512 chars rejected
    const longFormAttempt = {
      ...validBase,
      suggestions: [{ ...validBase.suggestions[0], text: 'a'.repeat(513) }],
    };
    await expect(
      parseAndVerifyReviewResponseBytes(encode(JSON.stringify(longFormAttempt)), packet, []),
    ).rejects.toThrow(/512/);
  });

  it('rejects wrong task/digest/revision, out-of-scope or stale target concept, invalid slot, duplicate slot/response replay, and unallowlisted arbitrary uploads', async () => {
    const snapshot = makeSnapshot();
    const sel = selectEnrichmentTargets(
      snapshot,
      [{ conceptId: 'c-sulcus', expectedConceptRevision: 1 }],
      'missing-tr',
    );
    const { packet } = await buildReviewTaskPacket(sel, {
      taskId: 'task-f5-bind',
      createdAt: TS,
      slotCount: 3,
    });

    const validResp: ReviewResponseV1 = {
      format: 'termforge-review-response',
      version: 1,
      syntheticSimulation: true,
      taskId: packet.taskId,
      taskDigest: packet.taskDigest,
      baseLibraryRevision: packet.baseLibraryRevision,
      reviewerSlotId: 'slot-1',
      responseId: 'resp-slot-1',
      claimedProviderIdentity: {
        provider: 'synthetic-local-sim',
        model: 'sim-model',
        version: 'v1',
        selfReportedUnauthenticated: true,
      },
      createdAt: TS,
      suggestions: [
        {
          operation: 'proposeExpression',
          targetConceptId: 'c-sulcus',
          expectedConceptRevision: 1,
          text: 'dişeti oluğu',
          language: { kind: 'language', tag: 'tr' },
          role: 'preferred',
          rationale: 'Synthetic rationale.',
          evidenceRefs: [],
        },
      ],
    };

    // Wrong taskDigest rejected
    await expect(
      parseAndVerifyReviewResponseBytes(
        encode(JSON.stringify({ ...validResp, taskDigest: 'f'.repeat(64) })),
        packet,
        [],
      ),
    ).rejects.toThrow(/taskDigest/i);

    // Out-of-scope target concept c-other rejected
    await expect(
      parseAndVerifyReviewResponseBytes(
        encode(
          JSON.stringify({
            ...validResp,
            suggestions: [{ ...validResp.suggestions[0], targetConceptId: 'c-other', expectedConceptRevision: 0 }],
          }),
        ),
        packet,
        [],
      ),
    ).rejects.toThrow(/scope|target/i);

    // Stale expectedConceptRevision rejected
    await expect(
      parseAndVerifyReviewResponseBytes(
        encode(
          JSON.stringify({
            ...validResp,
            suggestions: [{ ...validResp.suggestions[0], expectedConceptRevision: 0 }],
          }),
        ),
        packet,
        [],
      ),
    ).rejects.toThrow(/revision/i);

    // Unassigned slotId rejected
    await expect(
      parseAndVerifyReviewResponseBytes(
        encode(JSON.stringify({ ...validResp, reviewerSlotId: 'slot-99' })),
        packet,
        [],
      ),
    ).rejects.toThrow(/slot/i);

    // Duplicate slot or responseId rejected
    await expect(
      parseAndVerifyReviewResponseBytes(
        encode(JSON.stringify({ ...validResp, responseId: 'resp-new' })),
        packet,
        [validResp],
      ),
    ).rejects.toThrow(/duplicate.*slot/i);

    await expect(
      parseAndVerifyReviewResponseBytes(
        encode(JSON.stringify({ ...validResp, reviewerSlotId: 'slot-2' })),
        packet,
        [validResp],
      ),
    ).rejects.toThrow(/duplicate.*responseId/i);

    // Arbitrary unallowlisted external response blocked under synthetic gate
    await expect(
      verifyUploadedSyntheticResponseBytes(
        encode(JSON.stringify({ ...validResp, syntheticSimulation: false })),
        packet,
        [],
        [],
      ),
    ).rejects.toThrow(/allowlist|synthetic gate/i);
  });
});
