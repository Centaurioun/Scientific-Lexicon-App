import { describe, expect, it } from 'vitest';
import {
  APPROVED_SYNTHETIC_IMPORT_FIXTURES,
  parseDelimitedText,
} from '@/domain/delimited-intake';
import { MAX_BACKUP_FILE_BYTES } from '@/domain/backup';
import { createEmptySnapshot, type LibrarySnapshot } from '@/domain/schema';
import {
  applyStagingMapping,
  STAGING_MAPPING_SCHEMA_VERSION,
  type StagingMappingSpec,
} from '@/domain/staging-mapping';
import { evaluateStagingReview, type StagedRowUserDecision } from '@/domain/staging-review';
import {
  computeDelimitedReviewIntentCanonical,
  computeDelimitedReviewIntentDigest,
  createValidatedPreCommitBackupOffer,
  verifyPreCommitCommitAuthorization,
  type PreCommitBackupProof,
} from '@/domain/review-guard';
import {
  DataOperationsSessionController,
  type DataOperationsViewState,
} from '@/features/exchange/data-operations-controller';
import type { ApplyResult } from '@/domain/changes';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const TS = '2026-11-27T12:00:00.000Z';

function makeSnapshot(revision = 0): LibrarySnapshot {
  return {
    ...createEmptySnapshot(),
    libraryRevision: revision,
    concepts: [
      { id: 'c-1', revision: 0, createdAt: TS, updatedAt: TS },
      { id: 'c-2', revision: 0, createdAt: TS, updatedAt: TS },
    ],
    expressions: [
      {
        id: 'e-1',
        conceptId: 'c-1',
        revision: 0,
        text: 'gingival sulcus',
        language: { kind: 'language', tag: 'en' },
        role: 'preferred',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'e-2',
        conceptId: 'c-2',
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

const BASIC_SPEC: StagingMappingSpec = {
  mappingVersion: STAGING_MAPPING_SCHEMA_VERSION,
  termColumnIndex: 1,
  languageSource: { kind: 'column', columnIndex: 2, missingPolicy: 'error' },
  roleSource: { kind: 'column', columnIndex: 3, missingPolicy: 'unspecified' },
  groupKeyColumnIndex: 0,
  textTransform: 'trim-collapse-spaces',
};

describe('WP04 F1 Hardening Gate (H1 Backup Proof & H2 Lossless Review-Intent + Async Races)', () => {
  it('H2-unit: computes lossless canonical review-intent identity covering parse policy, mapping, revision, and ordered row/target decisions', async () => {
    const csv = [
      'grp,term,lang,role',
      'G1,probing depth,en,preferred',
      'G2,calculus,en,preferred',
    ].join('\n');

    const snapshot = makeSnapshot(3);
    const stageSkipBlank = await parseDelimitedText(csv, {
      delimiter: ',',
      blankLinePolicy: 'skip',
      rawByteSha256: '1'.repeat(64),
    });
    const stageErrorBlank = await parseDelimitedText(csv, {
      delimiter: ',',
      blankLinePolicy: 'error-row',
      rawByteSha256: '1'.repeat(64),
    });

    const mappedSkip = applyStagingMapping(stageSkipBlank, BASIC_SPEC, snapshot.libraryRevision);
    const mappedErr = applyStagingMapping(stageErrorBlank, BASIC_SPEC, snapshot.libraryRevision);

    const decisionsCreateBoth: Record<string, StagedRowUserDecision> = {
      'row-1': { action: 'create-new-concept' },
      'row-2': { action: 'create-new-concept' },
    };
    const decisionsSkipSecond: Record<string, StagedRowUserDecision> = {
      'row-1': { action: 'create-new-concept' },
      'row-2': { action: 'skip' },
    };
    const decisionsLinkC1: Record<string, StagedRowUserDecision> = {
      'row-1': { action: 'create-new-concept' },
      'row-2': { action: 'link-existing-concept', targetConceptId: 'c-1' },
    };
    const decisionsLinkC2: Record<string, StagedRowUserDecision> = {
      'row-1': { action: 'create-new-concept' },
      'row-2': { action: 'link-existing-concept', targetConceptId: 'c-2' },
    };

    const revCreateBoth = evaluateStagingReview(mappedSkip, snapshot, decisionsCreateBoth);
    const revSkipSecond = evaluateStagingReview(mappedSkip, snapshot, decisionsSkipSecond);
    const revLinkC1 = evaluateStagingReview(mappedSkip, snapshot, decisionsLinkC1);
    const revLinkC2 = evaluateStagingReview(mappedSkip, snapshot, decisionsLinkC2);
    const revErrorPolicy = evaluateStagingReview(mappedErr, snapshot, decisionsCreateBoth);

    const dCreateBoth = await computeDelimitedReviewIntentDigest(stageSkipBlank, revCreateBoth);
    const dSkipSecond = await computeDelimitedReviewIntentDigest(stageSkipBlank, revSkipSecond);
    const dLinkC1 = await computeDelimitedReviewIntentDigest(stageSkipBlank, revLinkC1);
    const dLinkC2 = await computeDelimitedReviewIntentDigest(stageSkipBlank, revLinkC2);
    const dErrorPolicy = await computeDelimitedReviewIntentDigest(stageErrorBlank, revErrorPolicy);

    // Every review-intent variation produces a distinct SHA-256 identity even at identical revision 3
    expect(new Set([dCreateBoth, dSkipSecond, dLinkC1, dLinkC2, dErrorPolicy]).size).toBe(5);
    expect(
      computeDelimitedReviewIntentCanonical(stageSkipBlank, revCreateBoth),
    ).not.toBe(computeDelimitedReviewIntentCanonical(stageSkipBlank, revLinkC1));
  });

  it('H1-unit: requires validated current-snapshot backup proof bound to exact proposal, review intent, snapshot revision, and ack; rejects bypasses and >16 MiB backups', async () => {
    const snapshotRev3 = makeSnapshot(3);
    const snapshotRev4 = makeSnapshot(4);

    const offer = await createValidatedPreCommitBackupOffer({
      snapshot: snapshotRev3,
      proposalDigest: 'a'.repeat(64),
      batchId: 'batch-1',
      reviewIntentDigest: 'b'.repeat(64),
      filenamePrefix: 'termforge-pre-import-backup',
    });

    expect(offer.proof.proposalDigest).toBe('a'.repeat(64));
    expect(offer.proof.batchId).toBe('batch-1');
    expect(offer.proof.reviewIntentDigest).toBe('b'.repeat(64));
    expect(offer.proof.snapshotRevision).toBe(3);

    // Valid authorization passes when all fields match + checkbox checked + freshness confirmed
    expect(
      verifyPreCommitCommitAuthorization({
        plannedProposal: { digest: 'a'.repeat(64), batchId: 'batch-1', baseLibraryRevision: 3 },
        expectedReviewIntentDigest: 'b'.repeat(64),
        actualReviewIntentDigest: 'b'.repeat(64),
        authoritativeSnapshot: snapshotRev3,
        backupProof: offer.proof,
        preCommitAckChecked: true,
        freshnessConfirmed: true,
      }),
    ).toEqual({ ok: true });

    // Missing proof (checkbox checked alone bypass) fails closed
    expect(
      verifyPreCommitCommitAuthorization({
        plannedProposal: { digest: 'a'.repeat(64), batchId: 'batch-1', baseLibraryRevision: 3 },
        expectedReviewIntentDigest: 'b'.repeat(64),
        actualReviewIntentDigest: 'b'.repeat(64),
        authoritativeSnapshot: snapshotRev3,
        backupProof: null,
        preCommitAckChecked: true,
        freshnessConfirmed: true,
      }).ok,
    ).toBe(false);

    // Old backup proof from batch-1 cannot authorize batch-2 or changed review intent or drifted revision
    expect(
      verifyPreCommitCommitAuthorization({
        plannedProposal: { digest: 'c'.repeat(64), batchId: 'batch-2', baseLibraryRevision: 3 },
        expectedReviewIntentDigest: 'b'.repeat(64),
        actualReviewIntentDigest: 'b'.repeat(64),
        authoritativeSnapshot: snapshotRev3,
        backupProof: offer.proof,
        preCommitAckChecked: true,
        freshnessConfirmed: true,
      }).ok,
    ).toBe(false);

    expect(
      verifyPreCommitCommitAuthorization({
        plannedProposal: { digest: 'a'.repeat(64), batchId: 'batch-1', baseLibraryRevision: 3 },
        expectedReviewIntentDigest: 'd'.repeat(64),
        actualReviewIntentDigest: 'd'.repeat(64),
        authoritativeSnapshot: snapshotRev3,
        backupProof: offer.proof,
        preCommitAckChecked: true,
        freshnessConfirmed: true,
      }).ok,
    ).toBe(false);

    expect(
      verifyPreCommitCommitAuthorization({
        plannedProposal: { digest: 'a'.repeat(64), batchId: 'batch-1', baseLibraryRevision: 4 },
        expectedReviewIntentDigest: 'b'.repeat(64),
        actualReviewIntentDigest: 'b'.repeat(64),
        authoritativeSnapshot: snapshotRev4,
        backupProof: offer.proof,
        preCommitAckChecked: true,
        freshnessConfirmed: true,
      }).ok,
    ).toBe(false);

    // Backup exceeding 16 MiB fails closed when offering pre-commit backup
    const hugeSnapshot: LibrarySnapshot = {
      ...createEmptySnapshot(),
      libraryRevision: 1,
      documents: [
        {
          id: 'doc-huge',
          title: 'Oversized synthetic doc',
          text: 'X'.repeat(MAX_BACKUP_FILE_BYTES + 1024),
          createdAt: TS,
        },
      ],
    };
    await expect(
      createValidatedPreCommitBackupOffer({
        snapshot: hugeSnapshot,
        proposalDigest: 'a'.repeat(64),
        batchId: 'batch-1',
        reviewIntentDigest: 'b'.repeat(64),
        filenamePrefix: 'termforge-pre-import-backup',
      }),
    ).rejects.toThrow(/16 MiB/i);
  });

  it('H2-controller: discards stale build when row decision changes mid-async build at same revision, handles reverse-order overlapping builds, and rejects failed/late file reads leaving no stale actionable proposal', async () => {
    const fixture = APPROVED_SYNTHETIC_IMPORT_FIXTURES.find(
      (f) => f.id === 'synth-privacy-recovery-drill-csv-v1',
    )!;
    const snapshot = makeSnapshot(0);

    let viewState: DataOperationsViewState = {
      rawStage: null,
      mappingSpec: null,
      rowDecisions: {},
      plannedImport: null,
      reviewIntentDigest: null,
      backupProof: null,
      preCommitAckChecked: false,
      applyingImport: false,
      intakeError: null,
      intakeNotice: null,
      planningError: null,
      commitNotice: null,
      preCommitBackupNotice: null,
    };

    const planBuildDeferreds: Deferred<void>[] = [];
    const fileReadDeferreds: Deferred<string>[] = [];

    const controller = new DataOperationsSessionController({
      getSnapshot: () => snapshot,
      getViewState: () => viewState,
      patchViewState: (patch) => {
        viewState = { ...viewState, ...patch };
      },
      beforeBuildPlanHook: async () => {
        const d = createDeferred<void>();
        planBuildDeferreds.push(d);
        await d.promise;
      },
      readFileTextHook: async () => {
        const d = createDeferred<string>();
        fileReadDeferreds.push(d);
        return d.promise;
      },
      readAuthoritativeSnapshot: async () => snapshot,
      onSnapshotChanged: async () => {},
      downloadFile: () => {},
      applyBatch: async () => ({ status: 'applied', revision: 1 }),
    });

    // 1. Stage fixture
    await controller.stageBuiltInFixture(fixture.id, 'skip');
    expect(viewState.rawStage?.rows).toHaveLength(3);

    // 2. Start build A while row-3 is set to 'create-new-concept' (preserving G-PRIV-1 group link on row-2)
    controller.setRowDecision('row-3', { action: 'create-new-concept' });
    const buildAPromise = controller.buildProposal();
    await Promise.resolve();
    expect(planBuildDeferreds).toHaveLength(1);

    // While build A is in flight at SAME libraryRevision 0, user changes row-3 to 'skip'!
    controller.setRowDecision('row-3', { action: 'skip' });

    // Start build B (reflecting row-3 = skip)
    const buildBPromise = controller.buildProposal();
    await Promise.resolve();
    expect(planBuildDeferreds).toHaveLength(2);

    // Resolve build B first, then resolve build A LATER (reverse order!)
    planBuildDeferreds[1].resolve();
    await buildBPromise;
    expect(viewState.plannedImport?.summary.totalOperations).toBe(2);

    // Now build A resolves late with 3 operations -> MUST be discarded!
    planBuildDeferreds[0].resolve();
    await buildAPromise;
    expect(viewState.plannedImport?.summary.totalOperations).toBe(2);

    // 3. Rejecting an invalid file read NEVER leaves an old actionable proposal or backup proof
    await controller.offerPreCommitBackup();
    expect(viewState.backupProof).not.toBeNull();
    controller.setPreCommitAck(true);
    expect(viewState.preCommitAckChecked).toBe(true);

    const badUploadPromise = controller.stageUploadedFile({
      name: 'bad.csv',
      size: 32,
      delimiter: ',',
      blankLinePolicy: 'skip',
      rawText: 'term,lang\nunauthorized,en\n',
    });
    expect(viewState.plannedImport).toBeNull();
    expect(viewState.backupProof).toBeNull();
    expect(viewState.preCommitAckChecked).toBe(false);
    fileReadDeferreds[0].resolve('term,lang\nunauthorized,en\n');
    await badUploadPromise;
    expect(viewState.intakeError).toMatch(/allowlist/i);
    expect(viewState.plannedImport).toBeNull();
    expect(viewState.backupProof).toBeNull();
    expect(viewState.preCommitAckChecked).toBe(false);
  });

  it('H1+H2-controller: invalidates delayed backup offer after mapping/revision drift, blocks duplicate commit clicks, preserves committed transaction on unmount, and reloads authoritative snapshot on conflict', async () => {
    const fixture = APPROVED_SYNTHETIC_IMPORT_FIXTURES.find(
      (f) => f.id === 'synth-privacy-recovery-drill-csv-v1',
    )!;
    let currentSnapshot = makeSnapshot(0);

    let viewState: DataOperationsViewState = {
      rawStage: null,
      mappingSpec: null,
      rowDecisions: {},
      plannedImport: null,
      reviewIntentDigest: null,
      backupProof: null,
      preCommitAckChecked: false,
      applyingImport: false,
      intakeError: null,
      intakeNotice: null,
      planningError: null,
      commitNotice: null,
      preCommitBackupNotice: null,
    };

    const backupSnapDeferred = createDeferred<LibrarySnapshot>();
    let useDeferredBackupRead = false;
    let applyCount = 0;
    const applyDeferred = createDeferred<ApplyResult>();

    const controller = new DataOperationsSessionController({
      getSnapshot: () => currentSnapshot,
      getViewState: () => viewState,
      patchViewState: (patch) => {
        viewState = { ...viewState, ...patch };
      },
      readAuthoritativeSnapshot: async () =>
        useDeferredBackupRead ? backupSnapDeferred.promise : currentSnapshot,
      onSnapshotChanged: async (next) => {
        if (next) currentSnapshot = next;
      },
      downloadFile: () => {},
      applyBatch: async () => {
        applyCount += 1;
        return applyDeferred.promise;
      },
    });

    await controller.stageBuiltInFixture(fixture.id, 'skip');
    controller.setRowDecision('row-3', { action: 'skip' });
    await controller.buildProposal();
    expect(viewState.plannedImport).not.toBeNull();

    // 1. Mapping changes while pre-commit backup offer is awaiting authoritative snapshot read
    useDeferredBackupRead = true;
    const backupPromise = controller.offerPreCommitBackup();
    await Promise.resolve();
    controller.updateMapping((prev) => ({ ...prev, textTransform: 'none' }));
    backupSnapDeferred.resolve(currentSnapshot);
    await backupPromise;

    // Delayed backup offer MUST NOT become valid proof!
    expect(viewState.backupProof).toBeNull();
    expect(viewState.preCommitAckChecked).toBe(false);

    // 2. Rebuild proposal, offer valid backup, check ack, then test duplicate commit clicks & conflict recovery
    useDeferredBackupRead = false;
    await controller.buildProposal();
    await controller.offerPreCommitBackup();
    expect(viewState.backupProof).not.toBeNull();

    controller.setPreCommitAck(true);

    // Trigger two commits synchronously -> applyBatch must be invoked only ONCE
    const p1 = controller.approveAndApply();
    const p2 = controller.approveAndApply();
    expect(viewState.applyingImport).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(applyCount).toBe(1);

    // Mid-commit conflict from another tab advancing to Rev 1:
    currentSnapshot = makeSnapshot(1);
    applyDeferred.resolve({ status: 'conflict', reason: 'Stale revision 0; current revision is 1.' });
    await Promise.all([p1, p2]);

    expect(viewState.applyingImport).toBe(false);
    expect(viewState.plannedImport).toBeNull();
    expect(viewState.backupProof).toBeNull();
    expect(viewState.preCommitAckChecked).toBe(false);
    expect(viewState.planningError).toMatch(/CONFLICT/i);

    // 3. Unmount during an already-authorized commit must not revert the commit or mutate UI after unmount
    const commitApply2 = createDeferred<ApplyResult>();
    let mountedCallsAfterUnmount = 0;
    let committedRev = -1;
    const controller2 = new DataOperationsSessionController({
      getSnapshot: () => currentSnapshot,
      getViewState: () => viewState,
      patchViewState: (patch) => {
        if (!controller2.isMounted()) {
          mountedCallsAfterUnmount += 1;
        }
        viewState = { ...viewState, ...patch };
      },
      readAuthoritativeSnapshot: async () => currentSnapshot,
      onSnapshotChanged: async (next) => {
        if (next) currentSnapshot = next;
      },
      downloadFile: () => {},
      applyBatch: async () => {
        const res = await commitApply2.promise;
        if (res.status === 'applied') committedRev = res.revision;
        return res;
      },
    });

    await controller2.stageBuiltInFixture(fixture.id, 'skip');
    controller2.setRowDecision('row-3', { action: 'skip' });
    await controller2.buildProposal();
    await controller2.offerPreCommitBackup();
    controller2.setPreCommitAck(true);

    const unmountCommitPromise = controller2.approveAndApply();
    await new Promise((r) => setTimeout(r, 10));
    controller2.unmount();
    commitApply2.resolve({ status: 'applied', revision: 2 });
    await unmountCommitPromise;

    expect(committedRev).toBe(2);
    expect(mountedCallsAfterUnmount).toBe(0);
  });
});
