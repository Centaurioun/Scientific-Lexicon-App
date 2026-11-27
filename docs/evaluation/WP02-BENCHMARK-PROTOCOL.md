# WP02 Benchmark & Independent Evaluation Protocol (D10)

## Status Summary

- **Evaluation Harness Status:** Implemented and unit-verified on synthetic fixtures (`src/domain/evaluation.ts`, `src/application/evaluation.ts`, `tests/unit/evaluation.test.ts`).
- **G4 Real-Data Readiness:** `NOT READY`
- **G5 Scientific Accuracy:** `NOT ESTABLISHED`

Synthetic fixtures prove harness correctness, determinism, and metric math **only**. They do **not** establish real-world scientific extraction accuracy, clinical fitness, or G5 passage.

---

## 1. Exact Metric Definitions

1. **Exact Half-Open UTF-16 Span Matching (`[start, end)`):**
   - A predicted span matches a gold span if and only if `pred.start === gold.start && pred.end === gold.end` within the same `documentId`.
   - Zero lowercase folding, zero Unicode normalization, and zero fuzzy offset tolerance are applied.
   - Duplicate spans within a document are deduplicated prior to counting TP, FP, and FN.
2. **Micro vs. Macro Precision, Recall, and F1:**
   - **Micro P/R/F1** aggregates `TP`, `FP`, and `FN` across all documents before computing ratios.
   - **Macro P/R/F1** averages non-null per-document precision, recall, and F1 separately.
   - Empty denominators always evaluate to `null` (never `0` or `NaN`).
3. **Unknown & Nested Recall:**
   - `unknownRecall`: fraction of gold spans marked `unknown: true` recovered by exact span match.
   - `nestedRecall`: fraction of gold spans marked `nested: true` recovered by exact span match.
4. **False-Rejection Tracking:**
   - `falseRejectionCount`: count of gold spans explicitly present in `rejectedSpans` (when reviewer or filter rejection sets are supplied).
5. **Concept-Level Evaluation:**
   - Computed **only** when explicit gold `conceptKey` mappings are present (`conceptLevel === null` otherwise).
   - Never infers concept equivalence from surface similarity alone.
6. **Ranking At-K & Workload Proxy:**
   - `precisionAtK` and `recallAtK` evaluate the top `K` deduplicated spans in the tested ranking order (`source-order`, `frequency`, `c-value`).
   - `syntheticReviewerLoadProxy` records average unique predicted spans per document. It is strictly an algorithmic proxy and **not** a human-measured reviewer timing study.

---

## 2. Independent Held-Out Splits & Leakage Control

Before any future G5 evaluation on authorized real corpora:

1. **Strict Document & Concept Separation:**
   - Development/tuning corpora and final held-out evaluation corpora must have zero overlapping document IDs and zero overlapping unseen-concept evaluation keys.
   - Every evaluation run must execute `checkSplitLeakage(devDocs, holdoutDocs)` and fail closed if `hasLeakage === true`.
2. **Double Annotation & Adjudication:**
   - Real-domain held-out passages must be annotated independently by at least two domain-qualified annotators using written span-boundary guidelines (handling hyphenated compounds, Greek symbols, case-sensitive gene/protein symbols, nested terms, and bibliographic exclusions).
   - Inter-annotator agreement (IAA) and adjudication decisions must be recorded prior to running TermForge against the held-out split.
3. **Owner-Approved Thresholds Required for G5:**
   - Neither WP01 nor WP02 defines passing G5 numeric accuracy thresholds unilaterally. The owner must approve target domain metrics, minimum sample sizes, and error-mode limits before any G5 determination.

---

## 3. External Benchmark & Dictionary Rights Gate Status

No external datasets or real dictionary packs have been downloaded or bundled in WP02. Any future G5 benchmark execution must clear its license/redistribution/privacy gate first:

| External Resource | Role | Current Gate Status | Notes |
| --- | --- | --- | --- |
| **ACTER** | Multilingual ATE benchmark (domain terms) | `BLOCKED — NOT ACQUIRED` | Requires explicit license review and owner authorization before local staging. |
| **ACL RD-TEC 2.0** | Computational linguistics term extraction benchmark | `BLOCKED — NOT ACQUIRED` | Requires license/redistribution review before local use. |
| **MedMentions** | Biomedical UMLS entity/mention corpus | `BLOCKED — NOT ACQUIRED` | Requires UMLS/corpus rights clearance; no real biomedical datasets staged in WP02. |
| **BELB** | Biomedical entity linking benchmark | `BLOCKED — NOT ACQUIRED` | Requires source dataset rights clearance and separate G5 authorization. |
| **Real Dictionary Packs (MeSH / UMLS / TDK / SNOMED)** | Optional local lookup packs | `BLOCKED — NOT ACQUIRED` | WP02 tests dictionary pack ingestion and read-only lookup solely on synthetic JSON fixtures. |
