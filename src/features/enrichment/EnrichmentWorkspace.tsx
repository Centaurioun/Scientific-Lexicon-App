'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBrowserLibraryRepository } from '@/adapters/storage/dexie-library';
import {
  discoverMissingFieldTasks,
  type EnrichmentTaskFilterKind,
  type EnrichmentTaskKind,
} from '@/application/enrichment-tasks';
import { listLibrary } from '@/application/library';
import {
  REVIEW_RESPONSE_WORKFLOW_DISCLOSURE,
  type SyntheticSimulationScenario,
} from '@/application/review-response';
import { AppHeader } from '@/components/AppHeader';
import {
  formatLanguageUse,
  type LibrarySnapshot,
} from '@/domain/schema';
import {
  listSourceRegistryEntries,
  type SourceRegistryEntry,
} from '@/domain/source-registry';
import { shouldApplySnapshotLoad } from '@/features/extraction/concurrency-controller';
import {
  createInitialEnrichmentViewState,
  EnrichmentSessionController,
  type EnrichmentViewState,
} from './enrichment-controller';

function downloadBlobFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EnrichmentWorkspace() {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [viewState, setViewState] = useState<EnrichmentViewState>(
    createInitialEnrichmentViewState,
  );
  const [selectedSourceId, setSelectedSourceId] = useState('synth-bilingual-lexicon-v1');
  const [scenario, setScenario] = useState<SyntheticSimulationScenario>('consensus-with-source');

  const mountedRef = useRef(true);
  const snapshotLoadSeqRef = useRef(0);
  const snapshotRef = useRef<LibrarySnapshot | null>(null);
  const viewStateRef = useRef<EnrichmentViewState>(viewState);
  const prevRevRef = useRef<number | null>(null);
  const controllerRef = useRef<EnrichmentSessionController | null>(null);

  snapshotRef.current = snapshot;
  viewStateRef.current = viewState;

  const sourceRegistry: readonly SourceRegistryEntry[] = useMemo(
    () => listSourceRegistryEntries(),
    [],
  );
  const selectedRegistryEntry = useMemo(
    () => sourceRegistry.find((s) => s.sourceId === selectedSourceId) ?? sourceRegistry[0],
    [sourceRegistry, selectedSourceId],
  );

  const loadSnapshot = useCallback(async (providedSnapshot?: LibrarySnapshot) => {
    const loadSeq = ++snapshotLoadSeqRef.current;
    if (providedSnapshot) {
      if (
        shouldApplySnapshotLoad({
          mounted: mountedRef.current,
          capturedLoadSeq: loadSeq,
          currentLoadSeq: snapshotLoadSeqRef.current,
        })
      ) {
        setSnapshot(providedSnapshot);
        setStorageError(null);
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current) {
      setLoading(true);
      setStorageError(null);
    }
    try {
      const repo = getBrowserLibraryRepository();
      const loaded = await listLibrary(repo);
      if (
        shouldApplySnapshotLoad({
          mounted: mountedRef.current,
          capturedLoadSeq: loadSeq,
          currentLoadSeq: snapshotLoadSeqRef.current,
        })
      ) {
        setSnapshot(loaded);
      }
    } catch (error) {
      if (
        shouldApplySnapshotLoad({
          mounted: mountedRef.current,
          capturedLoadSeq: loadSeq,
          currentLoadSeq: snapshotLoadSeqRef.current,
        })
      ) {
        setStorageError(
          error instanceof Error ? error.message : 'Unable to open browser IndexedDB library.',
        );
        setSnapshot(null);
      }
    } finally {
      if (
        shouldApplySnapshotLoad({
          mounted: mountedRef.current,
          capturedLoadSeq: loadSeq,
          currentLoadSeq: snapshotLoadSeqRef.current,
        })
      ) {
        setLoading(false);
      }
    }
  }, []);

  if (!controllerRef.current) {
    controllerRef.current = new EnrichmentSessionController({
      getSnapshot: () => snapshotRef.current,
      getViewState: () => viewStateRef.current,
      patchViewState: (patch) => {
        setViewState((prev) => {
          const next = { ...prev, ...patch };
          viewStateRef.current = next;
          return next;
        });
      },
      readAuthoritativeSnapshot: async () => {
        const repo = getBrowserLibraryRepository();
        return listLibrary(repo);
      },
      onSnapshotChanged: async (nextSnapshot) => {
        await loadSnapshot(nextSnapshot);
      },
      downloadFile: downloadBlobFile,
      applyBatch: async (proposal, approval) => {
        const repo = getBrowserLibraryRepository();
        return repo.apply(proposal, approval);
      },
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    controllerRef.current?.remount();
    void loadSnapshot();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.unmount();
    };
  }, [loadSnapshot]);

  useEffect(() => {
    const rev = snapshot?.libraryRevision ?? null;
    if (prevRevRef.current !== null && rev !== prevRevRef.current) {
      controllerRef.current?.handleLibraryRevisionChanged(rev);
    }
    prevRevRef.current = rev;
  }, [snapshot?.libraryRevision]);

  const discoveryPage = useMemo(() => {
    if (!snapshot) return null;
    try {
      return discoverMissingFieldTasks(snapshot, {
        taskKind: viewState.taskKindFilter,
        query: viewState.searchQuery,
        page: viewState.page,
        pageSize: 20,
      });
    } catch {
      return null;
    }
  }, [snapshot, viewState.taskKindFilter, viewState.searchQuery, viewState.page]);

  const handleResponseFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !controllerRef.current) return;
    if (file.size > 262_144) {
      controllerRef.current.uploadSyntheticResponseBytes(
        file.name,
        new Uint8Array(262_145),
      );
      return;
    }
    const buf = await file.arrayBuffer();
    await controllerRef.current.uploadSyntheticResponseBytes(
      file.name,
      new Uint8Array(buf),
    );
  };

  const controller = controllerRef.current;
  const storageUnavailable = loading || Boolean(storageError) || !snapshot;

  return (
    <>
      <AppHeader revision={snapshot?.libraryRevision ?? null} />
      <main className="workspace-container stack-md">
        <div className="workspace-header" style={{ marginBottom: 0 }}>
          <div>
            <p className="eyebrow">BOUNDED SYNTHETIC SOURCE ENRICHMENT &amp; REVIEW</p>
            <h1>Source Enrichment &amp; AI Review Workspace</h1>
            <p className="muted small">
              Discover incomplete terminology records, inspect offline synthetic source suggestions,
              export scoped external review packets, compare blind reviewer slots, and commit
              reviewed additive expressions with mandatory pre-commit backup &amp; H1/H2 guards.
            </p>
          </div>
          <div className="row-inline">
            <Link href="/library" className="btn">
              Back to Library
            </Link>
            <Link href="/exchange" className="btn">
              Export &amp; Data Ops
            </Link>
            <button
              type="button"
              className="btn"
              data-testid="enrichment-clear-session-btn"
              onClick={() => controller.clearSession()}
            >
              Clear session
            </button>
          </div>
        </div>

        <div className="banner banner-warning" data-testid="wp04-synthetic-gate-banner" role="note">
          <strong>SYNTHETIC-ONLY WORKFLOW (G4 NOT READY / G5 NOT ESTABLISHED):</strong> No real
          terminology, no remote HTTP API requests, no API keys, and no external AI invocation. Live
          sources (MeSH, SPECIALIST, OBO, UMLS, PubTator 3, TDK, TÜBA, TBT) and arbitrary external
          JSON uploads are disabled. Approved changes commit with{' '}
          <code>kind: &quot;manual&quot;, source: null</code> only.
        </div>

        {storageError && (
          <div className="banner banner-error" role="alert">
            <strong>Local storage unavailable:</strong> {storageError}
          </div>
        )}

        {viewState.actionError && (
          <div className="banner banner-error" data-testid="enrichment-error-banner" role="alert">
            <strong>Action blocked:</strong> {viewState.actionError}
          </div>
        )}

        {viewState.statusNotice && (
          <div className="banner banner-success" data-testid="enrichment-status-banner" role="status">
            {viewState.statusNotice}
          </div>
        )}

        {/* Step 1: F2 Missing-field Task Discovery & Explicit Selection */}
        <section className="panel stack-md" aria-labelledby="f2-discovery-heading">
          <div className="row-inline" style={{ justifyContent: 'space-between' }}>
            <div>
              <p className="status-label">STEP 1 · MISSING-FIELD TASK DISCOVERY (F2)</p>
              <h2 id="f2-discovery-heading">Select incomplete concepts (max 50 targets)</h2>
            </div>
            <div className="row-inline">
              <span className="tag" data-testid="selected-targets-count">
                {viewState.selectedTargets.length} selected
              </span>
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="f2-task-filter">Discovery filter</label>
              <select
                id="f2-task-filter"
                className="select"
                data-testid="f2-task-filter-select"
                value={viewState.taskKindFilter}
                onChange={(e) =>
                  controller.setTaskKindFilter(e.target.value as EnrichmentTaskFilterKind)
                }
              >
                <option value="all">All eligible tasks</option>
                <option value="missing-tr">Missing Turkish (missing-tr)</option>
                <option value="missing-en">Missing English (missing-en)</option>
                <option value="unspecified-role">Unspecified role</option>
                <option value="undetermined-language">Undetermined language</option>
                <option value="candidate-review">Candidate review / unasserted</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="f2-active-task-kind">Outgoing ReviewTaskPacket kind</label>
              <select
                id="f2-active-task-kind"
                className="select"
                data-testid="f2-active-kind-select"
                value={viewState.activeTaskKind}
                onChange={(e) =>
                  controller.setActiveTaskKind(e.target.value as EnrichmentTaskKind)
                }
              >
                <option value="missing-tr">missing-tr</option>
                <option value="missing-en">missing-en</option>
                <option value="unspecified-role">unspecified-role</option>
                <option value="undetermined-language">undetermined-language</option>
                <option value="candidate-review">candidate-review</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="f2-search-query">Search concept ID or form</label>
              <input
                id="f2-search-query"
                className="input"
                type="search"
                value={viewState.searchQuery}
                placeholder="Case-sensitive filter…"
                onChange={(e) => controller.setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {!discoveryPage || discoveryPage.items.length === 0 ? (
            <div className="empty-state" data-testid="f2-empty-state">
              <h3>No eligible missing-field concepts found</h3>
              <p>
                Stage a synthetic CSV fixture in Export &amp; Recovery or add concepts in Library
                to inspect missing EN/TR forms and candidate reviews.
              </p>
              <div className="row-inline" style={{ justifyContent: 'center' }}>
                <Link href="/library" className="btn btn-primary">
                  Open Library
                </Link>
                <Link href="/exchange" className="btn">
                  Open Export &amp; Data Ops
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Concept / Rev</th>
                      <th>Current Expressions</th>
                      <th>Eligible Needs</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discoveryPage.items.map((item) => {
                      const isSelected = viewState.selectedTargets.some(
                        (t) => t.conceptId === item.conceptId,
                      );
                      return (
                        <tr
                          key={item.conceptId}
                          className={isSelected ? 'row-selected' : undefined}
                        >
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select concept ${item.conceptId}`}
                              data-testid={`select-target-${item.conceptId}`}
                              checked={isSelected}
                              disabled={storageUnavailable}
                              onChange={() =>
                                controller.toggleTargetSelection(
                                  item.conceptId,
                                  item.conceptRevision,
                                )
                              }
                            />
                          </td>
                          <td className="mono">
                            {item.conceptId}
                            <div className="muted small">rev {item.conceptRevision}</div>
                          </td>
                          <td>
                            <div className="stack-sm">
                              {item.expressions.map((expr) => (
                                <div key={expr.id}>
                                  <strong>{expr.text}</strong>{' '}
                                  <span className="tag">{formatLanguageUse(expr.language)}</span>{' '}
                                  <span className="tag">{expr.role}</span>
                                  {expr.protected && (
                                    <span className="tag tag-amber">Protected</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td>
                            <div className="row-inline">
                              {item.eligibleKinds.map((kind) => (
                                <span key={kind} className="tag tag-indigo">
                                  {kind}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="small muted">
                            {item.homonymSiblingCount > 0 && (
                              <span className="tag tag-amber">
                                {item.homonymSiblingCount} homonym sibling(s)
                              </span>
                            )}
                            <div>Absence is open scope, not error.</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="row-inline" style={{ justifyContent: 'space-between' }}>
                <span className="muted small">
                  Page {discoveryPage.page} of {discoveryPage.totalPages} ({discoveryPage.totalItems}{' '}
                  concept(s))
                </span>
                <div className="row-inline">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={discoveryPage.page <= 1}
                    onClick={() => controller.setPage(discoveryPage.page - 1)}
                  >
                    Previous page
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={discoveryPage.page >= discoveryPage.totalPages}
                    onClick={() => controller.setPage(discoveryPage.page + 1)}
                  >
                    Next page
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        <div className="workbench-grid-equal">
          {/* Step 2: F3 Typed Source Registry & Offline Synthetic Lookup */}
          <section className="panel stack-md" aria-labelledby="f3-source-heading">
            <div>
              <p className="status-label">STEP 2 · SOURCE REGISTRY &amp; OFFLINE ADAPTER (F3)</p>
              <h2 id="f3-source-heading">Synthetic evidence lookup (zero network)</h2>
            </div>

            <div className="field">
              <label htmlFor="f3-source-select">Source registry entry</label>
              <select
                id="f3-source-select"
                className="select"
                data-testid="f3-source-select"
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
              >
                {sourceRegistry.map((entry) => (
                  <option key={entry.sourceId} value={entry.sourceId}>
                    {entry.displayName} —{' '}
                    {entry.enabled ? 'ENABLED (Synthetic Offline)' : 'DISABLED (Conditional/G4)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="banner banner-info small" data-testid="f3-source-policy-card">
              <div>
                <strong>Release:</strong> {selectedRegistryEntry.sourceRelease} ·{' '}
                <strong>Rights verified:</strong>{' '}
                {selectedRegistryEntry.rightsVerified ? 'yes' : 'NO (metadata only)'}
              </div>
              <div>
                <strong>License label:</strong> {selectedRegistryEntry.licenseLabel}
              </div>
              {!selectedRegistryEntry.enabled && (
                <div className="tag tag-danger" style={{ marginTop: '0.35rem' }}>
                  {selectedRegistryEntry.disabledReason}
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn"
              data-testid="lookup-source-btn"
              disabled={storageUnavailable || viewState.selectedTargets.length === 0}
              onClick={() => void controller.lookupSyntheticEvidence(selectedSourceId)}
            >
              Lookup offline source evidence
            </button>

            {viewState.sourceLookup && (
              <div className="stack-sm" data-testid="f3-source-results">
                <p className="small muted">
                  Fixture SHA-256: <span className="mono">{viewState.sourceLookup.fixtureDigest.slice(0, 16)}…</span>
                  {viewState.sourceLookup.ambiguousTargetConceptIds.length > 0 && (
                    <span className="tag tag-amber" style={{ marginLeft: '0.5rem' }}>
                      Ambiguous multiple matches preserved separately
                    </span>
                  )}
                </p>
                {viewState.sourceLookup.candidates.length === 0 ? (
                  <p className="muted small">No exact case/Unicode matches in synthetic fixture.</p>
                ) : (
                  viewState.sourceLookup.candidates.map((cand) => (
                    <div key={cand.evidenceId} className="concept-card small">
                      <div className="row-inline" style={{ justifyContent: 'space-between' }}>
                        <strong>
                          {cand.targetConceptId} → &quot;{cand.candidateText}&quot; (
                          {formatLanguageUse(cand.candidateLanguage)}, {cand.candidateRole})
                        </strong>
                        <span className="tag tag-amber">{cand.verificationStatus}</span>
                      </div>
                      <div className="muted">{cand.evidenceSnippet}</div>
                      <div className="mono small muted">
                        Ref URI (unfetched): {cand.sourceUri} · {cand.limitations}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          {/* Step 3: F4 External-Review Task Packet Export */}
          <section className="panel stack-md" aria-labelledby="f4-packet-heading">
            <div>
              <p className="status-label">STEP 3 · REVIEW TASK PACKET v1 EXPORT (F4)</p>
              <h2 id="f4-packet-heading">Prepare scoped external review packet</h2>
            </div>

            <div className="field">
              <label htmlFor="f4-context-mode">Optional context mode (default none)</label>
              <select
                id="f4-context-mode"
                className="select"
                value={viewState.contextMode}
                onChange={(e) =>
                  controller.setContextMode(e.target.value as 'none' | 'explicit-scoped-note')
                }
              >
                <option value="none">none (zero manuscript or note text)</option>
                <option value="explicit-scoped-note">
                  explicit-scoped-note (max 4,096 UTF-16 chars)
                </option>
              </select>
            </div>

            {viewState.contextMode === 'explicit-scoped-note' && (
              <div className="field">
                <label htmlFor="f4-context-note">Explicit scoped context note</label>
                <textarea
                  id="f4-context-note"
                  className="textarea"
                  maxLength={4096}
                  value={viewState.explicitContextNote}
                  onChange={(e) => controller.setExplicitContextNote(e.target.value)}
                />
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              data-testid="build-packet-btn"
              disabled={storageUnavailable || viewState.selectedTargets.length === 0}
              onClick={() => void controller.buildPacket(3)}
            >
              Build ReviewTaskPacket v1 (3 blind slots)
            </button>

            {viewState.packet && (
              <div className="stack-sm" data-testid="f4-packet-preview">
                <div className="banner banner-info small">
                  <div>
                    <strong>Task ID:</strong> <span className="mono">{viewState.packet.taskId}</span> ·{' '}
                    <strong>Digest:</strong>{' '}
                    <span className="mono">{viewState.packet.taskDigest.slice(0, 16)}…</span> ·{' '}
                    <strong>Size:</strong> {viewState.packetByteLength} bytes
                  </div>
                  <div style={{ marginTop: '0.25rem' }}>
                    {viewState.packet.externalUsageInstructions}
                  </div>
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    data-testid="packet-consent-checkbox"
                    checked={viewState.packetConsentChecked}
                    onChange={(e) => controller.setPacketConsentChecked(e.target.checked)}
                  />
                  <span>
                    I confirm this export contains synthetic-only scoped fields and consent to local
                    download (no remote transfer performed).
                  </span>
                </label>

                <button
                  type="button"
                  className="btn"
                  data-testid="download-packet-btn"
                  disabled={!viewState.packetConsentChecked}
                  onClick={() => controller.downloadPacket()}
                >
                  Download ReviewTaskPacket JSON
                </button>

                <pre className="code-preview" style={{ maxHeight: '12rem' }}>
                  {viewState.packetJsonText}
                </pre>
              </div>
            )}
          </section>
        </div>

        {/* Step 4 & 5: F5 Response Staging & F6 Comparison */}
        <section className="panel stack-md" aria-labelledby="f5-f6-heading">
          <div>
            <p className="status-label">
              STEP 4 &amp; 5 · STRUCTURED RESPONSE STAGING (F5) &amp; SLOT COMPARISON (F6)
            </p>
            <h2 id="f5-f6-heading">Verify synthetic responses &amp; compare independent slots</h2>
            <p className="muted small" data-testid="unsupported-live-provider-notice">
              {REVIEW_RESPONSE_WORKFLOW_DISCLOSURE}
            </p>
          </div>

          <div className="workbench-grid-equal">
            <div className="stack-sm">
              <div className="field">
                <label htmlFor="f5-sim-scenario">Local deterministic synthetic scenario</label>
                <select
                  id="f5-sim-scenario"
                  className="select"
                  data-testid="f5-scenario-select"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as SyntheticSimulationScenario)}
                >
                  <option value="consensus-with-source">
                    3/3 synthetic consensus (with allowlisted source)
                  </option>
                  <option value="disagreement-with-abstain">
                    Contradiction + slot-3 abstain
                  </option>
                  <option value="unsupported-evidence-claim">
                    3/3 agreement citing unverified external claim
                  </option>
                </select>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="simulate-responses-btn"
                disabled={!viewState.packet}
                onClick={() => void controller.simulateResponses(scenario)}
              >
                Generate &amp; verify synthetic slot responses
              </button>
            </div>

            <div className="stack-sm">
              <div className="field">
                <label htmlFor="f5-upload-response">
                  Stage allowlisted synthetic ReviewResponse JSON (&le; 256 KiB; real uploads
                  blocked)
                </label>
                <input
                  id="f5-upload-response"
                  type="file"
                  accept=".json,application/json"
                  data-testid="upload-response-file-input"
                  disabled={!viewState.packet}
                  onChange={(e) => void handleResponseFileUpload(e)}
                />
              </div>
              {viewState.rejectedResponseErrors.length > 0 && (
                <div className="banner banner-error small" data-testid="f5-rejected-summary">
                  <strong>Rejected responses ({viewState.rejectedResponseErrors.length}):</strong>{' '}
                  {viewState.rejectedResponseErrors[viewState.rejectedResponseErrors.length - 1]}
                </div>
              )}
            </div>
          </div>

          {viewState.comparisonSummary && (
            <div className="stack-md" data-testid="f6-comparison-panel">
              <div className="banner banner-info small">
                {viewState.comparisonSummary.blindReviewLimitationDisclosure}
              </div>

              <div className="row-inline">
                <span className="tag" data-testid="f6-responded-count">
                  Responded: {viewState.comparisonSummary.respondedSlotCount} /{' '}
                  {viewState.comparisonSummary.eligibleSlotCount}
                </span>
                <span className="tag" data-testid="f6-abstain-count">
                  Abstentions: {viewState.comparisonSummary.abstainSlotCount}
                </span>
                <span className="tag" data-testid="f6-missing-count">
                  Missing slots: {viewState.comparisonSummary.missingSlotCount}
                </span>
                <span className="tag tag-danger" data-testid="f6-invalid-count">
                  Invalid/rejected: {viewState.comparisonSummary.invalidResponseCount}
                </span>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Select to propose</th>
                      <th>Target Concept</th>
                      <th>Proposed Expression / Action</th>
                      <th>Synthetic Slot Votes</th>
                      <th>Evidence Validity (Separate)</th>
                      <th>Inert Claimed Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewState.comparisonSummary.groups.map((group, idx) => {
                      const isAddable = group.operation === 'proposeExpression';
                      const checked = viewState.selectedGroupKeys.includes(group.groupKey);
                      return (
                        <tr key={group.groupKey} className={checked ? 'row-selected' : undefined}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select proposal group ${idx + 1} for ${group.targetConceptId}`}
                              data-testid={`select-comparison-group-${idx}`}
                              disabled={!isAddable}
                              checked={checked}
                              onChange={() =>
                                controller.toggleComparisonGroupSelection(group.groupKey)
                              }
                            />
                          </td>
                          <td className="mono">
                            {group.targetConceptId}
                            <div className="muted small">rev {group.expectedConceptRevision}</div>
                          </td>
                          <td>
                            {group.text ? (
                              <>
                                <strong>{group.text}</strong>{' '}
                                <span className="tag">
                                  {group.language ? formatLanguageUse(group.language) : '—'}
                                </span>{' '}
                                <span className="tag">{group.role}</span>
                              </>
                            ) : (
                              <span className="tag tag-amber">{group.operation}</span>
                            )}
                          </td>
                          <td>
                            <span
                              className={
                                group.disagreementDetected ? 'tag tag-amber' : 'tag tag-accent'
                              }
                            >
                              {group.voteSummaryLabel}
                            </span>
                            {group.disagreementDetected && (
                              <div className="small muted">Disagreement across slots</div>
                            )}
                            <div className="small muted">Auto-accept: disabled</div>
                          </td>
                          <td>
                            <span
                              className={
                                group.evidenceValidity === 'supported-by-allowlisted-source'
                                  ? 'tag tag-accent'
                                  : group.evidenceValidity === 'unverified-claim'
                                    ? 'tag tag-danger'
                                    : 'tag'
                              }
                            >
                              {group.evidenceValidity}
                            </span>
                          </td>
                          <td className="small">
                            {group.slotDetails.map((d) => (
                              <div key={d.responseId} className="muted">
                                [{d.slotId}] ({d.claimedModel}, unauthenticated): {d.rationale}
                              </div>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* Step 6: F7 Approved Enrichment Proposal + H1 Backup Gate + Commit */}
        <section className="panel stack-md" aria-labelledby="f7-commit-heading">
          <div className="row-inline" style={{ justifyContent: 'space-between' }}>
            <div>
              <p className="status-label">
                STEP 6 · EXPLICIT PROPOSAL, H1 BACKUP GATE &amp; ATOMIC COMMIT (F7)
              </p>
              <h2 id="f7-commit-heading">Review before/after changes &amp; commit manually</h2>
            </div>
            <div className="row-inline">
              <button
                type="button"
                className="btn"
                data-testid="download-evidence-report-btn"
                disabled={!viewState.packet}
                onClick={() => controller.downloadSessionEvidenceReport()}
              >
                Download Non-Canonical Session Report
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="build-enrichment-proposal-btn"
                disabled={viewState.selectedGroupKeys.length === 0 || !viewState.packet}
                onClick={() => void controller.buildEnrichmentProposal()}
              >
                Build enrichment proposal ({viewState.selectedGroupKeys.length} selected)
              </button>
            </div>
          </div>

          {viewState.plannedEnrichment && (
            <div className="stack-md" data-testid="f7-planned-proposal-panel">
              <div className="banner banner-warning small">
                {viewState.plannedEnrichment.provenanceLimitationDisclosure}
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Target Concept</th>
                      <th>Before Expressions</th>
                      <th>After Addition (kind: manual, source: null)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewState.plannedEnrichment.beforeAfterPreviews.map((row, idx) => (
                      <tr key={`${row.targetConceptId}-${idx}`}>
                        <td className="mono">{row.targetConceptId}</td>
                        <td className="small">
                          {row.beforeExpressions.map((e) => (
                            <div key={e.id}>
                              {e.text} ({e.language}, {e.role})
                            </div>
                          ))}
                        </td>
                        <td>
                          <strong>+ {row.afterExpression.text}</strong>{' '}
                          <span className="tag">{row.afterExpression.language}</span>{' '}
                          <span className="tag">{row.afterExpression.role}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!viewState.backupProof && (
                <div
                  className="banner banner-warning small"
                  data-testid="enrichment-backup-required-banner"
                >
                  <strong>Pre-commit backup required (H1 guard):</strong> Offer a validated portable
                  backup bound to this exact proposal and library Rev{' '}
                  {viewState.plannedEnrichment.proposal.payload.baseLibraryRevision} before
                  acknowledgment or commit.
                </div>
              )}

              {viewState.preCommitBackupNotice && (
                <div
                  className="banner banner-info small"
                  data-testid="enrichment-backup-notice"
                >
                  {viewState.preCommitBackupNotice}
                </div>
              )}

              <div className="stack-sm">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    data-testid="enrichment-precommit-ack"
                    disabled={!viewState.backupProof || viewState.applyingCommit}
                    checked={viewState.preCommitAckChecked}
                    onChange={(e) => controller.setPreCommitAckChecked(e.target.checked)}
                  />
                  <span>
                    I acknowledge the pre-commit backup offer and that canonical v1 saves{' '}
                    <code>manual / source: null</code> without external AI/source metadata.
                  </span>
                </label>

                <div className="row-inline" style={{ justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    className="btn"
                    data-testid="enrichment-offer-backup-btn"
                    disabled={viewState.applyingCommit}
                    onClick={() => void controller.offerPreCommitBackup()}
                  >
                    Offer pre-commit portable backup (mandatory)
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="approve-commit-enrichment-btn"
                    disabled={
                      !viewState.backupProof ||
                      !viewState.preCommitAckChecked ||
                      viewState.applyingCommit
                    }
                    onClick={() => void controller.approveAndApplyCommit()}
                  >
                    {viewState.applyingCommit
                      ? 'Applying atomically…'
                      : 'Approve & Commit Enrichment'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
