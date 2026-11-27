'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  formatCandidateReason,
  type CandidateEvidence,
} from '@/domain/candidate-evidence';
import type { DictionaryPackSuggestion } from '@/domain/dictionary-pack';
import type { RankedCandidate, RankMode } from '@/domain/ranking';
import type { LibrarySnapshot, Occurrence } from '@/domain/schema';

const MAX_DISPLAY_PACK_ENTRIES = 5;
const MAX_DISPLAY_NESTED_CONTAINERS = 6;

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

function formatBoundedEntryIds(sug: DictionaryPackSuggestion): string {
  const total = sug.entries.length;
  const head = sug.entries
    .slice(0, MAX_DISPLAY_PACK_ENTRIES)
    .map((e) => e.externalId ?? e.id)
    .join(', ');
  if (total <= MAX_DISPLAY_PACK_ENTRIES) return head;
  return `${head} (+${(total - MAX_DISPLAY_PACK_ENTRIES).toLocaleString('en-US')} more of ${total.toLocaleString('en-US')})`;
}

function formatBoundedNestedSurfaces(surfaces: readonly string[]): string {
  if (surfaces.length <= MAX_DISPLAY_NESTED_CONTAINERS) {
    return surfaces.join(', ');
  }
  const head = surfaces.slice(0, MAX_DISPLAY_NESTED_CONTAINERS).join(', ');
  return `${head} (+${surfaces.length - MAX_DISPLAY_NESTED_CONTAINERS} more)`;
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
  const [selectedLinkConceptId, setSelectedLinkConceptId] = useState<string>('');
  const [resolveTargetByOcc, setResolveTargetByOcc] = useState<Record<string, string>>({});

  // Precompute concept display labels in O(concepts + expressions) instead of per-row O(C * E).
  const conceptLabelById = useMemo(() => {
    const preferredByConcept = new Map<string, string>();
    const fallbackByConcept = new Map<string, string>();
    for (const expr of snapshot.expressions) {
      if (!fallbackByConcept.has(expr.conceptId)) {
        fallbackByConcept.set(expr.conceptId, expr.text);
      }
      if (expr.role === 'preferred' && !preferredByConcept.has(expr.conceptId)) {
        preferredByConcept.set(expr.conceptId, expr.text);
      }
    }
    const labels = new Map<string, string>();
    for (const concept of snapshot.concepts) {
      const labelText = preferredByConcept.get(concept.id) ?? fallbackByConcept.get(concept.id);
      labels.set(
        concept.id,
        labelText ? `${labelText} (${concept.id.slice(0, 8)})` : concept.id.slice(0, 8),
      );
    }
    return labels;
  }, [snapshot.concepts, snapshot.expressions]);

  const effectiveLinkConceptId = useMemo(() => {
    if (selectedLinkConceptId && conceptLabelById.has(selectedLinkConceptId)) {
      return selectedLinkConceptId;
    }
    return snapshot.concepts[0]?.id ?? '';
  }, [selectedLinkConceptId, conceptLabelById, snapshot.concepts]);

  const rankByOccId = useMemo(() => {
    const map = new Map<string, RankedCandidate>();
    for (const item of rankedGroups) {
      for (const occId of item.group.occurrenceIds) {
        map.set(occId, item);
      }
    }
    return map;
  }, [rankedGroups]);

  const occById = useMemo(() => {
    const map = new Map<string, Occurrence>();
    for (const occ of occurrences) {
      map.set(occ.id, occ);
    }
    return map;
  }, [occurrences]);

  const orderedOccurrences = useMemo<Occurrence[]>(() => {
    if (rankMode === 'source-order' || rankedGroups.length === 0) {
      return [...occurrences];
    }
    return rankedGroups.flatMap((item) =>
      item.group.occurrenceIds
        .map((id) => occById.get(id))
        .filter((o): o is Occurrence => Boolean(o)),
    );
  }, [occurrences, rankMode, rankedGroups, occById]);

  if (occurrences.length === 0) {
    return (
      <div className="empty-state">
        <h3>No occurrences in this filter</h3>
        <p>Switch filter tabs or analyze another scientific passage to inspect candidates.</p>
      </div>
    );
  }

  const effectiveLinkConceptLabel = effectiveLinkConceptId
    ? conceptLabelById.get(effectiveLinkConceptId) ?? effectiveLinkConceptId.slice(0, 8)
    : '';

  const renderOccurrenceRow = (occ: Occurrence) => {
    const isSelected = occ.id === selectedOccurrenceId;
    const isRejected = rejectedIds.has(occ.id);
    const sessionResolvedId = sessionResolvedMap.get(occ.id) ?? null;
    const effectiveResolved = occ.resolvedConceptId ?? sessionResolvedId;
    const spanKey = `${occ.start}:${occ.end}`;
    const evidence = evidenceBySpan?.get(spanKey);
    const packSuggestions = packSuggestionsBySpan?.get(spanKey) ?? [];
    const rankInfo = rankByOccId.get(occ.id);

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
                  <span className="mono">{formatBoundedEntryIds(sug)}</span>
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

              {snapshot.concepts.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-subtle"
                  disabled={staleWarning || !effectiveLinkConceptId}
                  title={`Link "${occ.surface}" to ${effectiveLinkConceptLabel}`}
                  onClick={() => onLinkToConcept(occ, effectiveLinkConceptId)}
                >
                  Link form
                </button>
              )}
            </div>

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
                  {occ.conceptIds.map((cid) => (
                    <option key={cid} value={cid}>
                      {conceptLabelById.get(cid) ?? cid}
                    </option>
                  ))}
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

  const sharedLinkTargetBar =
    snapshot.concepts.length > 0 ? (
      <div
        className="row-inline"
        style={{
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
          padding: '0.5rem 0.75rem',
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: '0.5rem',
        }}
      >
        <label htmlFor="candidate-link-target-select" className="small" style={{ fontWeight: 600 }}>
          Target concept for &ldquo;Link form&rdquo; actions:
        </label>
        <select
          id="candidate-link-target-select"
          className="select"
          style={{ width: 'auto', minWidth: '14rem', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
          value={effectiveLinkConceptId}
          onChange={(event) => setSelectedLinkConceptId(event.target.value)}
        >
          {snapshot.concepts.map((c) => (
            <option key={c.id} value={c.id}>
              {conceptLabelById.get(c.id) ?? c.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  if (groupedView && rankedGroups.length > 0) {
    return (
      <div className="stack-md" data-testid="grouped-candidate-list">
        {sharedLinkTargetBar}
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
                      ? ` · nested in: ${formatBoundedNestedSurfaces(item.features.nestedContainerSurfaces)}`
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

  return (
    <div className="stack-sm">
      {sharedLinkTargetBar}
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
    </div>
  );
}
