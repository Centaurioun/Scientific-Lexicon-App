'use client';

import { useState } from 'react';
import type { Concept, Expression, LibrarySnapshot, Occurrence } from '@/domain/schema';

interface CandidateTableProps {
  occurrences: readonly Occurrence[];
  snapshot: LibrarySnapshot;
  selectedOccurrenceId: string | null;
  rejectedIds: ReadonlySet<string>;
  sessionResolvedMap: ReadonlyMap<string, string>;
  staleWarning: boolean;
  onSelectOccurrence: (occurrenceId: string) => void;
  onCreateConcept: (occ: Occurrence) => void;
  onLinkToConcept: (occ: Occurrence, conceptId: string) => void;
  onResolveAmbiguous: (occ: Occurrence, conceptId: string) => void;
  onRejectSession: (occ: Occurrence) => void;
}

function conceptLabel(concept: Concept, expressions: readonly Expression[]): string {
  const forms = expressions.filter((e) => e.conceptId === concept.id);
  const preferred = forms.find((f) => f.role === 'preferred') ?? forms[0];
  return preferred ? `${preferred.text} (${concept.id.slice(0, 8)})` : concept.id.slice(0, 8);
}

function stateBadgeClass(state: Occurrence['state']): string {
  switch (state) {
    case 'known-form':
      return 'tag tag-indigo';
    case 'new-candidate':
      return 'tag tag-accent';
    case 'possible-new-form':
    case 'ambiguous':
      return 'tag tag-amber';
  }
}

export function CandidateTable({
  occurrences,
  snapshot,
  selectedOccurrenceId,
  rejectedIds,
  sessionResolvedMap,
  staleWarning,
  onSelectOccurrence,
  onCreateConcept,
  onLinkToConcept,
  onResolveAmbiguous,
  onRejectSession,
}: CandidateTableProps) {
  const [linkTargetByOcc, setLinkTargetByOcc] = useState<Record<string, string>>({});
  const [resolveTargetByOcc, setResolveTargetByOcc] = useState<Record<string, string>>({});

  if (occurrences.length === 0) {
    return (
      <div className="empty-state">
        <h3>No occurrences in this filter</h3>
        <p>Switch filter tabs or analyze another scientific passage to inspect candidates.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Surface &amp; Span</th>
            <th>State</th>
            <th>Associations</th>
            <th>Explicit Review Actions</th>
          </tr>
        </thead>
        <tbody>
          {occurrences.map((occ) => {
            const isSelected = occ.id === selectedOccurrenceId;
            const isRejected = rejectedIds.has(occ.id);
            const sessionResolvedId = sessionResolvedMap.get(occ.id) ?? null;
            const effectiveResolved = occ.resolvedConceptId ?? sessionResolvedId;

            const defaultLinkConcept =
              linkTargetByOcc[occ.id] ?? snapshot.concepts[0]?.id ?? '';
            const defaultResolveConcept =
              resolveTargetByOcc[occ.id] ?? occ.conceptIds[0] ?? '';

            return (
              <tr
                key={occ.id}
                data-testid="candidate-row"
                className={isSelected ? 'row-selected' : undefined}
              >
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-subtle"
                    onClick={() => onSelectOccurrence(occ.id)}
                    style={{ fontWeight: 700, marginBottom: '0.25rem' }}
                  >
                    {occ.surface}
                  </button>
                  <div className="mono muted small">
                    [{occ.start}, {occ.end})
                  </div>
                </td>

                <td>
                  <div className="stack-sm">
                    <span className={stateBadgeClass(occ.state)}>{occ.state}</span>
                    {isRejected && <span className="tag tag-danger">rejected (session)</span>}
                    {sessionResolvedId && (
                      <span className="tag tag-accent">
                        resolved (session): {sessionResolvedId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                </td>

                <td className="small">
                  <div>
                    Concepts: <strong>{occ.conceptIds.length}</strong> · Forms:{' '}
                    <strong>{occ.expressionIds.length}</strong>
                  </div>
                  <div className="muted">
                    {effectiveResolved
                      ? `Resolved concept: ${effectiveResolved.slice(0, 8)}`
                      : 'Unresolved (requires explicit review)'}
                  </div>
                </td>

                <td>
                  <div className="stack-sm">
                    <div className="row-inline">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={staleWarning}
                        onClick={() => onCreateConcept(occ)}
                      >
                        Create concept
                      </button>

                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onRejectSession(occ)}
                      >
                        {isRejected ? 'Undo reject' : 'Reject'}
                      </button>
                    </div>

                    {snapshot.concepts.length > 0 && (
                      <div className="row-inline">
                        <select
                          aria-label={`Target concept to link ${occ.surface}`}
                          className="select"
                          style={{ width: 'auto', minWidth: '10rem', padding: '0.26rem 0.45rem', fontSize: '0.78rem' }}
                          value={defaultLinkConcept}
                          onChange={(event) =>
                            setLinkTargetByOcc((prev) => ({
                              ...prev,
                              [occ.id]: event.target.value,
                            }))
                          }
                        >
                          {snapshot.concepts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {conceptLabel(c, snapshot.expressions)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-sm btn-subtle"
                          disabled={staleWarning || !defaultLinkConcept}
                          onClick={() => onLinkToConcept(occ, defaultLinkConcept)}
                        >
                          Link form
                        </button>
                      </div>
                    )}

                    {occ.state === 'ambiguous' && occ.conceptIds.length > 1 && (
                      <div className="row-inline">
                        <select
                          aria-label={`Resolve ambiguous concept for ${occ.surface}`}
                          className="select"
                          style={{ width: 'auto', minWidth: '10rem', padding: '0.26rem 0.45rem', fontSize: '0.78rem' }}
                          value={defaultResolveConcept}
                          onChange={(event) =>
                            setResolveTargetByOcc((prev) => ({
                              ...prev,
                              [occ.id]: event.target.value,
                            }))
                          }
                        >
                          {occ.conceptIds.map((cid) => {
                            const concept = snapshot.concepts.find((c) => c.id === cid);
                            return (
                              <option key={cid} value={cid}>
                                {concept ? conceptLabel(concept, snapshot.expressions) : cid}
                              </option>
                            );
                          })}
                        </select>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={!defaultResolveConcept}
                          onClick={() => onResolveAmbiguous(occ, defaultResolveConcept)}
                        >
                          Resolve in session
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
