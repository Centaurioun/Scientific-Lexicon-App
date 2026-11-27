'use client';

import {
  formatLanguageUse,
  isExpressionProtected,
  type Concept,
  type Expression,
  type LibrarySnapshot,
} from '@/domain/schema';

interface ExpressionListProps {
  viewMode: 'concepts' | 'expressions';
  snapshot: LibrarySnapshot;
  filteredExpressions: Expression[];
  selectedConceptId: string | null;
  disabled: boolean;
  onSelectConcept: (conceptId: string) => void;
  onAddExpression: (concept: Concept) => void;
  onEditExpression: (expression: Expression) => void;
  onAssertExpression: (expression: Expression) => void;
}

export function ExpressionList({
  viewMode,
  snapshot,
  filteredExpressions,
  selectedConceptId,
  disabled,
  onSelectConcept,
  onAddExpression,
  onEditExpression,
  onAssertExpression,
}: ExpressionListProps) {
  const conceptsById = new Map(snapshot.concepts.map((c) => [c.id, c]));
  const docsById = new Map(snapshot.documents.map((d) => [d.id, d]));

  const assertionsByExpr = new Map<string, typeof snapshot.assertions>();
  for (const assertion of snapshot.assertions) {
    const list = assertionsByExpr.get(assertion.expressionId) ?? [];
    list.push(assertion);
    assertionsByExpr.set(assertion.expressionId, list);
  }

  const provenanceByExpr = new Map<string, typeof snapshot.provenance>();
  for (const prov of snapshot.provenance) {
    const list = provenanceByExpr.get(prov.expressionId) ?? [];
    list.push(prov);
    provenanceByExpr.set(prov.expressionId, list);
  }

  if (filteredExpressions.length === 0) {
    return (
      <div className="empty-state">
        <h3>No matching expressions</h3>
        <p>Adjust your case-sensitive search query or language/role filters to inspect records.</p>
      </div>
    );
  }

  if (viewMode === 'expressions') {
    return (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Expression</th>
              <th>Language</th>
              <th>Role</th>
              <th>Concept</th>
              <th>Status &amp; Provenance</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredExpressions.map((expr) => {
              const exprAssertions = assertionsByExpr.get(expr.id) ?? [];
              const exprProv = provenanceByExpr.get(expr.id) ?? [];
              const protectedFlag = isExpressionProtected(expr, exprAssertions);

              return (
                <tr key={expr.id} data-testid="expression-row">
                  <td>
                    <div style={{ fontWeight: 700 }}>{expr.text}</div>
                    <div className="mono muted small">
                      {expr.id.slice(0, 8)} · r{expr.revision}
                    </div>
                  </td>
                  <td>
                    <span className="tag tag-mono">{formatLanguageUse(expr.language)}</span>
                  </td>
                  <td>
                    <span className="tag">{expr.role}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-subtle mono"
                      onClick={() => onSelectConcept(expr.conceptId)}
                    >
                      {expr.conceptId.slice(0, 8)}
                    </button>
                  </td>
                  <td>
                    <div className="stack-sm">
                      <div className="row-inline">
                        {protectedFlag ? (
                          <span className="tag tag-accent">user-confirmed</span>
                        ) : (
                          <span className="tag tag-amber">unasserted</span>
                        )}
                      </div>
                      {exprProv.map((prov) => {
                        const doc = prov.source ? docsById.get(prov.source.documentId) : null;
                        return (
                          <div key={prov.id} className="small muted">
                            {prov.kind}
                            {prov.source
                              ? ` · retained "${doc?.title ?? prov.source.documentId.slice(0, 8)}" [${prov.source.start}, ${prov.source.end})`
                              : ' · no retained source'}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    <div className="actions-nowrap">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onEditExpression(expr)}
                        disabled={disabled}
                        aria-label={`Edit expression ${expr.text}`}
                      >
                        Edit
                      </button>
                      {!protectedFlag && (
                        <button
                          type="button"
                          className="btn btn-sm btn-subtle"
                          onClick={() => onAssertExpression(expr)}
                          disabled={disabled}
                          aria-label={`Confirm expression ${expr.text}`}
                        >
                          Confirm
                        </button>
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

  // Group filtered expressions by conceptId in deterministic concept order
  const expressionsByConcept = new Map<string, Expression[]>();
  for (const expr of filteredExpressions) {
    const list = expressionsByConcept.get(expr.conceptId) ?? [];
    list.push(expr);
    expressionsByConcept.set(expr.conceptId, list);
  }

  const orderedConcepts = snapshot.concepts.filter((c) => expressionsByConcept.has(c.id));

  return (
    <div className="concept-list">
      {orderedConcepts.map((concept) => {
        const exprs = expressionsByConcept.get(concept.id) ?? [];
        const isSelected = selectedConceptId === concept.id;
        return (
          <article
            key={concept.id}
            className={isSelected ? 'concept-card selected' : 'concept-card'}
            data-testid="concept-card"
          >
            <div className="concept-card-header">
              <div>
                <div className="row-inline">
                  <span className="tag tag-mono">Concept {concept.id.slice(0, 8)}</span>
                  <span className="tag tag-mono">rev {concept.revision}</span>
                  <span className="muted small">
                    {exprs.length} {exprs.length === 1 ? 'expression' : 'expressions'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  onSelectConcept(concept.id);
                  onAddExpression(conceptsById.get(concept.id) ?? concept);
                }}
                disabled={disabled}
              >
                Add expression
              </button>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Form</th>
                    <th>Language</th>
                    <th>Role</th>
                    <th>Verification &amp; Provenance</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {exprs.map((expr) => {
                    const exprAssertions = assertionsByExpr.get(expr.id) ?? [];
                    const exprProv = provenanceByExpr.get(expr.id) ?? [];
                    const protectedFlag = isExpressionProtected(expr, exprAssertions);

                    return (
                      <tr key={expr.id} data-testid="expression-row">
                        <td>
                          <div style={{ fontWeight: 700 }}>{expr.text}</div>
                          <div className="mono muted small">r{expr.revision}</div>
                        </td>
                        <td>
                          <span className="tag tag-mono">{formatLanguageUse(expr.language)}</span>
                        </td>
                        <td>
                          <span className="tag">{expr.role}</span>
                        </td>
                        <td>
                          <div className="stack-sm">
                            <div className="row-inline">
                              {protectedFlag ? (
                                <span className="tag tag-accent">user-confirmed</span>
                              ) : (
                                <span className="tag tag-amber">unasserted</span>
                              )}
                            </div>
                            {exprProv.map((prov) => {
                              const doc = prov.source
                                ? docsById.get(prov.source.documentId)
                                : null;
                              return (
                                <div key={prov.id} className="small muted">
                                  {prov.kind}
                                  {prov.source
                                    ? ` · "${doc?.title ?? prov.source.documentId.slice(0, 8)}" [${prov.source.start}, ${prov.source.end})`
                                    : ' · no retained source'}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td>
                          <div className="actions-nowrap">
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => onEditExpression(expr)}
                              disabled={disabled}
                              aria-label={`Edit expression ${expr.text}`}
                            >
                              Edit
                            </button>
                            {!protectedFlag && (
                              <button
                                type="button"
                                className="btn btn-sm btn-subtle"
                                onClick={() => onAssertExpression(expr)}
                                disabled={disabled}
                                aria-label={`Confirm expression ${expr.text}`}
                              >
                                Confirm
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        );
      })}
    </div>
  );
}
