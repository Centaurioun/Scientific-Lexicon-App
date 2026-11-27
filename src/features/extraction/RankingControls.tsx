'use client';

import type { CandidateGrammarMode } from '@/domain/candidate-evidence';
import type { DictionaryPack } from '@/domain/dictionary-pack';
import type { DocumentFormat } from '@/domain/document-input';
import type { RankMode } from '@/domain/ranking';

export interface RankingControlsProps {
  grammarMode: CandidateGrammarMode;
  inputFormat: Exclude<DocumentFormat, 'docx'>;
  rankMode: RankMode;
  groupedView: boolean;
  dictionaryPack: DictionaryPack | null;
  usePackAsHints: boolean;
  packError: string | null;
  disabled: boolean;
  onGrammarModeChange: (mode: CandidateGrammarMode) => void;
  onInputFormatChange: (format: Exclude<DocumentFormat, 'docx'>) => void;
  onRankModeChange: (mode: RankMode) => void;
  onGroupedViewChange: (grouped: boolean) => void;
  onDictionaryPackUpload: (file: File) => void;
  onClearDictionaryPack: () => void;
  onUsePackAsHintsChange: (enabled: boolean) => void;
}

export function RankingControls({
  grammarMode,
  inputFormat,
  rankMode,
  groupedView,
  dictionaryPack,
  usePackAsHints,
  packError,
  disabled,
  onGrammarModeChange,
  onInputFormatChange,
  onRankModeChange,
  onGroupedViewChange,
  onDictionaryPackUpload,
  onClearDictionaryPack,
  onUsePackAsHintsChange,
}: RankingControlsProps) {
  return (
    <section className="panel stack-sm" aria-labelledby="scientific-controls-heading">
      <div className="panel-header" style={{ marginBottom: 0 }}>
        <div>
          <p className="status-label">SCIENTIFIC EXTRACTION &amp; RANKING CONTROLS (WP02)</p>
          <h2 id="scientific-controls-heading">Grammar, input format, ranking &amp; local pack</h2>
        </div>
        <div className="row-inline">
          <span className="tag">
            {grammarMode === 's1-grammar-1' ? 'S1 baseline active' : 'S2 experimental active'}
          </span>
          <span className="tag tag-amber">DOCX blocked (awaiting G1)</span>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="grammar-mode-select">Candidate grammar mode</label>
          <select
            id="grammar-mode-select"
            className="select"
            value={grammarMode}
            disabled={disabled}
            onChange={(event) => onGrammarModeChange(event.target.value as CandidateGrammarMode)}
          >
            <option value="s1-grammar-1">S1 Baseline (s1-grammar-1)</option>
            <option value="s2-grammar-2">S2 Scientific Experimental (s2-grammar-2)</option>
          </select>
          <span className="muted small">
            Switching grammar clears any prior run so S1 and S2 outputs never mix.
          </span>
        </div>

        <div className="field">
          <label htmlFor="input-format-select">Source document format</label>
          <select
            id="input-format-select"
            className="select"
            value={inputFormat}
            disabled={disabled}
            onChange={(event) =>
              onInputFormatChange(event.target.value as Exclude<DocumentFormat, 'docx'>)
            }
          >
            <option value="txt">Plain text (.txt)</option>
            <option value="markdown">Structured Markdown (.md)</option>
          </select>
          <span className="muted small">
            Markdown excludes code fences, inline code, and link URLs without fabricating offsets.
            DOCX is disabled pending separate G1 dependency qualification.
          </span>
        </div>

        <div className="field">
          <label htmlFor="rank-mode-select">Candidate ordering / ranking</label>
          <select
            id="rank-mode-select"
            className="select"
            value={rankMode}
            disabled={disabled}
            onChange={(event) => onRankModeChange(event.target.value as RankMode)}
          >
            <option value="source-order">Source order (document offset)</option>
            <option value="frequency">Raw frequency f(a)</option>
            <option value="c-value">Canonical multiword C-value (unigrams separate)</option>
          </select>
          <span className="muted small">
            Display-only session ranking; shows raw features only (never calibrated confidence) and
            never modifies the library.
          </span>
        </div>
      </div>

      <label className="checkbox-row">
        <input
          id="grouped-view-toggle"
          type="checkbox"
          checked={groupedView}
          disabled={disabled}
          onChange={(event) => onGroupedViewChange(event.target.checked)}
        />
        <span>
          Group identical exact surfaces with ranking breakdown (preserves per-occurrence explicit
          review actions; never merges distinct concepts)
        </span>
      </label>

      <div
        className="stack-sm"
        style={{
          paddingTop: '0.75rem',
          borderTop: '1px solid var(--line)',
        }}
      >
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="field field-grow">
            <label htmlFor="dictionary-pack-input">
              Optional local dictionary pack (.json, session-only, read-only)
            </label>
            <input
              id="dictionary-pack-input"
              type="file"
              accept=".json,application/json"
              className="input"
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) onDictionaryPackUpload(file);
              }}
            />
          </div>
          {dictionaryPack && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={disabled}
              onClick={onClearDictionaryPack}
            >
              Clear pack
            </button>
          )}
        </div>

        {dictionaryPack && (
          <div className="banner banner-info" style={{ marginBottom: 0 }}>
            <div className="row-inline" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>Active session pack:</strong> {dictionaryPack.name}{' '}
                <span className="tag tag-mono">{dictionaryPack.entries.length} entries</span>{' '}
                <span className="tag tag-amber">Unverified / read-only</span>
              </div>
              <div className="small muted">
                Authority: {dictionaryPack.source.authority} · Release:{' '}
                {dictionaryPack.source.release} · License: {dictionaryPack.source.license}
              </div>
            </div>
            <label className="checkbox-row" style={{ marginTop: '0.5rem' }}>
              <input
                id="pack-discovery-hints-toggle"
                type="checkbox"
                checked={usePackAsHints}
                disabled={disabled}
                onChange={(event) => onUsePackAsHintsChange(event.target.checked)}
              />
              <span>
                Also surface unmatched pack hits as bounded new-candidate discovery hints (counts
                toward occurrence cap; never marked known-form)
              </span>
            </label>
          </div>
        )}

        {packError && (
          <div className="banner banner-error" role="alert" style={{ marginBottom: 0 }}>
            {packError}
          </div>
        )}
      </div>
    </section>
  );
}
