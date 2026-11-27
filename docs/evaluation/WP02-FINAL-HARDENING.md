# TermForge — WP02 Final Hardening Report (`FH01–FH04`)

- **Final Hardening Verdict:** **`IMPLEMENTED — FINAL NATIVE VERIFICATION PENDING`**
- **Scope:** WP02 Final Hardening (`docs/handoffs/WP02-FINAL-HARDENING.md`), executing targeted tasks `FH01`–`FH04` on top of the existing AI Studio source baseline.
- **Pinned Starting Checkpoints:**
  - **Application Baseline:** `bb31ad240a8c442c8ec59366b478317944015b2b`
  - **Native Verification Checkpoint:** `2db2ec69f79dc82b177fa86b19fe9cf35ac699ab` (GitHub Actions run `46033315994`, job `140622337711`, artifact `15215576976` — historical evidence on prior source, not claimed for new edits)
  - **Pinned Transfer Policy:** The historical Codex transfer (`docs/handoffs/wp02-codex-transfer/`) was **not** reapplied and remains preserved intact as inert documentation.
- **Review Basis:** **AI Studio Self-Review & Self-Verification** (NOT final independent qualification).
- **Unchanged Gate Boundaries:**
  - **D3 Local DOCX Parser:** `BLOCKED—CONDITIONAL/EXCLUDED`
  - **G4 Real-Data Readiness:** `NOT READY`
  - **G5 Scientific Accuracy:** `NOT ESTABLISHED`
  - **Release Approval:** `NOT APPROVED`
  - **WP03 Boundary:** Strictly respected — zero WP03 features or speculative scope added.
  - **GitHub Sync:** Owner performs manual GitHub synchronization; no automatic push or merge performed.

---

## 1. Exact Changed & Created Files (`FH01–FH04`)

### Modified Source & Test Files
1. `src/features/extraction/concurrency-controller.ts` — Replaced `shouldHandleExternalRevision` blanket drop with `RevisionReconciliationController` (`idle` / `applying` / `reconciling` state machine, deferred notification queues, coalesced post-settlement snapshot refresh, paired `PendingProposalEntry` staleness check) and updated `evaluateCommitSettlement` so `conflict` / `stale` or concurrent external revisions always invalidate the matcher, abort active analysis, and reload the authoritative snapshot.
2. `src/features/extraction/ExtractionWorkspace.tsx` — Wired `RevisionReconciliationController` and atomic `PendingProposalEntry` (`{ proposal, retainMeta }`) into `subscribeRevision`, `loadSnapshot`, and `handleApproveAndSave`, plus added actionable fallback buttons (`Switch to source-order`, `Switch to frequency`) in the `rankingError` alert banner.
3. `src/application/ranking.ts` — Replaced per-probe `slice()` + `JSON.stringify()` subsequence hashing with an exact integer-keyed Token-ID Trie and overflow-safe length- and escape-weighted work budget (`MAX_CVALUE_WORK_UNITS = 10_000_000`, `MAX_CVALUE_CONTAINER_EDGES = 250_000`, `MAX_CVALUE_INDEX_PROBES = 1_000_000`, `CValueWorkMetrics`, `onWorkMetrics`).
4. `tests/unit/ui-concurrency.test.ts` — Replaced the old blanket-ignore `shouldHandleExternalRevision` test with deterministic deferred-promise tests (`FH01-1` through `FH01-4`) covering concurrent external revision during conflict/invalid/thrown-error commits, notifications arriving during post-commit `loadSnapshot()`, newer non-stale vs. stale pending proposals with `retainMeta`, and workspace unmount during commit (`7/7` tests PASS).
5. `tests/unit/ranking.test.ts` — Added `FH02` deterministic work-metric, long escape-sensitive oracle comparison, work-unit exhaustion, container-edge exhaustion, non-finite option rejection, and fallback-mode tests (`13/13` tests PASS).
6. `tests/unit/dictionary-pack.test.ts` — Added `FH03` canonical JSON semantic digest test verifying acceptance of equivalent key-order/whitespace formatting and rejection of array-order/semantic tampering (`9/9` tests PASS).
7. `tests/e2e/s2-async-races.spec.ts` — Added `FH01` real same-origin IndexedDB concurrent revision transaction test verifying fail-closed `STALE` settlement, authoritative `Rev 1` snapshot refresh, and stale-run warning banner (`5` tests in spec; `28` total E2E tests across `18` files).

### Modified & Created Documentation Files
8. `docs/evaluation/WP02-AI-STUDIO-CLOSURE.md` — Appended Section 12 (`Erratum & Final Hardening Addendum`) preserving Sections 1–11 intact.
9. `docs/evaluation/WP02-ACCEPTANCE.md` — Appended Section 5 (`Final Hardening Addendum FH01–FH04`) preserving Sections 1–4 intact.
10. `docs/handoffs/WP02-IMPLEMENTATION-LEDGER.md` — Appended `Final Hardening Addendum (FH01–FH04)` preserving all historical entries intact.
11. `docs/evaluation/WP02-FINAL-HARDENING.md` — Created this final hardening evaluation report.

*(All GitHub Actions workflow and production qualification files created by the owner — `.github/workflows/termforge-native-qualification.yml`, `playwright.qualification.config.ts`, `tests/qualification/production-performance.spec.ts`, and `docs/evaluation/WP02-NATIVE-CI.md` — remain completely untouched.)*

---

## 2. Finite Hardening Matrix (`FH01–FH04`)

| Item | Task Scope | Status | Basis |
| --- | --- | --- | --- |
| **FH01** | Revision notification reconciliation & stale snapshot handling | `CLOSED—VERIFIED` | Reproduced RED on conflict settlement (`shouldInvalidateMatcher` / `shouldReloadSnapshot` were `false` and `RevisionReconciliationController` was absent); implemented lossless deferral/coalescing across `applying` and `reconciling` phases; verified GREEN in `tests/unit/ui-concurrency.test.ts` (`7/7 PASS`) and live headless Chromium against real IndexedDB concurrent transactions. |
| **FH02** | Bound actual C-value workload rather than counting probes alone | `CLOSED—VERIFIED` | Reproduced RED on missing `onWorkMetrics` / `maxWorkUnits` / `maxContainerEdges`; replaced per-probe `slice` + `JSON.stringify` with exact integer Token-ID Trie and length-/escape-weighted preflight debits (`MAX_CVALUE_WORK_UNITS = 10_000_000`, `MAX_CVALUE_CONTAINER_EDGES = 250_000`); verified GREEN in `tests/unit/ranking.test.ts` (`13/13 PASS`). |
| **FH03** | Correct dictionary digest documentation | `CLOSED—VERIFIED` | Appended explicit Section 12.1 erratum to `docs/evaluation/WP02-AI-STUDIO-CLOSURE.md` distinguishing canonical JSON semantic content SHA-256 verification from raw file byte-for-byte identity; added `FH03` test in `tests/unit/dictionary-pack.test.ts` (`9/9 PASS`). |
| **FH04** | Verify and report | `IMPLEMENTED—VERIFICATION BLOCKED (environment)` | `npm run typecheck` PASS, full Vitest suite **24 files / 114 tests PASS**, production Next.js build PASS, 6-way factorial comparison unchanged (`s2-comparison.test.ts` 1/1 PASS), live headless Chromium FH01/FH02 check PASS (`0` console errors, `0` external requests). Native `npm run test:gate` and native `npm run test:e2e` / production Playwright runner remain blocked in AI Studio container and will execute on GitHub Actions upon owner push. |

---

## 3. Reproduction, Root-Cause Analysis, and RED → GREEN Evidence

### 3.1 FH01 — Revision Notification Reconciliation & Stale Snapshot Handling

- **Source Risk Confirmed:**
  1. At `bb31ad240a8c442c8ec59366b478317944015b2b`, `shouldHandleExternalRevision` returned `false` whenever `inFlightCommitBatchId !== null`, causing `ExtractionWorkspace`'s `subscribeRevision` callback to permanently drop any revision notification arriving during an in-flight `applyChange` OR during the subsequent `await loadSnapshot()`.
  2. Furthermore, `evaluateCommitSettlement` returned `shouldInvalidateMatcher: false` and `shouldReloadSnapshot: false` whenever `committed === false` (including `conflict` and `stale`). If an external commit advanced the library while a user's proposal modal was open or committing, a `conflict` / `stale` or thrown error left the workspace displaying the outdated snapshot revision and stale matcher cache.
  3. `pendingProposal` and `pendingRetainMeta` were stored in separate state hooks rather than an atomic entry, and newer proposals opened during an in-flight commit were not reconciled against the newly loaded revision.
- **RED Reproduction:**
  - Updated `tests/unit/ui-concurrency.test.ts` with deterministic deferred-promise tests (`FH01-1` through `FH01-4`) and updated `evaluateCommitSettlement` assertions for `conflict`. Running `npx vitest run tests/unit/ui-concurrency.test.ts` failed **5/7 tests RED** (`expect(conflict.shouldInvalidateMatcher).toBe(true)` failed with `false`, and `RevisionReconciliationController` was missing).
- **Remediation & Guarantees:**
  - Implemented `RevisionReconciliationController` (`src/features/extraction/concurrency-controller.ts`) and wired it into `ExtractionWorkspace.tsx`:
    - **During `applying`:** Notifications delivered to `observeRevisionNotification(rev)` are queued in `observedDuringApply`. Because `DexieLibraryRepository.apply` fires `notifyRevisionCommitted(rev)` synchronously only when `status === 'applied'`, the controller strips at most one matching own-revision notification upon `applied` settlement; any remaining notification is treated as an external revision.
    - **On `conflict` / `stale` / rejected / thrown error or external notification:** The controller invalidates `matcherRef`, aborts any active analysis, and awaits `loadSnapshot()` so the workspace always converges to the latest authoritative IndexedDB revision.
    - **During `reconciling` (`loadSnapshot`):** Notifications arriving while `loadSnapshot()` is reading IndexedDB are queued in `observedDuringReconcile` and drained in a bounded coalesced loop (`MAX_RECONCILE_DRAINS = 8`), preventing both lost revisions and infinite refresh loops.
    - **Newer pending proposal & `retainMeta` handling:** `pendingEntry` pairs `{ proposal, retainMeta }` atomically. If a newer proposal (`batchId !== commitBatchId`) is open when the authoritative snapshot loads, it is preserved intact (with its `retainMeta`) if `baseLibraryRevision === latestSnapshot.libraryRevision`, and explicitly invalidated with a user notice if `baseLibraryRevision !== latestSnapshot.libraryRevision`.
    - **Unmount & context drift:** Unmounting mid-commit never rolls back an already-committed IndexedDB transaction, and suppresses all post-unmount React state writes (`uiWritesAfterUnmount === 0`).
    - **Instance-Local vs. Cross-Tab Scope (Explicit):** `DexieLibraryRepository.subscribeRevision` is an instance-local listener set, **not** a cross-tab broadcast channel (`BroadcastChannel` / `storage` event). Cross-tab concurrent writes are detected deterministically when a commit settles as `STALE` / `CONFLICT` inside the Dexie read-write transaction, which now automatically triggers matcher invalidation and `loadSnapshot()` to reconcile the external tab's committed revision.
- **GREEN Verification:**
  - `npx vitest run tests/unit/ui-concurrency.test.ts`: **7/7 PASS**.
  - Live headless Chromium (`playwright-cli`) test on `http://127.0.0.1:3000/extraction`: opened a `Create concept` approval modal at `Rev 0`, executed a direct concurrent IndexedDB readwrite transaction advancing `termforge-library-v1` to `Rev 1` (`ext-c-1`), clicked `Approve and save` -> modal dismissed, gateway failed closed with `STALE: Stale baseLibraryRevision: expected 1, got 0.`, header immediately updated to `Rev 1`, and the stale-run warning banner (`This extraction run reflects Rev 0, while your library is now at Rev 1`) appeared cleanly.

### 3.2 FH02 — Bound Actual C-Value Workload Rather Than Counting Probes Alone

- **Source Risk Confirmed:**
  - At `bb31ad240a8c442c8ec59366b478317944015b2b`, `rankCandidates` counted `probes += 1` up to `MAX_CVALUE_INDEX_PROBES = 1,000,000`, but each probe executed `JSON.stringify(info.tokens.slice(start, start + len))` and allocated `{ surface, frequency }` edges without bounding token traversal length, escape-expansion cost, or total containment edges.
- **RED Reproduction:**
  - Added `FH02` test in `tests/unit/ranking.test.ts` constructing a short-token workload (`20` nested phrases with 2-char tokens) and a long escape-sensitive workload (`11` nested multiword terms up to `12` tokens each containing `\"` and `\\` sequences, well inside the `200,000` UTF-16 char and `10,000` span limits). Running `npx vitest run tests/unit/ranking.test.ts` failed **RED** (`shortMetrics` was `null`).
- **Algorithmic & Budget Remediation (`src/application/ranking.ts`):**
  1. **Exact Integer Token-ID Trie (Zero Per-Probe Slice/JSON Allocation):** During C-value indexing, unique token strings are interned once into sequential integer IDs (`0..V-1`), and all multiword candidate token sequences (`len >= 2`) are inserted into an integer-keyed Trie (`TrieNode.children: Map<number, TrieNode>`). Container scanning (`containerLen >= 3`) walks integer transitions in the Trie from each start index `start` up to `maxEnd`, eliminating per-probe `Array.prototype.slice` and `JSON.stringify` allocations while preserving 100% exact case-sensitive token-sequence matching for arbitrary token lengths.
  2. **Conservative Length- and Escape-Weighted Budget Units (`MAX_CVALUE_WORK_UNITS = 10_000_000`):**
     - Each token `t` is assigned a conservative serialized text weight `conservativeTokenTextUnits(t) = t.length + 2 + escapePenalty`, where `"` (`0x22`) and `\` (`0x5c`) add `+1` unit and control characters (`< 0x20`) add `+5` units (`\u00xx`).
     - Work is debited **before** allocation/traversal (`debitWork(stepCost, textCost)`) using overflow-safe integer subtraction (`delta > maxWorkUnits - metrics.workUnits`) across:
       - Phase A preprocessing: token interning (`1 + tokWeight` per candidate token) and Trie insertion (`1 + tokWeight` per multiword token edge);
       - Phase B Trie traversal: each candidate transition probe debits `1` step plus the traversed token text weights (`tokenWeightById[startTokenId] + tokenWeightById[tokenId]` on the 2-token prefix step and `tokenWeightById[tokenId]` on each extension step), alongside the `MAX_CVALUE_INDEX_PROBES = 1_000_000` probe counter;
       - Result-edge recording & sorting: each distinct `(nestedSeqId, containerSurface)` match increments `containerEdges` (checked against `MAX_CVALUE_CONTAINER_EDGES = 250_000` **before** `.push()`) and debits `2 + info.surfaceTextWeight` to account for edge storage and deterministic UTF-16 container surface sorting.
     - Non-finite or non-positive budget options (`NaN`, `Infinity`, `<= 0`) throw `RangeError` immediately in C-value mode.
  3. **Actionable Fail-Closed UI Recovery:** When `RankingWorkloadExceededError` is thrown, `ExtractionWorkspace.tsx` renders zero partial candidate rows and displays an alert banner with one-click recovery buttons (`Switch to source-order` and `Switch to frequency`), both of which skip C-value indexing entirely.
- **GREEN Verification:**
  - `npx vitest run tests/unit/ranking.test.ts`: **13/13 PASS**.
  - On the FH02 adversarial fixture, `longMetrics.workUnits` (`19,589` units across `55` probes) exceeded `shortMetrics.workUnits` (`1,100` units across `40` probes) by **`17.8x`** despite having only `1.375x` as many probes, proving length/escape sensitivity. All `11` nested chain terms matched the exact analytical C-value oracle (`12 - len` containers, `score = 0` for nested `f=1` terms and `log2(12)` for the top container).

### 3.3 FH03 — Dictionary Digest Documentation Erratum

- **Audit Finding Confirmed:** `readDictionaryPackFile` (`src/application/dictionary-pack-file.ts`) checks `file.size <= MAX_DICTIONARY_PACK_BYTES`, decodes fatal UTF-8, parses the strict v1 Zod schema (`parseDictionaryPackJson`), and calls `verifyApprovedSyntheticDictionaryPack(pack)` (`src/domain/synthetic-dictionary-manifest.ts`), which hashes `canonicalJson(pack)` (`src/domain/changes.ts`) with SHA-256.
- **Correction Applied:** Appended Section 12.1 to `docs/evaluation/WP02-AI-STUDIO-CLOSURE.md` explicitly correcting the earlier "raw UTF-8 bytes" phrasing and distinguishing **semantic canonical JSON content verification** from raw byte-for-byte file identity without altering the allowlist or digest implementation.
- **Test Verification (`tests/unit/dictionary-pack.test.ts` — `FH03`):** Confirmed that reordered object keys + 4-space indentation + CRLF line endings activate `pack-synth-bio-v1` cleanly (`loaded.entries.length === 4`), whereas swapping two elements in the `entries` array alters the canonical JSON digest and throws `DictionaryPackPolicyError` (**9/9 PASS**).

---

## 4. Complete Verification Evidence (`FH04`)

| Verification Check | Command | Exit Code | Result / Count |
| --- | --- | ---: | --- |
| TypeScript check | `npm run typecheck` | `0` | **PASS** (0 errors) |
| Full Vitest unit suite | `npm run test` | `0` | **PASS** — **24 test files / 114 tests PASS** (`+5` new FH01–FH03 unit tests over the `109`-test closure baseline) |
| Controlled 6-way factorial comparison | `npx vitest run tests/unit/s2-comparison.test.ts` | `0` | **PASS (1/1)** — all TP/FP/FN, Micro/Macro P/R/F1, and P@5/10/15 values across `S1/S2 × source-order/frequency/C-value` are **100% unchanged** from Section 4 of `docs/evaluation/WP02-SYNTHETIC-COMPARISON.md` |
| Production Next.js build | `compile_applet` (`npm run build`) | `0` | **PASS** — all 4 routes (`/`, `/library`, `/extraction`, `/exchange`) compiled cleanly |
| Live Headless Chromium (`playwright-cli`) | Concurrent IndexedDB `STALE` conflict reconciliation + C-value ranking check on `http://127.0.0.1:3000/extraction` | `0` | **PASS** — `FH_CHROMIUM_ALL_ASSERTIONS_VERIFIED=true`, `0` console errors, `0` page errors, `0` external requests |
| Playwright E2E spec discovery | `npx playwright test --list` | `0` | **28 tests in 18 files** (`+1` new FH01 concurrent IndexedDB E2E test) |
| Production Playwright spec discovery | `npx playwright test --config playwright.qualification.config.ts --list` | `0` | **2 tests in 1 file** (`production-performance.spec.ts`) |
| Native dependency gate | `npm run test:gate` | `1` | **BLOCKED (AI Studio container)** — `1/4 PASS` (exact 15 direct packages in `package.json`), `3/4 FAIL` (`authoritative package-lock.json is missing` in Bun container; lockfile NOT fabricated) |
| Native Playwright runner | `npm run test:e2e` | `1` | **BLOCKED (AI Studio container)** — Next.js `.next/dev/lock` collision with running port 3000 preview server |

---

## 5. Residual Limitations, Architectural Decisions & Required Native Verification

1. **Cross-Tab Notification Boundary:** `DexieLibraryRepository.subscribeRevision` remains an in-memory instance listener. Same-origin concurrent transactions from other tabs or instances are caught fail-closed by Dexie transaction CAS checks (`STALE` / `CONFLICT`) and reconciled into UI state at commit settlement via `RevisionReconciliationController`.
2. **Synchronous UI Rendering Cost Preserved as Future Scope:** Unvirtualized DOM commits at `5,000`–`10,000` rows remain unchanged per `docs/handoffs/WP02-FINAL-HARDENING.md` (*"do not implement virtualization/pagination in this task"*), preserving WP01 `toHaveCount(5_000)` / `10_000` E2E compatibility.
3. **Unchanged Gate Boundaries:** D3 DOCX remains `BLOCKED—CONDITIONAL/EXCLUDED`; G4 Real-Data Readiness is `NOT READY`; G5 Scientific Accuracy is `NOT ESTABLISHED`; release is `NOT APPROVED`; WP03 has not been started.
4. **Required Final Native Verification (Next Action):**
   - Owner manually syncs these changes to GitHub `main` while preserving the authoritative `package-lock.json` (SHA-256 `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`).
   - GitHub Actions workflow `.github/workflows/termforge-native-qualification.yml` will automatically run on `main` (or via manual `workflow_dispatch`) to execute:
     - Canonical `package-lock.json` SHA-256 check before and after;
     - `npm ci` and `npm run test:gate` (`4/4`);
     - `npm run typecheck` and `npm run test` (`24` files / `114` unit tests);
     - `NODE_ENV=production npm run build`;
     - Production Playwright performance suite (`2/2` tests via `playwright.qualification.config.ts`);
     - Native Playwright regression suite (`28/28` tests across `18` files via `npm run test:e2e`);
     - `npm audit --audit-level=moderate` and tracked-source `git diff --exit-code` integrity check (`148` total automated checks).
