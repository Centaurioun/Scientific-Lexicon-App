'use client';

import { useEffect, useRef } from 'react';
import type { ProposedChange } from '@/domain/changes';

interface ChangeApprovalDialogProps {
  proposal: ProposedChange | null;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}

export function ChangeApprovalDialog({
  proposal,
  busy,
  onApprove,
  onCancel,
}: ChangeApprovalDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const approveButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (proposal && !wasOpenRef.current) {
      wasOpenRef.current = true;
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      approveButtonRef.current?.focus();
    } else if (!proposal && wasOpenRef.current) {
      wasOpenRef.current = false;
      const target = previousFocusRef.current;
      previousFocusRef.current = null;
      if (target && target.isConnected) {
        target.focus();
      }
    }
  }, [proposal]);

  useEffect(() => {
    if (!proposal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey) {
          if (!active || active === first || !dialogRef.current.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !dialogRef.current.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [proposal, busy, onCancel]);

  if (!proposal) return null;

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-dialog-title"
      >
        <p className="status-label">EXPLICIT CHANGE APPROVAL</p>
        <h2 id="approval-dialog-title">Review and approve change</h2>
        <p className="muted small">
          All canonical library writes require explicit approval bound to this immutable change
          digest. Approving writes locally to browser IndexedDB only.
        </p>

        <div className="metrics-strip" style={{ marginTop: '0.8rem' }}>
          <div className="metric-chip">
            <span>Batch</span>
            <strong>{proposal.payload.batchId.slice(0, 14)}</strong>
          </div>
          <div className="metric-chip">
            <span>Base Rev</span>
            <strong>{proposal.payload.baseLibraryRevision}</strong>
          </div>
          <div className="metric-chip">
            <span>Operations</span>
            <strong>{proposal.payload.ops.length}</strong>
          </div>
        </div>

        <h3>Proposed operations</h3>
        <ul className="preview-list">
          {proposal.preview.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>

        <div className="banner banner-info">
          <strong>SHA-256 Digest:</strong>{' '}
          <span className="mono" style={{ wordBreak: 'break-all' }}>
            {proposal.digest}
          </span>
        </div>

        <div className="form-actions">
          <button
            ref={approveButtonRef}
            type="button"
            className="btn btn-primary"
            onClick={onApprove}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Approve and save'}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
