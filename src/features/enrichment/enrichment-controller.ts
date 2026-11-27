import {
  lookupSyntheticSourceEvidence,
  type SourceEvidenceCandidate,
  type SourceEvidenceLookupResult,
} from '@/adapters/sources/synthetic-source-adapter';
import {
  buildEnrichmentProposalPlan,
  buildSessionEvidenceReport,
  type EnrichmentProposalSelectionItem,
  type PlannedEnrichmentChange,
} from '@/application/enrichment-planner';
import {
  selectEnrichmentTargets,
  type EnrichmentTaskFilterKind,
  type EnrichmentTaskKind,
  type ValidatedEnrichmentSelection,
} from '@/application/enrichment-tasks';
import { approveChange } from '@/application/library';
import {
  generateSyntheticSimulatedReviewResponses,
  parseAndVerifyReviewResponseBytes,
  verifyUploadedSyntheticResponseBytes,
  type GeneratedSyntheticResponseBundle,
  type SyntheticSimulationScenario,
} from '@/application/review-response';
import type { Approval, ApplyResult, ProposedChange } from '@/domain/changes';
import {
  buildReviewComparisonSummary,
  type ReviewComparisonSummary,
} from '@/domain/review-comparison';
import {
  buildReviewTaskPacket,
  REVIEW_EXCHANGE_LIMITS,
  type ReviewResponseV1,
  type ReviewTaskPacketV1,
} from '@/domain/review-exchange';
import {
  computeEnrichmentReviewIntentDigest,
  createValidatedPreCommitBackupOffer,
  verifyPreCommitCommitAuthorization,
  type PreCommitBackupProof,
} from '@/domain/review-guard';
import type { LibrarySnapshot } from '@/domain/schema';
import { RevisionReconciliationController } from '@/features/extraction/concurrency-controller';

export interface EnrichmentViewState {
  readonly taskKindFilter: EnrichmentTaskFilterKind;
  readonly searchQuery: string;
  readonly page: number;
  readonly activeTaskKind: EnrichmentTaskKind;
  readonly selectedTargets: readonly { conceptId: string; expectedConceptRevision: number }[];
  readonly contextMode: 'none' | 'explicit-scoped-note';
  readonly explicitContextNote: string;
  readonly packetConsentChecked: boolean;
  readonly sourceLookup: SourceEvidenceLookupResult | null;
  readonly packet: ReviewTaskPacketV1 | null;
  readonly packetJsonText: string | null;
  readonly packetByteLength: number;
  readonly simulatedBundle: GeneratedSyntheticResponseBundle | null;
  readonly allowlistedDigests: readonly string[];
  readonly acceptedResponses: readonly ReviewResponseV1[];
  readonly rejectedResponseErrors: readonly string[];
  readonly comparisonSummary: ReviewComparisonSummary | null;
  readonly selectedGroupKeys: readonly string[];
  readonly plannedEnrichment: PlannedEnrichmentChange | null;
  readonly backupProof: PreCommitBackupProof | null;
  readonly preCommitAckChecked: boolean;
  readonly applyingCommit: boolean;
  readonly actionError: string | null;
  readonly statusNotice: string | null;
  readonly preCommitBackupNotice: string | null;
}

export function createInitialEnrichmentViewState(): EnrichmentViewState {
  return {
    taskKindFilter: 'all',
    searchQuery: '',
    page: 1,
    activeTaskKind: 'missing-tr',
    selectedTargets: [],
    contextMode: 'none',
    explicitContextNote: '',
    packetConsentChecked: false,
    sourceLookup: null,
    packet: null,
    packetJsonText: null,
    packetByteLength: 0,
    simulatedBundle: null,
    allowlistedDigests: [],
    acceptedResponses: [],
    rejectedResponseErrors: [],
    comparisonSummary: null,
    selectedGroupKeys: [],
    plannedEnrichment: null,
    backupProof: null,
    preCommitAckChecked: false,
    applyingCommit: false,
    actionError: null,
    statusNotice: null,
    preCommitBackupNotice: null,
  };
}

export interface EnrichmentControllerDeps {
  readonly getSnapshot: () => LibrarySnapshot | null;
  readonly getViewState: () => EnrichmentViewState;
  readonly patchViewState: (patch: Partial<EnrichmentViewState>) => void;
  readonly readAuthoritativeSnapshot: () => Promise<LibrarySnapshot | null>;
  readonly onSnapshotChanged: (nextSnapshot?: LibrarySnapshot) => Promise<void>;
  readonly downloadFile: (filename: string, content: string, mimeType: string) => void;
  readonly applyBatch: (proposal: ProposedChange, approval: Approval) => Promise<ApplyResult>;
  readonly reconciler?: RevisionReconciliationController;
  readonly onFreshnessChange?: (confirmed: boolean) => void;
}

export class EnrichmentSessionController {
  private readonly deps: EnrichmentControllerDeps;
  private readonly reconciler: RevisionReconciliationController;
  private mounted = true;
  private freshnessConfirmed = true;
  private commitInFlightLock = false;

  private sessionEpoch = 0;
  private lookupGen = 0;
  private packetGen = 0;
  private responseGen = 0;
  private planGen = 0;
  private backupGen = 0;

  constructor(deps: EnrichmentControllerDeps) {
    this.deps = deps;
    this.reconciler = deps.reconciler ?? new RevisionReconciliationController();
  }

  remount(): void {
    this.mounted = true;
  }

  unmount(): void {
    this.mounted = false;
    this.sessionEpoch += 1;
  }

  isFreshnessConfirmed(): boolean {
    return this.freshnessConfirmed;
  }

  private safePatch(patch: Partial<EnrichmentViewState>): void {
    if (!this.mounted) return;
    this.deps.patchViewState(patch);
  }

  private invalidateDownstreamPlanAndBackup(): Partial<EnrichmentViewState> {
    this.planGen += 1;
    this.backupGen += 1;
    return {
      plannedEnrichment: null,
      backupProof: null,
      preCommitAckChecked: false,
      preCommitBackupNotice: null,
    };
  }

  private invalidateExchangeAndPlan(): Partial<EnrichmentViewState> {
    this.lookupGen += 1;
    this.packetGen += 1;
    this.responseGen += 1;
    return {
      sourceLookup: null,
      packet: null,
      packetJsonText: null,
      packetByteLength: 0,
      packetConsentChecked: false,
      simulatedBundle: null,
      allowlistedDigests: [],
      acceptedResponses: [],
      rejectedResponseErrors: [],
      comparisonSummary: null,
      selectedGroupKeys: [],
      ...this.invalidateDownstreamPlanAndBackup(),
    };
  }

  clearSession(): void {
    this.sessionEpoch += 1;
    const current = this.deps.getViewState();
    this.safePatch({
      ...createInitialEnrichmentViewState(),
      taskKindFilter: current.taskKindFilter,
      activeTaskKind: current.activeTaskKind,
      statusNotice: 'Cleared ephemeral WP04 session evidence, packets, responses, and unapproved plans.',
    });
  }

  handleLibraryRevisionChanged(newRevision: number | null): void {
    this.freshnessConfirmed = true;
    this.deps.onFreshnessChange?.(true);
    const state = this.deps.getViewState();
    const hadSessionData =
      state.selectedTargets.length > 0 ||
      state.packet !== null ||
      state.plannedEnrichment !== null ||
      state.sourceLookup !== null;
    if (!hadSessionData) return;

    this.sessionEpoch += 1;
    this.safePatch({
      selectedTargets: [],
      ...this.invalidateExchangeAndPlan(),
      actionError: null,
      statusNotice:
        newRevision !== null
          ? `Library snapshot updated to revision ${newRevision}; prior enrichment selections, packets, and proposals were invalidated.`
          : 'Library snapshot reloaded; prior enrichment session invalidated.',
    });
  }

  toggleTargetSelection(conceptId: string, expectedConceptRevision: number): void {
    const state = this.deps.getViewState();
    const exists = state.selectedTargets.some((t) => t.conceptId === conceptId);
    const nextTargets = exists
      ? state.selectedTargets.filter((t) => t.conceptId !== conceptId)
      : [...state.selectedTargets, { conceptId, expectedConceptRevision }];

    if (nextTargets.length > REVIEW_EXCHANGE_LIMITS.maxTargetsPerTask) {
      this.safePatch({
        actionError: `Cannot select more than ${REVIEW_EXCHANGE_LIMITS.maxTargetsPerTask} target concepts per task.`,
      });
      return;
    }

    this.safePatch({
      selectedTargets: nextTargets,
      ...this.invalidateExchangeAndPlan(),
      actionError: null,
      statusNotice: null,
    });
  }

  setTaskKindFilter(taskKindFilter: EnrichmentTaskFilterKind): void {
    const nextActiveKind: EnrichmentTaskKind =
      taskKindFilter === 'all' ? this.deps.getViewState().activeTaskKind : taskKindFilter;
    this.safePatch({
      taskKindFilter,
      activeTaskKind: nextActiveKind,
      page: 1,
      actionError: null,
    });
  }

  setActiveTaskKind(activeTaskKind: EnrichmentTaskKind): void {
    this.safePatch({
      activeTaskKind,
      ...this.invalidateExchangeAndPlan(),
      actionError: null,
    });
  }

  setSearchQuery(searchQuery: string): void {
    this.safePatch({ searchQuery, page: 1 });
  }

  setPage(page: number): void {
    this.safePatch({ page: Math.max(1, page) });
  }

  setContextMode(contextMode: 'none' | 'explicit-scoped-note'): void {
    this.safePatch({
      contextMode,
      explicitContextNote: contextMode === 'none' ? '' : this.deps.getViewState().explicitContextNote,
      ...this.invalidateExchangeAndPlan(),
      actionError: null,
    });
  }

  setExplicitContextNote(explicitContextNote: string): void {
    this.safePatch({
      explicitContextNote,
      ...this.invalidateExchangeAndPlan(),
      actionError: null,
    });
  }

  setPacketConsentChecked(packetConsentChecked: boolean): void {
    this.safePatch({ packetConsentChecked });
  }

  private validateCurrentSelection(snapshot: LibrarySnapshot): ValidatedEnrichmentSelection {
    const state = this.deps.getViewState();
    return selectEnrichmentTargets(snapshot, state.selectedTargets, state.activeTaskKind);
  }

  async lookupSyntheticEvidence(sourceId = 'synth-bilingual-lexicon-v1'): Promise<void> {
    const snapshot = this.deps.getSnapshot();
    if (!snapshot) {
      this.safePatch({ actionError: 'No library snapshot available.' });
      return;
    }
    const epoch = this.sessionEpoch;
    const reqGen = ++this.lookupGen;

    try {
      const selection = this.validateCurrentSelection(snapshot);
      const result = await lookupSyntheticSourceEvidence(snapshot, selection, { sourceId });
      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.lookupGen) return;

      this.safePatch({
        sourceLookup: result,
        actionError: null,
        statusNotice: `Found ${result.candidates.length} synthetic-unverified candidate(s) from ${result.sourceId} (release ${result.sourceRelease}).`,
      });
    } catch (error) {
      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.lookupGen) return;
      this.safePatch({
        sourceLookup: null,
        actionError: error instanceof Error ? error.message : 'Synthetic source lookup failed.',
      });
    }
  }

  async buildPacket(slotCount = 3): Promise<void> {
    const snapshot = this.deps.getSnapshot();
    if (!snapshot) {
      this.safePatch({ actionError: 'No library snapshot available.' });
      return;
    }
    const epoch = this.sessionEpoch;
    const reqGen = ++this.packetGen;
    const state = this.deps.getViewState();

    try {
      const selection = this.validateCurrentSelection(snapshot);
      const built = await buildReviewTaskPacket(selection, {
        taskId: `wp04-task-r${snapshot.libraryRevision}-${globalThis.crypto.randomUUID().slice(0, 8)}`,
        slotCount,
        contextMode: state.contextMode,
        explicitContextNote:
          state.contextMode === 'explicit-scoped-note' ? state.explicitContextNote : null,
      });
      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.packetGen) return;

      this.safePatch({
        packet: built.packet,
        packetJsonText: built.canonicalJsonText,
        packetByteLength: built.byteLength,
        packetConsentChecked: false,
        simulatedBundle: null,
        allowlistedDigests: [],
        acceptedResponses: [],
        rejectedResponseErrors: [],
        comparisonSummary: null,
        selectedGroupKeys: [],
        ...this.invalidateDownstreamPlanAndBackup(),
        actionError: null,
        statusNotice: `Built ReviewTaskPacket v1 (${built.byteLength} bytes, ${built.packet.selectedTargets.length} targets, digest ${built.packet.taskDigest.slice(0, 12)}…).`,
      });
    } catch (error) {
      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.packetGen) return;
      this.safePatch({
        actionError:
          error instanceof Error ? error.message : 'Unable to build ReviewTaskPacket v1.',
      });
    }
  }

  downloadPacket(): void {
    const state = this.deps.getViewState();
    if (!state.packet || !state.packetJsonText) {
      this.safePatch({ actionError: 'Build a ReviewTaskPacket before downloading.' });
      return;
    }
    if (!state.packetConsentChecked) {
      this.safePatch({
        actionError:
          'Confirm synthetic-only external review consent before downloading ReviewTaskPacket.',
      });
      return;
    }
    const filename = `termforge-review-packet-${state.packet.taskId}.json`;
    this.deps.downloadFile(filename, state.packetJsonText, 'application/json;charset=utf-8');
    this.safePatch({
      actionError: null,
      statusNotice: `Exported "${filename}" for offline/manual synthetic-only external review (no network transfer performed).`,
    });
  }

  async simulateResponses(scenario: SyntheticSimulationScenario): Promise<void> {
    const state = this.deps.getViewState();
    if (!state.packet) {
      this.safePatch({ actionError: 'Build a ReviewTaskPacket before running synthetic simulation.' });
      return;
    }
    const epoch = this.sessionEpoch;
    const reqGen = ++this.responseGen;
    const packetSnapshot = state.packet;
    const evidenceCandidates = state.sourceLookup?.candidates ?? [];

    try {
      const bundle = await generateSyntheticSimulatedReviewResponses(
        packetSnapshot,
        evidenceCandidates,
        { scenario },
      );

      // Parse & verify all generated synthetic slot responses strictly through F5 verifier
      const accepted: ReviewResponseV1[] = [];
      for (const serialized of bundle.serializedResponses) {
        const verified = await parseAndVerifyReviewResponseBytes(
          new TextEncoder().encode(serialized),
          packetSnapshot,
          accepted,
        );
        accepted.push(verified);
      }

      const comparison = buildReviewComparisonSummary({
        packet: packetSnapshot,
        acceptedResponses: accepted,
        rejectedResponseErrors: [],
        allowlistedEvidenceCandidates: evidenceCandidates,
      });

      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.responseGen) return;
      this.safePatch({
        simulatedBundle: bundle,
        allowlistedDigests: bundle.allowlistedDigests,
        acceptedResponses: accepted,
        rejectedResponseErrors: [],
        comparisonSummary: comparison,
        selectedGroupKeys: [],
        ...this.invalidateDownstreamPlanAndBackup(),
        actionError: null,
        statusNotice: `Staged ${accepted.length} deterministic synthetic-simulated slot response(s) (scenario: ${scenario}).`,
      });
    } catch (error) {
      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.responseGen) return;
      this.safePatch({
        actionError:
          error instanceof Error ? error.message : 'Synthetic response generation failed.',
      });
    }
  }

  async uploadSyntheticResponseBytes(filename: string, rawBytes: Uint8Array): Promise<void> {
    const state = this.deps.getViewState();
    if (!state.packet) {
      this.safePatch({ actionError: 'Build a ReviewTaskPacket before staging a response file.' });
      return;
    }
    const epoch = this.sessionEpoch;
    const reqGen = ++this.responseGen;
    const packetSnapshot = state.packet;
    const evidenceCandidates = state.sourceLookup?.candidates ?? [];

    try {
      const verified = await verifyUploadedSyntheticResponseBytes(
        rawBytes,
        packetSnapshot,
        state.acceptedResponses,
        state.allowlistedDigests,
      );

      const nextAccepted = [...state.acceptedResponses, verified];
      const comparison = buildReviewComparisonSummary({
        packet: packetSnapshot,
        acceptedResponses: nextAccepted,
        rejectedResponseErrors: state.rejectedResponseErrors,
        allowlistedEvidenceCandidates: evidenceCandidates,
      });

      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.responseGen) return;
      this.safePatch({
        acceptedResponses: nextAccepted,
        comparisonSummary: comparison,
        selectedGroupKeys: [],
        ...this.invalidateDownstreamPlanAndBackup(),
        actionError: null,
        statusNotice: `Verified synthetic allowlisted response "${filename}" for slot ${verified.reviewerSlotId}.`,
      });
    } catch (error) {
      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.responseGen) return;
      const reason = error instanceof Error ? error.message : 'Rejected uploaded response.';
      const nextErrors = [...state.rejectedResponseErrors, `${filename}: ${reason}`];
      const comparison = buildReviewComparisonSummary({
        packet: packetSnapshot,
        acceptedResponses: state.acceptedResponses,
        rejectedResponseErrors: nextErrors,
        allowlistedEvidenceCandidates: evidenceCandidates,
      });
      this.safePatch({
        rejectedResponseErrors: nextErrors,
        comparisonSummary: comparison,
        actionError: reason,
      });
    }
  }

  toggleComparisonGroupSelection(groupKey: string): void {
    const state = this.deps.getViewState();
    const exists = state.selectedGroupKeys.includes(groupKey);
    const nextKeys = exists
      ? state.selectedGroupKeys.filter((k) => k !== groupKey)
      : [...state.selectedGroupKeys, groupKey];

    this.safePatch({
      selectedGroupKeys: nextKeys,
      ...this.invalidateDownstreamPlanAndBackup(),
      actionError: null,
      statusNotice: null,
    });
  }

  private getSelectedProposalItems(): EnrichmentProposalSelectionItem[] {
    const state = this.deps.getViewState();
    if (!state.comparisonSummary) return [];
    const selectedSet = new Set(state.selectedGroupKeys);
    const items: EnrichmentProposalSelectionItem[] = [];
    for (const group of state.comparisonSummary.groups) {
      if (!selectedSet.has(group.groupKey)) continue;
      if (group.operation !== 'proposeExpression' || !group.text || !group.language || !group.role) {
        continue;
      }
      items.push({
        operation: 'addExpression',
        targetConceptId: group.targetConceptId,
        expectedConceptRevision: group.expectedConceptRevision,
        text: group.text,
        language: group.language,
        role: group.role,
      });
    }
    return items;
  }

  async buildEnrichmentProposal(): Promise<void> {
    const snapshot = this.deps.getSnapshot();
    const state = this.deps.getViewState();
    if (!snapshot || !state.packet) {
      this.safePatch({ actionError: 'Active snapshot and ReviewTaskPacket are required.' });
      return;
    }

    const epoch = this.sessionEpoch;
    const reqGen = ++this.planGen;

    try {
      const selectedItems = this.getSelectedProposalItems();
      const planned = await buildEnrichmentProposalPlan({
        snapshot,
        packet: state.packet,
        selectedItems,
      });

      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.planGen) return;
      this.safePatch({
        plannedEnrichment: planned,
        backupProof: null,
        preCommitAckChecked: false,
        preCommitBackupNotice: null,
        actionError: null,
        statusNotice: `Built immutable enrichment proposal (${planned.proposal.payload.ops.length} operation(s), digest ${planned.proposal.digest.slice(0, 12)}…). Offer a pre-commit portable backup before committing.`,
      });
    } catch (error) {
      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.planGen) return;
      this.safePatch({
        plannedEnrichment: null,
        backupProof: null,
        preCommitAckChecked: false,
        actionError:
          error instanceof Error ? error.message : 'Unable to build enrichment proposal.',
      });
    }
  }

  downloadSessionEvidenceReport(): void {
    const state = this.deps.getViewState();
    if (!state.packet) {
      this.safePatch({ actionError: 'Build a ReviewTaskPacket before exporting session evidence.' });
      return;
    }
    const evidence: readonly SourceEvidenceCandidate[] = state.sourceLookup?.candidates ?? [];
    const json = buildSessionEvidenceReport({
      packet: state.packet,
      comparison: state.comparisonSummary,
      evidenceCandidates: evidence,
    });
    const filename = `termforge-non-canonical-evidence-${state.packet.taskId}.json`;
    this.deps.downloadFile(filename, json, 'application/json;charset=utf-8');
    this.safePatch({
      actionError: null,
      statusNotice: `Exported non-canonical session evidence report "${filename}" (separate from portable backups).`,
    });
  }

  async offerPreCommitBackup(): Promise<void> {
    const snapshot = this.deps.getSnapshot();
    const state = this.deps.getViewState();
    if (!snapshot || !state.plannedEnrichment || !state.packet) {
      this.safePatch({ actionError: 'Build an enrichment proposal before offering a backup.' });
      return;
    }
    if (!this.freshnessConfirmed) {
      this.safePatch({
        actionError: 'Library freshness is unconfirmed. Refresh snapshot before offering a backup.',
      });
      return;
    }

    const epoch = this.sessionEpoch;
    const reqGen = ++this.backupGen;
    const capturedProposalDigest = state.plannedEnrichment.proposal.digest;
    const capturedBatchId = state.plannedEnrichment.proposal.payload.batchId;
    const capturedIntentDigest = state.plannedEnrichment.reviewIntentDigest;
    const capturedBaseRev = state.plannedEnrichment.proposal.payload.baseLibraryRevision;

    try {
      const authoritativeSnapshot = await this.deps.readAuthoritativeSnapshot();
      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.backupGen) return;
      if (!authoritativeSnapshot || authoritativeSnapshot.libraryRevision !== capturedBaseRev) {
        this.safePatch({
          actionError: `Authoritative library revision (${authoritativeSnapshot?.libraryRevision ?? 'missing'}) no longer matches proposal revision ${capturedBaseRev}. Reload and rebuild proposal.`,
          backupProof: null,
          preCommitAckChecked: false,
        });
        return;
      }

      const offer = await createValidatedPreCommitBackupOffer({
        snapshot: authoritativeSnapshot,
        proposalDigest: capturedProposalDigest,
        batchId: capturedBatchId,
        reviewIntentDigest: capturedIntentDigest,
        filenamePrefix: 'termforge-pre-enrichment-backup',
      });
      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.backupGen) return;

      const latestState = this.deps.getViewState();
      if (
        !latestState.plannedEnrichment ||
        latestState.plannedEnrichment.proposal.digest !== capturedProposalDigest
      ) {
        return;
      }

      this.deps.downloadFile(offer.filename, offer.serializedBackup, 'application/json;charset=utf-8');
      this.safePatch({
        backupProof: offer.proof,
        preCommitAckChecked: false,
        preCommitBackupNotice: `Pre-commit portable backup "${offer.filename}" (Rev ${offer.proof.snapshotRevision}, digest ${offer.proof.backupDigest.slice(0, 12)}…) offered for browser download. Browser download initiation cannot verify external filesystem persistence on disk.`,
        actionError: null,
      });
    } catch (error) {
      if (!this.mounted || epoch !== this.sessionEpoch || reqGen !== this.backupGen) return;
      this.safePatch({
        backupProof: null,
        preCommitAckChecked: false,
        actionError:
          error instanceof Error ? error.message : 'Pre-commit backup generation failed.',
      });
    }
  }

  setPreCommitAckChecked(checked: boolean): void {
    if (checked && !this.deps.getViewState().backupProof) {
      this.safePatch({
        preCommitAckChecked: false,
        actionError:
          'Offer a validated pre-commit portable backup bound to the current proposal before acknowledging.',
      });
      return;
    }
    this.safePatch({ preCommitAckChecked: checked, actionError: null });
  }

  async approveAndApplyCommit(): Promise<void> {
    if (this.commitInFlightLock) return;
    const state = this.deps.getViewState();
    const planned = state.plannedEnrichment;
    const packet = state.packet;
    if (!planned || !packet) {
      this.safePatch({ actionError: 'No active enrichment proposal to commit.' });
      return;
    }

    // Synchronous lock BEFORE any await prevents duplicate clicks (H2 invariant)
    this.commitInFlightLock = true;
    this.safePatch({ applyingCommit: true, actionError: null });

    try {
      const authoritativeSnapshot = await this.deps.readAuthoritativeSnapshot();
      const actualIntentDigest = authoritativeSnapshot
        ? await computeEnrichmentReviewIntentDigest({
            taskId: packet.taskId,
            taskDigest: packet.taskDigest,
            baseLibraryRevision: authoritativeSnapshot.libraryRevision,
            selectedItems: this.getSelectedProposalItems(),
          })
        : null;

      const authCheck = verifyPreCommitCommitAuthorization({
        plannedProposal: {
          digest: planned.proposal.digest,
          batchId: planned.proposal.payload.batchId,
          baseLibraryRevision: planned.proposal.payload.baseLibraryRevision,
        },
        expectedReviewIntentDigest: planned.reviewIntentDigest,
        actualReviewIntentDigest: actualIntentDigest,
        authoritativeSnapshot,
        backupProof: state.backupProof,
        preCommitAckChecked: state.preCommitAckChecked,
        freshnessConfirmed: this.freshnessConfirmed,
      });

      if (!authCheck.ok) {
        if (
          authoritativeSnapshot &&
          authoritativeSnapshot.libraryRevision !== planned.proposal.payload.baseLibraryRevision
        ) {
          await this.deps.onSnapshotChanged(authoritativeSnapshot);
        }
        this.safePatch({ actionError: authCheck.reason });
        return;
      }

      let commitOutcomeNotice: string | null = null;
      let commitOutcomeError: string | null = null;
      const capturedEpoch = this.sessionEpoch;
      const committedProposal = planned.proposal;

      await this.reconciler.runCommit({
        proposal: committedProposal,
        retainMeta: null,
        capturedContextSeq: capturedEpoch,
        getCurrentContextSeq: () => this.sessionEpoch,
        getActiveRunId: () => null,
        getActivePendingEntry: () => {
          const active = this.deps.getViewState().plannedEnrichment;
          return active ? { proposal: active.proposal, retainMeta: null } : null;
        },
        isMounted: () => this.mounted,
        applyProposal: async () => {
          const approval = approveChange(committedProposal);
          const result = await this.deps.applyBatch(committedProposal, approval);
          if (result.status === 'applied') {
            commitOutcomeNotice = `Committed ${committedProposal.payload.ops.length} approved additive enrichment expression(s) atomically at library revision ${result.revision} (provenance kind: "manual", source: null).`;
          } else if (result.status === 'replay') {
            commitOutcomeNotice = `Enrichment batch already applied at revision ${result.revision} (idempotent replay).`;
          }
          return result;
        },
        loadSnapshot: async () => {
          const fresh = await this.deps.readAuthoritativeSnapshot();
          if (fresh && this.mounted) {
            await this.deps.onSnapshotChanged(fresh);
          }
          return fresh;
        },
        invalidateMatcher: () => {},
        abortActiveAnalysis: () => {},
        setApplying: (applying) => {
          if (this.mounted) {
            this.safePatch({ applyingCommit: applying });
          }
        },
        clearPendingIfBatchMatches: (batchId) => {
          if (!this.mounted) return;
          const active = this.deps.getViewState().plannedEnrichment;
          if (active && active.proposal.payload.batchId === batchId) {
            this.sessionEpoch += 1;
            this.safePatch({
              selectedTargets: commitOutcomeNotice
                ? []
                : this.deps.getViewState().selectedTargets,
              ...(commitOutcomeNotice
                ? this.invalidateExchangeAndPlan()
                : this.invalidateDownstreamPlanAndBackup()),
            });
          }
        },
        invalidateStalePendingProposal: (reason) => {
          if (!this.mounted) return;
          this.safePatch({
            ...this.invalidateDownstreamPlanAndBackup(),
            actionError: reason,
          });
        },
        attachRetainedRunLink: () => {},
        setStatusNotice: (msg) => {
          if (!this.mounted) return;
          if (commitOutcomeNotice) {
            this.safePatch({ statusNotice: commitOutcomeNotice, actionError: null });
          } else if (msg) {
            this.safePatch({ statusNotice: msg });
          }
        },
        setAnalysisError: (msg) => {
          if (!this.mounted) return;
          commitOutcomeError = msg;
          this.safePatch({ actionError: msg });
        },
      });

      if (this.mounted) {
        this.freshnessConfirmed = this.reconciler.isFreshnessConfirmed();
        this.deps.onFreshnessChange?.(this.freshnessConfirmed);
        if (!commitOutcomeNotice && commitOutcomeError) {
          this.safePatch({
            ...this.invalidateDownstreamPlanAndBackup(),
          });
        }
      }
    } catch (error) {
      if (this.mounted) {
        this.safePatch({
          applyingCommit: false,
          actionError:
            error instanceof Error ? error.message : 'Unexpected failure committing enrichment.',
        });
      }
    } finally {
      this.commitInFlightLock = false;
      if (this.mounted && !this.reconciler.isCommitInFlight()) {
        this.safePatch({ applyingCommit: false });
      }
    }
  }
}
