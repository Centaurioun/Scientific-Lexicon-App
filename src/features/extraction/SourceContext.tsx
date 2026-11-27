'use client';

import { memo, useMemo } from 'react';
import {
  formatCandidateReason,
  type CandidateEvidence,
} from '@/domain/candidate-evidence';
import type { DictionaryPackSuggestion } from '@/domain/dictionary-pack';
import type { ParsedDocument } from '@/domain/document-input';
import type { Occurrence } from '@/domain/schema';

interface SourceContextProps {
  text: string;
  occurrences: readonly Occurrence[];
  selectedOccurrenceId: string | null;
  parsedDocument?: ParsedDocument;
  evidenceBySpan?: ReadonlyMap<string, CandidateEvidence>;
  packSuggestionsBySpan?: ReadonlyMap<string, DictionaryPackSuggestion[]>;
  onSelectOccurrence: (occurrenceId: string) => void;
}

interface TextSegment {
  key: string;
  text: string;
  occurrence: Occurrence | null;
}

/**
 * Segments source text into non-overlapping clickable display slices in O(N) time
 * while prioritizing the currently selected occurrence (even when nested inside a
 * longer candidate span). Relies on occurrences sorted by start asc, longer span first.
 * Never mutates source text or drops any characters.
 */
function buildDisplaySegments(
  text: string,
  occurrences: readonly Occurrence[],
  selectedId: string | null,
): TextSegment[] {
  if (occurrences.length === 0) {
    return [{ key: 'plain-0', text, occurrence: null }];
  }

  const selected = selectedId ? occurrences.find((o) => o.id === selectedId) ?? null : null;
  const chosen: Occurrence[] = [];
  let lastEnd = -1;
  let insertedSelected = false;

  // Single O(N) sweep: occurrences are sorted by start asc, length desc.
  for (const occ of occurrences) {
    if (selected) {
      if (occ.id === selected.id) continue;
      // Skip any occurrence overlapping the prioritized selected span
      if (occ.start < selected.end && occ.end > selected.start) continue;
      // Insert selected span in sorted order once we pass its start
      if (!insertedSelected && occ.start >= selected.end) {
        chosen.push(selected);
        insertedSelected = true;
        if (selected.end > lastEnd) {
          lastEnd = selected.end;
        }
      }
    }

    if (occ.start >= lastEnd) {
      chosen.push(occ);
      lastEnd = occ.end;
    }
  }

  if (selected && !insertedSelected) {
    chosen.push(selected);
  }

  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const occ of chosen) {
    if (occ.start > cursor) {
      segments.push({
        key: `plain-${cursor}`,
        text: text.slice(cursor, occ.start),
        occurrence: null,
      });
    }
    segments.push({
      key: occ.id,
      text: text.slice(occ.start, occ.end),
      occurrence: occ,
    });
    cursor = occ.end;
  }

  if (cursor < text.length) {
    segments.push({
      key: `plain-${cursor}`,
      text: text.slice(cursor),
      occurrence: null,
    });
  }

  return segments;
}

function classForState(state: Occurrence['state'], isActive: boolean): string {
  const base =
    state === 'known-form'
      ? 'occ-mark occ-known'
      : state === 'ambiguous' || state === 'possible-new-form'
        ? 'occ-mark occ-ambiguous'
        : 'occ-mark occ-new';
  return isActive ? `${base} occ-active` : base;
}

export const SourceContext = memo(function SourceContext({
  text,
  occurrences,
  selectedOccurrenceId,
  parsedDocument,
  evidenceBySpan,
  packSuggestionsBySpan,
  onSelectOccurrence,
}: SourceContextProps) {
  const segments = useMemo(
    () => buildDisplaySegments(text, occurrences, selectedOccurrenceId),
    [text, occurrences, selectedOccurrenceId],
  );
  const active = useMemo(
    () => (selectedOccurrenceId ? occurrences.find((o) => o.id === selectedOccurrenceId) ?? null : null),
    [occurrences, selectedOccurrenceId],
  );
  const activeKey = active ? `${active.start}:${active.end}` : null;
  const activeEvidence = activeKey ? evidenceBySpan?.get(activeKey) : undefined;
  const activePackSuggestions = activeKey ? packSuggestionsBySpan?.get(activeKey) ?? [] : [];

  return (
    <section className="panel sticky-panel stack-md" aria-labelledby="source-context-heading">
      <div className="panel-header" style={{ marginBottom: 0 }}>
        <div>
          <p className="status-label">SOURCE CONTEXT</p>
          <h2 id="source-context-heading">Annotated source text</h2>
        </div>
        <div className="row-inline small">
          <span className="tag tag-indigo">known-form</span>
          <span className="tag tag-accent">new-candidate</span>
          <span className="tag tag-amber">ambiguous / possible</span>
        </div>
      </div>

      {parsedDocument && (
        <div className="small muted row-inline" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
          <span className="tag tag-mono">Format: {parsedDocument.format}</span>
          <span className="tag tag-mono">Parser: {parsedDocument.parserVersion}</span>
          <span className="tag tag-mono">Sections: {parsedDocument.sections.length}</span>
          <span className="tag tag-mono">
            Excluded ranges: {parsedDocument.excludedRanges.length}
          </span>
        </div>
      )}

      {parsedDocument && parsedDocument.warnings.length > 0 && (
        <div className="banner banner-warning" role="status" style={{ marginBottom: 0 }}>
          <strong>Parser warnings ({parsedDocument.warnings.length}):</strong>
          <ul style={{ margin: '0.35rem 0 0 1.2rem', padding: 0 }}>
            {parsedDocument.warnings.map((warning, idx) => (
              <li key={idx} className="small">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="source-context-box" data-testid="source-context">
        {segments.map((seg) =>
          seg.occurrence ? (
            <button
              key={seg.key}
              type="button"
              className={classForState(
                seg.occurrence.state,
                seg.occurrence.id === selectedOccurrenceId,
              )}
              onClick={() => onSelectOccurrence(seg.occurrence!.id)}
              title={`${seg.occurrence.state} [${seg.occurrence.start}, ${seg.occurrence.end})`}
            >
              {seg.text}
            </button>
          ) : (
            <span key={seg.key}>{seg.text}</span>
          ),
        )}
      </div>

      {active && (
        <div className="banner banner-info" style={{ marginBottom: 0 }}>
          <div className="row-inline" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>Selected occurrence:</strong> <span className="mono">{active.surface}</span>{' '}
              <span className="tag tag-mono">
                UTF-16 [{active.start}, {active.end})
              </span>{' '}
              <span className="tag">{active.state}</span>
            </div>
            <div className="small muted">
              Concepts: {active.conceptIds.length} · Expressions: {active.expressionIds.length}
            </div>
          </div>
          <div className="small" style={{ marginTop: '0.45rem' }}>
            Context snippet:{' '}
            <span className="mono">
              …{text.slice(Math.max(0, active.start - 45), active.start)}[
              <strong>{active.surface}</strong>]
              {text.slice(active.end, Math.min(text.length, active.end + 45))}…
            </span>
          </div>
          {activeEvidence && (
            <div className="small" style={{ marginTop: '0.4rem' }}>
              <strong>Evidence ({activeEvidence.grammarVersion}):</strong>{' '}
              {activeEvidence.reasons.map(formatCandidateReason).join(', ')}
              {activeEvidence.posPattern ? ` · POS: ${activeEvidence.posPattern}` : ''}
            </div>
          )}
          {activeEvidence?.abbreviationHypothesis && (
            <div className="small" style={{ marginTop: '0.3rem' }}>
              <strong>Acronym hypothesis (not canonical):</strong>{' '}
              <span className="mono">{activeEvidence.abbreviationHypothesis.longForm}</span> ↔{' '}
              <span className="mono">{activeEvidence.abbreviationHypothesis.acronym}</span>
            </div>
          )}
          {activePackSuggestions.length > 0 && (
            <div className="small" style={{ marginTop: '0.3rem' }}>
              <strong>Local pack suggestion (unverified):</strong>{' '}
              {activePackSuggestions
                .map(
                  (s) =>
                    `${s.packName} (${s.authority}, ${s.release}, ${s.license}) [${s.entries.map((e) => e.externalId ?? e.id).join(', ')}]`,
                )
                .join(' · ')}
            </div>
          )}
        </div>
      )}
    </section>
  );
});
