# WP02 Independent Engineering Qualification

**Verdict: NOT QUALIFIED — REMEDIATION REQUIRED**

This report independently reproduces the pinned Gemini WP02 implementation, records confirmed defects and corrections, and distinguishes passing local synthetic checks from incomplete mandatory qualification work. It does not authorize integration, DOCX enablement, real-data use, G4, G5, or WP03.

## Baseline and environment

- Repository: `Centaurioun/Scientific-Lexicon-App` (`https://github.com/Centaurioun/Scientific-Lexicon-App.git`). The initially open workspace was the separate `Scientific-Lexicon-Lab` repo and was left untouched.
- Qualification branch: `codex/wp02-independent-qualification`, created from pinned Gemini revision `2e4a5894e92f3439330aa019d337ac04a08b794f`.
- Final implementation checkpoint: `6b8736b6186fc4f5d7e78197188f1139ad0d095e` (required commands rerun on this source tree). A documentation-only publication commit follows it; the branch tip is included in the delivery handoff.
- WP01 baseline `09a505b12db12b5830921120020d3084fe080e8c` and WP02 spec checkpoint `41473feec38708c34902dc3710ed00569c791198` are ancestors of the pinned implementation. Remote `main` was at the pinned Gemini SHA at initial inspection; the separate Lab checkout's local `main` was three commits behind its own `origin/main`.
- Environment: macOS 27.0 ARM64; Node `v26.12.1`; npm `11.20.0`; Playwright `1.65.1`; Next `16.4.6`; Chromium headless through Playwright.
- Initial `npm ci`: exit 0, 69 packages added, 70 audited, 0 vulnerabilities. npm warned that `fsevents@2.3.3` install scripts were not approved; no script approval or dependency change was made.
- Canonical root lock SHA-256 before and after: `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`. The 15-package direct dependency set and `scripts/dev.mjs` remain unchanged.

## Baseline reproduction and corrections

Initial pinned-source reproduction: `npm run test:gate` 4/4; `npm run typecheck` exit 0; `npm run test` 80/80 across 22 files; production build exit 0. Initial Playwright run was 22/23: the D11 integrated backup/restore test navigated to `/library` immediately after the asynchronous confirmation click, without waiting for the restore success state. After the test waited for “Restored validated backup atomically,” that test passed.

Confirmed corrections on the qualification branch:

1. Ranking scores were computed from filter-visible occurrences. Ranking now uses the full extraction run and explicit NLP token spans; filtering only affects displayed rows. A nested fixture demonstrates full-run C-value 4 versus the incorrect filtered value 7.
2. C-value nested-container lookup compared each candidate type with every longer type. It now indexes exact contiguous token subsequences and enumerates actual containment matches.
3. Delimiter-composed group keys were replaced with JSON tuple encoding.
4. Dictionary packs were read before checking file size and used replacement UTF-8 decoding. New reader enforces the 2 MiB file size before reading, checks actual buffer size, uses fatal UTF-8, and validates before activation. Pack provenance URI is required.
5. Dictionary suggestion-only lookup did not share the run's span tracker and copied entry maps for each repeated matching span. Both modes now share the configured tracker; a default 10,000-span cap applies to direct lookup, and same-surface spans share one sorted entry array.
6. `ParsedDocument` metadata could have out-of-order excluded ranges or be analyzed against different text. Extraction and direct dictionary lookup now reject mismatched coordinate text; validation rejects unordered/overlapping exclusions and unqualified DOCX metadata. Markdown line offsets now recognize CRLF, bare CR, and LF.
7. Overlapping file reads could complete out of order; proposal creation and analysis errors could publish stale state; external library revisions did not invalidate pending proposals. Request sequence checks and revision refresh/clear behavior were added. Cancellation feedback is emitted at the explicit cancel action.
8. The historical S1/source-order vs S2/C-value comparison confounded grammar and ranking and compared cold S1 to warm S2. It now evaluates all six grammar/ranking combinations on the same fixtures with NLP warmed before the matrix. The historical table is retained and labeled uncontrolled.
9. Independent review found repeated token windows in one longer surface were counted as separate C-value containers. A regression produced RED at `4.5` versus the distinct-container result `13/3`; the index now deduplicates each container surface per candidate token sequence. Review also found a library revision invalidation could strand the UI in an analyzing state; revision invalidation now aborts the request and explicitly clears that state. The factorial test now checks every rank-independent full-set metric.

Regression evidence: new/expanded unit and E2E cases cover required URI, pre-read oversize rejection, malformed UTF-8, extraction and dictionary coordinate mismatch, mixed line endings, full-run ranking, explicit token spans, repeated nested windows, an independent pairwise C-value oracle, ranking workloads, out-of-order file loads, clearing a pack during delayed upload, dense repeated-surface dictionary results, evaluation span/input validation, and the integrated restore confirmation wait. No test assertion was weakened.

## Six-cycle execution notes

1. **Intent and requirements:** Confirmed the three pinned SHAs, exact app remote, no-WP03 boundary, synthetic-only/G4/G5/DOCX gates, and no dependency/schema changes.
2. **Architecture and contracts:** Kept corrections inside the browser-local app/application/domain boundaries; no remote service, worker architecture, dependency, or canonical schema change was added.
3. **Evidence and reuse:** Reproduced the package gate, existing WP01 tests, native build and Playwright suite; reused the existing DOCX dossier and did not restart component research.
4. **Integrity, security, correctness:** Fixed text-coordinate mismatch, strict decoding/pre-read size, shared occurrence caps, async stale results, and ranking container identity; preserved exact matching and session-only analysis.
5. **Efficiency and maintainability:** Replaced all-type nested comparisons with an exact token-sequence index and shared per-surface dictionary entries; measured repeated and diverse ranking workloads.
6. **Adversarial challenge and reconciliation:** Added malformed metadata, mixed line endings, repeated-window nesting, out-of-order file reads, and six-way factorial checks. Independent review findings were fixed. Remaining mandatory scope gaps keep the verdict NOT QUALIFIED.

### Independent code review

A read-only Luna/medium review of implementation checkpoint `04603e9` returned two Important findings and one Minor coverage gap. The repeated-container score defect was reproduced RED then fixed; revision invalidation now aborts and clears analyzing state; all rank-independent metric assertions were added. Focused tests and the final full suite passed after these changes. The reviewer did not perform a second pass after the fixes.

## Requirements traceability

| Requirement | Status | Evidence and limitation |
|---|---|---|
| D1 baseline & dependency reproduction | PASS for bounded reproduction | Exact ancestry/lock verified; commands above rerun. No exhaustive WP01-to-WP02 source-to-test line trace completed. |
| D2 document parsing & coordinates | PARTIAL | Unicode/UTF-16/parser suite passes; added malformed metadata and mixed-line-ending cases. Full adversarial malformed Markdown, escaped syntax, and fuzz boundary matrix remains incomplete. |
| D3 DOCX conditional G1 | BLOCKED | No DOCX code or dependency. Existing dossier reused. No exact candidate install, archive/XML hostile fixture run, license notice audit, bundle test, or isolated G1 artifact; no DOCX branch pushed. |
| D4 scientific grammar | PARTIAL | Existing S1 and S2 tests pass; broad independent challenge fixtures and every specified case/error path are not independently established. |
| D5 statistical ranking | PARTIAL; identified defects corrected | Explicit NLP token spans, full-run universe, deterministic grouping, subsequence index, hand-calculated cases and independent pairwise oracle. Fallback for forms with no NLP token is whitespace tokenization. |
| D6 dictionary packs | PARTIAL; identified defects corrected | Size-before-read, fatal decode, required URI, bounded shared span count, repeated-entry allocation reduction. App still accepts arbitrary schema-valid packs; qualification's synthetic-only policy is not technically enforced. License strings and URIs are self-declared, not rights clearance. |
| D7 browser performance & cancellation | PARTIAL | Real Chromium full UI runs at 5k/10k repeated synthetic occurrences and limit/cancel E2E pass. High distinct-type browser workload, pack stress, worker failure/cross-request cancellation matrix, all stage timing, and measured memory/main-thread responsiveness are incomplete. |
| D8 UI state & proposals | PARTIAL | Stale file, proposal, analysis error, and revision invalidation guards; out-of-order file E2E. Delayed proposal, pack-clear race, all approval/revision interleavings, keyboard accessibility and homonym navigation were not fully qualified. |
| D9 lookup & navigation | PASS within existing scope | `s2-lookup` browser test passes for literal versus case-insensitive view. |
| D10 evaluation harness | PASS for synthetic harness semantics | Fail-closed validation checks safe UTF-16 spans, duplicate/conflicting annotations and mappings, document correspondence, K values and elapsed times. Factorial tests assert TP/FP/FN, micro/macro P/R/F1 and unknown/nested recall invariance across ranking modes. This does not establish G5 or expert annotation validity. |
| D11 controlled comparison | PASS for synthetic factorial | Six configurations and same synthetic fixture/library/limits; results below. Not a gold or holdout evaluation. |
| D12 integrated verification/privacy/recovery | PARTIAL | Unit/build/gate/E2E pass. Full source-transmission audit across every worker and restored context, pack stress isolation, and every canonical snapshot/backup semantic invariant in one integrated workflow remain incomplete. |

## Final verification matrix

| Command | Result |
|---|---|
| `npm ci` | PASS; exit 0; 0 vulnerabilities reported |
| `npm run test:gate` | PASS; 4/4 |
| `npm run typecheck` | PASS; exit 0 |
| `npm run test` | PASS; 91/91 across 22 files |
| `NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production npm run build` | PASS; exit 0 |
| `npm run test:e2e` | PASS; 25/25 |
| `npm audit --audit-level=moderate` | PASS; 0 vulnerabilities |
| `git diff --check` | PASS; no whitespace errors |
| `trail check` | PASS; no conflicts (0 learnings indexed) |
| Lock SHA before/after | PASS; required SHA unchanged |

Final browser full-suite performance observations in this environment: repeated synthetic workload at 5,000 spans analyzed in 1,063 ms with rows visible 156 ms after count update; 10,000 analyzed in 1,849 ms with rows visible 310 ms after count update. These tests use repeated patterns, not high distinct-type diversity. Separate ranking-only Vitest measurements: repeated 5k 1.39 ms, diverse 5k 7.39 ms, repeated 10k 2.84 ms, diverse 10k 15.61 ms. These are single-run observations, not thresholds or capacity claims.

## Controlled synthetic comparison

The six configurations used the same three synthetic documents (26 annotated spans), synthetic library snapshot, parser configuration and limits. NLP was warmed once before the matrix. Ranking order affects at-k only; full-span metrics are shared within each grammar. Pipeline time excludes separate ranking and is not a threshold.

| Grammar | Ranking | TP / FP / FN | Micro P / R / F1 | P@5 / P@10 / P@15 | New spans |
|---|---|---:|---:|---:|---:|
| S1 | Source order | 22 / 84 / 4 | .2075 / .8462 / .3333 | .2667 / .3000 / .2444 | 100 |
| S1 | Frequency | 22 / 84 / 4 | .2075 / .8462 / .3333 | .4667 / .3667 / .2889 | 100 |
| S1 | C-value | 22 / 84 / 4 | .2075 / .8462 / .3333 | .6000 / .4667 / .3111 | 100 |
| S2 | Source order | 26 / 78 / 0 | .2500 / 1.0000 / .4000 | .2667 / .3000 / .2667 | 98 |
| S2 | Frequency | 26 / 78 / 0 | .2500 / 1.0000 / .4000 | .3333 / .4000 / .3556 | 98 |
| S2 | C-value | 26 / 78 / 0 | .2500 / 1.0000 / .4000 | .6000 / .5000 / .3778 | 98 |

Only bounded synthetic fixtures were used. This does not show scientific generalization, clinical accuracy, or human reviewer workload. G5 remains NOT ESTABLISHED.

## Privacy, persistence, and dependency boundaries

- No real manuscript, terminology list, external dictionary, or external benchmark corpus was used. No new dependency or canonical storage field was added.
- Existing browser E2E includes a zero-external-request assertion for the primary local extraction/review/export/restore journey. The new out-of-order test uses synthetic local files. A unified network audit covering all worker paths and the restored context was not run independently.
- Canonical schema and backup formats were not changed. Existing WP01 IndexedDB, retention, restore, and export E2E tests passed. Dictionary packs, ranking features, NLP tokens and parsed metadata remain session-only by code path; new tokens are part of the transient run and are not copied into retained run records.
- `G4 NOT READY`; `G5 NOT ESTABLISHED`; DOCX remains disabled and BLOCKED.

## Residual decisions and next action

The app accepts arbitrary schema-valid packs even though this qualification is synthetic-only. A self-declared source URI/license cannot establish synthetic provenance or legal rights. No safe technical discriminator was approved by the specification, so the pack feature remains a blocker for a qualification that claims enforceable synthetic-only operation. The owner must decide whether to disable arbitrary upload for the bounded qualification or define a verifiable synthetic fixture boundary.

Next engineering action: complete the remaining D2/D4/D6-D8/D10/Q5/Q9 matrices, resolve the synthetic-pack boundary, and produce an isolated DOCX G1 result or leave D3 explicitly blocked. Re-run the full matrix afterward. Do not merge or begin WP03.

## Git delivery

- Branch: `codex/wp02-independent-qualification`.
- Pinned source base: `2e4a5894e92f3439330aa019d337ac04a08b794f`.
- Implementation checkpoint: `6b8736b6186fc4f5d7e78197188f1139ad0d095e`; final branch tip is the documentation publication commit following it. The final documentation publication commit is identified in the delivery handoff because a report cannot contain its own commit SHA without changing that SHA.
- Integration: not merged. Main was not modified.
