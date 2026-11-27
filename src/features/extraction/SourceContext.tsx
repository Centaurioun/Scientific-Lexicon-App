'use client';

import type { Occurrence } from '@/domain/schema';

interface SourceContextProps {
  text: string;
  occurrences: readonly Occurrence[];
  selectedOccurrenceId: string | null;
  onSelectOccurrence: (occurrenceId: string) => void;
}

interface TextSegment {
  key: string;
  text: string;
  occurrence: Occurrence | null;
}

/**
 * Segments source text into non-overlapping clickable display slices while prioritizing
 * the currently selected occurrence (even when nested inside a longer candidate span).
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

  const chosen: Occurrence[] = [];
  const selected = occurrences.find((o) => o.id === selectedId) ?? null;
  if (selected) {
    chosen.push(selected);
  }

  // Add non-overlapping occurrences sorted by start asc, longer span first
  for (const occ of occurrences) {
    if (selected && occ.id === selected.id) continue;
    const overlaps = chosen.some((c) => occ.start < c.end && occ.end > c.start);
    if (!overlaps) {
      chosen.push(occ);
    }
  }

  chosen.sort((a, b) => a.start - b.start);

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

export function SourceContext({
  text,
  occurrences,
  selectedOccurrenceId,
  onSelectOccurrence,
}: SourceContextProps) {
  const segments = buildDisplaySegments(text, occurrences, selectedOccurrenceId);
  const active = occurrences.find((o) => o.id === selectedOccurrenceId) ?? null;

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
        </div>
      )}
    </section>
  );
}
