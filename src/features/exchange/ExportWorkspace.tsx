'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBrowserLibraryRepository } from '@/adapters/storage/dexie-library';
import {
  formatExport,
  selectExportRows,
  type ExportFormat,
  type ExportLanguageFilter,
  type ExportScope,
  type ExportSort,
} from '@/application/exchange';
import { listLibrary } from '@/application/library';
import { AppHeader } from '@/components/AppHeader';
import type { LibrarySnapshot } from '@/domain/schema';
import { shouldApplySnapshotLoad } from '@/features/extraction/concurrency-controller';
import { getSessionExtractionRun } from '@/features/extraction/session-run-store';
import { BackupPanel } from './BackupPanel';
import { DataOperationsPanel } from './DataOperationsPanel';
import { QualityInspectorPanel } from './QualityInspectorPanel';

function downloadExportFile(content: string, format: ExportFormat, scope: ExportScope): string {
  const mimeByFormat: Record<ExportFormat, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `termforge-${scope}-${stamp}.${format}`;
  const blob = new Blob([content], { type: `${mimeByFormat[format]};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export function ExportWorkspace() {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  const [scope, setScope] = useState<ExportScope>('library-expressions');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [sort, setSort] = useState<ExportSort>('alphabetical');
  const [language, setLanguage] = useState<ExportLanguageFilter>('all');
  const [includeKnown, setIncludeKnown] = useState(true);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const snapshotLoadSeqRef = useRef(0);

  const sessionRun = getSessionExtractionRun();

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

  useEffect(() => {
    mountedRef.current = true;
    void loadSnapshot();
    return () => {
      mountedRef.current = false;
    };
  }, [loadSnapshot]);

  const rows = useMemo(() => {
    if (!snapshot) return [];
    return selectExportRows(snapshot, sessionRun, {
      scope,
      sort,
      language,
      includeKnown,
    });
  }, [snapshot, sessionRun, scope, sort, language, includeKnown]);

  const formattedPreview = useMemo(() => formatExport(rows, format), [rows, format]);

  const handleDownloadExport = () => {
    const filename = downloadExportFile(formattedPreview, format, scope);
    setDownloadNotice(
      `Presentation export "${filename}" offered for browser download (${rows.length} rows, ${format.toUpperCase()}).`,
    );
  };

  return (
    <>
      <AppHeader revision={snapshot?.libraryRevision ?? null} />
      <main className="workspace-container stack-md">
        <div className="workspace-header" style={{ marginBottom: 0 }}>
          <div>
            <p className="eyebrow">INTERCHANGE &amp; DURABILITY</p>
            <h1>Export &amp; Recovery Workspace</h1>
            <p className="muted small">
              Deterministic presentation exports (TXT, Markdown, CSV, JSON), complete SHA-256
              verified portable backups, reviewed synthetic CSV/TSV staging &amp; additive import,
              and read-only library quality diagnostics. All operations occur locally in your browser.
            </p>
          </div>
          <div className="row-inline">
            <Link href="/enrichment" className="btn" data-testid="nav-enrichment-link">
              Source Enrichment
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() => void loadSnapshot()}
              disabled={loading}
            >
              Refresh library
            </button>
          </div>
        </div>

        {storageError && (
          <div className="banner banner-error" role="alert">
            <strong>Local storage unavailable:</strong> {storageError}
          </div>
        )}

        <div className="workbench-grid-equal">
          {/* C1 Presentation Exports */}
          <section className="panel sticky-panel stack-md" aria-labelledby="presentation-export-heading">
            <div>
              <p className="status-label">PRESENTATION EXPORTS (C1)</p>
              <h2 id="presentation-export-heading">Deterministic table &amp; list exports</h2>
              <p className="muted small">
                Presentation exports are deterministic read-only projections (CSV cells apply
                spreadsheet formula-injection protection without modifying stored terminology).
                Presentation exports are <strong>not</strong> complete recoverable backups.
              </p>
            </div>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="export-scope">Export scope</label>
                <select
                  id="export-scope"
                  className="select"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as ExportScope)}
                >
                  <option value="library-expressions">Library expressions</option>
                  <option value="library-concepts">Library concepts (one display form)</option>
                  <option value="current-run">
                    Current extraction run ({sessionRun ? `${sessionRun.occurrences.length} occ.` : 'none in session'})
                  </option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="export-format">Output format</label>
                <select
                  id="export-format"
                  className="select"
                  value={format}
                  onChange={(event) => setFormat(event.target.value as ExportFormat)}
                >
                  <option value="csv">CSV (formula-safe RFC 4180)</option>
                  <option value="md">Markdown table (.md)</option>
                  <option value="txt">Plain text tab-delimited (.txt)</option>
                  <option value="json">Structured presentation JSON (.json)</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="export-sort">Deterministic sort</label>
                <select
                  id="export-sort"
                  className="select"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as ExportSort)}
                >
                  <option value="alphabetical">Alphabetical (UTF-16 binary order)</option>
                  <option value="frequency">Frequency (descending, missing last)</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="export-language">Language filter</label>
                <select
                  id="export-language"
                  className="select"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as ExportLanguageFilter)}
                >
                  <option value="all">All languages</option>
                  <option value="en">English (en / US / GB)</option>
                  <option value="tr">Turkish (tr)</option>
                  <option value="shared">Shared</option>
                </select>
              </div>
            </div>

            {scope === 'current-run' && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={includeKnown}
                  onChange={(event) => setIncludeKnown(event.target.checked)}
                />
                <span>Include known-form occurrences from current session run</span>
              </label>
            )}

            {downloadNotice && (
              <div className="banner banner-success" role="status">
                {downloadNotice}
              </div>
            )}

            <div className="row-inline" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading || !snapshot}
                onClick={handleDownloadExport}
              >
                Download {format.toUpperCase()} export
              </button>
              <span className="muted small">
                {rows.length} {rows.length === 1 ? 'row' : 'rows'} in projection
              </span>
            </div>

            <div>
              <h3>Export preview</h3>
              <pre className="code-preview" data-testid="export-preview">
                {formattedPreview || '(No rows match the current export selection)'}
              </pre>
            </div>
          </section>

          {/* C2 / C3 Backup & Restore */}
          <BackupPanel
            snapshot={snapshot}
            disabled={loading || Boolean(storageError)}
            onRestored={loadSnapshot}
          />
        </div>

        {/* WP03 E6: Reviewed Synthetic Data Operations */}
        <DataOperationsPanel
          snapshot={snapshot}
          disabled={loading || Boolean(storageError)}
          onSnapshotChanged={loadSnapshot}
        />

        {/* WP03 E7: Read-Only Quality & Maintenance Inspector */}
        <QualityInspectorPanel snapshot={snapshot} />
      </main>
    </>
  );
}
