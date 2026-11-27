# TermForge — WP02 Implementation Ledger (D1–D12)

- **Repository:** `Centaurioun/Scientific-Lexicon-App`
- **Integrated WP01 Starting Baseline:** `09a505b12db12b5830921120020d3084fe080e8c` (+ WP02 docs commit)
- **Work Package:** WP02 — Scientific Intelligence (`D1`–`D12`, strictly stopping before WP03)
- **Environment:** Google AI Studio container (Bun runtime lock; canonical npm `package-lock.json` absent in container and NOT fabricated)
- **Dependency/Lock Integrity:** Exact 15 packages in `package.json` unchanged (`0` packages added/upgraded); `package-lock.json` untouched; `scripts/dev.mjs` and `allowedDevOrigins` preserved.
- **Canonical Schema & Persistence Integrity:** S1 IndexedDB schema v1 and `termforge-backup` v1 envelope strictly unchanged; all WP02 parser metadata, candidate evidence, acronym hypotheses, ranking stats, and dictionary packs are strictly **session-only**.
- **Gate Boundary Status:**
  - **G3 (WP01 + WP02 synthetic regression):** Unit & build verified in AI Studio; native npm lock gate (`npm run test:gate`) and native Playwright runner (`npm run test:e2e`) require independent Codex verification on native Linux/npm.
  - **D3 Local DOCX Parser:** `BLOCKED` pending separate G1 dependency qualification (`docs/qualification/WP02-DOCX-CANDIDATE.md`).
  - **G4 Real-Data Readiness:** `NOT READY`
  - **G5 Scientific Accuracy:** `NOT ESTABLISHED`

---

## Task Execution Ledger (D1–D12)

| Task | Scope | Status | Key Files | TDD / Verification Evidence | Notes / Blockers |
| --- | --- | --- | --- | --- | --- |
| **D1** | Baseline freeze & reproducible comparison reference | `DONE` | `tests/fixtures/s2/synthetic-documents.ts`, `tests/unit/s2-baseline.test.ts`, `docs/handoffs/WP02-IMPLEMENTATION-LEDGER.md` | GREEN: `tests/unit/s2-baseline.test.ts` (1/1 PASS); SHA-256 fixture hash verified; zero canonical mutations. | Preserves exact S1 baseline (`s1-grammar-1+s1-boundary-v1`). |
| **D2** | Structured Markdown & `ParsedDocument` representation | `DONE` | `src/domain/document-input.ts`, `src/adapters/documents/markdown.ts`, `src/application/document-input.ts`, `src/features/extraction/read-text.ts`, `tests/unit/document-input.test.ts` | RED verified (missing module) -> GREEN: `tests/unit/document-input.test.ts` (3/3 PASS). | Conservative dependency-free parser (`md-conservative-v1`), exact UTF-16 slices, CRLF, Greek/emoji, escaped pipes, code/link URL exclusions, explicit warnings on unclosed fences/raw HTML, explicit `.docx` rejection. |
| **D3** | Local DOCX parser qualification boundary | `BLOCKED` | `docs/qualification/WP02-DOCX-CANDIDATE.md` | Gate documented cleanly per WP02 conditional dependency rule. | No DOCX adapter, no `.docx` UI option, no `package.json` or lockfile change. Requires separate G1 qualification (`mammoth` vs minimal `fflate` + `DOMParser` vs defer). |
| **D4** | Scientific grammar v2 & explainable candidate evidence | `DONE` | `src/domain/candidate-evidence.ts`, `src/application/scientific-candidates.ts`, `src/domain/extraction.ts`, `src/adapters/matching/registered-matcher.ts`, `src/application/extraction.ts`, `tests/unit/scientific-candidates.test.ts` | RED verified -> GREEN: `tests/unit/scientific-candidates.test.ts` (5/5 PASS) + WP01 `extraction.test.ts` (11/11 PASS). | Handles `p53`/`P53`, `Na+/K+-ATPase`, `HLA-B`/`HLA-B27`, `TNF-α`, `2,4-dinitrophenol`, `Gram staining`, `loss of heterozygosity`, `Periodontal ligament-derived stem cells`, excludes `et al.`, emits `hypothesis-only` acronym pairs, enforces `ParsedDocument` exclusions, preserves `s1-grammar-1` default. |
| **D5** | Session corpus statistics & canonical multiword C-value ranking | `DONE` | `src/domain/ranking.ts`, `src/application/ranking.ts`, `tests/unit/ranking.test.ts` | RED verified -> GREEN: `tests/unit/ranking.test.ts` (4/4 PASS). | Exact token-sequence nesting (not naive substring), hand-verified `4` and `7` C-value fixtures, unigrams separated (`score: null`), deterministic UTF-16 tie-breaking, zero fake confidence. |
| **D6** | Local dictionary pack staging & read-only lookup | `DONE` | `src/domain/dictionary-pack.ts`, `src/application/dictionary-lookup.ts`, `src/features/extraction/dictionary-pack-store.ts`, `src/application/extraction.ts`, `tests/unit/dictionary-pack.test.ts` | RED verified -> GREEN: `tests/unit/dictionary-pack.test.ts` (4/4 PASS). | Strict v1 JSON validation (`2 MiB`, `10,000` entries, unique IDs, mandatory `authority`/`release`/`license`), RAM-only store, read-only unverified suggestions, bounded optional discovery hints via shared `OccurrenceLimitTracker`, zero canonical writes. |
| **D7** | Performance & cancellation hardening | `DONE` | `src/adapters/matching/registered-matcher.ts`, `src/adapters/nlp/wink-engine.ts`, `src/application/extraction.ts`, `tests/unit/s2-cancellation.test.ts`, `tests/e2e/s2-performance.spec.ts` | RED verified -> GREEN: `tests/unit/s2-cancellation.test.ts` (5/5 PASS). | Added `AHOCORASICK_TABLE_ADAPTER_VERSION` + `assertCompatibleAutomatonShape`, oracle parity, 5k/10k occurrence tests, abort checkpoints, `WorkerUnavailableForLargeInputError` guard (>20,000 chars), stage timings callback. |
| **D8** | Scientific review & ranking UI | `DONE` | `src/features/extraction/RankingControls.tsx`, `src/features/extraction/CandidateTable.tsx`, `src/features/extraction/SourceContext.tsx`, `src/features/extraction/ExtractionWorkspace.tsx`, `tests/e2e/s2-review.spec.ts` | Verified live in headless Chromium (`playwright-cli` R1 & R2) + production Next.js build. | Grammar switcher (S1 default, S2 experimental), TXT/MD selector (DOCX blocked note), C-value & frequency ranking, grouped surface view preserving per-occurrence actions, dictionary pack loader/clearer, parser warnings, `Inspect <id>` links to `/library?concept=...`, strict invalidation on source/policy changes. |
| **D9** | Improved terminology lookup & review navigation | `DONE` | `src/application/library.ts`, `src/features/library/LibraryWorkspace.tsx`, `tests/unit/s2-lookup.test.ts`, `tests/e2e/s2-lookup.spec.ts` | RED verified -> GREEN: `tests/unit/s2-lookup.test.ts` (3/3 PASS) + live Chromium verified (`p53`/`P53` literal=1, CI-view=2, Rev unchanged). | Preserves `findExpressions` default case-sensitive literal lookup; adds `exact`, `prefix`, and explicitly labeled `case-insensitive-view` (Turkish-aware without mutating stored text); adds `?concept=<id>` read-only focus banner with homonym siblings (`PD`). |
| **D10** | Independent evaluation harness & benchmark protocol | `DONE` | `src/domain/evaluation.ts`, `src/application/evaluation.ts`, `tests/unit/evaluation.test.ts`, `docs/evaluation/WP02-BENCHMARK-PROTOCOL.md` | RED verified -> GREEN: `tests/unit/evaluation.test.ts` (3/3 PASS). | Exact half-open span matching, deduplication, `null` empty denominators, distinct micro vs macro P/R/F1, unknown/nested recall, false rejections, concept-level scoring only with explicit gold keys, `at-k`, split-leakage check (`checkSplitLeakage`), external corpus rights gate documented. |
| **D11** | Integrated synthetic comparison & evaluation boundary | `DONE` | `tests/unit/s2-comparison.test.ts`, `tests/e2e/s2-integrated.spec.ts`, `docs/evaluation/WP02-SYNTHETIC-COMPARISON.md` | GREEN: `tests/unit/s2-comparison.test.ts` (1/1 PASS); exact measured S1 vs S2 synthetic metrics and honest negative cases recorded. | S2 experimental remains user-selectable alongside S1 default; synthetic workload proxy explicitly distinguished from human measurements. |
| **D12** | Integrated verification, live Chromium critique & Codex handoff | `DONE` | `docs/evaluation/WP02-ACCEPTANCE.md`, `docs/handoffs/WP02-CODEX-HANDOFF.md`, `docs/handoffs/WP02-IMPLEMENTATION-LEDGER.md` | Full unit suite (`22` files, `80/80` tests PASS), `npm run typecheck` PASS, `npm run build` PASS, live Chromium R1 & R2 PASS with visual polish fixes (`0` console errors, `0` external requests). | Stopped cleanly before WP03. Native `npm run test:gate` and native `npm run test:e2e` handed off for independent Codex verification. |

---

## Live Browser Verification Notes (D12)
- **Round 1** caught route path mismatch in newly authored E2E specs (`/extract` -> `/extraction`, `#expr-text-input` -> `#editor-text-input`, `Preview change`, `Download complete backup (.json)` / `#backup-file-input` / `Confirm atomic restore`), and spotted minor tag spacing + toolbar baseline alignment in `/library`.
- **Round 2** verified polished `/library` focused concept banner + baseline-aligned toolbar, verified `/extraction` split-view C-value grouping + parser warnings + excluded Markdown ranges + `0` console errors + `0` external network requests, and fixed grouped-card inner table button wrapping so `Create concept` and `Reject` fit cleanly at `1440x900`.

---

## Independent Codex Qualification Addendum (2026-11-27)

Environment: macOS ARM64, Node `v26.12.1`, npm `11.20.0`, Playwright `1.65.1`; branch `codex/wp02-independent-qualification`; source base `2e4a5894e92f3439330aa019d337ac04a08b794f`. Required lock SHA matched before and after remediation. `npm ci` installed the existing lock graph (69 packages added; 0 npm audit advisories); no package or lockfile edit was made.

| Task | Independent status | Evidence / remaining scope |
|---|---|---|
| D1 | PASS for reproduction | Pinned WP01/WP02 ancestry verified; original 80 unit tests, dependency gate, typecheck, build, and Playwright rerun. First native browser suite exposed one integrated restore test timing failure. |
| D2 | PARTIAL | Fixed mixed CRLF/CR/LF splitting; reject out-of-order exclusion metadata and mismatched `ParsedDocument.text`. Exact UTF-16/cross-section/markup adversarial matrix is incomplete. |
| D3 | BLOCKED | Existing candidate dossier reused; no parser dependency added or enabled. No isolated hostile-archive G1 artifact produced. |
| D4 | PARTIAL | S1 remains default and baseline tests pass. Full independent adversarial grammar challenge and limit-plus-one/error-path matrix not completed. |
| D5 | PARTIAL / REMEDIATED FINDINGS | Explicit NLP tokens now drive ranking, view filtering no longer changes corpus scores, subsequence index removes all-pairs type comparison and deduplicates repeated windows per distinct container, and group keys are tuple encoded. Independent pairwise oracle and 5k/10k repeated/diverse timings added. Review RED/GREEN reproduced and fixed a duplicate-container score error. |
| D6 | PARTIAL / REMEDIATED FINDINGS | Pre-read 2 MiB check, fatal UTF-8 decoding, required URI, shared tracker in both pack modes, and shared per-surface entries. Schema-valid arbitrary packs remain importable; synthetic-only enforcement is unresolved. |
| D7 | PARTIAL | Browser UI 5k/10k runs and cancellation test passed; complete browser-local stage measurements, high type diversity, pack stress, worker failure/cancellation matrix, and memory/responsiveness audit remain incomplete. |
| D8 | PARTIAL | File reads, proposals, cancellation status, and revision changes now guard stale completions; out-of-order file completion tested. Independent review found revision invalidation could strand `analyzing`; it now aborts and clears loading state. Pack-clear race, proposal delayed-promise matrix, accessibility, and homonym workflows need broader coverage. |
| D9 | PASS within existing tests | Literal and case-insensitive lookup E2E passed; no new changes to lookup semantics. |
| D10 | PARTIAL | Existing unit suite passed; complete independent metric, duplicate, at-k, concept mapping, false-rejection, and leakage audit not completed. |
| D11 | PASS for bounded synthetic factorial | Replaced confounded evaluation with S1/S2 × source-order/frequency/C-value, identical inputs and warmed NLP. No generalization claim. |
| D12 | NOT QUALIFIED | Final dependency gate 4/4, unit tests 91/91, typecheck, production build, and Playwright 25/25 pass. Q2/Q4/Q5/Q6/Q7/Q8 mandatory evidence gaps remain. See independent qualification report. |

The Gemini D1–D12 completion entries above are historical claims and are not upgraded to independent PASS by this addendum.


### Independent Qualification Follow-up (2026-11-27)

The independent remediation branch extends the original ledger evidence; the original Google AI Studio entries above remain historical. Final native verification on the remediation tree passed: dependency gate 4/4, unit 91/91 across 22 files, typecheck, production build, Playwright 25/25, and npm audit with zero vulnerabilities.

| Requirement | Independent status | Added evidence / remaining limits |
|---|---|---|
| D2 | PARTIAL | Added exact UTF-16 slices for combining marks and supplementary-plane characters with CRLF; full malformed Markdown/fuzz matrix remains incomplete. |
| D6 | PARTIAL | Added 100-ID repeated-surface / 2,000-hit stress fixture and browser test clearing a pack during delayed upload. Arbitrary schema-valid packs remain importable; synthetic-only enforcement and rights verification remain unresolved. |
| D8 | PARTIAL | Delayed pack upload invalidation now has browser coverage; delayed proposal and full policy/revision interleavings, accessibility and homonym workflows remain incomplete. |
| D10 | PASS for synthetic harness semantics | Fail-closed UTF-16 span, annotation consistency, document correspondence, K and elapsed-time validation. This does not establish G5 or gold annotation validity. |
| D12 | NOT QUALIFIED | Gate 4/4, unit 91/91, typecheck/build pass, Playwright 25/25; Q2/Q4/Q5/Q6/Q8/Q9 mandatory gaps remain. See `docs/evaluation/WP02-INDEPENDENT-QUALIFICATION.md`. |
