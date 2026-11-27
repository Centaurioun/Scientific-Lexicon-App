import {
  readSyntheticDelimitedFile,
  stageApprovedBuiltInSyntheticFixture,
} from '@/application/delimited-file';
import {
  buildAdditiveImportPlan,
  type PlannedAdditiveImport,
} from '@/application/import-planner';
import { approveChange } from '@/application/library';
import type { Approval, ApplyResult, ProposedChange } from '@/domain/changes';
import {
  APPROVED_SYNTHETIC_IMPORT_FIXTURES,
  DELIMITED_INTAKE_LIMITS,
  DelimitedParseError,
  parseDelimitedText,
  verifyApprovedSyntheticImportBytes,
  type BlankLinePolicy,
  type DelimitedDelimiter,
  type RawDelimitedStage,
} from '@/domain/delimited-intake';
import {
  computeDelimitedReviewIntentCanonical,
  computeDelimitedReviewIntentDigest,
  createValidatedPreCommitBackupOffer,
  verifyPreCommitCommitAuthorization,
  type PreCommitBackupProof,
} from '@/domain/review-guard';
import type { LibrarySnapshot } from '@/domain/schema';
import {
  applyStagingMapping,
  STAGING_MAPPING_SCHEMA_VERSION,
  type StagingMappingSpec,
} from '@/domain/staging-mapping';
import {
  buildSuggestedInitialDecisions,
  evaluateStagingReview,
  type StagedRowUserDecision,
} from '@/domain/staging-review';
import { RevisionReconciliationController } from '@/features/extraction/concurrency-controller';

export interface DataOperationsViewState {
  readonly rawStage: RawDelimitedStage | null;
  readonly mappingSpec: StagingMappingSpec | null;
  readonly rowDecisions: Record<string, StagedRowUserDecision>;
  readonly plannedImport: PlannedAdditiveImport | null;
  readonly reviewIntentDigest: string | null;
  readonly backupProof: PreCommitBackupProof | null;
  readonly preCommitAckChecked: boolean;
  readonly applyingImport: boolean;
  readonly intakeError: string | null;
  readonly intakeNotice: string | null;
  readonly planningError: string | null;
  readonly commitNotice: string | null;
  readonly preCommitBackupNotice: string | null;
}

export interface StagedUploadedFileInput {
  readonly file?: File;
  readonly name: string;
  readonly size: number;
  readonly delimiter: DelimitedDelimiter;
  readonly blankLinePolicy: BlankLinePolicy;
  readonly rawText?: string;
}

export interface DataOperationsControllerDeps {
  readonly getSnapshot: () => LibrarySnapshot | null;
  readonly getViewState: () => DataOperationsViewState;
  readonly patchViewState: (patch: Partial<DataOperationsViewState>) => void;
  readonly readAuthoritativeSnapshot: () => Promise<LibrarySnapshot | null>;
  readonly onSnapshotChanged: (nextSnapshot?: LibrarySnapshot) => Promise<void>;
  readonly downloadFile: (filename: string, content: string, mimeType: string) => void;
  readonly applyBatch: (proposal: ProposedChange, approval: Approval) => Promise<ApplyResult>;
  readonly reconciler?: RevisionReconciliationController;
  readonly onFreshnessChange?: (confirmed: boolean) => void;
  readonly beforeBuildPlanHook?: () => Promise<void>;
  readonly readFileTextHook?: (input: StagedUploadedFileInput) => Promise<string>;
}

export function createDefaultMappingForStage(stage: RawDelimitedStage): StagingMappingSpec {
  const colCount = stage.headers.length;
  if (colCount >= 4) {
    return {
      mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
      termColumnIndex: 1,
      languageSource: { kind: 'column', columnIndex: 2, missingPolicy: 'error' },
      roleSource: { kind: 'column', columnIndex: 3, missingPolicy: 'unspecified' },
      groupKeyColumnIndex: 0,
      textTransform: 'trim-collapse-spaces',
    };
  }
  return {
    mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
    termColumnIndex: 0,
    languageSource:
      colCount > 1
        ? { kind: 'column', columnIndex: 1, missingPolicy: 'error' }
        : { kind: 'fixed', value: { kind: 'language', tag: 'en' } },
    roleSource:
      colCount > 2
        ? { kind: 'column', columnIndex: 2, missingPolicy: 'unspecified' }
        : { kind: 'fixed', value: 'preferred' },
    groupKeyColumnIndex: null,
    textTransform: 'trim-collapse-spaces',
  };
}

/**
 * Race-safe session lifecycle controller for WP03 Data Operations (`H1 + H2`).
 *
 * Enforces:
 * - Monotonic generation counters (`intakeGen`, `reviewGen`, `proposalGen`, `backupGen`) so any
 *   change to staged source, parse policy, mapping, row/target decisions, library revision, clear,
 *   cancel, or unmount immediately invalidates active proposals, backup proofs, and acknowledgments.
 * - Late-resolving or failed async file reads, built-in fixture loads, proposal builds, or backup
 *   offers never reinstall stale proposals or enable stale approvals.
 * - Synchronous commit re-entry lock + `RevisionReconciliationController` settlement so duplicate
 *   clicks are blocked, already-committed transactions are never hidden, and conflicts trigger
 *   authoritative snapshot reload.
 */
export class DataOperationsSessionController {
  private readonly deps: DataOperationsControllerDeps;
  readonly reconciler: RevisionReconciliationController;

  private mounted = true;
  private intakeGen = 0;
  private reviewGen = 0;
  private proposalGen = 0;
  private backupGen = 0;
  private commitInFlightLock = false;

  constructor(deps: DataOperationsControllerDeps) {
    this.deps = deps;
    this.reconciler = deps.reconciler ?? new RevisionReconciliationController();
  }

  isMounted(): boolean {
    return this.mounted;
  }

  remount(): void {
    this.mounted = true;
  }

  unmount(): void {
    this.mounted = false;
    this.intakeGen += 1;
    this.reviewGen += 1;
    this.proposalGen += 1;
    this.backupGen += 1;
  }

  invalidateReviewAndProposal(extraPatch: Partial<DataOperationsViewState> = {}): void {
    this.reviewGen += 1;
    this.proposalGen += 1;
    this.backupGen += 1;
    if (!this.mounted) return;
    this.deps.patchViewState({
      plannedImport: null,
      reviewIntentDigest: null,
      backupProof: null,
      preCommitBackupNotice: null,
      preCommitAckChecked: false,
      planningError: null,
      ...extraPatch,
    });
  }

  cancelProposal(): void {
    this.proposalGen += 1;
    this.backupGen += 1;
    if (!this.mounted) return;
    this.deps.patchViewState({
      plannedImport: null,
      reviewIntentDigest: null,
      backupProof: null,
      preCommitBackupNotice: null,
      preCommitAckChecked: false,
      planningError: null,
    });
  }

  clearStagingSession(): void {
    this.intakeGen += 1;
    this.reviewGen += 1;
    this.proposalGen += 1;
    this.backupGen += 1;
    if (!this.mounted) return;
    this.deps.patchViewState({
      rawStage: null,
      mappingSpec: null,
      rowDecisions: {},
      plannedImport: null,
      reviewIntentDigest: null,
      backupProof: null,
      preCommitBackupNotice: null,
      preCommitAckChecked: false,
      intakeError: null,
      intakeNotice: null,
      planningError: null,
    });
  }

  notifyRevisionChanged(): void {
    this.invalidateReviewAndProposal();
  }

  private applyNewStage(stage: RawDelimitedStage, notice: string): void {
    const snapshot = this.deps.getSnapshot();
    const defaultMapping = createDefaultMappingForStage(stage);
    let suggested: Record<string, StagedRowUserDecision> = {};
    if (snapshot) {
      const mapped = applyStagingMapping(stage, defaultMapping, snapshot.libraryRevision);
      suggested = buildSuggestedInitialDecisions(mapped, snapshot);
    }

    this.reviewGen += 1;
    this.proposalGen += 1;
    this.backupGen += 1;

    this.deps.patchViewState({
      rawStage: stage,
      mappingSpec: defaultMapping,
      rowDecisions: suggested,
      plannedImport: null,
      reviewIntentDigest: null,
      backupProof: null,
      preCommitBackupNotice: null,
      preCommitAckChecked: false,
      intakeError: null,
      intakeNotice: notice,
      planningError: null,
      commitNotice: null,
    });
  }

  async stageBuiltInFixture(
    fixtureId: string,
    blankLinePolicy: BlankLinePolicy,
  ): Promise<void> {
    if (!this.mounted) return;
    const capturedIntakeGen = ++this.intakeGen;
    this.invalidateReviewAndProposal({
      intakeError: null,
      intakeNotice: null,
      commitNotice: null,
    });

    try {
      const stage = await stageApprovedBuiltInSyntheticFixture(fixtureId, blankLinePolicy);
      if (!this.mounted || capturedIntakeGen !== this.intakeGen) return;
      this.applyNewStage(
        stage,
        `Staged approved synthetic fixture "${stage.sourceName}" (${stage.rows.length} rows, SHA-256 ${stage.rawByteSha256.slice(0, 16)}…).`,
      );
    } catch (error) {
      if (!this.mounted || capturedIntakeGen !== this.intakeGen) return;
      this.invalidateReviewAndProposal({
        intakeError:
          error instanceof Error ? error.message : 'Unable to stage built-in synthetic fixture.',
      });
    }
  }

  async stageUploadedFile(input: StagedUploadedFileInput): Promise<void> {
    if (!this.mounted) return;
    const capturedIntakeGen = ++this.intakeGen;
    this.invalidateReviewAndProposal({
      intakeError: null,
      intakeNotice: null,
      commitNotice: null,
    });

    try {
      let stage: RawDelimitedStage;
      if (this.deps.readFileTextHook) {
        if (input.size > DELIMITED_INTAKE_LIMITS.maxFileBytes) {
          throw new DelimitedParseError(
            `File "${input.name}" exceeds the 2 MiB maximum limit and was rejected before reading.`,
          );
        }
        const text = await this.deps.readFileTextHook(input);
        if (!this.mounted || capturedIntakeGen !== this.intakeGen) return;
        const bytes = new TextEncoder().encode(text);
        const { fixture, rawByteSha256 } = await verifyApprovedSyntheticImportBytes(bytes);
        if (input.delimiter !== fixture.delimiter) {
          throw new DelimitedParseError(
            `Approved synthetic fixture "${fixture.name}" requires explicit delimiter "${fixture.delimiter}".`,
          );
        }
        stage = await parseDelimitedText(text, {
          delimiter: input.delimiter,
          blankLinePolicy: input.blankLinePolicy,
          sourceName: input.name || fixture.filename,
          rawByteLength: bytes.byteLength,
          rawByteSha256,
          approvedFixtureId: fixture.id,
        });
      } else if (input.file) {
        stage = await readSyntheticDelimitedFile(input.file, {
          delimiter: input.delimiter,
          blankLinePolicy: input.blankLinePolicy,
        });
      } else {
        throw new DelimitedParseError('No file supplied for delimited synthetic intake.');
      }

      if (!this.mounted || capturedIntakeGen !== this.intakeGen) return;
      this.applyNewStage(
        stage,
        `Verified and staged uploaded synthetic file "${stage.sourceName}" (${stage.rows.length} rows, SHA-256 ${stage.rawByteSha256.slice(0, 16)}…).`,
      );
    } catch (error) {
      if (!this.mounted || capturedIntakeGen !== this.intakeGen) return;
      this.invalidateReviewAndProposal({
        intakeError:
          error instanceof Error
            ? error.message
            : 'Uploaded file failed synthetic allowlist or delimited parser validation.',
      });
    }
  }

  updateMapping(updater: (prev: StagingMappingSpec) => StagingMappingSpec): void {
    const prevMapping = this.deps.getViewState().mappingSpec;
    if (!prevMapping) return;
    const nextMapping = updater(prevMapping);
    this.invalidateReviewAndProposal({
      mappingSpec: nextMapping,
    });
  }

  setRowDecision(rowId: string, decision: StagedRowUserDecision): void {
    const prevDecisions = this.deps.getViewState().rowDecisions;
    this.invalidateReviewAndProposal({
      rowDecisions: {
        ...prevDecisions,
        [rowId]: decision,
      },
    });
  }

  replaceRowDecisions(decisions: Record<string, StagedRowUserDecision>): void {
    this.invalidateReviewAndProposal({
      rowDecisions: decisions,
    });
  }

  setPreCommitAck(checked: boolean): void {
    const state = this.deps.getViewState();
    const snapshot = this.deps.getSnapshot();
    if (!this.mounted) return;
    if (!checked) {
      this.deps.patchViewState({ preCommitAckChecked: false });
      return;
    }

    // Require a valid current proposal AND matching validated backup proof before ack can stick
    if (
      !state.plannedImport ||
      !state.backupProof ||
      !state.reviewIntentDigest ||
      !snapshot ||
      state.backupProof.proposalDigest !== state.plannedImport.proposal.digest ||
      state.backupProof.batchId !== state.plannedImport.proposal.payload.batchId ||
      state.backupProof.reviewIntentDigest !== state.reviewIntentDigest ||
      state.backupProof.snapshotRevision !== snapshot.libraryRevision
    ) {
      this.deps.patchViewState({
        preCommitAckChecked: false,
        planningError:
          'Offer and validate a pre-commit portable backup for the current reviewed proposal before acknowledging commit.',
      });
      return;
    }

    this.deps.patchViewState({
      preCommitAckChecked: true,
      planningError: null,
    });
  }

  private evaluateCurrentReview() {
    const state = this.deps.getViewState();
    const snapshot = this.deps.getSnapshot();
    if (!state.rawStage || !state.mappingSpec || !snapshot) return null;
    try {
      const table = applyStagingMapping(
        state.rawStage,
        state.mappingSpec,
        snapshot.libraryRevision,
      );
      const review = evaluateStagingReview(table, snapshot, state.rowDecisions);
      const intentCanonical = computeDelimitedReviewIntentCanonical(state.rawStage, review);
      return { rawStage: state.rawStage, snapshot, table, review, intentCanonical };
    } catch {
      return null;
    }
  }

  async buildProposal(): Promise<void> {
    if (!this.mounted) return;
    const evaluated = this.evaluateCurrentReview();
    if (!evaluated) return;

    const capturedProposalGen = ++this.proposalGen;
    const capturedReviewGen = this.reviewGen;
    this.backupGen += 1;

    this.deps.patchViewState({
      plannedImport: null,
      reviewIntentDigest: null,
      backupProof: null,
      preCommitBackupNotice: null,
      preCommitAckChecked: false,
      planningError: null,
      commitNotice: null,
    });

    if (!this.reconciler.isFreshnessConfirmed()) {
      this.deps.patchViewState({
        planningError:
          'Library revision freshness is unconfirmed after concurrent background updates. Click "Confirm latest revision" before building a proposal.',
      });
      return;
    }

    try {
      if (this.deps.beforeBuildPlanHook) {
        await this.deps.beforeBuildPlanHook();
      }
      if (
        !this.mounted ||
        capturedProposalGen !== this.proposalGen ||
        capturedReviewGen !== this.reviewGen
      ) {
        return;
      }

      const [planned, intentDigest] = await Promise.all([
        buildAdditiveImportPlan(evaluated.review, evaluated.snapshot),
        computeDelimitedReviewIntentDigest(evaluated.rawStage, evaluated.review),
      ]);

      // Verify exact post-await context & review-intent equivalence (H2)
      const latestEvaluated = this.evaluateCurrentReview();
      if (
        !this.mounted ||
        capturedProposalGen !== this.proposalGen ||
        capturedReviewGen !== this.reviewGen ||
        !latestEvaluated ||
        latestEvaluated.intentCanonical !== evaluated.intentCanonical ||
        latestEvaluated.snapshot.libraryRevision !== evaluated.snapshot.libraryRevision
      ) {
        return;
      }

      this.deps.patchViewState({
        plannedImport: planned,
        reviewIntentDigest: intentDigest,
        backupProof: null,
        preCommitBackupNotice: null,
        preCommitAckChecked: false,
        planningError: null,
      });
    } catch (error) {
      if (
        !this.mounted ||
        capturedProposalGen !== this.proposalGen ||
        capturedReviewGen !== this.reviewGen
      ) {
        return;
      }
      this.deps.patchViewState({
        plannedImport: null,
        reviewIntentDigest: null,
        backupProof: null,
        preCommitBackupNotice: null,
        preCommitAckChecked: false,
        planningError:
          error instanceof Error ? error.message : 'Unable to build additive import proposal.',
      });
    }
  }

  async offerPreCommitBackup(): Promise<void> {
    if (!this.mounted) return;
    const state = this.deps.getViewState();
    const evaluated = this.evaluateCurrentReview();
    if (!state.plannedImport || !state.reviewIntentDigest || !evaluated) {
      this.deps.patchViewState({
        backupProof: null,
        preCommitAckChecked: false,
        planningError:
          'Build a current additive import proposal before offering a pre-commit portable backup.',
      });
      return;
    }

    const capturedBackupGen = ++this.backupGen;
    const capturedProposalGen = this.proposalGen;
    const capturedReviewGen = this.reviewGen;
    const capturedPlanned = state.plannedImport;
    const capturedIntentDigest = state.reviewIntentDigest;
    const capturedIntentCanonical = evaluated.intentCanonical;

    this.deps.patchViewState({
      backupProof: null,
      preCommitBackupNotice: null,
      preCommitAckChecked: false,
      planningError: null,
    });

    try {
      const authoritativeSnapshot = await this.deps.readAuthoritativeSnapshot();
      if (
        !this.mounted ||
        capturedBackupGen !== this.backupGen ||
        capturedProposalGen !== this.proposalGen ||
        capturedReviewGen !== this.reviewGen
      ) {
        return;
      }

      if (!authoritativeSnapshot) {
        this.deps.patchViewState({
          backupProof: null,
          preCommitAckChecked: false,
          planningError: 'Unable to read authoritative library snapshot for pre-commit backup.',
        });
        return;
      }

      if (
        authoritativeSnapshot.libraryRevision !==
        capturedPlanned.proposal.payload.baseLibraryRevision
      ) {
        await this.deps.onSnapshotChanged(authoritativeSnapshot);
        if (!this.mounted) return;
        this.invalidateReviewAndProposal({
          planningError: `Authoritative library revision advanced to Rev ${authoritativeSnapshot.libraryRevision} (stale proposal targeted Rev ${capturedPlanned.proposal.payload.baseLibraryRevision}). Rebuild the proposal before offering a backup.`,
        });
        return;
      }

      const offer = await createValidatedPreCommitBackupOffer({
        snapshot: authoritativeSnapshot,
        proposalDigest: capturedPlanned.proposal.digest,
        batchId: capturedPlanned.proposal.payload.batchId,
        reviewIntentDigest: capturedIntentDigest,
        filenamePrefix: 'termforge-pre-import-backup',
      });

      const latestEvaluated = this.evaluateCurrentReview();
      if (
        !this.mounted ||
        capturedBackupGen !== this.backupGen ||
        capturedProposalGen !== this.proposalGen ||
        capturedReviewGen !== this.reviewGen ||
        !latestEvaluated ||
        latestEvaluated.intentCanonical !== capturedIntentCanonical ||
        latestEvaluated.snapshot.libraryRevision !== authoritativeSnapshot.libraryRevision
      ) {
        return;
      }

      this.deps.downloadFile(offer.filename, offer.serializedBackup, 'application/json');
      this.deps.patchViewState({
        backupProof: offer.proof,
        preCommitAckChecked: false,
        preCommitBackupNotice:
          `Pre-commit backup "${offer.filename}" (Rev ${offer.proof.snapshotRevision}, Backup SHA-256 ${offer.proof.backupDigest.slice(0, 16)}…, bound to Batch ${offer.proof.batchId.slice(0, 8)}…) offered for browser download. Note: browser download initiation cannot verify external disk storage.`,
        planningError: null,
      });
    } catch (error) {
      if (
        !this.mounted ||
        capturedBackupGen !== this.backupGen ||
        capturedProposalGen !== this.proposalGen ||
        capturedReviewGen !== this.reviewGen
      ) {
        return;
      }
      this.deps.patchViewState({
        backupProof: null,
        preCommitBackupNotice: null,
        preCommitAckChecked: false,
        planningError:
          error instanceof Error ? error.message : 'Unable to generate pre-commit portable backup.',
      });
    }
  }

  async approveAndApply(): Promise<void> {
    if (this.commitInFlightLock || !this.mounted || this.reconciler.isCommitInFlight()) {
      return;
    }

    // Acquire synchronous re-entry lock immediately before ANY `await` so concurrent
    // duplicate clicks in the same microtask turn cannot both enter.
    this.commitInFlightLock = true;
    this.deps.patchViewState({ applyingImport: true, planningError: null });

    try {
      const state = this.deps.getViewState();
      const evaluated = this.evaluateCurrentReview();
      const actualReviewIntentDigest = evaluated
        ? await computeDelimitedReviewIntentDigest(evaluated.rawStage, evaluated.review)
        : null;

      if (!this.mounted) return;

      const auth = verifyPreCommitCommitAuthorization({
        plannedProposal: state.plannedImport
          ? {
              digest: state.plannedImport.proposal.digest,
              batchId: state.plannedImport.proposal.payload.batchId,
              baseLibraryRevision: state.plannedImport.proposal.payload.baseLibraryRevision,
            }
          : null,
        expectedReviewIntentDigest: state.reviewIntentDigest,
        actualReviewIntentDigest,
        authoritativeSnapshot: evaluated?.snapshot ?? this.deps.getSnapshot(),
        backupProof: state.backupProof,
        preCommitAckChecked: state.preCommitAckChecked,
        freshnessConfirmed: this.reconciler.isFreshnessConfirmed(),
      });

      if (!auth.ok) {
        this.deps.patchViewState({
          applyingImport: false,
          preCommitAckChecked: false,
          planningError: auth.reason,
        });
        return;
      }

      const commitProposal = state.plannedImport!;
      const expectedIntentDigest = state.reviewIntentDigest!;
      const capturedBackupProof = state.backupProof!;
      const capturedContextSeq = this.reviewGen;

      let commitOutcomeNotice: string | null = null;
      let commitOutcomeError: string | null = null;

      await this.reconciler.runCommit({
        proposal: commitProposal.proposal,
        retainMeta: null,
        capturedContextSeq,
        getCurrentContextSeq: () => this.reviewGen,
        getActiveRunId: () => null,
        getActivePendingEntry: () => {
          const active = this.deps.getViewState().plannedImport;
          return active ? { proposal: active.proposal, retainMeta: null } : null;
        },
        isMounted: () => this.mounted,
        applyProposal: async () => {
          // Final fail-closed proof verification at gateway boundary before calling approve/apply
          const gateCheck = verifyPreCommitCommitAuthorization({
            plannedProposal: {
              digest: commitProposal.proposal.digest,
              batchId: commitProposal.proposal.payload.batchId,
              baseLibraryRevision: commitProposal.proposal.payload.baseLibraryRevision,
            },
            expectedReviewIntentDigest: expectedIntentDigest,
            actualReviewIntentDigest,
            authoritativeSnapshot: evaluated?.snapshot ?? this.deps.getSnapshot(),
            backupProof: capturedBackupProof,
            preCommitAckChecked: true,
            freshnessConfirmed: this.reconciler.isFreshnessConfirmed(),
          });
          if (!gateCheck.ok) {
            return { status: 'invalid', reason: gateCheck.reason };
          }
          const approval = approveChange(commitProposal.proposal);
          const result = await this.deps.applyBatch(commitProposal.proposal, approval);
          if (result.status === 'applied') {
            commitOutcomeNotice = `Committed reviewed additive import batch (${commitProposal.summary.totalOperations} operations) atomically at library revision ${result.revision}.`;
          } else if (result.status === 'replay') {
            commitOutcomeNotice = `Import batch already recorded at library revision ${result.revision} (idempotent replay).`;
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
            this.deps.patchViewState({ applyingImport: applying });
          }
        },
        clearPendingIfBatchMatches: (batchId) => {
          if (!this.mounted) return;
          const active = this.deps.getViewState().plannedImport;
          if (active && active.proposal.payload.batchId === batchId) {
            this.intakeGen += 1;
            this.reviewGen += 1;
            this.proposalGen += 1;
            this.backupGen += 1;
            this.deps.patchViewState({
              plannedImport: null,
              reviewIntentDigest: null,
              backupProof: null,
              preCommitBackupNotice: null,
              preCommitAckChecked: false,
              rawStage: commitOutcomeNotice ? null : this.deps.getViewState().rawStage,
              mappingSpec: commitOutcomeNotice ? null : this.deps.getViewState().mappingSpec,
              rowDecisions: commitOutcomeNotice ? {} : this.deps.getViewState().rowDecisions,
            });
          }
        },
        invalidateStalePendingProposal: (reason) => {
          if (!this.mounted) return;
          this.invalidateReviewAndProposal({
            planningError: reason,
          });
        },
        attachRetainedRunLink: () => {},
        setStatusNotice: (msg) => {
          if (!this.mounted) return;
          if (commitOutcomeNotice) {
            this.deps.patchViewState({ commitNotice: commitOutcomeNotice });
          } else if (msg) {
            this.deps.patchViewState({ commitNotice: msg });
          }
        },
        setAnalysisError: (msg) => {
          if (!this.mounted) return;
          commitOutcomeError = msg;
          this.deps.patchViewState({ planningError: msg });
        },
      });

      if (this.mounted) {
        this.deps.onFreshnessChange?.(this.reconciler.isFreshnessConfirmed());
        if (!commitOutcomeNotice && commitOutcomeError) {
          this.deps.patchViewState({
            plannedImport: null,
            reviewIntentDigest: null,
            backupProof: null,
            preCommitBackupNotice: null,
            preCommitAckChecked: false,
          });
        }
      }
    } finally {
      this.commitInFlightLock = false;
      if (this.mounted && !this.reconciler.isCommitInFlight()) {
        const cur = this.deps.getViewState();
        if (cur.applyingImport) {
          this.deps.patchViewState({ applyingImport: false });
        }
      }
    }
  }

  getApprovedFixtureById(id: string) {
    return APPROVED_SYNTHETIC_IMPORT_FIXTURES.find((f) => f.id === id) ?? null;
  }
}
