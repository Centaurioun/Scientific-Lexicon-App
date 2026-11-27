# WP02 — Scientific Intelligence Acceptance & Verification Record (D12)

## 1. Executive Gate Verdicts

| Gate / Scope | Verdict | Basis |
| --- | --- | --- |
| **WP01 Regression Preservation (Unit & Build)** | `PASS` (AI Studio) | All 13 WP01 unit test files (`51/51` tests) remain intact and passing alongside 9 new WP02 unit test files (`29/29` tests; `80/80` total). `npm run typecheck` and `npm run build` succeed cleanly. |
| **WP02 Synthetic Functional Implementation (D1–D2, D4–D12)** | `PASS` (AI Studio) | Verified via Vitest unit suites, `tsc --noEmit`, production Next.js build, and live headless Chromium verification (`playwright-cli` R1 & R2 with `0` console errors and `0` external requests). |
| **D3 Local DOCX Parser** | `BLOCKED` | Conditional dependency gate: requires separate G1 qualification (`docs/qualification/WP02-DOCX-CANDIDATE.md`). No DOCX adapter, no `.docx` UI selector, and no dependency changes were introduced. |
| **Native npm Lock & Dependency Gate (`npm run test:gate`)** | `BLOCKED` (AI Studio container) | AI Studio container omits canonical `package-lock.json` (uses Bun graph); `npm run test:gate` fails tests 1–3 on missing lockfile and passes test 4 (`package.json` exact 15 packages verified unchanged). Must be re-verified by Codex on native Linux/npm. |
| **Native Playwright Suite (`npm run test:e2e`, 13 WP01 + 4 WP02 specs)** | `NOT TESTED` (native runner blocked in container) | Next.js 16 `.next/dev/lock` collides with port 3000 preview server in AI Studio. Live Chromium flows were verified via `playwright-cli`; full native Playwright runner execution is required in Codex verification. |
| **G4 Real-Data Readiness** | `NOT READY` | Synthetic fixtures only; no real terminology, manuscripts, or real dictionary packs processed. |
| **G5 Scientific Accuracy** | `NOT ESTABLISHED` | Evaluation harness and synthetic comparison prove deterministic mechanics only; held-out real-corpus evaluation, rights clearance (ACTER / ACL RD-TEC / MedMentions / BELB), and owner-approved thresholds remain pending. |
| **G6 Release Readiness** | `CONDITIONAL / NOT APPROVED` | Contingent on independent Codex verification (native `npm ci`, `npm run test:gate`, `npm run test`, `npm run build`, `npm run test:e2e`), plus separate future G4/G5 gates. |

---

## 2. Invariant & Boundary Compliance Checklist

- **WP01 Baseline Preserved:** `s1-grammar-1+s1-boundary-v1` remains the default extraction mode; `S1CandidateGenerator`, `findExpressions`, `readTxt`, `scripts/dev.mjs`, `allowedDevOrigins`, and processing limits (`2,097,152` TXT/MD bytes, `200,000` UTF-16 chars, `100`–`10,000` distinct spans default `5,000`, `16,777,216` backup bytes) remain untouched.
- **Canonical Storage & Backup Parity:** Zero IndexedDB schema changes, zero new persisted fields, `termforge-backup` v1 format unchanged. `ParsedDocument`, `CandidateEvidence`, `AcronymExpansionHypothesis`, `RankedCandidate`, and `DictionaryPack` / `DictionaryPackSuggestion` are strictly session-only in RAM.
- **Dependency & Lock Discipline:** Exact 15 dependencies in `package.json` unchanged; `package-lock.json` was NOT fabricated or modified.
- **Local-Only Privacy:** Zero external API calls, zero server document processing, zero analytics/telemetry, zero authentication; verified `0` external network requests in live headless Chromium.
- **Scope Boundary:** Stopped cleanly before WP03 (no S3 bulk import, S4 AI enrichment, Phrasebank, Turkish NLP, accounts, or cloud storage).

## 3. Independent Native Qualification Addendum (2026-11-27)

The Gemini figures above are preserved as historical implementation evidence. Independent native reproduction on Node `v26.12.1` / npm `11.20.0` found 80/80 unit tests passing initially, but the native Playwright suite exposed a timing defect in the new integrated restore test (it navigated away before waiting for the restore success state). The test was corrected to await the UI confirmation. Independent remediation and final commands are recorded in [WP02 Independent Qualification](WP02-INDEPENDENT-QUALIFICATION.md).

Final independent verification on the remediation tree: dependency gate 4/4; unit tests 91/91; typecheck pass; production build pass; Playwright 25/25. These results qualify only the tested local synthetic scope. They do not clear DOCX G1, synthetic-only pack enforcement, full pipeline browser performance coverage, G4, G5, or release readiness. Final verdict: **NOT QUALIFIED — REMEDIATION REQUIRED** because mandatory tasks remain unresolved. The evaluation harness now fails closed on invalid spans and inconsistent annotation inputs; details and evidence are in the independent report.

---

## 4. AI Studio Qualification Closure Addendum (`QC01–QC09`, 2026-11-27)

Historical Sections 1–3 above are preserved unchanged. Following verified application of the pinned Codex transfer (`a935c186f27e829d42f5370b3840391e8fe64ed4`, 21 files applied + `next-env.d.ts` verified matching), all mandatory closure packages (`QC01`–`QC07`, plus `QC08` DOCX exclusion confirmation and `QC09` reconciliation) were implemented and self-verified in Google AI Studio.

- **AI Studio Verification Summary:** `npm run typecheck` PASS; `npm run test` **24 files / 109 tests PASS**; production Next.js build PASS; HTTP `200` on all 4 routes; live headless Chromium (`playwright-cli`) QC06 performance matrix & QC07 privacy/backup-restore sentinel audit PASS (`0` console errors, `0` external requests, exact canonical backup equivalence).
- **Environment-Blocked Native Checks:** `npm run test:gate` (`1/4 PASS`, `3/4 FAIL` on absent `package-lock.json` in Bun container — NOT fabricated; `package.json` exact 15 packages confirmed unchanged) and native `npm run test:e2e` (`27` tests in `18` specs listed; blocked by `.next/dev/lock` collision on port 3000).
- **Unchanged Gate Boundaries:** D3 DOCX `BLOCKED—CONDITIONAL/EXCLUDED`; G4 `NOT READY`; G5 `NOT ESTABLISHED`; release `NOT APPROVED`; WP03 untouched.
- **Closure Verdict:** **`IMPLEMENTED — INDEPENDENT QUALIFICATION PENDING`** — full matrix and raw evidence recorded in [WP02 AI Studio Closure Report](WP02-AI-STUDIO-CLOSURE.md).

---

## 5. Final Hardening Addendum (`FH01–FH04`, 2026-11-27)

Historical Sections 1–4 above are preserved unchanged. Following native GitHub Actions execution on checkpoint `2db2ec69f79dc82b177fa86b19fe9cf35ac699ab` (recorded in [WP02 Native CI](WP02-NATIVE-CI.md)), targeted final hardening tasks `FH01`–`FH04` (`docs/handoffs/WP02-FINAL-HARDENING.md`) were executed in AI Studio on application baseline `bb31ad240a8c442c8ec59366b478317944015b2b` without reapplying the historical Codex transfer:

- **FH01 (Revision Notification Reconciliation):** Implemented `RevisionReconciliationController` in `src/features/extraction/concurrency-controller.ts` and wired it into `ExtractionWorkspace.tsx` so revision notifications arriving during in-flight commits or post-commit snapshot loads are deferred and coalesced losslessly, `conflict`/`stale`/error outcomes reload the authoritative snapshot and invalidate the matcher, and newer open proposals (with paired `retainMeta`) are preserved if current or explicitly invalidated if stale (`tests/unit/ui-concurrency.test.ts` **7/7 PASS** + live Chromium IndexedDB `STALE` conflict reconciliation verified).
- **FH02 (Bounded C-Value Workload):** Replaced per-probe `slice` + `JSON.stringify` hashing in `src/application/ranking.ts` with an exact integer Token-ID Trie and overflow-safe length- and escape-weighted work budgets (`MAX_CVALUE_WORK_UNITS = 10_000_000`, `MAX_CVALUE_CONTAINER_EDGES = 250_000`, `MAX_CVALUE_INDEX_PROBES = 1_000_000`) plus one-click fallback buttons in `ExtractionWorkspace.tsx` (`tests/unit/ranking.test.ts` **13/13 PASS**).
- **FH03 (Dictionary Digest Erratum):** Recorded explicit erratum in Section 12.1 of `docs/evaluation/WP02-AI-STUDIO-CLOSURE.md` clarifying that `verifyApprovedSyntheticDictionaryPack` verifies the SHA-256 digest of `canonicalJson(pack)` after strict byte-ceiling, fatal UTF-8, and v1 schema validation (`tests/unit/dictionary-pack.test.ts` **9/9 PASS**).
- **FH04 (Verification & Verdict):** `npm run typecheck` PASS; `npm run test` **24 files / 114 tests PASS**; 6-way factorial synthetic comparison unchanged (`s2-comparison.test.ts` 1/1 PASS); Next.js production build PASS; live headless Chromium check PASS (`0` console errors, `0` external requests). Native `npm run test:gate` and native Playwright suites (`28` E2E + `2` production tests) will re-execute on GitHub Actions after manual owner sync.
- **Current Verdict:** **`IMPLEMENTED — FINAL NATIVE VERIFICATION PENDING`** — full details in [WP02 Final Hardening Report](WP02-FINAL-HARDENING.md).



## Final independent native acceptance — 2026-11-27
See [WP02 final qualification](WP02-FINAL-QUALIFICATION.md): exact commit `f7857d8d9e11fbcd5e40b1731f8ad52217ea54fd`, Actions run 46042674468, 148/148 tests. QUALIFIED WITHIN BOUNDED SYNTHETIC SCOPE — DOCX EXCLUDED. Historical pending/blocked environment entries remain evidence for earlier runs; latest native execution passed. Residual revision drain boundary carried to WP03 E1; G4/G5/release not lifted.
