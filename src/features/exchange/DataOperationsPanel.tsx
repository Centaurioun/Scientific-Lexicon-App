'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBrowserLibraryRepository } from '@/adapters/storage/dexie-library';
import {
  readSyntheticDelimitedFile,
  stageApprovedBuiltInSyntheticFixture,
} from '@/application/delimited-file';
import { createBackup, serializeBackupFile } from '@/application/exchange';
import {
  buildAdditiveImportPlan,
  PROVENANCE_LIMITATION_DISCLOSURE,
  type PlannedAdditiveImport,
} from '@/application/import-planner';
import { applyChange, approveChange, listLibrary } from '@/application/library';
import {
  APPROVED_SYNTHETIC_IMPORT_FIXTURES,
  DELIMITED_INTAKE_LIMITS,
  type BlankLinePolicy,
  type DelimitedDelimiter,
  type RawDelimitedStage,
} from '@/domain/delimited-intake';
import {
  EXPRESSION_ROLES,
  formatLanguageUse,
  type ExpressionRole,
  type LanguageUse,
  type LibrarySnapshot,
} from '@/domain/schema';
import {
  applyStagingMapping,
  computeStagingSessionFingerprint,
  STAGING_MAPPING_SCHEMA_VERSION,
  type MissingLanguagePolicy,
  type MissingRolePolicy,
  type StagingMappingSpec,
  type StagingTextTransform,
} from '@/domain/staging-mapping';
import {
  buildSuggestedInitialDecisions,
  evaluateStagingReview,
  type StagedRowUserDecision,
} from '@/domain/staging-review';
import { RevisionReconciliationController } from '@/features/extraction/concurrency-controller';

const STAGING_PAGE_SIZE = 50;

interface DataOperationsPanelProps {
  snapshot: LibrarySnapshot | null;
  disabled: boolean;
  onSnapshotChanged: (nextSnapshot?: LibrarySnapshot) => Promise<void>;
}

function triggerUtf8FileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createDefaultMappingForStage(stage: RawDelimitedStage): StagingMappingSpec {
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

function encodeLanguageUseOption(lang: LanguageUse): string {
  if (lang.kind === 'shared') return 'shared';
  if (lang.kind === 'undetermined') return 'undetermined';
  return lang.tag;
}

function decodeLanguageUseOption(value: string): LanguageUse {
  if (value === 'shared') return { kind: 'shared' };
  if (value === 'undetermined') return { kind: 'undetermined' };
  if (value === 'en' || value === 'en-US' || value === 'en-GB' || value === 'tr') {
    return { kind: 'language', tag: value };
  }
  return { kind: 'undetermined' };
}

export function DataOperationsPanel({
  snapshot,
  disabled,
  onSnapshotChanged,
}: DataOperationsPanelProps) {
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>(
    APPROVED_SYNTHETIC_IMPORT_FIXTURES[0].id
  );
  const [explicitDelimiter, setExplicitDelimiter] = useState<DelimitedDelimiter>(',');
  const [blankLinePolicy, setBlankLinePolicy] = useState<BlankLinePolicy>('skip');

  const [rawStage, setRawStage] = useState<RawDelimitedStage | null>(null);
  const [mappingSpec, setMappingSpec] = useState<StagingMappingSpec | null>(null);
  const [rowDecisions, setRowDecisions] = useState<Record<string, StagedRowUserDecision>>({});

  const [searchFilter, setSearchFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeNotice, setIntakeNotice] = useState<string | null>(null);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [commitNotice, setCommitNotice] = useState<string | null>(null);

  const [plannedImport, setPlannedImport] = useState<PlannedAdditiveImport | null>(null);
  const [preCommitBackupNotice, setPreCommitBackupNotice] = useState<string | null>(null);
  const [preCommitAckChecked, setPreCommitAckChecked] = useState(false);
  const [applyingImport, setApplyingImport] = useState(false);
  const [freshnessConfirmed, setFreshnessConfirmed] = useState(true);

  const reconcilerRef = useRef<RevisionReconciliationController>(
    new RevisionReconciliationController()
  );

  const reloadFreshSnapshot = useCallback(async (): Promise<LibrarySnapshot | null> => {
    try {
      const repo = getBrowserLibraryRepository();
      const fresh = await listLibrary(repo);
      await onSnapshotChanged(fresh);
      return fresh;
    } catch {
      return null;
    }
  }, [onSnapshotChanged]);

  useEffect(() => {
    const controller = reconcilerRef.current;
    const repo = getBrowserLibraryRepository();
    const unsub = repo.subscribeRevision((notifiedRev) => {
      const decision = controller.observeRevisionNotification(notifiedRev);
      if (decision.action === 'handle-external-immediately') {
        void controller.confirmFreshnessWithSnapshot(reloadFreshSnapshot).then(() => {
          setFreshnessConfirmed(controller.isFreshnessConfirmed());
        });
      }
    });

    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      return () => {
        unsub();
      };
    }

    const channel = new BroadcastChannel('termforge-library-sync');
    channel.onmessage = (event: MessageEvent<{ revision?: number }>) => {
      const notifiedRev = event.data?.revision ?? 0;
      const decision = controller.observeRevisionNotification(notifiedRev);
      if (decision.action === 'handle-external-immediately') {
        void controller.confirmFreshnessWithSnapshot(reloadFreshSnapshot).then(() => {
          setFreshnessConfirmed(controller.isFreshnessConfirmed());
        });
      }
    };

    return () => {
      unsub();
      channel.close();
    };
  }, [reloadFreshSnapshot]);

  const stagedTable = useMemo(() => {
    if (!rawStage || !mappingSpec || !snapshot) return null;
    try {
      return applyStagingMapping(rawStage, mappingSpec, snapshot.libraryRevision);
    } catch {
      return null;
    }
  }, [rawStage, mappingSpec, snapshot]);

  const sessionFingerprint = useMemo(() => {
    if (!stagedTable) return null;
    return computeStagingSessionFingerprint(stagedTable);
  }, [stagedTable]);

  const reviewEvaluation = useMemo(() => {
    if (!stagedTable || !snapshot) return null;
    return evaluateStagingReview(stagedTable, snapshot, rowDecisions);
  }, [stagedTable, snapshot, rowDecisions]);

  // Invalidate any active proposal if session fingerprint or library revision drifts
  const isProposalCurrent =
    plannedImport !== null &&
    sessionFingerprint !== null &&
    snapshot !== null &&
    plannedImport.sessionFingerprint === sessionFingerprint &&
    plannedImport.proposal.payload.baseLibraryRevision === snapshot.libraryRevision;

  const initializeStageAndMapping = (stage: RawDelimitedStage) => {
    const defaultMapping = createDefaultMappingForStage(stage);
    setRawStage(stage);
    setMappingSpec(defaultMapping);
    setPlannedImport(null);
    setPreCommitBackupNotice(null);
    setPreCommitAckChecked(false);
    setPlanningError(null);
    setCommitNotice(null);
    setCurrentPage(1);

    if (snapshot) {
      const mapped = applyStagingMapping(stage, defaultMapping, snapshot.libraryRevision);
      const suggested = buildSuggestedInitialDecisions(mapped, snapshot);
      setRowDecisions(suggested);
    } else {
      setRowDecisions({});
    }
  };

  const handleStageBuiltInFixture = async () => {
    setIntakeError(null);
    setIntakeNotice(null);
    setCommitNotice(null);
    try {
      const fixture = APPROVED_SYNTHETIC_IMPORT_FIXTURES.find((f) => f.id === selectedFixtureId);
      if (fixture) {
        setExplicitDelimiter(fixture.delimiter);
      }
      const stage = await stageApprovedBuiltInSyntheticFixture(
        selectedFixtureId,
        blankLinePolicy
      );
      initializeStageAndMapping(stage);
      setIntakeNotice(
        `Staged approved synthetic fixture "${stage.sourceName}" (${stage.rows.length} rows, SHA-256 ${stage.rawByteSha256.slice(0, 16)}…).`
      );
    } catch (error) {
      setIntakeError(
        error instanceof Error ? error.message : 'Unable to stage built-in synthetic fixture.'
      );
    }
  };

  const handleDownloadSelectedFixture = () => {
    const fixture = APPROVED_SYNTHETIC_IMPORT_FIXTURES.find((f) => f.id === selectedFixtureId);
    if (!fixture) return;
    const mime = fixture.delimiter === '\t' ? 'text/tab-separated-values' : 'text/csv';
    triggerUtf8FileDownload(fixture.filename, fixture.rawText, mime);
    setIntakeNotice(
      `Synthetic fixture "${fixture.filename}" offered for download (SHA-256 ${fixture.rawByteSha256.slice(0, 16)}…).`
    );
  };

  const handleUploadSyntheticFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIntakeError(null);
    setIntakeNotice(null);
    setCommitNotice(null);

    try {
      const stage = await readSyntheticDelimitedFile(file, {
        delimiter: explicitDelimiter,
        blankLinePolicy,
      });
      initializeStageAndMapping(stage);
      setIntakeNotice(
        `Verified and staged uploaded synthetic file "${stage.sourceName}" (${stage.rows.length} rows, SHA-256 ${stage.rawByteSha256.slice(0, 16)}…).`
      );
    } catch (error) {
      setIntakeError(
        error instanceof Error
          ? error.message
          : 'Uploaded file failed synthetic allowlist or delimited parser validation.'
      );
    }
  };

  const handleUpdateMapping = (updater: (prev: StagingMappingSpec) => StagingMappingSpec) => {
    setMappingSpec((prev) => {
      if (!prev) return prev;
      return updater(prev);
    });
    setPlannedImport(null);
    setPreCommitAckChecked(false);
    setPlanningError(null);
  };

  const handleSetRowDecision = (rowId: string, decision: StagedRowUserDecision) => {
    setRowDecisions((prev) => ({
      ...prev,
      [rowId]: decision,
    }));
    setPlannedImport(null);
    setPreCommitAckChecked(false);
    setPlanningError(null);
  };

  const handleApplySuggestedDecisions = () => {
    if (!stagedTable || !snapshot) return;
    const suggested = buildSuggestedInitialDecisions(stagedTable, snapshot);
    setRowDecisions(suggested);
    setPlannedImport(null);
    setPreCommitAckChecked(false);
    setPlanningError(null);
  };

  const handleSkipUnresolvedAndInvalid = () => {
    if (!reviewEvaluation) return;
    const updated: Record<string, StagedRowUserDecision> = { ...rowDecisions };
    for (const r of reviewEvaluation.rows) {
      if (!r.row.isValidForPlanning || r.decision.action === 'unresolved' || r.hasBlockingConflict) {
        updated[r.row.rowId] = { action: 'skip' };
      }
    }
    setRowDecisions(updated);
    setPlannedImport(null);
    setPreCommitAckChecked(false);
    setPlanningError(null);
  };

  const handleResetDecisions = () => {
    if (!stagedTable) return;
    const reset: Record<string, StagedRowUserDecision> = {};
    for (const r of stagedTable.rows) {
      reset[r.rowId] = { action: 'unresolved' };
    }
    setRowDecisions(reset);
    setPlannedImport(null);
    setPreCommitAckChecked(false);
    setPlanningError(null);
  };

  const handleBuildProposal = async () => {
    if (!reviewEvaluation || !snapshot) return;
    setPlanningError(null);
    setCommitNotice(null);

    if (reconcilerRef.current && !reconcilerRef.current.isFreshnessConfirmed()) {
      setPlanningError(
        'Library revision freshness is unconfirmed after concurrent background updates. Click "Confirm latest revision" before building a proposal.'
      );
      return;
    }

    try {
      const planned = await buildAdditiveImportPlan(reviewEvaluation, snapshot);
      setPlannedImport(planned);
      setPreCommitAckChecked(false);
    } catch (error) {
      setPlannedImport(null);
      setPlanningError(
        error instanceof Error ? error.message : 'Unable to build additive import proposal.'
      );
    }
  };

  const handleOfferPreCommitBackup = async () => {
    if (!snapshot) return;
    setPlanningError(null);
    try {
      const envelope = await createBackup(snapshot);
      const serialized = serializeBackupFile(envelope);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `termforge-pre-import-backup-rev${snapshot.libraryRevision}-${stamp}.json`;
      triggerUtf8FileDownload(filename, serialized, 'application/json');
      setPreCommitBackupNotice(
        `Pre-commit backup "${filename}" (Rev ${snapshot.libraryRevision}, SHA-256 ${envelope.digest.slice(0, 16)}…) offered for browser download. Note: browser download initiation cannot verify that the file was saved to external disk.`
      );
    } catch (error) {
      setPlanningError(
        error instanceof Error ? error.message : 'Unable to generate pre-commit portable backup.'
      );
    }
  };

  const handleApproveAndApplyImport = async () => {
    if (!plannedImport || !isProposalCurrent || !preCommitAckChecked || applyingImport) return;

    if (reconcilerRef.current && !reconcilerRef.current.isFreshnessConfirmed()) {
      setPlanningError(
        'Library revision freshness is unconfirmed. Reload and confirm the latest revision before committing.'
      );
      return;
    }

    setApplyingImport(true);
    setPlanningError(null);
    setCommitNotice(null);

    try {
      const repo = getBrowserLibraryRepository();
      const approval = approveChange(plannedImport.proposal);
      const result = await applyChange(repo, plannedImport.proposal, approval);

      if (result.status === 'applied' || result.status === 'replay') {
        const appliedOpsCount = plannedImport.summary.totalOperations;
        setPlannedImport(null);
        setPreCommitAckChecked(false);
        setRawStage(null);
        setMappingSpec(null);
        setRowDecisions({});

        await onSnapshotChanged();

        if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
          const ch = new BroadcastChannel('termforge-library-sync');
          ch.postMessage({ revision: result.revision });
          ch.close();
        }

        setCommitNotice(
          result.status === 'applied'
            ? `Committed reviewed additive import batch (${appliedOpsCount} operations) atomically at library revision ${result.revision}.`
            : `Import batch already recorded at library revision ${result.revision} (idempotent replay).`
        );
      } else {
        setPlannedImport(null);
        setPreCommitAckChecked(false);
        await onSnapshotChanged();
        setPlanningError(
          `Import batch rejected (${result.status.toUpperCase()}): ${result.reason}`
        );
      }
    } catch (error) {
      setPlannedImport(null);
      setPreCommitAckChecked(false);
      await onSnapshotChanged();
      setPlanningError(
        error instanceof Error ? error.message : 'Atomic import batch commit failed.'
      );
    } finally {
      setApplyingImport(false);
    }
  };

  const handleConfirmFreshnessManual = async () => {
    await reconcilerRef.current.confirmFreshnessWithSnapshot(reloadFreshSnapshot);
    setFreshnessConfirmed(reconcilerRef.current.isFreshnessConfirmed());
  };

  const filteredReviewedRows = useMemo(() => {
    if (!reviewEvaluation) return [];
    const q = searchFilter.trim().toLowerCase();
    if (!q) return reviewEvaluation.rows;
    return reviewEvaluation.rows.filter(
      (item) =>
        item.row.rawTermText.toLowerCase().includes(q) ||
        item.row.stagedTermText.toLowerCase().includes(q) ||
        (item.row.groupKey ?? '').toLowerCase().includes(q) ||
        item.classification.toLowerCase().includes(q) ||
        item.conflictFlags.some((f) => f.toLowerCase().includes(q))
    );
  }, [reviewEvaluation, searchFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredReviewedRows.length / STAGING_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const pageRows = filteredReviewedRows.slice(
    (safePage - 1) * STAGING_PAGE_SIZE,
    safePage * STAGING_PAGE_SIZE
  );

  return (
    <section
      className="panel stack-md"
      aria-labelledby="data-operations-heading"
      data-testid="data-operations-panel"
    >
      <div className="row-inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <p className="status-label">REVIEWED SYNTHETIC DATA OPERATIONS (WP03 E2–E6)</p>
          <h2 id="data-operations-heading">Bounded CSV/TSV Staging, Mapping &amp; Additive Import</h2>
          <p className="muted small">
            Session-only delimited staging with positional column mapping, explicit before/after
            transformation preview, indexed homonym &amp; duplicate detection, and atomic{' '}
            <span className="mono">&lt;= {DELIMITED_INTAKE_LIMITS.maxAtomicChangeOperations}</span>
            -operation additive change commits via the master write gateway.
          </p>
        </div>
        <span className="tag tag-amber" data-testid="g4-synthetic-gate-badge">
          G4 NOT READY · Synthetic Allowlist Enforced
        </span>
      </div>

      {/* Prominent G4 Synthetic-Only Gate Banner */}
      <div className="banner banner-warning" data-testid="wp03-synthetic-only-banner">
        <strong>Synthetic-only data boundary (G4 NOT READY):</strong> Only SHA-256 allowlisted
        synthetic CSV/TSV fixtures (maximum 2 MiB, {DELIMITED_INTAKE_LIMITS.maxDataRows} rows,{' '}
        {DELIMITED_INTAKE_LIMITS.maxColumns} columns) may be staged or imported. Arbitrary or real
        user spreadsheets are rejected fail-closed before staging. Staged tables, unmapped columns,
        and skipped rows remain strictly in memory and are never persisted to IndexedDB, Web
        Storage, logs, or network requests.
      </div>

      {!freshnessConfirmed && (
        <div className="banner banner-error" role="alert" data-testid="freshness-unconfirmed-banner">
          <div className="row-inline" style={{ justifyContent: 'space-between' }}>
            <span>
              <strong>Revision freshness unconfirmed:</strong> Concurrent library updates exceeded
              automatic drain bounds. Proposal creation and approval are disabled fail-closed until
              you confirm the latest library snapshot.
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void handleConfirmFreshnessManual()}
            >
              Confirm latest revision
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Synthetic Fixture / File Intake */}
      <div className="setup-card stack-sm" style={{ padding: '1rem' }}>
        <h3>1. Select or upload SHA-256 verified synthetic CSV/TSV fixture</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="synthetic-fixture-select">Approved synthetic fixture</label>
            <select
              id="synthetic-fixture-select"
              className="select"
              value={selectedFixtureId}
              disabled={disabled || applyingImport}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedFixtureId(nextId);
                const found = APPROVED_SYNTHETIC_IMPORT_FIXTURES.find((f) => f.id === nextId);
                if (found) {
                  setExplicitDelimiter(found.delimiter);
                }
              }}
            >
              {APPROVED_SYNTHETIC_IMPORT_FIXTURES.map((fixture) => (
                <option key={fixture.id} value={fixture.id}>
                  {fixture.name} ({fixture.filename})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="delimited-delimiter-select">Explicit delimiter (no auto-sniffing)</label>
            <select
              id="delimited-delimiter-select"
              className="select"
              value={explicitDelimiter}
              disabled={disabled || applyingImport}
              onChange={(event) =>
                setExplicitDelimiter(event.target.value as DelimitedDelimiter)
              }
            >
              <option value=",">Comma (&quot;,&quot; — CSV)</option>
              <option value={'\t'}>Tab (&quot;\t&quot; — TSV)</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="blank-line-policy-select">Blank line policy</label>
            <select
              id="blank-line-policy-select"
              className="select"
              value={blankLinePolicy}
              disabled={disabled || applyingImport}
              onChange={(event) => setBlankLinePolicy(event.target.value as BlankLinePolicy)}
            >
              <option value="skip">Skip physical blank lines (record line numbers)</option>
              <option value="error-row">Flag blank lines as blocking row errors</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="synthetic-delimited-file-input">
              Upload allowlisted synthetic file (.csv / .tsv, &lt;= 2 MiB)
            </label>
            <input
              id="synthetic-delimited-file-input"
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              className="input"
              disabled={disabled || applyingImport}
              onChange={(event) => void handleUploadSyntheticFile(event)}
              data-testid="synthetic-delimited-file-input"
            />
          </div>
        </div>

        <div className="row-inline" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabled || applyingImport}
            onClick={() => void handleStageBuiltInFixture()}
            data-testid="stage-builtin-fixture-btn"
          >
            Stage selected synthetic fixture
          </button>
          <button
            type="button"
            className="btn"
            disabled={disabled || applyingImport}
            onClick={handleDownloadSelectedFixture}
            data-testid="download-synthetic-fixture-btn"
          >
            Download synthetic fixture file
          </button>
          {rawStage && (
            <button
              type="button"
              className="btn"
              disabled={applyingImport}
              onClick={() => {
                setRawStage(null);
                setMappingSpec(null);
                setRowDecisions({});
                setPlannedImport(null);
                setPreCommitAckChecked(false);
                setIntakeNotice(null);
                setPlanningError(null);
              }}
              data-testid="clear-staging-session-btn"
            >
              Discard in-memory staging session
            </button>
          )}
        </div>

        {intakeError && (
          <div className="banner banner-error" role="alert" data-testid="delimited-intake-error">
            <strong>Intake rejected:</strong> {intakeError}
          </div>
        )}

        {intakeNotice && (
          <div className="banner banner-success" role="status" data-testid="delimited-intake-notice">
            {intakeNotice}
          </div>
        )}

        {commitNotice && (
          <div className="banner banner-success" role="status" data-testid="import-commit-notice">
            {commitNotice}
          </div>
        )}
      </div>

      {/* Step 2: Positional Column Mapping & Loss Summary */}
      {rawStage && mappingSpec && stagedTable && reviewEvaluation && snapshot && (
        <>
          <div className="setup-card stack-sm" style={{ padding: '1rem' }} data-testid="staging-mapping-card">
            <div className="row-inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <h3>2. Positional column mapping &amp; transformation preview</h3>
              <span className="mono small muted">
                Source SHA-256: {rawStage.rawByteSha256.slice(0, 16)}… · Base Rev{' '}
                {stagedTable.baseLibraryRevision}
              </span>
            </div>

            {stagedTable.duplicateHeaderColumns.length > 0 && (
              <div className="banner banner-info" data-testid="duplicate-headers-warning">
                <strong>Duplicate header names detected:</strong> Columns{' '}
                {stagedTable.duplicateHeaderColumns
                  .map((c) => `#${c.columnIndex} ("${c.rawName}")`)
                  .join(', ')}{' '}
                share identical header names. Mapping is strictly bound by positional column index (
                <span className="mono">0..{stagedTable.headers.length - 1}</span>) so duplicate
                names never collide or overwrite one another.
              </div>
            )}

            <div className="form-grid">
              {/* Term column */}
              <div className="field">
                <label htmlFor="mapping-term-col">Term text column (required)</label>
                <select
                  id="mapping-term-col"
                  className="select"
                  value={mappingSpec.termColumnIndex}
                  disabled={applyingImport}
                  onChange={(e) =>
                    handleUpdateMapping((prev) => ({
                      ...prev,
                      termColumnIndex: Number(e.target.value),
                    }))
                  }
                >
                  {rawStage.headers.map((col) => (
                    <option key={col.columnIndex} value={col.columnIndex}>
                      Col #{col.columnIndex}: {col.rawName || '(empty header)'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Text Transform */}
              <div className="field">
                <label htmlFor="mapping-text-transform">Explicit text transformation</label>
                <select
                  id="mapping-text-transform"
                  className="select"
                  value={mappingSpec.textTransform}
                  disabled={applyingImport}
                  onChange={(e) =>
                    handleUpdateMapping((prev) => ({
                      ...prev,
                      textTransform: e.target.value as StagingTextTransform,
                    }))
                  }
                >
                  <option value="none">None (preserve exact raw exterior whitespace)</option>
                  <option value="trim-exterior">Trim exterior whitespace only</option>
                  <option value="trim-collapse-spaces">
                    Trim exterior &amp; collapse repeated ASCII spaces
                  </option>
                </select>
              </div>

              {/* Language source mode */}
              <div className="field">
                <label htmlFor="mapping-lang-mode">Language designation source</label>
                <select
                  id="mapping-lang-mode"
                  className="select"
                  value={
                    mappingSpec.languageSource.kind === 'column'
                      ? `col:${mappingSpec.languageSource.columnIndex}`
                      : `fixed:${encodeLanguageUseOption(mappingSpec.languageSource.value)}`
                  }
                  disabled={applyingImport}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.startsWith('col:')) {
                      const colIdx = Number(val.slice(4));
                      handleUpdateMapping((prev) => ({
                        ...prev,
                        languageSource: {
                          kind: 'column',
                          columnIndex: colIdx,
                          missingPolicy:
                            prev.languageSource.kind === 'column'
                              ? prev.languageSource.missingPolicy
                              : 'error',
                        },
                      }));
                    } else {
                      const fixedLang = decodeLanguageUseOption(val.slice(6));
                      handleUpdateMapping((prev) => ({
                        ...prev,
                        languageSource: {
                          kind: 'fixed',
                          value: fixedLang,
                        },
                      }));
                    }
                  }}
                >
                  {rawStage.headers.map((col) => (
                    <option key={`col:${col.columnIndex}`} value={`col:${col.columnIndex}`}>
                      From Col #{col.columnIndex} ({col.rawName || 'unnamed'})
                    </option>
                  ))}
                  <option value="fixed:en">Fixed for all rows: en (English)</option>
                  <option value="fixed:tr">Fixed for all rows: tr (Turkish)</option>
                  <option value="fixed:shared">Fixed for all rows: shared</option>
                  <option value="fixed:undetermined">Fixed for all rows: undetermined</option>
                </select>
              </div>

              {/* Missing language policy */}
              {mappingSpec.languageSource.kind === 'column' && (
                <div className="field">
                  <label htmlFor="mapping-lang-missing-policy">Empty language cell policy</label>
                  <select
                    id="mapping-lang-missing-policy"
                    className="select"
                    value={mappingSpec.languageSource.missingPolicy}
                    disabled={applyingImport}
                    onChange={(e) => {
                      const policy = e.target.value as MissingLanguagePolicy;
                      handleUpdateMapping((prev) =>
                        prev.languageSource.kind === 'column'
                          ? {
                              ...prev,
                              languageSource: {
                                ...prev.languageSource,
                                missingPolicy: policy,
                              },
                            }
                          : prev
                      );
                    }}
                  >
                    <option value="error">Flag row as blocking error (MISSING_LANGUAGE)</option>
                    <option value="undetermined">
                      Map empty cell to explicit &quot;undetermined&quot;
                    </option>
                  </select>
                </div>
              )}

              {/* Role source mode */}
              <div className="field">
                <label htmlFor="mapping-role-mode">Expression role source</label>
                <select
                  id="mapping-role-mode"
                  className="select"
                  value={
                    mappingSpec.roleSource.kind === 'column'
                      ? `col:${mappingSpec.roleSource.columnIndex}`
                      : `fixed:${mappingSpec.roleSource.value}`
                  }
                  disabled={applyingImport}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.startsWith('col:')) {
                      const colIdx = Number(val.slice(4));
                      handleUpdateMapping((prev) => ({
                        ...prev,
                        roleSource: {
                          kind: 'column',
                          columnIndex: colIdx,
                          missingPolicy:
                            prev.roleSource.kind === 'column'
                              ? prev.roleSource.missingPolicy
                              : 'unspecified',
                        },
                      }));
                    } else {
                      const fixedRole = val.slice(6) as ExpressionRole;
                      handleUpdateMapping((prev) => ({
                        ...prev,
                        roleSource: {
                          kind: 'fixed',
                          value: fixedRole,
                        },
                      }));
                    }
                  }}
                >
                  {rawStage.headers.map((col) => (
                    <option key={`col:${col.columnIndex}`} value={`col:${col.columnIndex}`}>
                      From Col #{col.columnIndex} ({col.rawName || 'unnamed'})
                    </option>
                  ))}
                  {EXPRESSION_ROLES.map((role) => (
                    <option key={`fixed:${role}`} value={`fixed:${role}`}>
                      Fixed for all rows: {role}
                    </option>
                  ))}
                </select>
              </div>

              {/* Missing role policy */}
              {mappingSpec.roleSource.kind === 'column' && (
                <div className="field">
                  <label htmlFor="mapping-role-missing-policy">Empty role cell policy</label>
                  <select
                    id="mapping-role-missing-policy"
                    className="select"
                    value={mappingSpec.roleSource.missingPolicy}
                    disabled={applyingImport}
                    onChange={(e) => {
                      const policy = e.target.value as MissingRolePolicy;
                      handleUpdateMapping((prev) =>
                        prev.roleSource.kind === 'column'
                          ? {
                              ...prev,
                              roleSource: {
                                ...prev.roleSource,
                                missingPolicy: policy,
                              },
                            }
                          : prev
                      );
                    }}
                  >
                    <option value="unspecified">
                      Map empty cell to explicit &quot;unspecified&quot;
                    </option>
                    <option value="error">Flag row as blocking error (MISSING_ROLE)</option>
                  </select>
                </div>
              )}

              {/* Optional Group Key column */}
              <div className="field">
                <label htmlFor="mapping-group-col">
                  Optional concept group key column (explicit bilingual / synonym grouping)
                </label>
                <select
                  id="mapping-group-col"
                  className="select"
                  value={
                    mappingSpec.groupKeyColumnIndex === null
                      ? 'none'
                      : String(mappingSpec.groupKeyColumnIndex)
                  }
                  disabled={applyingImport}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleUpdateMapping((prev) => ({
                      ...prev,
                      groupKeyColumnIndex: val === 'none' ? null : Number(val),
                    }));
                  }}
                >
                  <option value="none">None — treat each row independently</option>
                  {rawStage.headers.map((col) => (
                    <option key={col.columnIndex} value={col.columnIndex}>
                      Col #{col.columnIndex}: {col.rawName || '(empty header)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Unmapped Column & Provenance Loss Summary */}
            <div className="banner banner-info stack-sm" data-testid="unmapped-loss-summary">
              <div>
                <strong>Unmapped column loss summary ({stagedTable.unmappedColumns.length} unmapped columns):</strong>{' '}
                {stagedTable.unmappedColumns.length === 0 ? (
                  <span>All columns in the staged table are mapped.</span>
                ) : (
                  <span>
                    {stagedTable.unmappedColumns
                      .map(
                        (col) =>
                          `Col #${col.columnIndex} ("${col.rawName}", ${col.nonEmptyRowCount} non-empty cells)`
                      )
                      .join(' · ')}{' '}
                    will be discarded on commit and never written to IndexedDB.
                  </span>
                )}
              </div>
              <div className="small muted">{PROVENANCE_LIMITATION_DISCLOSURE}</div>
            </div>
          </div>

          {/* Step 3: Row-by-Row Review & Duplicate/Homonym Resolution */}
          <div className="setup-card stack-sm" style={{ padding: '1rem' }} data-testid="staging-review-card">
            <div className="row-inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <h3>3. Review staged rows &amp; resolve duplicates, homonyms, and concept grouping</h3>
              <div className="row-inline" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={applyingImport}
                  onClick={handleApplySuggestedDecisions}
                  data-testid="apply-suggested-decisions-btn"
                >
                  Apply suggested non-ambiguous decisions
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={applyingImport}
                  onClick={handleSkipUnresolvedAndInvalid}
                  data-testid="skip-unresolved-rows-btn"
                >
                  Skip all unresolved &amp; invalid rows
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={applyingImport}
                  onClick={handleResetDecisions}
                >
                  Reset all to unresolved
                </button>
              </div>
            </div>

            <div className="metrics-strip">
              <div className="metric-chip">
                <span>Total rows</span>
                <strong data-testid="staged-total-rows">{reviewEvaluation.counts.totalRows}</strong>
              </div>
              <div className="metric-chip">
                <span>New concepts</span>
                <strong data-testid="staged-create-concepts">
                  {reviewEvaluation.counts.createConceptCount}
                </strong>
              </div>
              <div className="metric-chip">
                <span>Link existing</span>
                <strong data-testid="staged-link-existing">
                  {reviewEvaluation.counts.addExpressionToExistingCount}
                </strong>
              </div>
              <div className="metric-chip">
                <span>Link staged group</span>
                <strong data-testid="staged-link-group">
                  {reviewEvaluation.counts.addExpressionToStagedGroupCount}
                </strong>
              </div>
              <div className="metric-chip">
                <span>Skipped</span>
                <strong data-testid="staged-skipped-rows">
                  {reviewEvaluation.counts.skippedRowCount}
                </strong>
              </div>
              <div className="metric-chip">
                <span>Unresolved / Conflicts</span>
                <strong data-testid="staged-unresolved-conflicts">
                  {reviewEvaluation.counts.unresolvedRowCount} /{' '}
                  {reviewEvaluation.counts.blockingConflictRowCount}
                </strong>
              </div>
            </div>

            {reviewEvaluation.blockingReasons.length > 0 && (
              <div className="banner banner-warning" data-testid="staging-blocking-reasons">
                <strong>Review items requiring explicit action before building proposal:</strong>
                <ul style={{ margin: '0.35rem 0 0 1.2rem', padding: 0 }}>
                  {reviewEvaluation.blockingReasons.map((reason) => (
                    <li key={reason} className="small">
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="field" style={{ maxWidth: '380px' }}>
              <label htmlFor="staging-row-search">Filter staged rows</label>
              <input
                id="staging-row-search"
                type="search"
                className="input"
                placeholder="Filter by term, group key, classification, or flag…"
                value={searchFilter}
                onChange={(e) => {
                  setSearchFilter(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>

            <div className="table-wrap">
              <table className="data-table" data-testid="staging-review-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Raw → Staged Term Text</th>
                    <th>Language &amp; Role</th>
                    <th>Group Key</th>
                    <th>Classification &amp; Flags</th>
                    <th>Explicit Row Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((item) => {
                    const { row } = item;
                    return (
                      <tr key={row.rowId} data-testid={`staged-row-${row.rowNumber}`}>
                        <td className="mono small">
                          #{row.rowNumber}
                          <div className="muted">
                            L{row.startLine}
                            {row.endLine !== row.startLine ? `–${row.endLine}` : ''}
                          </div>
                        </td>
                        <td>
                          {row.wasTransformed ? (
                            <div className="stack-sm" style={{ gap: '0.15rem' }}>
                              <div className="mono small muted">
                                Raw: <code>{JSON.stringify(row.rawTermText)}</code>
                              </div>
                              <div className="mono">
                                <strong>{row.stagedTermText || '(empty)'}</strong>{' '}
                                <span className="tag tag-teal">transformed</span>
                              </div>
                            </div>
                          ) : (
                            <div className="mono">
                              <strong>{row.stagedTermText || '(empty)'}</strong>
                            </div>
                          )}
                          {row.issues.length > 0 && (
                            <div
                              className="row-inline"
                              style={{ flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.25rem' }}
                            >
                              {row.issues.map((iss, idx) => (
                                <span
                                  key={`${iss.code}-${idx}`}
                                  className={
                                    iss.severity === 'error'
                                      ? 'tag tag-amber mono'
                                      : 'tag tag-mono'
                                  }
                                  title={iss.message}
                                >
                                  {iss.code}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="small">
                          <div>
                            Lang:{' '}
                            <strong>
                              {row.stagedLanguage
                                ? formatLanguageUse(row.stagedLanguage)
                                : 'INVALID'}
                            </strong>
                          </div>
                          <div>
                            Role: <strong>{row.stagedRole ?? 'INVALID'}</strong>
                          </div>
                        </td>
                        <td className="mono small">{row.groupKey ?? '—'}</td>
                        <td>
                          <div className="stack-sm" style={{ gap: '0.25rem' }}>
                            <span className="tag tag-mono">{item.classification}</span>
                            {item.matchingExistingConceptIds.length > 0 && (
                              <span className="small muted mono">
                                Existing:{' '}
                                {item.matchingExistingConceptIds
                                  .map((id) => id.slice(0, 8))
                                  .join(', ')}
                              </span>
                            )}
                            {item.conflictFlags.map((flag) => (
                              <span key={flag} className="tag tag-amber mono">
                                {flag}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className="stack-sm" style={{ gap: '0.35rem' }}>
                            <select
                              aria-label={`Decision for row ${row.rowNumber}`}
                              className="select"
                              disabled={applyingImport}
                              value={item.decision.action}
                              data-testid={`decision-select-row-${row.rowNumber}`}
                              onChange={(e) => {
                                const act = e.target.value;
                                if (act === 'unresolved') {
                                  handleSetRowDecision(row.rowId, { action: 'unresolved' });
                                } else if (act === 'skip') {
                                  handleSetRowDecision(row.rowId, { action: 'skip' });
                                } else if (act === 'create-new-concept') {
                                  handleSetRowDecision(row.rowId, {
                                    action: 'create-new-concept',
                                  });
                                } else if (act === 'link-existing-concept') {
                                  const defaultConceptId =
                                    item.matchingExistingConceptIds[0] ??
                                    snapshot.concepts[0]?.id ??
                                    '';
                                  handleSetRowDecision(row.rowId, {
                                    action: 'link-existing-concept',
                                    targetConceptId: defaultConceptId,
                                  });
                                } else if (act === 'link-staged-group' && row.groupKey) {
                                  handleSetRowDecision(row.rowId, {
                                    action: 'link-staged-group',
                                    groupKey: row.groupKey,
                                  });
                                }
                              }}
                            >
                              <option value="unresolved">Unresolved (must choose)</option>
                              <option value="skip">Skip row (do not import)</option>
                              {row.isValidForPlanning && (
                                <>
                                  <option value="create-new-concept">Create new concept</option>
                                  {snapshot.concepts.length > 0 && (
                                    <option value="link-existing-concept">
                                      Add expression to existing concept
                                    </option>
                                  )}
                                  {row.groupKey && (
                                    <option value="link-staged-group">
                                      Link to staged group ({row.groupKey})
                                    </option>
                                  )}
                                </>
                              )}
                            </select>

                            {item.decision.action === 'link-existing-concept' && (
                              <select
                                aria-label={`Target concept for row ${row.rowNumber}`}
                                className="select"
                                disabled={applyingImport}
                                value={item.decision.targetConceptId}
                                data-testid={`target-concept-select-row-${row.rowNumber}`}
                                onChange={(e) =>
                                  handleSetRowDecision(row.rowId, {
                                    action: 'link-existing-concept',
                                    targetConceptId: e.target.value,
                                  })
                                }
                              >
                                <option value="">-- Select target concept --</option>
                                {snapshot.concepts.map((c) => {
                                  const exprPreview = snapshot.expressions
                                    .filter((ex) => ex.conceptId === c.id)
                                    .map((ex) => ex.text)
                                    .slice(0, 2)
                                    .join(' / ');
                                  return (
                                    <option key={c.id} value={c.id}>
                                      {c.id.slice(0, 8)} ({exprPreview || 'no expressions'})
                                    </option>
                                  );
                                })}
                              </select>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div
                className="row-inline"
                style={{ justifyContent: 'space-between' }}
                data-testid="staging-pagination"
              >
                <span className="muted small">
                  Page {safePage} of {totalPages} ({filteredReviewedRows.length} rows,{' '}
                  {STAGING_PAGE_SIZE} per page)
                </span>
                <div className="row-inline">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage(safePage - 1)}
                  >
                    Previous page
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setCurrentPage(safePage + 1)}
                  >
                    Next page
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 4: Immutable Proposal, Pre-Commit Backup & Atomic Apply */}
          <div className="setup-card stack-sm" style={{ padding: '1rem' }} data-testid="import-proposal-card">
            <h3>4. Build immutable proposal, offer pre-commit backup &amp; commit atomically</h3>
            <p className="muted small">
              Proposals are bound to the exact staging session fingerprint and library revision{' '}
              <strong>Rev {snapshot.libraryRevision}</strong>. Maximum{' '}
              {DELIMITED_INTAKE_LIMITS.maxAtomicChangeOperations} additive operations per atomic
              commit.
            </p>

            {planningError && (
              <div className="banner banner-error" role="alert" data-testid="import-planning-error">
                <strong>Import proposal / commit error:</strong> {planningError}
              </div>
            )}

            <div className="row-inline">
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !reviewEvaluation.canBuildProposal ||
                  !freshnessConfirmed ||
                  applyingImport ||
                  disabled
                }
                onClick={() => void handleBuildProposal()}
                data-testid="build-import-proposal-btn"
              >
                Build immutable import proposal
              </button>
            </div>

            {plannedImport && isProposalCurrent && (
              <div
                className="panel stack-sm"
                style={{ marginTop: '0.5rem' }}
                data-testid="planned-import-preview"
              >
                <p className="status-label">IMMUTABLE ADDITIVE CHANGE PROPOSAL</p>
                <div className="metrics-strip">
                  <div className="metric-chip">
                    <span>Base Revision</span>
                    <strong>Rev {plannedImport.summary.baseLibraryRevision}</strong>
                  </div>
                  <div className="metric-chip">
                    <span>Total Atomic Ops</span>
                    <strong data-testid="proposal-total-ops">
                      {plannedImport.summary.totalOperations}
                    </strong>
                  </div>
                  <div className="metric-chip">
                    <span>createConcept</span>
                    <strong>{plannedImport.summary.createConceptCount}</strong>
                  </div>
                  <div className="metric-chip">
                    <span>addExpression</span>
                    <strong>{plannedImport.summary.addExpressionCount}</strong>
                  </div>
                  <div className="metric-chip">
                    <span>Skipped Rows</span>
                    <strong>{plannedImport.summary.skippedRowCount}</strong>
                  </div>
                  <div className="metric-chip">
                    <span>Unmapped Cells Excluded</span>
                    <strong>{plannedImport.summary.unmappedNonEmptyCellCount}</strong>
                  </div>
                </div>

                <p className="mono small muted" style={{ wordBreak: 'break-all', margin: 0 }}>
                  Batch ID: {plannedImport.proposal.payload.batchId} · Proposal SHA-256:{' '}
                  {plannedImport.proposal.digest}
                </p>

                <div className="row-inline" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={applyingImport}
                    onClick={() => void handleOfferPreCommitBackup()}
                    data-testid="offer-precommit-backup-btn"
                  >
                    Offer &amp; download pre-commit backup (.json)
                  </button>
                </div>

                {preCommitBackupNotice && (
                  <div
                    className="banner banner-info"
                    role="status"
                    data-testid="precommit-backup-notice"
                  >
                    {preCommitBackupNotice}
                  </div>
                )}

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={preCommitAckChecked}
                    disabled={applyingImport}
                    onChange={(e) => setPreCommitAckChecked(e.target.checked)}
                    data-testid="precommit-ack-checkbox"
                  />
                  <span className="small">
                    I have downloaded or verified my portable backup (knowing browser download
                    initiation cannot prove external disk storage) and acknowledge the unmapped
                    column loss summary and v1 manual provenance (
                    <span className="mono">kind: &quot;manual&quot;, source: null</span>).
                  </span>
                </label>

                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!preCommitAckChecked || applyingImport || !freshnessConfirmed}
                    onClick={() => void handleApproveAndApplyImport()}
                    data-testid="approve-apply-import-btn"
                  >
                    {applyingImport ? 'Committing atomic batch…' : 'Approve and apply import batch'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={applyingImport}
                    onClick={() => {
                      setPlannedImport(null);
                      setPreCommitAckChecked(false);
                    }}
                    data-testid="cancel-import-proposal-btn"
                  >
                    Cancel proposal
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
