import type { SourceEvidenceCandidate } from '@/adapters/sources/synthetic-source-adapter';
import { deepFreeze, digest } from '@/domain/changes';
import {
  REVIEW_EXCHANGE_LIMITS,
  ReviewResponseV1Schema,
  verifyReviewTaskPacket,
  type ReviewResponseSuggestion,
  type ReviewResponseV1,
  type ReviewTaskPacketV1,
} from '@/domain/review-exchange';
import type { ExpressionRole, LanguageUse } from '@/domain/schema';

export type SyntheticSimulationScenario =
  | 'consensus-with-source'
  | 'disagreement-with-abstain'
  | 'unsupported-evidence-claim';

export interface GeneratedSyntheticResponseBundle {
  readonly scenario: SyntheticSimulationScenario;
  readonly responses: readonly ReviewResponseV1[];
  readonly serializedResponses: readonly string[];
  readonly allowlistedDigests: readonly string[];
}

export const REVIEW_RESPONSE_WORKFLOW_DISCLOSURE =
  'Synthetic review simulation mode (G4 NOT READY): TermForge currently accepts deterministic local synthetic-simulated responses or SHA-256 allowlisted synthetic fixtures bound to the active ReviewTaskPacket. Arbitrary unallowlisted external JSON uploads and live provider calls are blocked until G4/G5 policy gates pass.';

const FORBIDDEN_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function measureJsonDepth(value: unknown, maxDepth: number): void {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 1 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > maxDepth) {
      throw new Error(
        `ReviewResponse JSON nesting depth exceeds maximum (${maxDepth} levels).`,
      );
    }
    if (typeof current.node === 'number' && !Number.isFinite(current.node)) {
      throw new Error('ReviewResponse contains non-finite number.');
    }
    if (Array.isArray(current.node)) {
      for (let i = 0; i < current.node.length; i += 1) {
        stack.push({ node: current.node[i], depth: current.depth + 1 });
      }
    } else if (typeof current.node === 'object' && current.node !== null) {
      const keys = Object.getOwnPropertyNames(current.node);
      for (const k of keys) {
        if (FORBIDDEN_PROTO_KEYS.has(k)) {
          throw new Error(`ReviewResponse contains unsafe property key "${k}".`);
        }
        stack.push({
          node: (current.node as Record<string, unknown>)[k],
          depth: current.depth + 1,
        });
      }
    }
  }
}

export function decodeAndParseReviewResponseJsonBytes(rawBytes: Uint8Array): unknown {
  if (!(rawBytes instanceof Uint8Array)) {
    throw new Error('ReviewResponse input must be raw UTF-8 bytes.');
  }
  if (rawBytes.byteLength === 0) {
    throw new Error('ReviewResponse file is empty.');
  }
  if (rawBytes.byteLength > REVIEW_EXCHANGE_LIMITS.maxResponseBytes) {
    throw new Error(
      `ReviewResponse byte size (${rawBytes.byteLength} bytes) exceeds 256 KiB limit (${REVIEW_EXCHANGE_LIMITS.maxResponseBytes} bytes).`,
    );
  }

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch {
    throw new Error('ReviewResponse contains malformed UTF-8 byte sequences.');
  }

  if (decoded.length > REVIEW_EXCHANGE_LIMITS.maxDecodedResponseChars) {
    throw new Error(
      `Decoded ReviewResponse length (${decoded.length} UTF-16 chars) exceeds limit (${REVIEW_EXCHANGE_LIMITS.maxDecodedResponseChars} chars).`,
    );
  }

  // Reject prototype-mutating keys immediately during JSON parsing
  const parsed = JSON.parse(decoded, (key, value) => {
    if (FORBIDDEN_PROTO_KEYS.has(key)) {
      throw new Error(`ReviewResponse contains forbidden prototype property "${key}".`);
    }
    return value;
  }) as unknown;

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('ReviewResponse JSON root must be a plain object.');
  }

  measureJsonDepth(parsed, REVIEW_EXCHANGE_LIMITS.maxJsonDepth);
  return parsed;
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', copy);
  const hashArray = new Uint8Array(hashBuffer);
  let hex = '';
  for (let i = 0; i < hashArray.length; i += 1) {
    hex += hashArray[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Strictly parses raw bytes and validates a ReviewResponse v1 payload against:
 * - pre-read byte/char/UTF-8/depth/prototype bounds
 * - strict Zod schema (proposeExpression | no-change | abstain only; no unknown keys)
 * - exact active ReviewTaskPacket binding (taskId, taskDigest, baseLibraryRevision)
 * - preassigned slot membership, zero duplicate slot or responseId replay
 * - exact selected target conceptId + expectedConceptRevision scope
 */
export async function parseAndVerifyReviewResponseBytes(
  rawBytes: Uint8Array,
  packet: ReviewTaskPacketV1,
  existingAcceptedResponses: readonly ReviewResponseV1[],
  options: { readonly requireSyntheticSimulationFlag?: boolean } = {},
): Promise<ReviewResponseV1> {
  const verifiedPacket = await verifyReviewTaskPacket(packet);
  const parsedRaw = decodeAndParseReviewResponseJsonBytes(rawBytes);
  const response = ReviewResponseV1Schema.parse(parsedRaw);

  if (options.requireSyntheticSimulationFlag !== false && !response.syntheticSimulation) {
    throw new Error(
      'ReviewResponse syntheticSimulation=false is not permitted under the synthetic gate.',
    );
  }

  if (response.taskId !== verifiedPacket.taskId) {
    throw new Error(
      `ReviewResponse taskId "${response.taskId}" does not match active packet taskId "${verifiedPacket.taskId}".`,
    );
  }
  if (response.taskDigest !== verifiedPacket.taskDigest) {
    throw new Error(
      `ReviewResponse taskDigest "${response.taskDigest}" does not match active packet taskDigest "${verifiedPacket.taskDigest}".`,
    );
  }
  if (response.baseLibraryRevision !== verifiedPacket.baseLibraryRevision) {
    throw new Error(
      `ReviewResponse baseLibraryRevision ${response.baseLibraryRevision} does not match packet baseLibraryRevision ${verifiedPacket.baseLibraryRevision}.`,
    );
  }

  const slotExists = verifiedPacket.blindReviewerSlots.some(
    (s) => s.slotId === response.reviewerSlotId,
  );
  if (!slotExists) {
    throw new Error(
      `ReviewResponse reviewerSlotId "${response.reviewerSlotId}" is not in packet blindReviewerSlots.`,
    );
  }

  if (existingAcceptedResponses.some((r) => r.reviewerSlotId === response.reviewerSlotId)) {
    throw new Error(
      `Duplicate response rejected for slot "${response.reviewerSlotId}": each blind slot may submit at most once per task.`,
    );
  }

  if (existingAcceptedResponses.some((r) => r.responseId === response.responseId)) {
    throw new Error(
      `Duplicate responseId "${response.responseId}" rejected (replay blocked).`,
    );
  }

  const targetsByConceptId = new Map(
    verifiedPacket.selectedTargets.map((t) => [t.conceptId, t]),
  );

  for (const suggestion of response.suggestions) {
    const target = targetsByConceptId.get(suggestion.targetConceptId);
    if (!target) {
      throw new Error(
        `Suggestion targets concept "${suggestion.targetConceptId}" which is outside active packet scope.`,
      );
    }
    if (suggestion.expectedConceptRevision !== target.conceptRevision) {
      throw new Error(
        `Stale suggestion for concept "${suggestion.targetConceptId}": expected revision ${suggestion.expectedConceptRevision}, packet holds ${target.conceptRevision}.`,
      );
    }
  }

  return deepFreeze(response);
}

/**
 * Enforces WP04 F5 synthetic-only upload gate: verifies raw UTF-8 SHA-256 against
 * exact allowlisted synthetic response digests (generated in-session or pinned fixtures)
 * before schema/binding verification. Arbitrary real uploads fail closed.
 */
export async function verifyUploadedSyntheticResponseBytes(
  rawBytes: Uint8Array,
  packet: ReviewTaskPacketV1,
  existingAcceptedResponses: readonly ReviewResponseV1[],
  sessionAllowlistedResponseDigests: readonly string[],
): Promise<ReviewResponseV1> {
  if (rawBytes.byteLength > REVIEW_EXCHANGE_LIMITS.maxResponseBytes) {
    throw new Error(
      `Uploaded ReviewResponse exceeds 256 KiB (${REVIEW_EXCHANGE_LIMITS.maxResponseBytes} bytes).`,
    );
  }
  const rawSha = await sha256HexBytes(rawBytes);
  if (!sessionAllowlistedResponseDigests.includes(rawSha)) {
    throw new Error(
      `Uploaded ReviewResponse (${rawSha.slice(0, 12)}…) is not in the synthetic fixture allowlist; arbitrary unallowlisted external response activation is blocked under G4/synthetic gate.`,
    );
  }

  return parseAndVerifyReviewResponseBytes(rawBytes, packet, existingAcceptedResponses, {
    requireSyntheticSimulationFlag: true,
  });
}

function inferDefaultSyntheticProposal(
  taskKind: ReviewTaskPacketV1['taskKind'],
  conceptId: string,
  primaryText: string,
  evidenceHits: readonly SourceEvidenceCandidate[],
): { text: string; language: LanguageUse; role: ExpressionRole; rationale: string } {
  if (evidenceHits.length > 0) {
    const first = evidenceHits[0];
    return {
      text: first.candidateText,
      language: first.candidateLanguage,
      role: first.candidateRole,
      rationale: `Synthetic-simulated proposal aligning with synthetic source fixture ${first.sourceId} for surface "${first.matchedQuerySurface}".`,
    };
  }
  if (taskKind === 'missing-en') {
    return {
      text: `synth-en-${primaryText}`,
      language: { kind: 'language', tag: 'en' },
      role: 'preferred',
      rationale: `Deterministic synthetic EN placeholder for concept ${conceptId}; unverified offline simulation.`,
    };
  }
  if (taskKind === 'missing-tr') {
    return {
      text: `sentetik-${primaryText}`,
      language: { kind: 'language', tag: 'tr' },
      role: 'preferred',
      rationale: `Deterministic synthetic TR placeholder for concept ${conceptId}; unverified offline simulation.`,
    };
  }
  return {
    text: primaryText,
    language: { kind: 'language', tag: 'en' },
    role: 'preferred',
    rationale: `Deterministic synthetic role/candidate review note for concept ${conceptId}.`,
  };
}

/**
 * Generates deterministic isolated blind synthetic-simulated ReviewResponse v1 bundles
 * strictly from the active ReviewTaskPacket (each slot receives no sibling responses).
 */
export async function generateSyntheticSimulatedReviewResponses(
  packet: ReviewTaskPacketV1,
  allowlistedEvidenceCandidates: readonly SourceEvidenceCandidate[],
  options: {
    readonly scenario?: SyntheticSimulationScenario;
    readonly createdAt?: string;
  } = {},
): Promise<GeneratedSyntheticResponseBundle> {
  const verifiedPacket = await verifyReviewTaskPacket(packet);
  const scenario: SyntheticSimulationScenario = options.scenario ?? 'consensus-with-source';
  const createdAt = options.createdAt ?? verifiedPacket.createdAt;

  const evidenceByConcept = new Map<string, SourceEvidenceCandidate[]>();
  for (const cand of allowlistedEvidenceCandidates) {
    const list = evidenceByConcept.get(cand.targetConceptId) ?? [];
    list.push(cand);
    evidenceByConcept.set(cand.targetConceptId, list);
  }

  const responses: ReviewResponseV1[] = [];
  const serializedResponses: string[] = [];
  const allowlistedDigests: string[] = [];

  for (let slotIdx = 0; slotIdx < verifiedPacket.blindReviewerSlots.length; slotIdx += 1) {
    const slot = verifiedPacket.blindReviewerSlots[slotIdx];
    const suggestions: ReviewResponseSuggestion[] = [];

    for (const target of verifiedPacket.selectedTargets) {
      if (suggestions.length >= REVIEW_EXCHANGE_LIMITS.maxSuggestionsPerResponse) {
        break;
      }
      const hits = evidenceByConcept.get(target.conceptId) ?? [];
      const primaryText = target.expressions[0].text;
      const baseProposal = inferDefaultSyntheticProposal(
        verifiedPacket.taskKind,
        target.conceptId,
        primaryText,
        hits,
      );

      if (scenario === 'disagreement-with-abstain' && slotIdx === 2) {
        suggestions.push({
          operation: 'abstain',
          targetConceptId: target.conceptId,
          expectedConceptRevision: target.conceptRevision,
          rationale: `Blind slot ${slot.slotId} synthetic simulation abstains pending specialist verification.`,
          evidenceRefs: [],
        });
      } else if (scenario === 'disagreement-with-abstain' && slotIdx === 1) {
        const secondHit = hits[1];
        suggestions.push({
          operation: 'proposeExpression',
          targetConceptId: target.conceptId,
          expectedConceptRevision: target.conceptRevision,
          text: secondHit ? secondHit.candidateText : `${baseProposal.text} (alternatif)`,
          language: secondHit ? secondHit.candidateLanguage : baseProposal.language,
          role: 'alternative',
          rationale: `Blind slot ${slot.slotId} synthetic alternative proposal differing from slot 1.`,
          evidenceRefs: secondHit
            ? [
                {
                  sourceId: secondHit.sourceId,
                  referenceId: secondHit.evidenceId,
                  referenceUri: secondHit.sourceUri,
                  quotedEvidence: secondHit.evidenceSnippet,
                  note: 'Matches allowlisted offline synthetic entry.',
                },
              ]
            : [],
        });
      } else if (scenario === 'unsupported-evidence-claim') {
        suggestions.push({
          operation: 'proposeExpression',
          targetConceptId: target.conceptId,
          expectedConceptRevision: target.conceptRevision,
          text: baseProposal.text,
          language: baseProposal.language,
          role: baseProposal.role,
          rationale: `Blind slot ${slot.slotId} cites unallowlisted external source (unverified claim).`,
          evidenceRefs: [
            {
              sourceId: 'unverified-external-claim',
              referenceId: `ext-ref-${slot.slotId}`,
              referenceUri: 'https://example.invalid/never-fetched',
              note: 'Self-claimed external citation; unverified and never fetched.',
            },
          ],
        });
      } else {
        const matchingHit = hits[0];
        suggestions.push({
          operation: 'proposeExpression',
          targetConceptId: target.conceptId,
          expectedConceptRevision: target.conceptRevision,
          text: baseProposal.text,
          language: baseProposal.language,
          role: baseProposal.role,
          rationale: baseProposal.rationale,
          evidenceRefs: matchingHit
            ? [
                {
                  sourceId: matchingHit.sourceId,
                  referenceId: matchingHit.evidenceId,
                  referenceUri: matchingHit.sourceUri,
                  quotedEvidence: matchingHit.evidenceSnippet,
                  note: 'Matched allowlisted offline synthetic fixture.',
                },
              ]
            : [],
        });
      }
    }

    const digestPrefix = verifiedPacket.taskDigest.slice(0, 12);
    const response: ReviewResponseV1 = ReviewResponseV1Schema.parse({
      format: 'termforge-review-response',
      version: 1,
      syntheticSimulation: true,
      taskId: verifiedPacket.taskId,
      taskDigest: verifiedPacket.taskDigest,
      baseLibraryRevision: verifiedPacket.baseLibraryRevision,
      reviewerSlotId: slot.slotId,
      responseId: `sim-${digestPrefix}-${slot.slotId}-${scenario}`,
      claimedProviderIdentity: {
        provider: 'synthetic-local-simulator',
        model: `synth-blind-persona-${slotIdx + 1}`,
        version: 'sim-v1',
        selfReportedUnauthenticated: true,
      },
      createdAt,
      suggestions,
    });

    const serialized = JSON.stringify(response, null, 2);
    const bytes = new TextEncoder().encode(serialized);
    const rawSha = await sha256HexBytes(bytes);

    responses.push(response);
    serializedResponses.push(serialized);
    allowlistedDigests.push(rawSha);
  }

  return deepFreeze({
    scenario,
    responses,
    serializedResponses,
    allowlistedDigests,
  });
}

/**
 * Helper used in tests/bundle creation to compute deterministic synthetic response digest cleanly.
 */
export async function digestCanonicalReviewResponse(response: ReviewResponseV1): Promise<string> {
  return digest(response);
}
