'use client';

import { useEffect, useState } from 'react';
import {
  MAX_CANDIDATE_OCCURRENCES,
  MAX_TEXT_UTF16_CODE_UNITS,
  MAX_TXT_INPUT_BYTES,
  MIN_CANDIDATE_OCCURRENCES,
  parseProcessingLimits,
  type ProcessingLimits,
} from '@/domain/processing-limits';

interface ProcessingLimitsPanelProps {
  limits: ProcessingLimits;
  disabled: boolean;
  notice: string | null;
  onSave: (limits: ProcessingLimits) => void;
}

export function ProcessingLimitsPanel({ limits, disabled, notice, onSave }: ProcessingLimitsPanelProps) {
  const [draft, setDraft] = useState<ProcessingLimits>(limits);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(limits), [limits]);

  const update = (field: keyof ProcessingLimits, value: string) => {
    setDraft((current) => ({ ...current, [field]: value === '' ? Number.NaN : Number(value) }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      onSave(parseProcessingLimits(draft));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Processing limits are invalid.');
    }
  };

  return (
    <section className="panel stack-sm" aria-labelledby="processing-limits-heading">
      <div className="panel-header" style={{ marginBottom: 0 }}>
        <div>
          <p className="status-label">BROWSER-LOCAL OPERATIONAL PREFERENCES</p>
          <h2 id="processing-limits-heading">Processing limits</h2>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        These preferences are stored in this browser only. They do not change terminology records,
        approved changes, or saved backups. Analysis rejects excess input or occurrences; it never
        returns a partial run.
      </p>
      <p className="muted small" style={{ margin: 0 }}>
        Occurrences count distinct spans across known matches and new candidates. Same-span ambiguity
        groups count once; nested spans count separately. The candidate values are provisional
        engineering controls, not scientific accuracy or production-capacity claims.
      </p>
      <form className="stack-sm" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="processing-max-txt-bytes">Maximum TXT input bytes</label>
            <input
              id="processing-max-txt-bytes"
              type="number"
              min={1}
              max={MAX_TXT_INPUT_BYTES}
              step={1}
              className="input"
              value={Number.isNaN(draft.maxTxtInputBytes) ? '' : draft.maxTxtInputBytes}
              disabled={disabled}
              onChange={(event) => update('maxTxtInputBytes', event.target.value)}
            />
            <span className="muted small">1–{MAX_TXT_INPUT_BYTES.toLocaleString('en-US')} bytes; lower values only.</span>
          </div>
          <div className="field">
            <label htmlFor="processing-max-text-units">Maximum text UTF-16 code units</label>
            <input
              id="processing-max-text-units"
              type="number"
              min={1}
              max={MAX_TEXT_UTF16_CODE_UNITS}
              step={1}
              className="input"
              value={Number.isNaN(draft.maxTextUtf16CodeUnits) ? '' : draft.maxTextUtf16CodeUnits}
              disabled={disabled}
              onChange={(event) => update('maxTextUtf16CodeUnits', event.target.value)}
            />
            <span className="muted small">1–{MAX_TEXT_UTF16_CODE_UNITS.toLocaleString('en-US')} code units; lower values only.</span>
          </div>
          <div className="field">
            <label htmlFor="processing-max-occurrences">Maximum candidate occurrences</label>
            <input
              id="processing-max-occurrences"
              type="number"
              min={MIN_CANDIDATE_OCCURRENCES}
              max={MAX_CANDIDATE_OCCURRENCES}
              step={1}
              className="input"
              value={Number.isNaN(draft.maxCandidateOccurrences) ? '' : draft.maxCandidateOccurrences}
              disabled={disabled}
              onChange={(event) => update('maxCandidateOccurrences', event.target.value)}
            />
            <span className="muted small">
              {MIN_CANDIDATE_OCCURRENCES.toLocaleString('en-US')}–{MAX_CANDIDATE_OCCURRENCES.toLocaleString('en-US')} distinct spans; provisional default 5,000.
            </span>
          </div>
        </div>
        <div className="row-inline">
          <button type="submit" className="btn" disabled={disabled}>Save processing limits</button>
          <span className="muted small" aria-live="polite">
            Effective: {limits.maxTxtInputBytes.toLocaleString('en-US')} TXT bytes ·{' '}
            {limits.maxTextUtf16CodeUnits.toLocaleString('en-US')} UTF-16 units ·{' '}
            {limits.maxCandidateOccurrences.toLocaleString('en-US')} occurrence spans
          </span>
        </div>
      </form>
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      {notice && <div className="banner banner-info" role="status">{notice}</div>}
    </section>
  );
}
