# TermForge — WP02 AI Studio Qualification Closure Report (QC01–QC09)

- **Closure Verdict:** **`IMPLEMENTED — INDEPENDENT QUALIFICATION PENDING`**
- **Scope:** WP02 Qualification Closure (`docs/handoffs/WP02-AI-STUDIO-CLOSURE.md`), executed continuously from pinned Codex transfer `a935c186f27e829d42f5370b3840391e8fe64ed4` across checkpoints `QC01`–`QC09`.
- **Review Basis:** **AI Studio Self-Review & Self-Verification** (NOT independent qualification; historical `docs/evaluation/WP02-INDEPENDENT-QUALIFICATION.md` remains intact and unedited).
- **Material Gate Status:**
  - **D3 Local DOCX Parser:** `BLOCKED—CONDITIONAL/EXCLUDED`
  - **Native npm Lock Gate (`npm run test:gate`):** `BLOCKED` in AI Studio Bun container (`package-lock.json` absent; NOT fabricated)
  - **Native Playwright Runner (`npm run test:e2e`):** `BLOCKED` in AI Studio container (Next.js `.next/dev/lock` collision with port 3000 preview server)
  - **G4 Real-Data Readiness:** `NOT READY`
  - **G5 Scientific Accuracy:** `NOT ESTABLISHED`
  - **Release Approval:** `NOT APPROVED`
  - **WP03 Boundary:** Strictly respected — zero WP03 code added.
  - **Repository Sync:** Owner performs GitHub synchronization manually; no automatic push or merge performed.

---

## 1. Environment & Dependency Integrity

| Property | Observed Value |
| --- | --- |
| Runtime OS / Arch | `Linux localhost 4.19.0-gvisor x86_64 GNU/Linux` (4 vCPUs) |
| Node.js / npm | `v22.23.5` / `10.9.9` |
| Headless Chromium (`playwright-cli`) | `HeadlessChrome/155.0.8059.12` |
| Direct `package.json` Packages | **15** unchanged (`5` runtime + `10` devDependencies); `0` added, `0` upgraded, `0` removed |
| Canonical `package-lock.json` | Absent in AI Studio Bun container; **NOT** fabricated, regenerated, or altered (expected authoritative GitHub SHA-256: `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`) |
| `scripts/dev.mjs` & `allowedDevOrigins` | Preserved unchanged |
| `package.json` Scripts | Exact 7 scripts (`dev`, `build`, `start`, `typecheck`, `test:gate`, `test`, `test:e2e`); no `lint` script invented |
| Pinned Transfer Archive | `docs/handoffs/wp02-codex-transfer/` (manifest + 22 `.txt` copies) preserved intact as inert documentation |

---

## 2. Pinned Codex Transfer Result

Executed the exact Node SHA-1 Git-blob verification and transfer script from Section 1 of `docs/handoffs/WP02-AI-STUDIO-CLOSURE.md` against `docs/handoffs/wp02-codex-transfer/manifest.json` (`format: termforge-pinned-source-transfer-v1`, `sourceCommit: a935c186f27e829d42f5370b3840391e8fe64ed4`, `22` entries):

- **Result:** `{"transfer": "verified", "applied": [21 files], "generatedFileSkipped": []}`
- **Details:** All 22 source blobs passed byte-length and Git SHA-1 verification before any write. 21 files matched `baseBlob` and were written + re-hashed to match `targetBlob`. `next-env.d.ts` already matched `targetBlob` (`a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`) and required no overwrite. Zero conflicts.

---

## 3. Finite Closure Matrix (`D1–D12` and `QC01–QC09`)

Status vocabulary strictly constrained to: `CLOSED—VERIFIED`, `BLOCKED—CONDITIONAL/EXCLUDED`, `OPEN—MANDATORY BLOCKER`, `IMPLEMENTED—VERIFICATION BLOCKED (environment)`.

### 3.1 WP02 Deliverables (`D1–D12`)

| Item | Deliverable | Status | Basis / Remaining Verification |
| --- | --- | --- | --- |
| **D1** | Baseline freeze & reproducible reference | `CLOSED—VERIFIED` | Pinned ancestry & transfer verified; `tests/unit/s2-baseline.test.ts` (1/1 PASS); S1 baseline `s1-grammar-1+s1-boundary-v1` untouched. |
| **D2** | Structured Markdown & `ParsedDocument` | `CLOSED—VERIFIED` | Transfer fixes + QC04 CommonMark §4.5 backtick info-string guard, `<=3`-space closing fence rule, unclosed `](` link warning, and 60-document deterministic fuzz matrix (`document-input.test.ts` 6/6, `s2-challenge.test.ts` 6/6 PASS). |
| **D3** | Local DOCX parser | `BLOCKED—CONDITIONAL/EXCLUDED` | Conditional G1 dependency gate unresolved; zero DOCX runtime packages, code, or UI selectors added. Dossier updated in `docs/qualification/WP02-DOCX-CANDIDATE.md`. |
| **D4** | Scientific grammar v2 & explainable evidence | `CLOSED—VERIFIED` | Fixed acronym pairing false positives (`matchesAcronymInitials` intra-word cursor + final-word anchor) and verified adversarial scientific grammar challenge (`scientific-candidates.test.ts` 5/5, `s2-challenge.test.ts` 6/6, WP01 `extraction.test.ts` 11/11 PASS). |
| **D5** | Session corpus stats & canonical C-value ranking | `CLOSED—VERIFIED` | Fixed arbitrary-length container indexing (`>8` tokens), exact NLP token coverage fallback, `group.tokenCount` parity, `MAX_CVALUE_INDEX_PROBES = 1_000_000` explicit workload guard, and C-value index skip in `source-order`/`frequency` (`ranking.test.ts` 12/12 PASS). |
| **D6** | Local dictionary pack staging & read-only lookup | `CLOSED—VERIFIED` | Enforced trusted synthetic manifest + exact SHA-256 content digest allowlist (`wp02-synthetic-allowlist-v1`) on activation with zero UI bypass; verified arbitrary/tampered rejection & allowlisted activation in Vitest (`8/8 PASS`) and live Chromium (QC07). |
| **D7** | Performance & cancellation hardening | `CLOSED—VERIFIED` | Fixed shared worker multi-request settlement, abort re-dispatch, synchronous `postMessage` failure cleanup, stale message rejection, `AbortSignal` propagation to NLP/oracle matcher (`s2-cancellation.test.ts` 8/8 PASS), fixed `SourceContext` `O(N^2)` loop, and captured full Chromium QC06 timings. |
| **D8** | Scientific review & ranking UI | `CLOSED—VERIFIED` | Added `concurrency-controller.ts` guarding async approval/load/revision interleavings without hiding committed transactions (`ui-concurrency.test.ts` 4/4 PASS), replaced per-row `<select>` with shared link target selector (`O(C+N)` DOM), added tablist roving keyboard nav & modal focus trap/restore, and verified live in Chromium. |
| **D9** | Improved terminology lookup & review navigation | `CLOSED—VERIFIED` | Preserved WP01 literal default + case-insensitive view + `?concept=<id>` homonym navigation (`s2-lookup.test.ts` 3/3 PASS). |
| **D10** | Independent evaluation harness & benchmark protocol | `CLOSED—VERIFIED` | Fail-closed span/annotation/document/K/elapsed validation from transfer preserved and passing (`evaluation.test.ts` 4/4 PASS). G5 remains `NOT ESTABLISHED`. |
| **D11** | Integrated synthetic comparison & boundary | `CLOSED—VERIFIED` | Controlled 6-way factorial (`S1/S2 × source-order/frequency/C-value`) re-run post-remediation (`s2-comparison.test.ts` 1/1 PASS); metrics match Section 4 of `WP02-SYNTHETIC-COMPARISON.md` identically. No scientific generalization claimed. |
| **D12** | Integrated verification & qualification closure | `IMPLEMENTED—VERIFICATION BLOCKED (environment)` | Typecheck, full Vitest suite (`24` files / `109` tests), Next.js production build, HTTP 200 route checks, and live headless Chromium QC06/QC07 audits PASS in AI Studio; native `npm run test:gate` (missing lockfile) and native `npm run test:e2e` (port 3000 lock collision) plus independent non-self qualification remain blocked by environment and require external native run. |

### 3.2 Closure Work Packages (`QC01–QC09`)

| Package | Scope | Status | Basis |
| --- | --- | --- | --- |
| **QC01** | Synthetic dictionary boundary | `CLOSED—VERIFIED` | Immutable SHA-256 content allowlist (`src/domain/synthetic-dictionary-manifest.ts`) enforced in `readAndValidateDictionaryPackFile`; unit (`8/8`) + Chromium UI rejection/activation verified. |
| **QC02** | Ranking semantics, bounds & render amplification | `CLOSED—VERIFIED` | Arbitrary-length indexing, exact NLP token coverage verification, `RankingWorkloadExceededError` (`MAX_CVALUE_INDEX_PROBES`), `CandidateTable` shared `<select>` + memoized concept map, `SourceContext` `O(N)` sweep (`ranking.test.ts` 12/12). |
| **QC03** | Worker lifecycle & cancellation | `CLOSED—VERIFIED` | Deterministic worker pending-map lifecycle, listener cleanup, abort re-dispatch, `terminate()` settlement, sync `postMessage` fail-closed, `AbortSignal` to NLP & matcher (`s2-cancellation.test.ts` 8/8). |
| **QC04** | Parser & scientific grammar challenge closure | `CLOSED—VERIFIED` | 3 real bugs caught RED and fixed GREEN (CommonMark §4.5 backtick info-string, unclosed link warning, acronym false pairings) + 60-doc deterministic fuzz suite (`s2-challenge.test.ts` 6/6). |
| **QC05** | UI concurrency & accessibility | `CLOSED—VERIFIED` | Extracted pure `concurrency-controller.ts` (`ui-concurrency.test.ts` 4/4), wired commit vs stale view-effect separation, abort-on-empty file read, modal focus trap/restore, roving-tabIndex filter keyboard nav; verified in Chromium. |
| **QC06** | Actual browser performance & stage breakdown | `CLOSED—VERIFIED` | Full real headless Chromium measurements across cold/warm, 5k/10k repeated (2 trials), 5001/10001 reject, 4k diverse high-type, dense pack hints + long forms, 115.2k cancel/restart RAF metrics, plus Node stage breakdown (`50` & `250` concepts). |
| **QC07** | Privacy, persistence & recovery sentinel audit | `CLOSED—VERIFIED` | End-to-end Chromium audit with 4 unique synthetic sentinels across ingestion → S2 → pack → approval → reload → CSV/backup → independent empty-context restore → opt-in retention → deletion → session clear; zero sentinel leaks, exact canonical backup equivalence. |
| **QC08** | Conditional DOCX boundary | `BLOCKED—CONDITIONAL/EXCLUDED` | Confirmed zero DOCX packages, zero parser code, zero UI selector; appended Section 5 QC08 closure confirmation to `docs/qualification/WP02-DOCX-CANDIDATE.md` with complete G1 checklist. |
| **QC09** | Reconcile, final verification & closure reporting | `IMPLEMENTED—VERIFICATION BLOCKED (environment)` | All closure docs, ledger, acceptance addenda, typecheck, 24-file/109-test Vitest suite, and Next.js build verified GREEN; native `npm run test:gate` and native `npm run test:e2e` blocked by AI Studio container and handed off for independent native verification. |

---

## 4. Changed & Created Paths

### 4.1 Applied from Pinned Codex Transfer (`a935c186f27e829d42f5370b3840391e8fe64ed4`, 21 files written)
- `docs/evaluation/WP02-ACCEPTANCE.md`
- `docs/evaluation/WP02-INDEPENDENT-QUALIFICATION.md` (new)
- `docs/evaluation/WP02-SYNTHETIC-COMPARISON.md`
- `docs/handoffs/WP02-IMPLEMENTATION-LEDGER.md`
- `src/adapters/documents/markdown.ts`
- `src/application/dictionary-lookup.ts`
- `src/application/dictionary-pack-file.ts` (new)
- `src/application/evaluation.ts`
- `src/application/extraction.ts`
- `src/application/ranking.ts`
- `src/domain/dictionary-pack.ts`
- `src/domain/document-input.ts`
- `src/domain/extraction.ts`
- `src/features/extraction/ExtractionWorkspace.tsx`
- `tests/e2e/s2-async-races.spec.ts` (new)
- `tests/e2e/s2-integrated.spec.ts`
- `tests/unit/dictionary-pack.test.ts`
- `tests/unit/document-input.test.ts`
- `tests/unit/evaluation.test.ts`
- `tests/unit/ranking.test.ts`
- `tests/unit/s2-comparison.test.ts`
- *(Verified already matching `targetBlob`: `next-env.d.ts`)*

### 4.2 Created in QC01–QC09 Closure
- `src/domain/synthetic-dictionary-manifest.ts`
- `src/features/extraction/concurrency-controller.ts`
- `tests/unit/s2-challenge.test.ts`
- `tests/unit/ui-concurrency.test.ts`
- `docs/evaluation/WP02-AI-STUDIO-CLOSURE.md`

### 4.3 Modified in QC01–QC09 Closure
- `src/application/dictionary-pack-file.ts`
- `src/application/ranking.ts`
- `src/application/extraction.ts`
- `src/application/scientific-candidates.ts`
- `src/domain/extraction.ts`
- `src/adapters/nlp/wink-core.ts`
- `src/adapters/nlp/wink-engine.ts`
- `src/adapters/nlp/extraction.worker.ts`
- `src/adapters/matching/registered-matcher.ts`
- `src/adapters/documents/markdown.ts`
- `src/components/ChangeApprovalDialog.tsx`
- `src/features/extraction/RankingControls.tsx`
- `src/features/extraction/CandidateTable.tsx`
- `src/features/extraction/SourceContext.tsx`
- `src/features/extraction/ExtractionWorkspace.tsx`
- `tests/unit/dictionary-pack.test.ts`
- `tests/unit/ranking.test.ts`
- `tests/unit/s2-cancellation.test.ts`
- `tests/e2e/s2-async-races.spec.ts`
- `docs/qualification/WP02-DOCX-CANDIDATE.md`
- `docs/evaluation/WP02-ACCEPTANCE.md`
- `docs/handoffs/WP02-IMPLEMENTATION-LEDGER.md`

---

## 5. Confirmed Fixes & TDD Evidence (`QC01–QC08`)

### QC01 — Synthetic Dictionary Boundary
- **Policy Decision:** Because general-purpose external dictionary rights verification cannot be enforced client-side by self-declared JSON fields (`packId`, `license`, `authority`, `sourceUri`), WP02 UI pack activation is restricted to an immutable project-owned synthetic fixture allowlist (`SYNTHETIC_DICTIONARY_POLICY_VERSION = 'wp02-synthetic-allowlist-v1'`) verified by exact SHA-256 content digest over raw UTF-8 bytes before activation.
- **Allowlisted Fixture Digests:**
  - `pack-synth-bio-v1`: `b94a37e434dff8894a90d138d5bd3a32ac6541e525989d1b359e24fbc07bdb48`
  - `synthetic-pack-one`: `6d0e2b12b05372c265d1a1e700e6cc297678b951840eef0ba45025251cc3433c`
  - `synthetic-pack-two`: `e94410eca04ba73d64208837980f394578a9b0a7c4891150ec4cb9eb46bb9e0f`
  - `pack-synth-sentinel-v1`: `a3d3aeb6954ef96ff28304d8157b4778fae0146deb08cd577162f9ff0e5aa59f`
- **RED → GREEN:** Added failing unit tests in `tests/unit/dictionary-pack.test.ts` for arbitrary schema-valid pack rejection, 1-entry tampered allowlisted pack rejection, and allowlisted pack activation (`DictionaryPackPolicyError`); enforced in `readAndValidateDictionaryPackFile` with explicit UI copy in `RankingControls.tsx` and browser tests in `tests/e2e/s2-async-races.spec.ts`. Result: `dictionary-pack.test.ts` **8/8 PASS** + live Chromium rejection/activation confirmed in QC07.

### QC02 — Ranking Semantics, Bounds & Render Amplification
- **Defects Resolved:**
  1. Subsequence index previously capped at 8 tokens (`MAX_SUBSEQ_LEN = 8`), silently mis-scoring registered/pack containers longer than 8 tokens. Replaced with exact first-token + target-length targeted matching for arbitrary-length registered/pack expressions.
  2. Partial NLP token overlap on an occurrence previously yielded truncated token sequences; added `extractExactNlpTokensForOccurrence` verifying full non-whitespace span coverage before trusting NLP tokens, falling back cleanly to deterministic tokenization and keeping `group.tokenCount === features.tokenCount`.
  3. C-value nesting index was previously built unnecessarily in `source-order` and `frequency` modes; now skipped outside `c-value`.
  4. Added explicit work bound `MAX_CVALUE_INDEX_PROBES = 1_000_000` throwing `RankingWorkloadExceededError` (fail-closed, zero partial actionable rows in `ExtractionWorkspace.tsx`).
  5. Reduced DOM amplification in `CandidateTable.tsx`: memoized `conceptLabelById` (`O(C+E)`), replaced per-row `<select>` with one shared accessible `#candidate-link-target-select` + lightweight per-row `Link form` button (`O(C+N)` DOM nodes while preserving exact `candidate-row` count for WP01 5k/10k E2E specs), and capped inline pack IDs (5) / nested containers (6).
  6. Discovered during QC06 Chromium profiling and fixed an `O(N^2)` `chosen.some()` overlap filter inside `SourceContext.tsx` (up to `50,000,000` iterations per render at `10,000` spans) -> replaced with an `O(N)` single linear sweep + `useMemo` + `React.memo`.
- **RED → GREEN:** Extended `tests/unit/ranking.test.ts` to **12/12 PASS** (including 10-token registered container oracle match, partial NLP coverage fallback, workload bound rejection, and 5k/10k Node benchmarks).

### QC03 — Worker Lifecycle & Cancellation
- **Defects Resolved:**
  1. Shared worker previously terminated on one request's abort without settling other pending promises, leaked listeners on sync `postMessage` failure, and lacked `AbortSignal` propagation into `nlp.analyze`.
  2. Refactored `src/adapters/nlp/wink-engine.ts` with a tracked `pending` map, centralized `message`/`error`/`messageerror` listeners cleaned up on detach, injectable `workerFactory?: () => Worker` for deterministic unit testing, single-request abort re-dispatching remaining active concurrent requests onto a fresh worker, `terminate()` settling all pending promises with `AbortError`, synchronous `postMessage` throw failing closed on large inputs (`>20,000` chars) with zero leaked listeners, and stale message ID rejection.
  3. Propagated `AbortSignal` through `NlpEngine.analyze(text, signal?)`, `analyzeWithWinkCore`, `runExtraction`, and `SimpleOracleRegisteredMatcher`.
- **RED → GREEN:** Reproduced 2/7 RED failures in `tests/unit/s2-cancellation.test.ts`, implemented fixes, verified **8/8 PASS** plus `nlp.test.ts` (3/3), `matcher.test.ts` (8/8), and `extraction.test.ts` (11/11).

### QC04 — Parser & Scientific Grammar Adversarial Challenge Closure
- **Defects Caught RED by `tests/unit/s2-challenge.test.ts` (6 tests incl. 60 deterministic fuzz documents) & Fixed GREEN:**
  1. `src/adapters/documents/markdown.ts`: single-line inline triple-backtick code (`` ```inline``` ``) was mistakenly opened as an unclosed code fence, swallowing the rest of the document. Added `matchOpeningFence` enforcing CommonMark §4.5 (backtick info strings cannot contain `` ` ``) and `FENCE_CLOSE_RE` (`<=3` leading spaces).
  2. `src/adapters/documents/markdown.ts`: unclosed inline link destination `](` did not emit an explicit unsupported-syntax warning. Added explicit warning emission.
  3. `src/application/scientific-candidates.ts`: `matchesAcronymInitials` allowed repeated matching of the same character index and ignored trailing unconsumed words, causing false pairings (`AAB => active beta`, `AAA => active assay`, `TNF => Tumor necrosis factor assay`). Fixed with intra-word character cursor (`lastMatchedCharIdx`) + `lastMatchedWordIdx === wordsLower.length - 1` anchor while preserving valid scientific pairs (`TNF-α`, `PCR`, `PDLSC`, `LOH`).
- **Verification:** `s2-challenge.test.ts` (6/6), `document-input.test.ts` (6/6), `scientific-candidates.test.ts` (5/5), `s2-baseline.test.ts` (1/1), `s2-comparison.test.ts` (1/1) all **PASS**.

### QC05 — UI Concurrency & Accessibility
- **Changes Implemented:**
  1. Extracted pure state guard module `src/features/extraction/concurrency-controller.ts` (`tests/unit/ui-concurrency.test.ts` **4/4 PASS**) separating already-committed canonical transactions (never hidden or reverted when source/policy/revision changes mid-flight) from stale view-local side effects (`retainedRunLink`, outdated pending proposals, overlapping `loadSnapshot`, own in-flight commit vs external revision).
  2. Wired into `ExtractionWorkspace.tsx` (`mountedRef`, `snapshotLoadSeqRef`, `inFlightCommitBatchIdRef`, aborting active analysis on empty file load, incrementing `proposalSeqRef` on modal dismissal).
  3. Added keyboard roving-`tabIndex` (`ArrowLeft`/`ArrowRight`/`Home`/`End`) on candidate filter tablist in `ExtractionWorkspace.tsx` and modal `Tab`/`Shift+Tab` focus trap + trigger focus restoration in `src/components/ChangeApprovalDialog.tsx`.
  4. Updated `tests/e2e/s2-async-races.spec.ts` (`#grouped-view-toggle` + QC01 rejection tests) and verified keyboard tablist + modal Escape focus restoration live in headless Chromium (QC07: `newCandSelected: "true"`, `allSelectedAgain: "true"`, `focusRestored: true`).

---

## 6. Actual Verification Commands & Results (QC09 Final Pass)

| Check | Command | Exit Code | Actual Result |
| --- | --- | ---: | --- |
| TypeScript check | `npm run typecheck` | `0` | **PASS** (0 errors) |
| Full Vitest unit suite | `npm run test` | `0` | **PASS** — **24 test files / 109 tests PASS** (`13` WP01 files + `11` WP02 files) |
| Production Next.js build | `compile_applet` (`npm run build`) | `0` | **PASS** — all 4 static routes (`/`, `/library`, `/extraction`, `/exchange`) compiled cleanly |
| Dependency & lock gate | `npm run test:gate` | `1` | **BLOCKED (environment)** — `1/4 PASS` (`package.json` exact 15 packages verified), `3/4 FAIL` (`authoritative package-lock.json is missing` in AI Studio Bun container; lockfile NOT fabricated) |
| Native Playwright discovery | `npx playwright test --list` | `0` | **27 tests across 18 spec files** enumerated cleanly |
| Native Playwright execution | `npm run test:e2e` | `1` | **BLOCKED (environment)** — Next.js 16 `.next/dev/lock` collides with already-running port 3000 AI Studio preview server (`playwright.config.ts` untouched) |
| Live Headless Chromium (`playwright-cli`) | QC06 perf suite + QC07 sentinel audit on `http://127.0.0.1:3000` | `0` | **PASS** — full measurements and sentinel audit recorded in Sections 7 & 8; `0` console errors, `0` page errors, `0` external requests |
| Route HTTP 200 smoke check | `curl` on `/`, `/library`, `/extraction`, `/exchange` | `0` | **PASS** — HTTP `200` on all 4 routes |

---

## 7. QC06 — Actual Headless Chromium Performance & Stage Breakdown

### 7.1 Methodology
- **Browser Environment:** Headless Chromium `155.0.8059.12` on `Linux x86_64` (4 vCPUs, `performance.memory` enabled), running against the Next.js dev server at `http://127.0.0.1:3000` with actual Web Worker NLP (`wink-nlp` + `wink-eng-lite-web-model`), actual `AhoCorasick`, actual `rankCandidates`, and real React DOM rendering.
- **Responsiveness Sampling:** Continuous `requestAnimationFrame` delta monitor measuring max single-frame gap (`rafMaxMs`) and mean frame gap (`rafAvgMs`) across each operation.
- **Distinct-Type Workload Construction Note:** Because `DEFAULT_PROCESSING_LIMITS` caps source length at `200,000` UTF-16 chars and `S2` noun-phrase extraction also emits sub-phrases for multi-word sequences, the closest valid high-distinct-type workload inside the `5,000`-span default cap uses `4,000` distinct alphanumeric scientific symbols (`SYM0001`–`SYM4000`, `54,892` UTF-16 chars), yielding exactly `4,000` distinct occurrences and `4,000` distinct surface types.
- **Note:** These are measured AI Studio container dev-mode observations, **not** production capacity claims or release thresholds.

### 7.2 Full Headless Chromium Measurements

| Scenario | Input Size | Occurrences / Rows | Wall Time (ms) | RAF Max / Avg (ms) | JS Heap Used (MiB) | Notes |
| --- | --- | --- | ---: | ---: | ---: | --- |
| **Cold vs Warm (S2 + C-value)** — Cold | 5,320 chars | 640 occ / 640 rows | `1,621` | `783.3` / `35.14` | `35.57` | Includes first Web Worker wink-nlp init |
| **Cold vs Warm (S2 + C-value)** — Warm | 5,320 chars | 640 occ / 640 rows | `962` | `799.9` / `135.70` | `35.57` | `outputParityExact: true` (exact cold/warm parity) |
| **Repeated 5,000 (Trial 1)** — Analyze (source-order) | 34,999 chars | 5,000 occ / 5,000 rows | `5,124` | `4,133.1` / `146.40` | `66.10` | C-value flat switch: `2,915 ms`; grouped: `4,159 ms` |
| **Repeated 5,000 (Trial 2)** — Analyze (source-order) | 34,999 chars | 5,000 occ / 5,000 rows | `4,381` | `3,149.9` / `132.76` | `71.09` | C-value flat switch: `2,861 ms`; grouped: `4,229 ms` |
| **Limit+1 Reject (`5,001 > 5,000`)** | 35,006 chars | `0` partial rows | `239` | `50.0` / `22.22` | `44.91` | Explicit fail-closed limit alert |
| **Repeated 10,000 (Trial 1)** — Analyze (source-order) | 69,999 chars | 10,000 occ / 10,000 rows | `9,343` | `6,583.1` / `198.79` | `102.31` | C-value flat switch: `8,005 ms`; grouped: `10,017 ms` |
| **Repeated 10,000 (Trial 2)** — Analyze (source-order) | 69,999 chars | 10,000 occ / 10,000 rows | `9,129` | `7,266.5` / `228.23` | `116.58` | C-value flat switch: `8,702 ms`; grouped: `9,605 ms` |
| **Limit+1 Reject (`10,001 > 10,000`)** | 70,006 chars | `0` partial rows | `303` | `66.7` / `21.43` | `48.14` | Explicit fail-closed limit alert |
| **Diverse High-Distinct-Type (4,000 distinct symbols)** | 54,892 chars | 4,000 occ / 4,000 types | `3,772` | `2,833.3` / `101.95` | `84.89` | Switches: freq `2,788 ms`, C-value flat `2,286 ms`, grouped `4,908 ms` |
| **Dense Pack Hints (`pack-synth-bio-v1`) + Long Forms + S2** | 8,520 chars | 1,200 occ / C-value grouped | `1,213` | `966.7` / `139.58` | `53.15` | Real allowlisted pack suggestions + hints |
| **Cancel Mid-Flight (Web Worker)** | 115,200 chars | `0` partial rows | `360` | **`50.0`** / **`19.44`** | `51.72` | Main thread stayed smooth (`<=50 ms`) during worker cancel |
| **Immediate Restart After Cancel** | 1,280 chars | 160 occ / 160 rows | `432` | `250.0` / `28.80` | `51.80` | Clean post-cancel worker recovery |

### 7.3 Stage Breakdown (`tests/unit/s2-cancellation.test.ts` — `QC06_STAGE_BREAKDOWN`, Node Vitest, warmed NLP)

Includes homonym `PD`, 9-word registered expression, `pack-synth-bio-v1` hints, `4,200` chars, `600` occurrences, `23` distinct candidate groups:

| Library Size | `matchMs` | `nlpMs` | `candidateGenMs` | `packLookupMs` | `rankMs` | `totalMs` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 concepts / 103 expressions | `2.11` | `8.64` | `7.18` | `4.12` | `4.36` | `26.82` |
| 250 concepts / 503 expressions | `4.47` | `3.84` | `3.46` | `4.16` | `2.36` | `18.73` |

### 7.4 Residual Browser Performance Finding (Honest Engineering Note)
- Off-thread Web Worker extraction and limit rejection keep the main thread highly responsive (`50.0 ms` max RAF gap on `115,200`-char cancel; `239–303 ms` limit+1 rejection).
- The `3.1 s–7.2 s` single-frame pause at `5,000`–`10,000` rendered occurrences occurs strictly during **unvirtualized React dev-mode DOM commit/layout** of `5,000`–`10,000` `CandidateTable` rows + `5,000`–`10,000` `SourceContext` highlight buttons. Virtualizing the table was intentionally **not** introduced because WP01 `tests/e2e/processing-limits-ui.spec.ts` asserts `toHaveCount(5_000)` and `toHaveCount(10_000)` on `[data-testid="candidate-row"]`. Future WP03+ UI pagination/virtualization would require an approved WP01 E2E contract update.

---

## 8. QC07 — Privacy, Persistence & Recovery Sentinel Audit

Executed end-to-end in live headless Chromium (`playwright-cli`) using 4 unique synthetic sentinels:
- Source text sentinel: `SYNTH_SRC_SENTINEL_9C2E`
- Allowlisted dictionary pack sentinel (`pack-synth-sentinel-v1`): `SYNTH_PACK_SENTINEL_7F3A`
- Markdown fenced-code exclusion sentinel: `SYNTH_CODE_EXCLUDED_4B1D`
- Explicit opt-in retention sentinel: `SYNTH_RETAIN_SENTINEL_3D8B`

### Verified Assertions
1. **QC01 UI Pack Policy:** Arbitrary schema-valid pack rejected (`arbitraryPackRejected: true`); 1-entry tampered allowlisted pack rejected (`tamperedPackRejected: true`); exact allowlisted `pack-synth-sentinel-v1` activated (`allowlistedSentinelPackLoaded: true`).
2. **Markdown Exclusion & Zero Unauthorized Persistence on Analysis:** `SYNTH_CODE_EXCLUDED_4B1D` excluded from candidates (`codeSentinelExcludedFromCandidates: true`); after S2 extraction + C-value ranking + pack hints, IndexedDB remained completely empty (`concepts: 0, expressions: 0, documents: 0, runs: 0, metaRevision: null`) with zero sentinel occurrences in `localStorage`, `sessionStorage`, `URL`, or `IndexedDB`.
3. **Explicit Approval & Reload Volatility:** Approved 1 concept via ChangeSet modal (`Rev 1`, `concepts: 1, expressions: 1, documents: 0`). Reload cleared session source, pack, and extraction run (`sourceCleared: true, packCleared: true, runCleared: true`) while preserving the canonical concept.
4. **CSV Export & Canonical Backup v1 Integrity:** Exported CSV and downloaded `termforge-backup` v1 (`digest: f67ec596e45940e8f9a5e6070fd31c5ce56e23be459f77e2cdd72a8807b4d442`, `backupSentinelLeaks: []`, `backupHasEphemeralKeys: []`).
5. **Independent Empty-Context Restore Equivalence:** Restored the downloaded backup in a fresh browser context -> exact semantic equivalence verified (`conceptsEquivalent: true, expressionsEquivalent: true, provenanceEquivalent: true, auditCount: 1 -> 1, restoredRevision: 1, restoredBackupSentinelLeaks: []`, zero sentinel hits in storage).
6. **Opt-In Source Retention, Deletion & Session Clear:** Retained `SYNTH_RETAIN_SENTINEL_3D8B` only after explicit consent + approval (`documents: 1`, sentinel present in IndexedDB `documents` store); deleted retained source -> `documents: 0`, `concepts: 1` preserved, zero sentinel hits remaining in IndexedDB; clicked `Clear session` -> `sourceAfterClearEmpty: true`.
7. **Network & Console Audit (Main + Restore Contexts):** `totalRequests: 128` (strictly same-origin `127.0.0.1:3000` app assets/routes), `externalRequests: []`, `sentinelLeakedRequests: []`, `consoleErrors: []`, `pageErrors: []`, `consoleSentinelLeaks: []`.
8. **Instrumentation Limitation (Explicit):** Playwright request interception covers browser-initiated HTTP/fetch/worker/beacon traffic within the inspected Chromium contexts; it does not substitute for OS-level packet capture, TLS inspection, or third-party security review. Zero external requests in this audit is necessary but not sufficient for a full privacy certification.

---

## 9. Controlled 6-Way Factorial Synthetic Comparison (D11 / QC09)

Re-executed `tests/unit/s2-comparison.test.ts` after all QC01–QC08 remediations (`1/1 PASS`). All span-level TP/FP/FN, Micro/Macro P/R/F1, and P@5/P@10/P@15 counts across all 6 combinations (`S1/S2 × source-order/frequency/C-value`) matched Section 4 of `docs/evaluation/WP02-SYNTHETIC-COMPARISON.md` **identically** (S1: `22/84/4`; S2: `26/78/0`; S1 C-value P@5/10/15 `.6000/.4667/.3111`; S2 C-value P@5/10/15 `.6000/.5000/.3778`). No table revision was required, and no general scientific accuracy claim is made (`G5 NOT ESTABLISHED`).

---

## 10. Conditional DOCX Exclusion (D3 / QC08)

- **Status:** `BLOCKED—CONDITIONAL/EXCLUDED`
- **Code & Dependency Audit:** Verified zero DOCX runtime packages in `package.json`, zero DOCX parser modules under `src/`, and zero `.docx` upload selector in the UI (`read-text.ts` explicitly rejects `.docx` files).
- **Remaining G1 Evidence:** Preserved and reaffirmed in Section 5 of `docs/qualification/WP02-DOCX-CANDIDATE.md` (exact candidate pins, SRI/integrity, transitive license/notice/vulnerability audit, browser bundle impact, hostile/encrypted/macro/zip-bomb decompression bounds, XXE/external relationship rejection, cooperative cancellation, coordinate/omission semantics, and explicit owner approval).

---

## 11. Self-Review Notes, Residual Limitations & Next Action

- **Self-Review Label:** All code reviews and verification checks in this closure pass were performed as **AI Studio self-review**; no independent reviewer or external agent participated.
- **Residual Limitations:**
  1. Native `npm ci`, `npm run test:gate` (canonical `package-lock.json` SHA-256 verification), and native `npm run test:e2e` (27 tests across 18 specs) cannot complete inside the AI Studio Bun/port-3000 container and remain required in an external native Node/npm environment.
  2. Unvirtualized `5,000`–`10,000` row DOM commits cause a `3.1 s–7.2 s` dev-mode main-thread paint pause (preserved deliberately for WP01 E2E row-count contract compatibility).
  3. UI dictionary pack loading is strictly restricted to the allowlisted synthetic fixture manifest (`wp02-synthetic-allowlist-v1`); real dictionary onboarding requires future rights clearance and owner policy approval.
  4. D3 DOCX remains `BLOCKED`, G4 remains `NOT READY`, G5 remains `NOT ESTABLISHED`.
- **Required Next Action:** Owner manually syncs these changes to GitHub while preserving the authoritative `package-lock.json` (`0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`), then runs independent native qualification (`npm ci`, `npm run test:gate`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:e2e`, `npm audit`). Stop cleanly before WP03.

---

## 12. Erratum & Final Hardening Addendum (`FH01–FH04`, 2026-11-27)

Historical Sections 1–11 above are preserved unchanged.

### 12.1 FH03 Erratum — Canonical JSON Semantic Content Digest vs. Raw File-Byte Digest
- **Correction:** Section 5 (`QC01 — Synthetic Dictionary Boundary`, line 141) above stated that allowlist verification checks the SHA-256 content digest *"over raw UTF-8 bytes before activation"*. That phrasing is inaccurate and is hereby corrected:
  1. `readDictionaryPackFile` (`src/application/dictionary-pack-file.ts`) first enforces the pre-read file byte ceiling (`MAX_DICTIONARY_PACK_BYTES = 2,097,152`), decodes strict UTF-8 (`TextDecoder('utf-8', { fatal: true })`), and validates the strict v1 `DictionaryPack` Zod schema (`parseDictionaryPackJson`).
  2. `verifyApprovedSyntheticDictionaryPack` (`src/domain/synthetic-dictionary-manifest.ts`) then computes `digest(pack)` (`src/domain/changes.ts`), which hashes the **UTF-8 bytes of `canonicalJson(pack)`** (sorted object keys, preserved array ordering, no insignificant whitespace) via Web Crypto `SHA-256` and compares it against the allowlisted `contentSha256` in `APPROVED_SYNTHETIC_DICTIONARY_PACKS`.
- **Semantic vs. Byte-Identity Distinction:** This verifies **semantic canonical JSON content equivalence** (after strict UTF-8 and schema validation), not raw file byte-for-byte identity. Equivalent JSON formatting (e.g., pretty-printed indentation, CRLF vs. LF line endings, or reordered object properties) produces the identical canonical JSON SHA-256 digest and is accepted, whereas any semantic content modification (e.g., 1-character entry change, metadata change, or reordered `entries` array) produces a different canonical JSON SHA-256 digest and fails closed with `DictionaryPackPolicyError`.
- **Unchanged Policy Boundary:** The allowlist (`wp02-synthetic-allowlist-v1`) and its four SHA-256 digests are unchanged. This bounded allowlist enforces synthetic-only qualification and does not provide legal rights or authenticity verification for third-party dictionaries; real packs remain blocked.

### 12.2 FH01–FH04 Final Hardening Summary
See [WP02 Final Hardening Report](WP02-FINAL-HARDENING.md) for the complete `FH01–FH04` remediation record, lossless revision reconciliation (`RevisionReconciliationController`), exact Token-ID Trie and length-/escape-weighted C-value work bounds (`MAX_CVALUE_WORK_UNITS`, `MAX_CVALUE_CONTAINER_EDGES`), and updated verification evidence.

