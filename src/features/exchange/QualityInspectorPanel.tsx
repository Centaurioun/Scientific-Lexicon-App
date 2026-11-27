'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  inspectLibraryQuality,
  paginateQualityItems,
  QUALITY_INSPECTOR_PAGE_SIZE,
} from '@/application/quality-inspector';
import type { LibrarySnapshot } from '@/domain/schema';

type InspectorTab =
  | 'duplicates'
  | 'homonyms'
  | 'coverage'
  | 'advisories'
  | 'protected';

interface QualityInspectorPanelProps {
  snapshot: LibrarySnapshot | null;
}

export function QualityInspectorPanel({ snapshot }: QualityInspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('duplicates');
  const [searchFilter, setSearchFilter] = useState('');
  const [pageByTab, setPageByTab] = useState<Record<InspectorTab, number>>({
    duplicates: 1,
    homonyms: 1,
    coverage: 1,
    advisories: 1,
    protected: 1,
  });

  const report = useMemo(() => {
    if (!snapshot) return null;
    return inspectLibraryQuality(snapshot);
  }, [snapshot]);

  const query = searchFilter.trim().toLowerCase();

  const filteredDuplicates = useMemo(() => {
    if (!report) return [];
    if (!query) return report.exactSameConceptDuplicates;
    return report.exactSameConceptDuplicates.filter(
      (item) =>
        item.text.toLowerCase().includes(query) ||
        item.conceptId.toLowerCase().includes(query)
    );
  }, [report, query]);

  const filteredHomonyms = useMemo(() => {
    if (!report) return [];
    if (!query) return report.homonymGroups;
    return report.homonymGroups.filter(
      (item) =>
        item.surface.toLowerCase().includes(query) ||
        item.conceptIds.some((id) => id.toLowerCase().includes(query))
    );
  }, [report, query]);

  const filteredCoverage = useMemo(() => {
    if (!report) return [];
    if (!query) return report.conceptCoverageItems;
    return report.conceptCoverageItems.filter(
      (item) =>
        item.conceptId.toLowerCase().includes(query) ||
        item.flags.some((f) => f.toLowerCase().includes(query))
    );
  }, [report, query]);

  const filteredAdvisories = useMemo(() => {
    if (!report) return [];
    if (!query) return report.expressionAdvisoryItems;
    return report.expressionAdvisoryItems.filter(
      (item) =>
        item.text.toLowerCase().includes(query) ||
        item.conceptId.toLowerCase().includes(query) ||
        item.expressionId.toLowerCase().includes(query) ||
        item.flags.some((f) => f.toLowerCase().includes(query))
    );
  }, [report, query]);

  const filteredProtected = useMemo(() => {
    if (!report) return [];
    if (!query) return report.protectedExpressionItems;
    return report.protectedExpressionItems.filter(
      (item) =>
        item.text.toLowerCase().includes(query) ||
        item.conceptId.toLowerCase().includes(query) ||
        item.expressionId.toLowerCase().includes(query)
    );
  }, [report, query]);

  const setCurrentTabPage = (nextPage: number) => {
    setPageByTab((prev) => ({
      ...prev,
      [activeTab]: nextPage,
    }));
  };

  const handleSelectTab = (tab: InspectorTab) => {
    setActiveTab(tab);
  };

  if (!snapshot || !report) {
    return (
      <section className="panel stack-md" aria-labelledby="quality-inspector-heading" data-testid="quality-inspector-panel">
        <div>
          <p className="status-label">READ-ONLY QUALITY &amp; MAINTENANCE INSPECTOR (E7)</p>
          <h2 id="quality-inspector-heading">Library quality &amp; integrity diagnostics</h2>
          <p className="muted small">Loading library snapshot for read-only inspection…</p>
        </div>
      </section>
    );
  }

  const currentPageNumber = pageByTab[activeTab];
  const duplicatesPage = paginateQualityItems(filteredDuplicates, currentPageNumber, QUALITY_INSPECTOR_PAGE_SIZE);
  const homonymsPage = paginateQualityItems(filteredHomonyms, currentPageNumber, QUALITY_INSPECTOR_PAGE_SIZE);
  const coveragePage = paginateQualityItems(filteredCoverage, currentPageNumber, QUALITY_INSPECTOR_PAGE_SIZE);
  const advisoriesPage = paginateQualityItems(filteredAdvisories, currentPageNumber, QUALITY_INSPECTOR_PAGE_SIZE);
  const protectedPage = paginateQualityItems(filteredProtected, currentPageNumber, QUALITY_INSPECTOR_PAGE_SIZE);

  const activePageMeta =
    activeTab === 'duplicates'
      ? duplicatesPage
      : activeTab === 'homonyms'
        ? homonymsPage
        : activeTab === 'coverage'
          ? coveragePage
          : activeTab === 'advisories'
            ? advisoriesPage
            : protectedPage;

  return (
    <section
      className="panel stack-md"
      aria-labelledby="quality-inspector-heading"
      data-testid="quality-inspector-panel"
    >
      <div className="row-inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <p className="status-label">READ-ONLY QUALITY &amp; MAINTENANCE INSPECTOR (E7)</p>
          <h2 id="quality-inspector-heading">Library quality &amp; integrity diagnostics</h2>
          <p className="muted small">
            Read-only diagnostic inspector over persisted snapshot Rev {report.libraryRevision}. No
            automatic merge, deletion, or silent normalization is performed. Shared surface forms
            across distinct concepts are reported as valid scientific homonym groups (not errors).
          </p>
        </div>
        <span
          className={
            report.referentialIntegrity.status === 'valid' ? 'tag tag-teal' : 'tag tag-amber'
          }
          data-testid="quality-integrity-badge"
        >
          Integrity: {report.referentialIntegrity.status.toUpperCase()}
        </span>
      </div>

      {report.referentialIntegrity.status === 'invalid-fail-closed' && (
        <div className="banner banner-error" role="alert">
          <strong>Referential integrity failure (fail-closed, no automatic repair):</strong>{' '}
          {report.referentialIntegrity.errorMessage}
        </div>
      )}

      <div className="metrics-strip">
        <div className="metric-chip" data-testid="quality-count-duplicates">
          <span>Same-concept duplicates</span>
          <strong>{report.exactSameConceptDuplicates.length}</strong>
        </div>
        <div className="metric-chip" data-testid="quality-count-homonyms">
          <span>Homonym groups (non-error)</span>
          <strong>{report.homonymGroups.length}</strong>
        </div>
        <div className="metric-chip" data-testid="quality-count-coverage">
          <span>Concept coverage gaps</span>
          <strong>{report.conceptCoverageItems.length}</strong>
        </div>
        <div className="metric-chip" data-testid="quality-count-advisories">
          <span>Expression advisories</span>
          <strong>{report.expressionAdvisoryItems.length}</strong>
        </div>
        <div className="metric-chip" data-testid="quality-count-protected">
          <span>User-confirmed protected</span>
          <strong>{report.protectedExpressionItems.length}</strong>
        </div>
      </div>

      <div className="toolbar" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div className="tabs" role="tablist" aria-label="Quality inspector categories">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'duplicates'}
            className="tab-btn"
            onClick={() => handleSelectTab('duplicates')}
            data-testid="quality-tab-duplicates"
          >
            Same-Concept Duplicates ({filteredDuplicates.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'homonyms'}
            className="tab-btn"
            onClick={() => handleSelectTab('homonyms')}
            data-testid="quality-tab-homonyms"
          >
            Homonyms ({filteredHomonyms.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'coverage'}
            className="tab-btn"
            onClick={() => handleSelectTab('coverage')}
            data-testid="quality-tab-coverage"
          >
            Concept Coverage ({filteredCoverage.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'advisories'}
            className="tab-btn"
            onClick={() => handleSelectTab('advisories')}
            data-testid="quality-tab-advisories"
          >
            Expression Advisories ({filteredAdvisories.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'protected'}
            className="tab-btn"
            onClick={() => handleSelectTab('protected')}
            data-testid="quality-tab-protected"
          >
            Protected Inventory ({filteredProtected.length})
          </button>
        </div>

        <div className="field" style={{ minWidth: '240px' }}>
          <label htmlFor="quality-inspector-search">Filter findings</label>
          <input
            id="quality-inspector-search"
            type="search"
            className="input"
            placeholder="Filter by term, concept ID, or flag…"
            value={searchFilter}
            onChange={(event) => {
              setSearchFilter(event.target.value);
              setPageByTab({
                duplicates: 1,
                homonyms: 1,
                coverage: 1,
                advisories: 1,
                protected: 1,
              });
            }}
          />
        </div>
      </div>

      {activeTab === 'duplicates' && (
        <div className="table-wrap">
          {duplicatesPage.items.length === 0 ? (
            <div className="empty-state" data-testid="quality-empty-duplicates">
              <p>No exact same-concept duplicate tuples detected in the current library snapshot.</p>
            </div>
          ) : (
            <table className="data-table" data-testid="quality-table-duplicates">
              <thead>
                <tr>
                  <th>Concept ID</th>
                  <th>Exact Surface</th>
                  <th>Language</th>
                  <th>Role</th>
                  <th>Duplicate Expression IDs</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {duplicatesPage.items.map((item) => (
                  <tr key={`${item.conceptId}:${item.language}:${item.role}:${item.text}`}>
                    <td className="mono">{item.conceptId.slice(0, 8)}</td>
                    <td className="mono">
                      <strong>{item.text}</strong>
                    </td>
                    <td>{item.language}</td>
                    <td>{item.role}</td>
                    <td className="mono small">{item.expressionIds.map((id) => id.slice(0, 8)).join(', ')}</td>
                    <td>
                      <Link
                        href={`/library?concept=${encodeURIComponent(item.conceptId)}`}
                        className="btn btn-sm"
                      >
                        Inspect in Library →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'homonyms' && (
        <div className="table-wrap">
          {homonymsPage.items.length === 0 ? (
            <div className="empty-state" data-testid="quality-empty-homonyms">
              <p>No shared surface homonyms across distinct concepts in the current library snapshot.</p>
            </div>
          ) : (
            <table className="data-table" data-testid="quality-table-homonyms">
              <thead>
                <tr>
                  <th>Shared Surface</th>
                  <th>Distinct Concepts</th>
                  <th>Classification</th>
                  <th>Inspect Concepts</th>
                </tr>
              </thead>
              <tbody>
                {homonymsPage.items.map((item) => (
                  <tr key={item.surface}>
                    <td className="mono">
                      <strong>{item.surface}</strong>
                    </td>
                    <td>
                      {item.conceptIds.length} concepts ({item.expressionCount} expressions)
                    </td>
                    <td>
                      <span className="tag tag-teal">Non-error scientific homonym</span>
                    </td>
                    <td>
                      <div className="row-inline" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
                        {item.conceptIds.map((cid) => (
                          <Link
                            key={cid}
                            href={`/library?concept=${encodeURIComponent(cid)}`}
                            className="btn btn-sm mono"
                          >
                            {cid.slice(0, 8)} →
                          </Link>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'coverage' && (
        <div className="table-wrap">
          {coveragePage.items.length === 0 ? (
            <div className="empty-state" data-testid="quality-empty-coverage">
              <p>All concepts have EN, TR, and preferred expression coverage.</p>
            </div>
          ) : (
            <table className="data-table" data-testid="quality-table-coverage">
              <thead>
                <tr>
                  <th>Concept ID</th>
                  <th>Expressions</th>
                  <th>EN / TR / Undetermined</th>
                  <th>Preferred Count</th>
                  <th>Coverage Flags</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {coveragePage.items.map((item) => (
                  <tr key={item.conceptId}>
                    <td className="mono">{item.conceptId.slice(0, 8)}</td>
                    <td>{item.expressionCount}</td>
                    <td>
                      {item.enCount} EN / {item.trCount} TR / {item.undeterminedCount} und
                    </td>
                    <td>{item.preferredCount}</td>
                    <td>
                      <div className="row-inline" style={{ flexWrap: 'wrap', gap: '0.25rem' }}>
                        {item.flags.map((flag) => (
                          <span key={flag} className="tag tag-amber mono">
                            {flag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Link
                        href={`/library?concept=${encodeURIComponent(item.conceptId)}`}
                        className="btn btn-sm"
                      >
                        Inspect in Library →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'advisories' && (
        <div className="table-wrap">
          {advisoriesPage.items.length === 0 ? (
            <div className="empty-state" data-testid="quality-empty-advisories">
              <p>No expression advisory flags detected.</p>
            </div>
          ) : (
            <table className="data-table" data-testid="quality-table-advisories">
              <thead>
                <tr>
                  <th>Expression ID</th>
                  <th>Concept ID</th>
                  <th>Literal Text</th>
                  <th>Lang / Role</th>
                  <th>Advisory Flags</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {advisoriesPage.items.map((item) => (
                  <tr key={item.expressionId}>
                    <td className="mono">{item.expressionId.slice(0, 8)}</td>
                    <td className="mono">{item.conceptId.slice(0, 8)}</td>
                    <td className="mono">
                      <strong>{item.text}</strong>
                    </td>
                    <td>
                      {item.language} · {item.role}
                    </td>
                    <td>
                      <div className="row-inline" style={{ flexWrap: 'wrap', gap: '0.25rem' }}>
                        {item.flags.map((flag) => (
                          <span key={flag} className="tag tag-amber mono">
                            {flag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Link
                        href={`/library?concept=${encodeURIComponent(item.conceptId)}`}
                        className="btn btn-sm"
                      >
                        Inspect in Library →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'protected' && (
        <div className="table-wrap">
          {protectedPage.items.length === 0 ? (
            <div className="empty-state" data-testid="quality-empty-protected">
              <p>No user-confirmed protected expressions in the current library snapshot.</p>
            </div>
          ) : (
            <table className="data-table" data-testid="quality-table-protected">
              <thead>
                <tr>
                  <th>Expression ID</th>
                  <th>Concept ID</th>
                  <th>Protected Literal Text</th>
                  <th>Assertion ID</th>
                  <th>Asserted At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {protectedPage.items.map((item) => (
                  <tr key={`${item.expressionId}:${item.assertionId}`}>
                    <td className="mono">{item.expressionId.slice(0, 8)}</td>
                    <td className="mono">{item.conceptId.slice(0, 8)}</td>
                    <td className="mono">
                      <strong>{item.text}</strong>
                    </td>
                    <td className="mono">{item.assertionId.slice(0, 8)}</td>
                    <td className="small muted">{item.assertedAt}</td>
                    <td>
                      <Link
                        href={`/library?concept=${encodeURIComponent(item.conceptId)}`}
                        className="btn btn-sm"
                      >
                        Inspect in Library →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activePageMeta.totalPages > 1 && (
        <div className="row-inline" style={{ justifyContent: 'space-between' }} data-testid="quality-pagination">
          <span className="muted small">
            Page {activePageMeta.currentPage} of {activePageMeta.totalPages} ({activePageMeta.totalItems}{' '}
            items, {QUALITY_INSPECTOR_PAGE_SIZE} per page)
          </span>
          <div className="row-inline">
            <button
              type="button"
              className="btn btn-sm"
              disabled={activePageMeta.currentPage <= 1}
              onClick={() => setCurrentTabPage(activePageMeta.currentPage - 1)}
            >
              Previous page
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={activePageMeta.currentPage >= activePageMeta.totalPages}
              onClick={() => setCurrentTabPage(activePageMeta.currentPage + 1)}
            >
              Next page
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
