import { describe, expect, it } from 'vitest';
import { stageApprovedBuiltInSyntheticFixture } from '@/application/delimited-file';
import {
  createBackup,
  formatExport,
  parseBackupFileText,
  selectExportRows,
  serializeBackupFile,
} from '@/application/exchange';
import { buildAdditiveImportPlan } from '@/application/import-planner';
import {
  applyChange,
  approveChange,
  approveRestore,
  listLibrary,
  proposeChange,
  restoreEmptyLibrary,
} from '@/application/library';
import { inspectLibraryQuality } from '@/application/quality-inspector';
import type { BackupEnvelope, RestoreApproval } from '@/domain/backup';
import {
  canonicalJson,
  evaluateChangeOnSnapshot,
  type Approval,
  type ProposedChange,
} from '@/domain/changes';
import type { RecoveryRepository } from '@/domain/repository';
import {
  createEmptySnapshot,
  parseLibrarySnapshot,
  type LibrarySnapshot,
} from '@/domain/schema';
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

/**
 * Transactional in-memory repository delegating to canonical `evaluateChangeOnSnapshot`
 * with optional mid-transaction abort injection for WP03 E8 recovery, privacy, and atomic failure drills.
 */
class DrillLibraryRepository implements RecoveryRepository {
  private state: LibrarySnapshot = createEmptySnapshot();
  private abortOnNextCommit = false;

  public injectAbortOnNextCommit(): void {
    this.abortOnNextCommit = true;
  }

  async snapshot(): Promise<LibrarySnapshot> {
    return parseLibrarySnapshot(structuredClone(this.state));
  }

  async apply(proposal: ProposedChange, approval: Approval) {
    const evaluated = evaluateChangeOnSnapshot(this.state, proposal.payload, approval);
    if (this.abortOnNextCommit) {
      this.abortOnNextCommit = false;
      throw new Error('AbortError: Simulated mid-transaction IndexedDB abort during batch commit.');
    }
    if (evaluated.kind === 'replay') {
      return { status: 'replay' as const, revision: evaluated.revision };
    }
    if (evaluated.kind === 'error') {
      return evaluated.result;
    }
    this.state = parseLibrarySnapshot(structuredClone(evaluated.nextSnapshot));
    return { status: 'applied' as const, revision: evaluated.nextRevision };
  }

  async restoreEmpty(envelope: BackupEnvelope, _approval: RestoreApproval) {
    const isEmpty =
      this.state.libraryRevision === 0 &&
      this.state.concepts.length === 0 &&
      this.state.expressions.length === 0 &&
      this.state.assertions.length === 0 &&
      this.state.provenance.length === 0 &&
      this.state.documents.length === 0 &&
      this.state.runs.length === 0 &&
      this.state.batches.length === 0 &&
      this.state.audit.length === 0;

    if (!isEmpty) {
      return {
        status: 'conflict' as const,
        reason: 'Target library is not empty; atomic restore refuses to overwrite existing data.',
      };
    }

    this.state = parseLibrarySnapshot(structuredClone(envelope.snapshot));
    return { status: 'applied' as const, revision: this.state.libraryRevision };
  }
}

const PRIVACY_DRILL_MAPPING_SPEC: StagingMappingSpec = {
  mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
  termColumnIndex: 1,
  languageSource: { kind: 'column', columnIndex: 2, missingPolicy: 'error' },
  roleSource: { kind: 'column', columnIndex: 3, missingPolicy: 'unspecified' },
  groupKeyColumnIndex: 0,
  textTransform: 'trim-collapse-spaces',
};

describe('WP03 E8: Recovery, privacy, and atomic failure drill', () => {
  it('executes full synthetic stage -> preview -> backup -> approve -> reload -> export -> independent empty-context restore parity while enforcing strict privacy exclusion of skipped rows and unmapped columns', async () => {
    const primaryRepo = new DrillLibraryRepository();

    // 1. Seed initial baseline concept so pre-commit backup captures non-empty state
    const initialSnap = await listLibrary(primaryRepo);
    const seedProposal = await proposeChange(initialSnap, {
      schemaVersion: 1,
      batchId: '00000000-0000-4000-8000-000000000001',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: '00000000-0000-4000-8000-000000000002',
          concept: {
            id: '00000000-0000-4000-8000-000000000010',
            revision: 0,
            createdAt: '2026-11-27T10:00:00.000Z',
            updatedAt: '2026-11-27T10:00:00.000Z',
          },
          firstExpression: {
            id: '00000000-0000-4000-8000-000000000011',
            conceptId: '00000000-0000-4000-8000-000000000010',
            revision: 0,
            text: 'Baseline Synthetic Term',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: '2026-11-27T10:00:00.000Z',
            updatedAt: '2026-11-27T10:00:00.000Z',
          },
          provenance: {
            id: '00000000-0000-4000-8000-000000000012',
            expressionId: '00000000-0000-4000-8000-000000000011',
            kind: 'manual',
            createdAt: '2026-11-27T10:00:00.000Z',
            source: null,
          },
        },
      ],
    });
    const seedResult = await applyChange(primaryRepo, seedProposal, approveChange(seedProposal));
    expect(seedResult).toEqual({ status: 'applied', revision: 1 });

    // 2. Stage synthetic privacy & recovery drill fixture
    const rev1Snap = await listLibrary(primaryRepo);
    const rawStage = await stageApprovedBuiltInSyntheticFixture(
      'synth-privacy-recovery-drill-csv-v1',
      'skip'
    );

    const stagedTable = applyStagingMapping(
      rawStage,
      PRIVACY_DRILL_MAPPING_SPEC,
      rev1Snap.libraryRevision
    );
    expect(stagedTable.unmappedColumns).toEqual([
      {
        columnIndex: 4,
        rawName: 'raw_only_unmapped_secret',
        nonEmptyRowCount: 3,
      },
    ]);

    // 3. Decisions: row 1 create-new-concept (G-PRIV-1), row 2 link-staged-group (G-PRIV-1), row 3 SKIP
    const decisions: Record<string, StagedRowUserDecision> = buildSuggestedInitialDecisions(
      stagedTable,
      rev1Snap
    );
    decisions['row-3'] = { action: 'skip' };

    const review = evaluateStagingReview(stagedTable, rev1Snap, decisions);
    expect(review.canBuildProposal).toBe(true);
    expect(review.counts.createConceptCount).toBe(1);
    expect(review.counts.addExpressionToStagedGroupCount).toBe(1);
    expect(review.counts.skippedRowCount).toBe(1);

    // 4. Create pre-commit portable backup at Rev 1
    const preCommitBackup = await createBackup(rev1Snap);
    const preCommitBackupJson = serializeBackupFile(preCommitBackup);
    const validatedPreCommit = await parseBackupFileText(preCommitBackupJson);
    expect(validatedPreCommit.snapshot.libraryRevision).toBe(1);

    // 5. Build additive import proposal & commit atomically
    const planned = await buildAdditiveImportPlan(review, rev1Snap);
    // row-1 creates concept with firstExpression (1 createConcept op), row-2 links second expression (1 addExpression op) -> 2 ops total
    expect(planned.summary.totalOperations).toBe(2);
    expect(planned.summary.createConceptCount).toBe(1);
    expect(planned.summary.addExpressionCount).toBe(1);
    expect(planned.summary.skippedRowCount).toBe(1);
    expect(planned.summary.unmappedNonEmptyCellCount).toBe(3);

    const applyRes = await applyChange(
      primaryRepo,
      planned.proposal,
      approveChange(planned.proposal)
    );
    expect(applyRes).toEqual({ status: 'applied', revision: 2 });

    // Idempotent replay check: re-submitting identical proposal returns replay at rev 2
    const replayRes = await applyChange(
      primaryRepo,
      planned.proposal,
      approveChange(planned.proposal)
    );
    expect(replayRes).toEqual({ status: 'replay', revision: 2 });

    // 6. Reload & inspect persisted snapshot at Rev 2
    const rev2Snap = await listLibrary(primaryRepo);
    expect(rev2Snap.libraryRevision).toBe(2);
    expect(rev2Snap.concepts).toHaveLength(2);
    expect(rev2Snap.expressions).toHaveLength(3);
    expect(rev2Snap.assertions).toHaveLength(0); // Additive import creates zero assertions

    // 7. Strict privacy & retention check: skipped row and unmapped column sentinel MUST NOT exist anywhere
    const serializedRev2Snapshot = canonicalJson(rev2Snap);
    const csvExport = formatExport(
      selectExportRows(rev2Snap, null, {
        scope: 'library-expressions',
        sort: 'alphabetical',
        language: 'all',
        includeKnown: true,
      }),
      'csv'
    );
    const jsonExport = formatExport(
      selectExportRows(rev2Snap, null, {
        scope: 'library-expressions',
        sort: 'alphabetical',
        language: 'all',
        includeKnown: true,
      }),
      'json'
    );
    const postCommitBackup = await createBackup(rev2Snap);
    const postCommitBackupJson = serializeBackupFile(postCommitBackup);

    for (const artifact of [
      serializedRev2Snapshot,
      csvExport,
      jsonExport,
      postCommitBackupJson,
      preCommitBackupJson,
    ]) {
      expect(artifact).not.toContain('SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST');
      expect(artifact).not.toContain('SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST');
    }

    // Approved terms MUST be present in post-commit artifacts
    expect(serializedRev2Snapshot).toContain('SYNTH_APPROVED_IMPORT_TERM_E8');
    expect(serializedRev2Snapshot).toContain('sentetik onaylı terim E8');
    expect(csvExport).toContain('SYNTH_APPROVED_IMPORT_TERM_E8');

    // 8. Independent empty-context restore parity verification
    const independentEmptyRepo = new DrillLibraryRepository();
    const parsedPostBackup = await parseBackupFileText(postCommitBackupJson);
    const restoreRes = await restoreEmptyLibrary(
      independentEmptyRepo,
      parsedPostBackup,
      approveRestore(parsedPostBackup)
    );
    expect(restoreRes).toEqual({ status: 'applied', revision: 2 });

    const restoredSnap = await listLibrary(independentEmptyRepo);
    expect(canonicalJson(restoredSnap)).toBe(canonicalJson(rev2Snap));
    const restoredBackup = await createBackup(restoredSnap);
    expect(restoredBackup.digest).toBe(postCommitBackup.digest);

    // Quality inspector on restored snapshot passes referential integrity
    const qualityReport = inspectLibraryQuality(restoredSnap);
    expect(qualityReport.referentialIntegrity.status).toBe('valid');
  });

  it('enforces fail-closed rollback on mid-transaction abort, stale base revision, non-empty restore target, and tampered backup digest', async () => {
    const repo = new DrillLibraryRepository();
    const initialSnap = await listLibrary(repo);

    const rawStage = await stageApprovedBuiltInSyntheticFixture(
      'synth-privacy-recovery-drill-csv-v1',
      'skip'
    );
    const stagedTable = applyStagingMapping(
      rawStage,
      PRIVACY_DRILL_MAPPING_SPEC,
      initialSnap.libraryRevision
    );
    const decisions = buildSuggestedInitialDecisions(stagedTable, initialSnap);
    const review = evaluateStagingReview(stagedTable, initialSnap, decisions);
    const planned = await buildAdditiveImportPlan(review, initialSnap);

    // 1. Simulated mid-transaction abort leaves all stores at Rev 0 untouched
    repo.injectAbortOnNextCommit();
    await expect(
      applyChange(repo, planned.proposal, approveChange(planned.proposal))
    ).rejects.toThrow(/AbortError/);

    const afterAbortSnap = await listLibrary(repo);
    expect(afterAbortSnap.libraryRevision).toBe(0);
    expect(afterAbortSnap.concepts).toHaveLength(0);
    expect(afterAbortSnap.expressions).toHaveLength(0);
    expect(afterAbortSnap.batches).toHaveLength(0);
    expect(afterAbortSnap.audit).toHaveLength(0);

    // 2. Competing commit advances library to Rev 1; stale proposal at baseLibraryRevision 0 is rejected
    const competingProposal = await proposeChange(initialSnap, {
      schemaVersion: 1,
      batchId: '00000000-0000-4000-8000-000000000099',
      baseLibraryRevision: 0,
      ops: [
        {
          kind: 'createConcept',
          opId: '00000000-0000-4000-8000-000000000098',
          concept: {
            id: '00000000-0000-4000-8000-000000000097',
            revision: 0,
            createdAt: '2026-11-27T10:00:00.000Z',
            updatedAt: '2026-11-27T10:00:00.000Z',
          },
          firstExpression: {
            id: '00000000-0000-4000-8000-000000000096',
            conceptId: '00000000-0000-4000-8000-000000000097',
            revision: 0,
            text: 'Competing Concept Term',
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: '2026-11-27T10:00:00.000Z',
            updatedAt: '2026-11-27T10:00:00.000Z',
          },
          provenance: {
            id: '00000000-0000-4000-8000-000000000095',
            expressionId: '00000000-0000-4000-8000-000000000096',
            kind: 'manual',
            createdAt: '2026-11-27T10:00:00.000Z',
            source: null,
          },
        },
      ],
    });
    const competingRes = await applyChange(
      repo,
      competingProposal,
      approveChange(competingProposal)
    );
    expect(competingRes).toEqual({ status: 'applied', revision: 1 });

    const staleRes = await applyChange(
      repo,
      planned.proposal,
      approveChange(planned.proposal)
    );
    expect(staleRes.status).toBe('stale');

    // 3. Non-empty restore refusal
    const backup = await createBackup(await listLibrary(repo));
    const nonEmptyRestoreRes = await restoreEmptyLibrary(
      repo,
      backup,
      approveRestore(backup)
    );
    expect(nonEmptyRestoreRes.status).toBe('conflict');

    // 4. Tampered backup digest refusal
    const tamperedJson = serializeBackupFile({
      ...backup,
      digest: '0'.repeat(64),
    });
    await expect(parseBackupFileText(tamperedJson)).rejects.toThrow(/digest/i);
  });
});
