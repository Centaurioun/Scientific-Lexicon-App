# WP02 Synthetic S1 vs. S2 Comparison Report (D11)

## Evaluation Boundary Notice

- **Scope:** Frozen synthetic fixtures only (`tests/fixtures/s2/synthetic-documents.ts`, executed via `tests/unit/s2-comparison.test.ts`).
- **G4 Real-Data Readiness:** `NOT READY`
- **G5 Scientific Accuracy:** `NOT ESTABLISHED`
- **User-Facing Default Policy:** `s1-grammar-1` remains the explicit default baseline in the Extraction Workbench; `s2-grammar-2` is explicitly labeled **S2 Scientific Experimental** and user-selectable alongside S1. These synthetic numbers prove deterministic regression behavior and harness operation **only** — they are **not** a scientific accuracy claim.

---

## 1. Test Configuration

- **Fixtures (3 frozen synthetic documents, 26 gold spans total — 20 unknown, 2 nested):**
  1. `syn-doc-baseline-01` (`txt`, `txt-utf8-v1`) — WP01 periodontology baseline sentence.
  2. `syn-doc-sci-02` (`txt`, `txt-utf8-v1`) — scientific compounds, symbols (`p53`/`P53`, `Na+/K+-ATPase`, `HLA-B`/`HLA-B27`, `2,4-dinitrophenol`), `Gram staining`, `loss of heterozygosity (LOH)`, `Tumor necrosis factor alpha (TNF-α)`, `Smith et al., 2026`, and exact Turkish forms.
  3. `syn-doc-md-03` (`markdown`, `md-conservative-v1`) — headings, lists, pipe table with escaped `\|` and emoji, links, inline code, and fenced code block exclusions.
- **Library Snapshot:** `createSyntheticBaselineSnapshot()` (`libraryRevision = 3`; 3 concepts: `TNF-α` + 2 homonym `PD` concepts). Unchanged (`libraryRevision = 3`) after both runs.
- **Processing Limits:** `DEFAULT_PROCESSING_LIMITS` (`2 MiB` TXT/MD, `200,000` UTF-16 chars, `5,000` distinct spans).

---

## 2. Measured Synthetic Comparison (`tests/unit/s2-comparison.test.ts`)

| Metric | S1 Baseline (`s1-grammar-1`, `source-order`) | S2 Experimental (`s2-grammar-2`, `c-value`) | Delta (S2 − S1) |
| --- | ---: | ---: | ---: |
| True Positives (TP) | 22 | 26 | +4 |
| False Positives (FP) | 84 | 78 | −6 |
| False Negatives (FN) | 4 | 0 | −4 |
| Micro Precision | 0.2075 | 0.2500 | +0.0425 |
| Micro Recall | 0.8462 | 1.0000 | +0.1538 |
| Micro F1 | 0.3333 | 0.4000 | +0.0667 |
| Macro Precision | 0.2490 | 0.2643 | +0.0153 |
| Macro Recall | 0.8535 | 1.0000 | +0.1465 |
| Macro F1 | 0.3797 | 0.4157 | +0.0360 |
| Unknown Recall (20 gold) | 0.8000 (16/20) | 1.0000 (20/20) | +0.2000 |
| Nested Recall (2 gold) | 1.0000 (2/2) | 1.0000 (2/2) | 0.0000 |
| Precision@5 / Recall@5 | 0.2667 / 0.1538 | 0.3333 / 0.1923 | +0.0667 / +0.0385 |
| Precision@10 / Recall@10 | 0.3000 / 0.3462 | 0.2333 / 0.2692 | −0.0667 / −0.0769 |
| Precision@15 / Recall@15 | 0.2444 / 0.4231 | 0.2444 / 0.4231 | 0.0000 / 0.0000 |
| Known-Form Occurrences | 3 | 3 | 0 |
| Ambiguous Occurrences (`PD`) | 3 | 3 | 0 |
| New-Candidate Occurrences | 100 | 98 | −2 |
| Acronym Hypotheses (`hypothesis-only`) | 0 | 2 | +2 |
| Total Predicted Spans | 106 | 104 | −2 |
| Synthetic Reviewer Load Proxy (spans/doc, **not human-measured**) | 35.33 | 34.67 | −0.67 |
| Measured Total Pipeline Time (Vitest Node runtime) | 308.90 ms (cold NLP init) | 25.39 ms (warm NLP) | N/A (cold vs warm) |

---

## 3. Observed Improvements, Negative Cases, and Limitations

### Observed Synthetic Improvements (S2 vs. S1)
1. **Scientific Compound & Formula Recovery (+4 TP, −4 FN):** On the synthetic scientific fixture, `s2-grammar-2` recovered `periodontal ligament-derived stem cells`, `Na+/K+-ATPase`, `Gram staining`, and `loss of heterozygosity` while keeping exact UTF-16 offsets and excluding bibliographic `et al.` noise.
2. **Explainable Session Evidence & Acronym Hypotheses:** `s2-grammar-2` emitted structured non-canonical reason tags and 2 `hypothesis-only` acronym pairs (`Tumor necrosis factor alpha (TNF-α)` and `loss of heterozygosity (LOH)`) without creating synonyms or mutating concepts.
3. **Markdown Structural Safety:** Both modes respect `ParsedDocument` excluded ranges (code fences, inline code, link destination URLs), preventing false matches inside markup or code.

### Honest Negative Cases & Trade-Offs
1. **Short-Document Unigram Ranking Drop at K=10 (`P@10`: 0.3000 → 0.2333):** Because canonical multiword C-value (`tokenCount >= 2`) scores multiword phrases ahead of separately listed unigrams, short synthetic passages with high-value single-token symbols (`TNF-α`, `PD`, `CD4+`, `p53`, `P53`, `HLA-B27`) rank those unigrams below longer multiword NP candidates (`log2(n) * f(a)`). Reviewers inspecting symbol-heavy short passages should use `source-order` or `frequency` ranking or inspect the separate unigram section.
2. **High False-Positive Surface Volume (78 FP in S2 / 84 FP in S1):** Deterministic POS noun-phrase generation emits all nested sub-phrases (e.g., `ligament`, `stem cells`, `cells`, `cohorts`, `exposure`), yielding low raw precision (`0.2500`) on uncalibrated synthetic passages. This confirms why human review and future held-out G5 benchmarking are mandatory.
3. **No Cold-vs-Warm Latency Parity Claim:** S1 ran first in the test process and absorbed wink-nlp model initialization (`308.90 ms`); S2 ran warm (`25.39 ms`). Both operate in tens of milliseconds warm on small fixtures and remain bounded by `OccurrenceLimitTracker` (`100`–`10,000` spans).
4. **DOCX Blocked & Real Benchmarks Absent:** Local DOCX parsing remains `BLOCKED` pending separate G1 dependency qualification (`docs/qualification/WP02-DOCX-CANDIDATE.md`), and no external corpus (ACTER, ACL RD-TEC, MedMentions, BELB) was run.
