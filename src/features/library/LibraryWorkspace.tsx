'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserLibraryRepository } from '@/adapters/storage/dexie-library';
import {
  applyChange,
  approveChange,
  findExpressions,
  listLibrary,
  proposeChange,
} from '@/application/library';
import { AppHeader } from '@/components/AppHeader';
import { ChangeApprovalDialog } from '@/components/ChangeApprovalDialog';
import type { ChangePayload, ProposedChange } from '@/domain/changes';
import {
  EXPRESSION_ROLES,
  languageMatchesFilter,
  type Expression,
  type ExpressionRole,
  type LibrarySnapshot,
} from '@/domain/schema';
import { ConceptEditor, type EditorMode } from './ConceptEditor';
import { ExpressionList } from './ExpressionList';

type LanguageFilter = 'all' | 'en' | 'tr' | 'shared' | 'undetermined';

export function LibraryWorkspace() {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'concepts' | 'expressions'>('concepts');
  const [searchQuery, setSearchQuery] = useState('');
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | ExpressionRole>('all');

  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>({ kind: 'idle' });
  const [editorKey, setEditorKey] = useState(0);

  const [pendingProposal, setPendingProposal] = useState<ProposedChange | null>(null);
  const [applying, setApplying] = useState(false);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setStorageError(null);
    try {
      const repo = getBrowserLibraryRepository();
      const loaded = await listLibrary(repo);
      setSnapshot(loaded);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to open browser-local IndexedDB storage.';
      setStorageError(message);
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const filteredExpressions = useMemo(() => {
    if (!snapshot) return [];
    const matched = findExpressions(snapshot, searchQuery);
    return matched.filter((expr) => {
      if (languageFilter === 'undetermined') {
        if (expr.language.kind !== 'undetermined') return false;
      } else if (!languageMatchesFilter(expr.language, languageFilter)) {
        return false;
      }
      if (roleFilter !== 'all' && expr.role !== roleFilter) {
        return false;
      }
      return true;
    });
  }, [snapshot, searchQuery, languageFilter, roleFilter]);

  const handlePropose = async (payload: ChangePayload) => {
    if (!snapshot) return;
    setActionError(null);
    setStatusNotice(null);
    const proposal = await proposeChange(snapshot, payload);
    setPendingProposal(proposal);
  };

  const handleAssertExpression = async (expression: Expression) => {
    if (!snapshot) return;
    setActionError(null);
    setStatusNotice(null);
    const now = new Date().toISOString();
    try {
      await handlePropose({
        schemaVersion: 1,
        batchId: crypto.randomUUID(),
        baseLibraryRevision: snapshot.libraryRevision,
        ops: [
          {
            kind: 'assertExpression',
            opId: crypto.randomUUID(),
            id: expression.id,
            expectedRevision: expression.revision,
            assertion: {
              id: crypto.randomUUID(),
              expressionId: expression.id,
              field: 'text',
              value: expression.text,
              recordRevision: expression.revision + 1,
              kind: 'user-confirmed',
              actor: 'local-user',
              assertedAt: now,
            },
          },
        ],
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to propose assertion.');
    }
  };

  const handleApproveAndSave = async () => {
    if (!pendingProposal) return;
    setApplying(true);
    setActionError(null);
    setStatusNotice(null);
    try {
      const repo = getBrowserLibraryRepository();
      const approval = approveChange(pendingProposal);
      const result = await applyChange(repo, pendingProposal, approval);

      if (result.status === 'applied' || result.status === 'replay') {
        setPendingProposal(null);
        setEditorMode({ kind: 'idle' });
        await loadSnapshot();
        setStatusNotice(
          result.status === 'applied'
            ? `Saved approved change locally (library revision ${result.revision}).`
            : `Change batch already recorded at revision ${result.revision} (idempotent replay).`,
        );
      } else {
        setPendingProposal(null);
        setActionError(`${result.status.toUpperCase()}: ${result.reason}`);
      }
    } catch (error) {
      setPendingProposal(null);
      setActionError(
        error instanceof Error ? error.message : 'Unexpected error while saving approved change.',
      );
    } finally {
      setApplying(false);
    }
  };

  const storageUnavailable = Boolean(storageError) || loading || !snapshot;

  return (
    <>
      <AppHeader revision={snapshot?.libraryRevision ?? null} />
      <main className="workspace-container">
        <div className="workspace-header">
          <div>
            <p className="eyebrow">CONCEPT-CENTRIC LEXICON</p>
            <h1>Terminology Library</h1>
            <p className="muted small">
              Private, browser-local English and Turkish concept records with explicit change
              approval.
            </p>
          </div>
          <div className="row-inline">
            <button
              type="button"
              className="btn"
              onClick={() => void loadSnapshot()}
              disabled={loading}
            >
              Refresh snapshot
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={storageUnavailable}
              onClick={() => {
                setActionError(null);
                setEditorMode({ kind: 'create-concept' });
                setEditorKey((k) => k + 1);
              }}
            >
              New concept
            </button>
          </div>
        </div>

        {storageError && (
          <div className="banner banner-error" role="alert">
            <strong>Local storage unavailable:</strong> {storageError}. TermForge never silently
            falls back to in-memory storage; resolve browser storage permissions before saving.
          </div>
        )}

        {actionError && (
          <div className="banner banner-error" role="alert">
            <div className="row-inline" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>Write rejected:</strong> {actionError}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setActionError(null);
                  void loadSnapshot();
                }}
              >
                Reload latest revision
              </button>
            </div>
          </div>
        )}

        {statusNotice && (
          <div className="banner banner-success" role="status">
            {statusNotice}
          </div>
        )}

        {snapshot && (
          <div className="metrics-strip">
            <div className="metric-chip" data-testid="library-revision">
              <span>Revision</span>
              <strong>Rev {snapshot.libraryRevision}</strong>
            </div>
            <div className="metric-chip">
              <span>Concepts</span>
              <strong>{snapshot.concepts.length}</strong>
            </div>
            <div className="metric-chip">
              <span>Expressions</span>
              <strong>{snapshot.expressions.length}</strong>
            </div>
            <div className="metric-chip">
              <span>User-confirmed</span>
              <strong>{snapshot.assertions.length}</strong>
            </div>
            <div className="metric-chip">
              <span>Retained sources</span>
              <strong>{snapshot.documents.length}</strong>
            </div>
          </div>
        )}

        <div className="workbench-grid">
          <section className="panel" aria-label="Library records">
            <div className="toolbar">
              <div className="field field-grow">
                <label htmlFor="library-search">Search expressions (case-sensitive)</label>
                <input
                  id="library-search"
                  type="search"
                  className="input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Exact literal substring, e.g., TNF-α, p53, PD"
                  disabled={storageUnavailable}
                />
              </div>

              <div className="field">
                <label htmlFor="library-lang-filter">Language filter</label>
                <select
                  id="library-lang-filter"
                  className="select"
                  value={languageFilter}
                  onChange={(event) => setLanguageFilter(event.target.value as LanguageFilter)}
                  disabled={storageUnavailable}
                >
                  <option value="all">All languages</option>
                  <option value="en">English (en / US / GB)</option>
                  <option value="tr">Turkish (tr)</option>
                  <option value="shared">Shared</option>
                  <option value="undetermined">Undetermined</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="library-role-filter">Role filter</label>
                <select
                  id="library-role-filter"
                  className="select"
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value as 'all' | ExpressionRole)}
                  disabled={storageUnavailable}
                >
                  <option value="all">All roles</option>
                  {EXPRESSION_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>

              <div className="tabs" role="tablist" aria-label="Library view mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'concepts'}
                  className="tab-btn"
                  onClick={() => setViewMode('concepts')}
                >
                  Concepts
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'expressions'}
                  className="tab-btn"
                  onClick={() => setViewMode('expressions')}
                >
                  Expressions
                </button>
              </div>
            </div>

            {loading ? (
              <div className="empty-state">
                <p>Loading local IndexedDB snapshot…</p>
              </div>
            ) : !snapshot ? (
              <div className="empty-state">
                <h3>Library inaccessible</h3>
                <p>Local IndexedDB could not be opened.</p>
              </div>
            ) : snapshot.concepts.length === 0 ? (
              <div className="empty-state">
                <h3>Your terminology library is empty</h3>
                <p>
                  No concepts or expressions are stored in this browser origin yet. Create your
                  first concept manually or review candidates from local scientific text.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setEditorMode({ kind: 'create-concept' });
                    setEditorKey((k) => k + 1);
                  }}
                >
                  Create first concept
                </button>
              </div>
            ) : (
              <ExpressionList
                viewMode={viewMode}
                snapshot={snapshot}
                filteredExpressions={filteredExpressions}
                selectedConceptId={selectedConceptId}
                disabled={storageUnavailable}
                onSelectConcept={(conceptId) => setSelectedConceptId(conceptId)}
                onAddExpression={(concept) => {
                  setActionError(null);
                  setSelectedConceptId(concept.id);
                  setEditorMode({ kind: 'add-expression', concept });
                  setEditorKey((k) => k + 1);
                }}
                onEditExpression={(expression) => {
                  setActionError(null);
                  setSelectedConceptId(expression.conceptId);
                  setEditorMode({ kind: 'edit-expression', expression });
                  setEditorKey((k) => k + 1);
                }}
                onAssertExpression={(expression) => void handleAssertExpression(expression)}
              />
            )}
          </section>

          {snapshot ? (
            <ConceptEditor
              key={`${editorMode.kind}-${editorKey}`}
              mode={editorMode}
              snapshot={snapshot}
              disabled={storageUnavailable}
              onCancel={() => setEditorMode({ kind: 'idle' })}
              onPropose={handlePropose}
              onValidationError={(msg) => setActionError(msg)}
            />
          ) : (
            <section className="panel">
              <p className="status-label">EDITOR PANEL</p>
              <h2>Storage required</h2>
              <p className="muted small">Editing is disabled until IndexedDB is accessible.</p>
            </section>
          )}
        </div>
      </main>

      <ChangeApprovalDialog
        proposal={pendingProposal}
        busy={applying}
        onApprove={() => void handleApproveAndSave()}
        onCancel={() => setPendingProposal(null)}
      />
    </>
  );
}
