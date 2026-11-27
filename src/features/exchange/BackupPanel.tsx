'use client';

import { useEffect, useState } from 'react';
import {
  getBrowserLibraryRepository,
  inspectBrowserStorageStatus,
  type BrowserStorageStatus,
} from '@/adapters/storage/dexie-library';
import {
  createBackup,
  MAX_BACKUP_FILE_BYTES,
  parseBackupFileText,
  serializeBackupFile,
  type BackupEnvelope,
} from '@/application/exchange';
import { approveRestore, restoreEmptyLibrary } from '@/application/library';
import type { LibrarySnapshot } from '@/domain/schema';

interface BackupPanelProps {
  snapshot: LibrarySnapshot | null;
  disabled: boolean;
  onRestored: () => Promise<void>;
}

function triggerUtf8Download(filename: string, content: string, mimeType: string): void {
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

export function BackupPanel({ snapshot, disabled, onRestored }: BackupPanelProps) {
  const [storageStatus, setStorageStatus] = useState<BrowserStorageStatus | null>(null);
  const [backupInfo, setBackupInfo] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [creatingBackup, setCreatingBackup] = useState(false);

  const [validatedRestore, setValidatedRestore] = useState<BackupEnvelope | null>(null);
  const [restoreFilename, setRestoreFilename] = useState<string>('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    void inspectBrowserStorageStatus(false).then(setStorageStatus);
  }, []);

  const handleRequestPersistence = async () => {
    const status = await inspectBrowserStorageStatus(true);
    setStorageStatus(status);
  };

  const handleDownloadBackup = async () => {
    if (!snapshot) return;
    setCreatingBackup(true);
    setBackupError(null);
    setBackupInfo(null);
    try {
      const envelope = await createBackup(snapshot);
      const serialized = serializeBackupFile(envelope);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `termforge-backup-rev${snapshot.libraryRevision}-${stamp}.json`;
      triggerUtf8Download(filename, serialized, 'application/json');
      setBackupInfo(
        `Backup file "${filename}" offered for download (Rev ${snapshot.libraryRevision}, SHA-256 ${envelope.digest.slice(0, 16)}…). Verify and store this file outside your browser.`,
      );
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : 'Unable to generate portable backup.');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleSelectBackupFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setRestoreError(null);
    setRestoreNotice(null);
    setValidatedRestore(null);
    setRestoreFilename(file.name);

    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setRestoreError(
        `Selected backup exceeds the ${(MAX_BACKUP_FILE_BYTES / (1024 * 1024)).toFixed(0)} MiB maximum size and was rejected without reading.`,
      );
      return;
    }

    try {
      const text = await file.text();
      const validated = await parseBackupFileText(text);
      setValidatedRestore(validated);
    } catch (error) {
      setRestoreError(
        error instanceof Error ? error.message : 'Selected file failed backup validation.',
      );
    }
  };

  const handleConfirmRestore = async () => {
    if (!validatedRestore) return;
    setRestoring(true);
    setRestoreError(null);
    setRestoreNotice(null);

    try {
      const repo = getBrowserLibraryRepository();
      const approval = approveRestore(validatedRestore);
      const result = await restoreEmptyLibrary(repo, validatedRestore, approval);

      if (result.status === 'applied' || result.status === 'replay') {
        setValidatedRestore(null);
        await onRestored();
        setRestoreNotice(
          `Restored validated backup atomically (library revision ${result.revision}).`,
        );
      } else {
        setRestoreError(`${result.status.toUpperCase()}: ${result.reason}`);
      }
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : 'Atomic restore failed.');
    } finally {
      setRestoring(false);
    }
  };

  const targetIsEmpty =
    snapshot !== null &&
    snapshot.libraryRevision === 0 &&
    snapshot.concepts.length === 0 &&
    snapshot.expressions.length === 0 &&
    snapshot.audit.length === 0 &&
    snapshot.batches.length === 0 &&
    snapshot.documents.length === 0;

  return (
    <section className="panel stack-md" aria-labelledby="backup-recovery-heading">
      <div>
        <p className="status-label">PORTABLE BACKUP &amp; ATOMIC RECOVERY (C2 / C3)</p>
        <h2 id="backup-recovery-heading">Complete backup &amp; empty-target restore</h2>
        <p className="muted small">
          Portable backups use format <span className="mono">termforge-backup</span> v1 with a
          canonical SHA-256 digest over the complete persisted library snapshot (concepts,
          expressions, assertions, provenance, retained sources, runs, batches, and audit).
          Presentation exports are never accepted as backups.
        </p>
      </div>

      {/* Browser storage & origin isolation warning */}
      <div className="banner banner-warning">
        <div className="stack-sm">
          <div>
            <strong>Browser storage is not a permanent backup:</strong> IndexedDB data is isolated
            to this exact browser origin and may be evicted by the browser or lost when clearing
            site data or switching disposable preview origins. Download portable backups regularly.
          </div>
          {storageStatus && (
            <div className="row-inline small" style={{ justifyContent: 'space-between' }}>
              <span>
                Persistent storage grant:{' '}
                <strong data-testid="storage-persisted">
                  {storageStatus.persisted === true
                    ? 'granted (true)'
                    : storageStatus.persisted === false
                      ? 'not granted (false)'
                      : 'unknown / unsupported'}
                </strong>
                {storageStatus.quotaBytes !== null && (
                  <>
                    {' '}
                    · Usage:{' '}
                    <span className="mono">
                      {((storageStatus.usageBytes ?? 0) / 1024).toFixed(1)} KiB
                    </span>{' '}
                    / Quota:{' '}
                    <span className="mono">
                      {(storageStatus.quotaBytes / (1024 * 1024)).toFixed(0)} MiB
                    </span>
                  </>
                )}
              </span>
              {storageStatus.persistenceSupported && storageStatus.persisted !== true && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void handleRequestPersistence()}
                >
                  Request browser persistence
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Generate Backup */}
      <div className="stack-sm">
        <h3>1. Create complete portable backup</h3>
        {backupError && (
          <div className="banner banner-error" role="alert">
            {backupError}
          </div>
        )}
        {backupInfo && (
          <div className="banner banner-success" role="status">
            {backupInfo}
          </div>
        )}
        <div className="row-inline">
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabled || !snapshot || creatingBackup}
            onClick={() => void handleDownloadBackup()}
          >
            {creatingBackup ? 'Generating backup…' : 'Download complete backup (.json)'}
          </button>
          {snapshot && (
            <span className="muted small">
              Includes Rev {snapshot.libraryRevision} · {snapshot.concepts.length} concepts ·{' '}
              {snapshot.expressions.length} expressions · {snapshot.documents.length} retained
              sources
            </span>
          )}
        </div>
      </div>

      <hr className="divider" />

      {/* Validate & Restore */}
      <div className="stack-sm">
        <h3>2. Validate &amp; restore backup into an empty library</h3>
        <p className="muted small" style={{ margin: 0 }}>
          Restore is permitted <strong>only</strong> into a genuinely empty target library (Rev 0
          with zero records across all stores). Existing library data is never silently overwritten.
        </p>

        {!targetIsEmpty && snapshot && (
          <div className="banner banner-info">
            Current library is non-empty (Rev {snapshot.libraryRevision}, {snapshot.concepts.length}{' '}
            concepts). You may still validate backup files below to inspect their integrity, but
            atomic restore will refuse to overwrite this non-empty target.
          </div>
        )}

        <div className="field">
          <label htmlFor="backup-file-input">Select portable backup file (.json)</label>
          <input
            id="backup-file-input"
            type="file"
            accept=".json,application/json"
            className="input"
            disabled={disabled}
            onChange={(event) => void handleSelectBackupFile(event)}
          />
        </div>

        {restoreError && (
          <div className="banner banner-error" role="alert">
            <strong>Backup validation / restore error:</strong> {restoreError}
          </div>
        )}

        {restoreNotice && (
          <div className="banner banner-success" role="status">
            {restoreNotice}
          </div>
        )}

        {validatedRestore && (
          <div className="setup-card" style={{ padding: '1rem' }} data-testid="restore-preview">
            <p className="status-label">VALIDATED BACKUP PREVIEW</p>
            <h3 style={{ marginBottom: '0.4rem' }}>
              {restoreFilename || 'Portable backup'} — SHA-256 verified
            </h3>
            <div className="metrics-strip">
              <div className="metric-chip">
                <span>Revision</span>
                <strong>Rev {validatedRestore.snapshot.libraryRevision}</strong>
              </div>
              <div className="metric-chip">
                <span>Concepts</span>
                <strong>{validatedRestore.snapshot.concepts.length}</strong>
              </div>
              <div className="metric-chip">
                <span>Expressions</span>
                <strong>{validatedRestore.snapshot.expressions.length}</strong>
              </div>
              <div className="metric-chip">
                <span>Assertions</span>
                <strong>{validatedRestore.snapshot.assertions.length}</strong>
              </div>
              <div className="metric-chip">
                <span>Retained sources</span>
                <strong>{validatedRestore.snapshot.documents.length}</strong>
              </div>
              <div className="metric-chip">
                <span>Audit entries</span>
                <strong>{validatedRestore.snapshot.audit.length}</strong>
              </div>
            </div>
            <p className="mono small muted" style={{ wordBreak: 'break-all' }}>
              Digest: {validatedRestore.digest}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={restoring || disabled}
                onClick={() => void handleConfirmRestore()}
              >
                {restoring ? 'Restoring…' : 'Confirm atomic restore'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={restoring}
                onClick={() => {
                  setValidatedRestore(null);
                  setRestoreError(null);
                }}
              >
                Cancel restore
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
