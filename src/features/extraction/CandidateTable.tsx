'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  formatCandidateReason,
  type CandidateEvidence,
} from '@/domain/candidate-evidence';
import type { DictionaryPackSuggestion } from '@/domain/dictionary-pack';
import type { RankedCandidate, RankMode } from '@/domain/ranking';
import type { Concept, Expression, LibrarySnapshot, Occurrence } from '@/domain/schema';

interface CandidateTableProps {
  occurrences: readonly Occurrence[];
  snapshot: LibrarySnapshot;
  selectedOccurrenceId: string | null;
  rejectedIds: ReadonlySet<string>;
  sessionResolvedMap: ReadonlyMap<string, string>;
  staleWarning: boolean;
  evidenceBySpan?: ReadonlyMap<string, CandidateEvidence>;
  packSuggestionsBySpan?: ReadonlyMap<string, DictionaryPackSuggestion[]>;
  rankMode?: RankMode;
  groupedView?: boolean;
  rankedGroups?: readonly RankedCandidate[];
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
  evidenceBySpan,
  packSuggestionsBySpan,
  rankMode = 'source-order',
  groupedView = false,
  rankedGroups = [],
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

  // Build quick lookup from occurrenceId to its RankedCandidate (for displaying raw ranking features)
  const rankByOccId = new Map<string, RankedCandidate>();
  for (const item of rankedGroups) {
    for (const occId of item.group.occurrenceIds) {
      rankByOccId.set(occId, item);
    }
  }

  const occById = new Map<string, Occurrence>();
  for (const occ of occurrences) {
    occById.set(occ.id, occ);
  }

  const renderOccurrenceRow = (occ: Occurrence) => {
    const isSelected = occ.id === selectedOccurrenceId;
    const isRejected = rejectedIds.has(occ.id);
    const sessionResolvedId = sessionResolvedMap.get(occ.id) ?? null;
    const effectiveResolved = occ.resolvedConceptId ?? sessionResolvedId;
    const spanKey = `${occ.start}:${occ.end}`;
    const evidence = evidenceBySpan?.get(spanKey);
    const packSuggestions = packSuggestionsBySpan?.get(spanKey) ?? [];
    const rankInfo = rankByOccId.get(occ.id);

    const defaultLinkConcept = linkTargetByOcc[occ.id] ?? snapshot.concepts[0]?.id ?? '';
    const defaultResolveConcept = resolveTargetByOcc[occ.id] ?? occ.conceptIds[0] ?? '';

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
          {evidence && evidence.reasons.length > 0 && (
            <div className="row-inline" style={{ marginTop: '0.3rem', flexWrap: 'wrap', gap: '0.25rem' }}>
              {evidence.reasons.map((tag) => (
                <span key={tag} className="tag" style={{ fontSize: '0.7rem' }}>
                  {formatCandidateReason(tag)}
                </span>
              ))}
            </div>
          )}
          {evidence?.abbreviationHypothesis && (
            <div className="small muted" style={{ marginTop: '0.25rem' }}>
              Hypothesis only: <span className="mono">{evidence.abbreviationHypothesis.longForm}</span> (
              <span className="mono">{evidence.abbreviationHypothesis.acronym}</span>) — not auto-linked
            </div>
          )}
          {rankInfo && rankMode !== 'source-order' && (
            <div className="mono small muted" style={{ marginTop: '0.25rem' }}>
              {rankMode === 'c-value'
                ? rankInfo.unigramGroup
                  ? `Unigram · f=${rankInfo.features.frequency} (C-value n/a)`
                  : `C-value=${rankInfo.score?.toFixed(3)} · f=${rankInfo.features.frequency}, n=${rankInfo.features.tokenCount}, nested=${rankInfo.features.nestedContainerCount}`
                : `f=${rankInfo.features.frequency}, n=${rankInfo.features.tokenCount}`}
            </div>
          )}
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
          {occ.conceptIds.length > 0 && (
            <div className="row-inline" style={{ marginTop: '0.3rem', flexWrap: 'wrap', gap: '0.3rem' }}>
              {occ.conceptIds.map((cid) => (
                <Link
                  key={cid}
                  href={`/library?concept=${encodeURIComponent(cid)}`}
                  className="btn btn-sm btn-subtle"
                  style={{ textDecoration: 'none', fontSize: '0.72rem' }}
                >
                  Inspect {cid.slice(0, 8)}
                </Link>
              ))}
            </div>
          )}
          {packSuggestions.length > 0 && (
            <div className="stack-sm" style={{ marginTop: '0.35rem' }}>
              {packSuggestions.map((sug) => (
                <div
                  key={`${sug.packId}:${sug.start}:${sug.end}`}
                  className="small"
                  style={{
                    padding: '0.3rem 0.45rem',
                    border: '1px solid var(--line)',
                    borderRadius: '0.35rem',
                    background: 'var(--paper)',
                  }}
                >
                  <span className="tag tag-amber" style={{ fontSize: '0.68rem' }}>
                    Pack hint (unverified)
                  </span>{' '}
                  <strong>{sug.packName}</strong> ({sug.authority}, {sug.release}, {sug.license}) ·{' '}
                  <span className="mono">
                    {sug.entries.map((e) => e.externalId ?? e.id).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </td>

        <td>
          <div className="stack-sm">
            <div className="row-inline" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
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
  };

  if (groupedView && rankedGroups.length > 0) {
    return (
      <div className="stack-md" data-testid="grouped-candidate-list">
        {rankedGroups.map((item) => {
          const groupOccurrences = item.group.occurrenceIds
            .map((id) => occById.get(id))
            .filter((o): o is Occurrence => Boolean(o));
          if (groupOccurrences.length === 0) return null;

          return (
            <article
              key={item.group.key}
              className="concept-card"
              data-testid="ranked-group-card"
            >
              <div className="concept-card-header">
                <div className="stack-sm">
                  <div className="row-inline" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                    <strong>{item.group.surface}</strong>
                    <span className={stateBadgeClass(item.group.state)}>{item.group.state}</span>
                    <span className="tag tag-mono">f={item.features.frequency}</span>
                    <span className="tag tag-mono">n={item.features.tokenCount}</span>
                    {rankMode === 'c-value' &&
                      (item.unigramGroup ? (
                        <span className="tag tag-amber">Unigram (raw frequency only)</span>
                      ) : (
                        <span className="tag tag-indigo">
                          C-value: {item.score?.toFixed(3)}
                        </span>
                      ))}
                  </div>
                  <div className="small muted mono">
                    {item.features.formulaDescription}: {item.features.formulaDetails}
                    {item.features.nestedContainerSurfaces.length > 0
                      ? ` · nested in: ${item.features.nestedContainerSurfaces.join(', ')}`
                      : ''}
                  </div>
                </div>
              </div>

              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ tableLayout: 'auto', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '34%' }}>Span &amp; Evidence</th>
                      <th style={{ width: '18%' }}>State</th>
                      <th style={{ width: '22%' }}>Links</th>
                      <th style={{ width: '26%' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>{groupOccurrences.map(renderOccurrenceRow)}</tbody>
                </table>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  // Flat per-occurrence table (reordered by rankMode if active, preserving every occurrence row)
  const orderedOccurrences: Occurrence[] =
    rankMode === 'source-order' || rankedGroups.length === 0
      ? [...occurrences]
      : rankedGroups.flatMap((item) =>
          item.group.occurrenceIds
            .map((id) => occById.get(id))
            .filter((o): o is Occurrence => Boolean(o)),
        );

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
        <tbody>{orderedOccurrences.map(renderOccurrenceRow)}</tbody>
      </table>
    </div>
  );
}
