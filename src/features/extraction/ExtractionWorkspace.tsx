'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RevisionCachedRegisteredMatcher } from '@/adapters/matching/registered-matcher';
import { BrowserLocalNlpEngine } from '@/adapters/nlp/wink-engine';
import { getBrowserLibraryRepository } from '@/adapters/storage/dexie-library';
import {
  analyzeText,
  selectCandidates,
} from '@/application/extraction';
import {
  applyChange,
  approveChange,
  listLibrary,
  proposeChange,
} from '@/application/library';
import { parseDocumentText, readDocument } from '@/application/document-input';
import { rankCandidates } from '@/application/ranking';
import { AppHeader } from '@/components/AppHeader';
import { ChangeApprovalDialog } from '@/components/ChangeApprovalDialog';
import type { CandidateGrammarMode } from '@/domain/candidate-evidence';
import type { ChangePayload, ProposedChange } from '@/domain/changes';
import {
  parseDictionaryPackJson,
  type DictionaryPack,
} from '@/domain/dictionary-pack';
import type { DocumentFormat } from '@/domain/document-input';
import type { CandidateFilter, ExtractionRun } from '@/domain/extraction';
import {
  DEFAULT_PROCESSING_LIMITS,
  type ProcessingLimits,
} from '@/domain/processing-limits';
import type { RankMode } from '@/domain/ranking';
import type { LibrarySnapshot, Occurrence } from '@/domain/schema';
import { CandidateTable } from './CandidateTable';
import {
  clearSessionDictionaryPack,
  getSessionDictionaryPack,
  setSessionDictionaryPack,
} from './dictionary-pack-store';
import { ProcessingLimitsPanel } from './ProcessingLimitsPanel';
import { RankingControls } from './RankingControls';
import { readProcessingLimits, writeProcessingLimits } from './processing-limits-store';
import {
  clearSessionExtractionRun,
  getSessionExtractionRun,
  setSessionExtractionRun,
} from './session-run-store';
import { SourceContext } from './SourceContext';

export function ExtractionWorkspace() {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  const [sourceText, setSourceText] = useState('');
  const [run, setRun] = useState<ExtractionRun | null>(() => getSessionExtractionRun());
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [processingLimits, setProcessingLimits] = useState<ProcessingLimits>(DEFAULT_PROCESSING_LIMITS);
  const [processingLimitsReady, setProcessingLimitsReady] = useState(false);
  const [processingLimitsNotice, setProcessingLimitsNotice] = useState<string | null>(null);

  const [filter, setFilter] = useState<CandidateFilter>('all');
  const [grammarMode, setGrammarMode] = useState<CandidateGrammarMode>('s1-grammar-1');
  const [inputFormat, setInputFormat] = useState<Exclude<DocumentFormat, 'docx'>>('txt');
  const [rankMode, setRankMode] = useState<RankMode>('source-order');
  const [groupedView, setGroupedView] = useState(false);
  const [dictionaryPack, setDictionaryPack] = useState<DictionaryPack | null>(() =>
    getSessionDictionaryPack(),
  );
  const [usePackAsHints, setUsePackAsHints] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(() => new Set());
  const [sessionResolvedMap, setSessionResolvedMap] = useState<Map<string, string>>(
    () => new Map(),
  );

  // Explicit opt-in retention state (session-only by default!)
  const [retentionTitle, setRetentionTitle] = useState('');
  const [retentionConsent, setRetentionConsent] = useState(false);
  const [retainedRunLink, setRetainedRunLink] = useState<{
    documentId: string;
    runId: string;
    forRunId: string;
  } | null>(null);

  const [pendingProposal, setPendingProposal] = useState<ProposedChange | null>(null);
  const [pendingRetainMeta, setPendingRetainMeta] = useState<{
    documentId: string;
    runId: string;
    forRunId: string;
  } | null>(null);
  const [applying, setApplying] = useState(false);

  const nlpRef = useRef<BrowserLocalNlpEngine | null>(null);
  const matcherRef = useRef<RevisionCachedRegisteredMatcher | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  if (!nlpRef.current) {
    nlpRef.current = new BrowserLocalNlpEngine();
  }
  if (!matcherRef.current) {
    matcherRef.current = new RevisionCachedRegisteredMatcher();
  }

  const loadSnapshot = useCallback(async () => {
    setLoadingLibrary(true);
    setStorageError(null);
    try {
      const repo = getBrowserLibraryRepository();
      const loaded = await listLibrary(repo);
      setSnapshot(loaded);
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : 'Unable to open browser IndexedDB library.',
      );
      setSnapshot(null);
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
    const repo = getBrowserLibraryRepository();
    const unsub = repo.subscribeRevision(() => {
      matcherRef.current?.invalidate();
    });
    return () => {
      unsub();
      abortRef.current?.abort();
      nlpRef.current?.terminate();
    };
  }, [loadSnapshot]);

  useEffect(() => {
    const result = readProcessingLimits();
    setProcessingLimits(result.limits);
    setProcessingLimitsNotice(
      result.status === 'invalid'
        ? 'Saved processing preferences were invalid; authorized defaults are active.'
        : result.status === 'unavailable'
          ? 'Browser preference storage is unavailable; authorized defaults are active for this page.'
          : null,
    );
    setProcessingLimitsReady(true);
  }, []);

  // Restore text if returning via SPA navigation within the same session
  useEffect(() => {
    if (run && sourceText === '') {
      setSourceText(run.text);
    }
  }, [run, sourceText]);

  const handleSourceTextChange = (nextText: string) => {
    if (nextText === sourceText) return;
    abortRef.current?.abort();
    abortRef.current = null;
    requestSeqRef.current += 1;
    setAnalyzing(false);
    setSourceText(nextText);
    setAnalysisError(null);
    setPendingProposal(null);
    setPendingRetainMeta(null);
    setRetainedRunLink(null);
    setRetentionConsent(false);
    setRetentionTitle('');

    if (run) {
      setRun(null);
      clearSessionExtractionRun();
      setSelectedOccurrenceId(null);
      setRejectedIds(new Set());
      setSessionResolvedMap(new Map());
      setStatusNotice('Source changed. Previous analysis and review state were cleared; analyze the updated text before acting.');
    }
  };

  const clearActiveRunForPolicyChange = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestSeqRef.current += 1;
    setAnalyzing(false);
    setRun(null);
    clearSessionExtractionRun();
    setSelectedOccurrenceId(null);
    setRejectedIds(new Set());
    setSessionResolvedMap(new Map());
    setPendingProposal(null);
    setPendingRetainMeta(null);
    setRetainedRunLink(null);
    setRetentionConsent(false);
    setAnalysisError(null);
  };

  const handleSaveProcessingLimits = (nextLimits: ProcessingLimits) => {
    const saved = writeProcessingLimits(nextLimits);
    clearActiveRunForPolicyChange();
    setProcessingLimits(saved);
    setStatusNotice(null);
    setProcessingLimitsNotice('Processing limits saved for this browser only.');
  };

  const handleGrammarModeChange = (nextMode: CandidateGrammarMode) => {
    if (nextMode === grammarMode) return;
    clearActiveRunForPolicyChange();
    setGrammarMode(nextMode);
    setStatusNotice(
      `Grammar mode switched to ${nextMode}. Previous run cleared; analyze again to compare outputs.`,
    );
  };

  const handleInputFormatChange = (nextFormat: Exclude<DocumentFormat, 'docx'>) => {
    if (nextFormat === inputFormat) return;
    clearActiveRunForPolicyChange();
    setInputFormat(nextFormat);
    setStatusNotice(
      `Input format set to ${nextFormat === 'markdown' ? 'Structured Markdown (.md)' : 'Plain text (.txt)'}. Analyze again to re-parse source.`,
    );
  };

  const handleDictionaryPackUpload = async (file: File) => {
    setPackError(null);
    try {
      const raw = await file.text();
      const validated = parseDictionaryPackJson(raw);
      clearActiveRunForPolicyChange();
      setDictionaryPack(validated);
      setSessionDictionaryPack(validated);
      setStatusNotice(
        `Loaded session-only dictionary pack "${validated.name}" (${validated.entries.length} entries; read-only, never writes library).`,
      );
    } catch (error) {
      setPackError(error instanceof Error ? error.message : 'Unable to validate dictionary pack.');
    }
  };

  const handleClearDictionaryPack = () => {
    clearActiveRunForPolicyChange();
    setDictionaryPack(null);
    setUsePackAsHints(false);
    setPackError(null);
    clearSessionDictionaryPack();
    setStatusNotice('Cleared session dictionary pack.');
  };

  const handleUsePackAsHintsChange = (enabled: boolean) => {
    clearActiveRunForPolicyChange();
    setUsePackAsHints(enabled);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setAnalysisError(null);
    setStatusNotice(null);
    handleSourceTextChange('');
    try {
      const parsedDoc = await readDocument(file, processingLimits);
      const nextFormat: Exclude<DocumentFormat, 'docx'> =
        parsedDoc.format === 'markdown' ? 'markdown' : 'txt';
      setInputFormat(nextFormat);
      setSourceText(parsedDoc.text);
      setRetentionTitle(file.name.replace(/\.(?:txt|md|markdown)$/i, '') || 'Local source');
      setStatusNotice(
        `Loaded "${file.name}" (${parsedDoc.format}, ${parsedDoc.text.length.toLocaleString('en-US')} UTF-16 chars) into session memory only.`,
      );
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Unable to read local document file.');
    }
  };

  const handleAnalyze = async () => {
    if (!snapshot || !processingLimitsReady) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;

    setAnalyzing(true);
    setAnalysisError(null);
    setStatusNotice(null);
    setRun(null);
    clearSessionExtractionRun();
    setSelectedOccurrenceId(null);
    setRejectedIds(new Set());
    setSessionResolvedMap(new Map());
    setPendingProposal(null);
    setPendingRetainMeta(null);
    setRetainedRunLink(null);

    try {
      const parsedDoc = parseDocumentText(sourceText, inputFormat, processingLimits);
      const result = await analyzeText(
        parsedDoc.text,
        snapshot,
        {
          analyze: (text) => nlpRef.current!.analyze(text, controller.signal),
        },
        matcherRef.current!,
        {
          signal: controller.signal,
          limits: processingLimits,
          grammarMode,
          parsedDocument: parsedDoc,
          dictionaryPack,
          useDictionaryPackAsDiscoveryHints: Boolean(dictionaryPack && usePackAsHints),
        },
      );

      // Guard against stale async completion
      if (seq !== requestSeqRef.current || controller.signal.aborted) {
        return;
      }

      setRun(result);
      setSessionExtractionRun(result);
      setSelectedOccurrenceId(result.occurrences[0]?.id ?? null);
      setRejectedIds(new Set());
      setSessionResolvedMap(new Map());
      setRetainedRunLink(null);
      setStatusNotice(
        `Analyzed locally (${result.algorithmVersion}, ${parsedDoc.format}) at library revision ${result.libraryRevision}: ${result.occurrences.length} occurrence spans identified (session-only; not persisted).`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatusNotice('In-flight analysis cancelled.');
      } else {
        setAnalysisError(error instanceof Error ? error.message : 'Local analysis failed.');
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setAnalyzing(false);
      }
    }
  };

  const handleCancelAnalysis = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestSeqRef.current += 1;
    setAnalyzing(false);
  };

  const handleClearSession = () => {
    handleCancelAnalysis();
    setSourceText('');
    setRun(null);
    clearSessionExtractionRun();
    setSelectedOccurrenceId(null);
    setRejectedIds(new Set());
    setSessionResolvedMap(new Map());
    setRetentionTitle('');
    setRetentionConsent(false);
    setRetainedRunLink(null);
    setAnalysisError(null);
    setStatusNotice('Session source text and unpersisted review state cleared.');
  };

  const visibleOccurrences = useMemo(() => {
    if (!run) return [];
    return selectCandidates(run, filter);
  }, [run, filter]);

  const rankedGroups = useMemo(() => {
    if (visibleOccurrences.length === 0) return [];
    return rankCandidates(visibleOccurrences, rankMode);
  }, [visibleOccurrences, rankMode]);

  const counts = useMemo(() => {
    if (!run) {
      return { total: 0, uniqueConcepts: 0, uniqueExpressions: 0, known: 0, newCand: 0, ambiguous: 0 };
    }
    const conceptSet = new Set<string>();
    const exprSet = new Set<string>();
    let known = 0;
    let newCand = 0;
    let ambiguous = 0;

    for (const occ of run.occurrences) {
      for (const c of occ.conceptIds) conceptSet.add(c);
      for (const e of occ.expressionIds) exprSet.add(e);
      if (occ.state === 'known-form') known += 1;
      else if (occ.state === 'new-candidate') newCand += 1;
      else ambiguous += 1;
    }

    return {
      total: run.occurrences.length,
      uniqueConcepts: conceptSet.size,
      uniqueExpressions: exprSet.size,
      known,
      newCand,
      ambiguous,
    };
  }, [run]);

  const runIsStale = Boolean(run && snapshot && run.libraryRevision !== snapshot.libraryRevision);

  const openProposal = async (
    payload: ChangePayload,
    retainMeta: { documentId: string; runId: string; forRunId: string } | null = null,
  ) => {
    if (!snapshot) return;
    setAnalysisError(null);
    setStatusNotice(null);
    try {
      const proposal = await proposeChange(snapshot, payload);
      setPendingProposal(proposal);
      setPendingRetainMeta(retainMeta);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Unable to prepare change proposal.');
    }
  };

  const activeRetainedSourceFor = (occ: Occurrence) => {
    if (!run || !retainedRunLink || retainedRunLink.forRunId !== run.id) return null;
    // Verify the retained document/run still exists in current snapshot
    const docExists = snapshot?.documents.some((d) => d.id === retainedRunLink.documentId);
    const runExists = snapshot?.runs.some((r) => r.id === retainedRunLink.runId);
    if (!docExists || !runExists) return null;
    return {
      documentId: retainedRunLink.documentId,
      runId: retainedRunLink.runId,
      start: occ.start,
      end: occ.end,
    };
  };

  const handleCreateConceptFromOcc = async (occ: Occurrence) => {
    if (!snapshot) return;
    const now = new Date().toISOString();
    const conceptId = crypto.randomUUID();
    const expressionId = crypto.randomUUID();
    await openProposal({
      schemaVersion: 1,
      batchId: crypto.randomUUID(),
      baseLibraryRevision: snapshot.libraryRevision,
      ops: [
        {
          kind: 'createConcept',
          opId: crypto.randomUUID(),
          concept: { id: conceptId, revision: 0, createdAt: now, updatedAt: now },
          firstExpression: {
            id: expressionId,
            conceptId,
            revision: 0,
            text: occ.surface,
            language: { kind: 'language', tag: 'en' },
            role: 'preferred',
            createdAt: now,
            updatedAt: now,
          },
          provenance: {
            id: crypto.randomUUID(),
            expressionId,
            kind: 'reviewed-candidate',
            createdAt: now,
            source: activeRetainedSourceFor(occ),
          },
        },
      ],
    });
  };

  const handleLinkToConcept = async (occ: Occurrence, conceptId: string) => {
    if (!snapshot) return;
    const targetConcept = snapshot.concepts.find((c) => c.id === conceptId);
    if (!targetConcept) return;
    const now = new Date().toISOString();
    const expressionId = crypto.randomUUID();
    await openProposal({
      schemaVersion: 1,
      batchId: crypto.randomUUID(),
      baseLibraryRevision: snapshot.libraryRevision,
      ops: [
        {
          kind: 'addExpression',
          opId: crypto.randomUUID(),
          expectedConceptRevision: targetConcept.revision,
          expression: {
            id: expressionId,
            conceptId: targetConcept.id,
            revision: 0,
            text: occ.surface,
            language: { kind: 'language', tag: 'en' },
            role: 'alternative',
            createdAt: now,
            updatedAt: now,
          },
          provenance: {
            id: crypto.randomUUID(),
            expressionId,
            kind: 'reviewed-candidate',
            createdAt: now,
            source: activeRetainedSourceFor(occ),
          },
        },
      ],
    });
  };

  const handleResolveAmbiguous = (occ: Occurrence, conceptId: string) => {
    setSessionResolvedMap((prev) => {
      const next = new Map(prev);
      next.set(occ.id, conceptId);
      return next;
    });
    // Also update the session-only run's resolvedConceptId so current-run exports reflect explicit user resolution
    if (run) {
      const updatedRun: ExtractionRun = {
        ...run,
        occurrences: run.occurrences.map((item) =>
          item.id === occ.id ? { ...item, resolvedConceptId: conceptId } : item,
        ),
      };
      setRun(updatedRun);
      setSessionExtractionRun(updatedRun);
    }
    setStatusNotice(
      `Resolved ambiguous occurrence "${occ.surface}" to concept ${conceptId.slice(0, 8)} in current session (not independent scientific verification).`,
    );
  };

  const handleRejectSession = (occ: Occurrence) => {
    setRejectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(occ.id)) next.delete(occ.id);
      else next.add(occ.id);
      return next;
    });
  };

  const handleProposeRetainSource = async () => {
    if (!snapshot || !run) return;
    if (!retentionConsent) {
      setAnalysisError('Explicit local retention consent is required before retaining source text.');
      return;
    }
    const title = retentionTitle.trim();
    if (title.length === 0) {
      setAnalysisError('Provide a non-empty title before retaining this source locally.');
      return;
    }

    const now = new Date().toISOString();
    const documentId = crypto.randomUUID();
    const retainedRunId = crypto.randomUUID();

    await openProposal(
      {
        schemaVersion: 1,
        batchId: crypto.randomUUID(),
        baseLibraryRevision: snapshot.libraryRevision,
        ops: [
          {
            kind: 'retainDocument',
            opId: crypto.randomUUID(),
            document: {
              id: documentId,
              title,
              text: run.text,
              createdAt: now,
            },
            run: {
              id: retainedRunId,
              documentId,
              algorithmVersion: run.algorithmVersion,
              libraryRevision: run.libraryRevision,
              createdAt: now,
              occurrences: run.occurrences,
            },
          },
        ],
      },
      { documentId, runId: retainedRunId, forRunId: run.id },
    );
  };

  const handleProposeDeleteRetained = async (documentId: string) => {
    if (!snapshot) return;
    await openProposal({
      schemaVersion: 1,
      batchId: crypto.randomUUID(),
      baseLibraryRevision: snapshot.libraryRevision,
      ops: [
        {
          kind: 'deleteRetainedDocument',
          opId: crypto.randomUUID(),
          id: documentId,
        },
      ],
    });
  };

  const handleApproveAndSave = async () => {
    if (!pendingProposal) return;
    setApplying(true);
    setAnalysisError(null);
    setStatusNotice(null);
    try {
      const repo = getBrowserLibraryRepository();
      const approval = approveChange(pendingProposal);
      const result = await applyChange(repo, pendingProposal, approval);

      if (result.status === 'applied' || result.status === 'replay') {
        const appliedRetain = pendingRetainMeta;
        setPendingProposal(null);
        setPendingRetainMeta(null);
        matcherRef.current?.invalidate();
        if (appliedRetain) {
          setRetainedRunLink(appliedRetain);
        }
        await loadSnapshot();
        setStatusNotice(
          `Saved approved change locally (library revision ${result.revision}). Re-analyze if you want matcher states refreshed against the new revision.`,
        );
      } else {
        setPendingProposal(null);
        setPendingRetainMeta(null);
        setAnalysisError(`${result.status.toUpperCase()}: ${result.reason}`);
      }
    } catch (error) {
      setPendingProposal(null);
      setPendingRetainMeta(null);
      setAnalysisError(error instanceof Error ? error.message : 'Unable to apply approved change.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <AppHeader revision={snapshot?.libraryRevision ?? null} />
      <main className="workspace-container stack-md">
        <div className="workspace-header" style={{ marginBottom: 0 }}>
          <div>
            <p className="eyebrow">LOCAL ENGLISH EXTRACTION &amp; REVIEW</p>
            <h1>Scientific Extraction Workbench</h1>
            <p className="muted small">
              Independent registered-term matching (Aho–Corasick) and unknown scientific candidate
              discovery (Wink NLP + deterministic grammar s1-grammar-1). Session-only by default; no
              text leaves your browser.
            </p>
          </div>
          <div className="row-inline">
            <span className="tag">Session-only default</span>
            <span className="tag tag-amber">Unvalidated ATE (pre-G5)</span>
          </div>
        </div>

        {storageError && (
          <div className="banner banner-error" role="alert">
            <strong>Local storage unavailable:</strong> {storageError}
          </div>
        )}

        {analysisError && (
          <div className="banner banner-error" role="alert">
            {analysisError}
          </div>
        )}

        {statusNotice && (
          <div className="banner banner-success" role="status">
            {statusNotice}
          </div>
        )}

        {runIsStale && (
          <div className="banner banner-warning" role="alert">
            <strong>Library revision changed:</strong> This extraction run reflects Rev{' '}
            {run?.libraryRevision}, while your library is now at Rev {snapshot?.libraryRevision}.
            Re-analyze locally before proposing new library writes so matched states stay current.
          </div>
        )}

        <ProcessingLimitsPanel
          limits={processingLimits}
          disabled={!processingLimitsReady || analyzing || applying}
          notice={processingLimitsNotice}
          onSave={handleSaveProcessingLimits}
        />

        <RankingControls
          grammarMode={grammarMode}
          inputFormat={inputFormat}
          rankMode={rankMode}
          groupedView={groupedView}
          dictionaryPack={dictionaryPack}
          usePackAsHints={usePackAsHints}
          packError={packError}
          disabled={!processingLimitsReady || analyzing || applying}
          onGrammarModeChange={handleGrammarModeChange}
          onInputFormatChange={handleInputFormatChange}
          onRankModeChange={(nextRank) => setRankMode(nextRank)}
          onGroupedViewChange={(grouped) => setGroupedView(grouped)}
          onDictionaryPackUpload={(file) => void handleDictionaryPackUpload(file)}
          onClearDictionaryPack={handleClearDictionaryPack}
          onUsePackAsHintsChange={handleUsePackAsHintsChange}
        />

        {/* Input panel */}
        <section className="panel stack-md" aria-labelledby="source-input-heading">
          <div className="panel-header" style={{ marginBottom: 0 }}>
            <div>
              <p className="status-label">SOURCE INPUT (BROWSER-LOCAL)</p>
              <h2 id="source-input-heading">Paste text or load UTF-8 TXT / Markdown</h2>
            </div>
            <div className="small muted">
              Effective limits: {processingLimits.maxTxtInputBytes.toLocaleString('en-US')} TXT/MD bytes ·{' '}
              {processingLimits.maxTextUtf16CodeUnits.toLocaleString('en-US')} UTF-16 chars ·{' '}
              {processingLimits.maxCandidateOccurrences.toLocaleString('en-US')} distinct occurrence spans (strict reject, no truncation)
            </div>
          </div>

          <div className="field">
            <label htmlFor="source-text-area">English scientific source text</label>
            <textarea
              id="source-text-area"
              className="textarea"
              value={sourceText}
              onChange={(event) => handleSourceTextChange(event.target.value)}
              disabled={applying}
              placeholder="Paste synthetic English scientific text or Markdown (e.g., Periodontal ligament-derived stem cells express TNF-α and Na+/K+-ATPase.)"
            />
          </div>

          <div className="toolbar" style={{ marginBottom: 0 }}>
            <div className="field">
              <label htmlFor="txt-file-input">Or load local UTF-8 .txt or .md file</label>
              <input
                id="txt-file-input"
                type="file"
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                className="input"
                disabled={applying}
                onChange={(event) => void handleFileChange(event)}
              />
            </div>

            <div className="row-inline">
              <button
                type="button"
                className="btn btn-primary"
                disabled={analyzing || loadingLibrary || !processingLimitsReady || !snapshot || sourceText.trim().length === 0}
                onClick={() => void handleAnalyze()}
              >
                {analyzing ? 'Analyzing locally…' : 'Analyze locally'}
              </button>
              {analyzing && (
                <button type="button" className="btn btn-danger" onClick={handleCancelAnalysis}>
                  Cancel analysis
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={handleClearSession}
                disabled={analyzing && !sourceText}
              >
                Clear session
              </button>
            </div>
          </div>
        </section>

        {/* Results split view */}
        {run && snapshot && (
          <>
            <div className="metrics-strip" style={{ marginBottom: 0 }}>
              <div className="metric-chip">
                <span>Occurrences</span>
                <strong data-testid="occurrence-total">{counts.total}</strong>
              </div>
              <div className="metric-chip">
                <span>Unique concepts matched</span>
                <strong>{counts.uniqueConcepts}</strong>
              </div>
              <div className="metric-chip">
                <span>Unique expressions matched</span>
                <strong>{counts.uniqueExpressions}</strong>
              </div>
              <div className="metric-chip">
                <span>Known forms</span>
                <strong>{counts.known}</strong>
              </div>
              <div className="metric-chip">
                <span>New candidates</span>
                <strong>{counts.newCand}</strong>
              </div>
              <div className="metric-chip">
                <span>Ambiguous / possible</span>
                <strong>{counts.ambiguous}</strong>
              </div>
            </div>

            <div className="workbench-grid-equal">
              <SourceContext
                text={run.text}
                occurrences={run.occurrences}
                selectedOccurrenceId={selectedOccurrenceId}
                parsedDocument={run.parsedDocument}
                evidenceBySpan={run.evidenceBySpan}
                packSuggestionsBySpan={run.packSuggestionsBySpan}
                onSelectOccurrence={(id) => setSelectedOccurrenceId(id)}
              />

              <section className="panel stack-md" aria-labelledby="candidate-review-heading">
                <div className="panel-header" style={{ marginBottom: 0 }}>
                  <div>
                    <p className="status-label">CANDIDATE REVIEW</p>
                    <h2 id="candidate-review-heading">Discovered &amp; matched occurrences</h2>
                  </div>
                  <span className="tag tag-mono">{run.algorithmVersion}</span>
                </div>

                <div className="tabs" role="tablist" aria-label="Candidate state filter">
                  {(
                    [
                      ['all', `All (${run.occurrences.length})`],
                      ['new-candidate', `New candidates (${counts.newCand})`],
                      ['known-form', `Known forms (${counts.known})`],
                      ['ambiguous', 'Ambiguous'],
                      ['possible-new-form', 'Possible new'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={filter === value}
                      className="tab-btn"
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <CandidateTable
                  occurrences={visibleOccurrences}
                  snapshot={snapshot}
                  selectedOccurrenceId={selectedOccurrenceId}
                  rejectedIds={rejectedIds}
                  sessionResolvedMap={sessionResolvedMap}
                  staleWarning={runIsStale}
                  evidenceBySpan={run.evidenceBySpan}
                  packSuggestionsBySpan={run.packSuggestionsBySpan}
                  rankMode={rankMode}
                  groupedView={groupedView}
                  rankedGroups={rankedGroups}
                  onSelectOccurrence={(id) => setSelectedOccurrenceId(id)}
                  onCreateConcept={(occ) => void handleCreateConceptFromOcc(occ)}
                  onLinkToConcept={(occ, cid) => void handleLinkToConcept(occ, cid)}
                  onResolveAmbiguous={handleResolveAmbiguous}
                  onRejectSession={handleRejectSession}
                />
              </section>
            </div>

            {/* B5: Explicit Source Retention Opt-in */}
            <section className="panel stack-md" aria-labelledby="retention-opt-in-heading">
              <div>
                <p className="status-label">OPTIONAL LOCAL SOURCE RETENTION (B5)</p>
                <h2 id="retention-opt-in-heading">Explicit consent to retain current source text</h2>
                <p className="muted small">
                  By default, source text stays only in session RAM and disappears on reload. Saving
                  a concept does <strong>not</strong> save the source document. Retain a source only
                  if you want durable span provenance and cross-document retained evidence counts.
                </p>
              </div>

              <div className="form-grid">
                <div className="field">
                  <label htmlFor="retention-title-input">Source title for local retention</label>
                  <input
                    id="retention-title-input"
                    type="text"
                    className="input"
                    value={retentionTitle}
                    onChange={(event) => setRetentionTitle(event.target.value)}
                    placeholder="e.g., Synthetic Periodontology Excerpt 1"
                    disabled={runIsStale}
                  />
                </div>
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={retentionConsent}
                  onChange={(event) => setRetentionConsent(event.target.checked)}
                  disabled={runIsStale}
                />
                <span>
                  I explicitly consent to retain this source text locally in browser IndexedDB for
                  provenance spans. I understand that previously downloaded backup files cannot be
                  revoked if I delete this source later.
                </span>
              </label>

              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={runIsStale || !retentionConsent || retentionTitle.trim().length === 0}
                  onClick={() => void handleProposeRetainSource()}
                >
                  Retain source locally
                </button>
              </div>
            </section>
          </>
        )}

        {/* B5: Retained sources management */}
        {snapshot && (
          <section className="panel stack-md" aria-labelledby="retained-sources-heading">
            <div>
              <p className="status-label">RETAINED LOCAL SOURCES</p>
              <h2 id="retained-sources-heading">
                Persisted source documents ({snapshot.documents.length})
              </h2>
              <p className="muted small">
                Deleting a retained source atomically removes the document, its retained runs, and
                linked provenance source pointers while preserving your concepts and expressions.
                Any previously downloaded backup files remain under your local file control and
                cannot be remotely revoked.
              </p>
            </div>

            {snapshot.documents.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                No source documents are persisted in IndexedDB.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Length</th>
                      <th>Retained Runs</th>
                      <th>Created</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.documents.map((doc) => {
                      const docRuns = snapshot.runs.filter((r) => r.documentId === doc.id);
                      return (
                        <tr key={doc.id}>
                          <td>
                            <strong>{doc.title}</strong>
                            <div className="mono muted small">{doc.id.slice(0, 8)}</div>
                          </td>
                          <td className="mono">{doc.text.length.toLocaleString('en-US')} chars</td>
                          <td className="mono">{docRuns.length}</td>
                          <td className="mono small">{doc.createdAt}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              aria-label={`Delete retained source ${doc.title}`}
                              onClick={() => void handleProposeDeleteRetained(doc.id)}
                            >
                              Delete source
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      <ChangeApprovalDialog
        proposal={pendingProposal}
        busy={applying}
        onApprove={() => void handleApproveAndSave()}
        onCancel={() => {
          setPendingProposal(null);
          setPendingRetainMeta(null);
        }}
      />
    </>
  );
}
