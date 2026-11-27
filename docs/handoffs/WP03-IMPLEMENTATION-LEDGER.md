# TermForge — WP03 Implementation Ledger (`E1–E11`)

- **Work Package:** `docs/WP03_DATA_OPERATIONS.md` (Data Operations / S3)
- **Design Specification:** `docs/superpowers/specs/2026-11-27-wp03-data-operations-design.md`
- **Combined Handoff:** `docs/handoffs/WP02-CLOSE-WP03-START.md`
- **Starting Application Baseline:** `f7857d8d9e11fbcd5e40b1731f8ad52217ea54fd` (WP02 bounded synthetic qualification — `148/148` historical native tests in GitHub Actions run `46042674468`, job `140654082609`, artifact `15220682504`)
- **Pinned Lockfile Authority:** Canonical npm `package-lock.json` SHA-256 `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033` (15 direct dependencies unchanged; lockfile omitted in AI Studio Bun container and never fabricated locally)
- **Gate Boundaries:**
  - **WP01 G3 Synthetic Core Acceptance:** Preserved
  - **WP02 Bounded Synthetic Qualification:** Preserved (`DOCX` excluded)
  - **D3 Local DOCX Parser:** `BLOCKED—CONDITIONAL/EXCLUDED`
  - **G4 Real-Data Readiness:** `NOT READY`
  - **G5 Scientific Accuracy:** `NOT ESTABLISHED`
  - **G6 Release Approval:** `NOT APPROVED`
  - **WP04 Boundary:** Strictly stopped before WP04

---

## Checkpoint E1 — Baseline, Closure Continuity, and Focused Residual

- **Status:** `CLOSED—VERIFIED`
- **Step A Continuity Recorded:**
  - Verified WP02 closure documentation (`docs/evaluation/WP02-FINAL-QUALIFICATION.md`, `docs/evaluation/WP02-FINAL-HARDENING.md`, `docs/evaluation/G4-REAL-DATA-READINESS.md`, `AGENTS.md`, `docs/architecture/MASTER-DESIGN-BASELINE-v1.0.md`, `docs/specifications/S1-IMPLEMENTATION-CONTRACTS-v0.1.md`).
  - Baseline typecheck (`npm run typecheck`) and 24-file / 114-test unit suite (`npm run test`) passed prior to WP03 edits; 6-way synthetic factorial comparison (`tests/unit/s2-comparison.test.ts`) unchanged.
  - Historical Codex transfer (`docs/handoffs/wp02-codex-transfer/`) was not reapplied.
- **TDD RED → GREEN Evidence:**
  - **RED:** Added `E1-1` (controlled >8 notifications arriving during the 8th reconcile drain reload) and `E1-2` (continuous notification storm exceeding bounded continuation budget) to `tests/unit/ui-concurrency.test.ts`. Ran `npx vitest run tests/unit/ui-concurrency.test.ts` -> **2 failed RED** (`expected 9 to be 10` because notification 10 was dropped in `finally`, and `isFreshnessConfirmed` was missing).
  - **GREEN:** Updated `RevisionReconciliationController` in `src/features/extraction/concurrency-controller.ts` to coalesce pending notifications into `pendingHighWaterRevision`, execute up to `MAX_CONTINUATION_TURNS = 2` scheduled continuation refresh turns after the 8-drain primary loop, and fail closed (`freshnessConfirmed = false`) with explicit `confirmFreshnessWithSnapshot` recovery if freshness still cannot be confirmed. Wired freshness gating into `ExtractionWorkspace.tsx`.
  - **Verification:** `npx vitest run tests/unit/ui-concurrency.test.ts` -> **9/9 PASS** (`0` lost revisions, `0` post-unmount writes, stale proposals invalidated, committed transactions preserved).
- **Changed Files:**
  - `src/features/extraction/concurrency-controller.ts`
  - `src/features/extraction/ExtractionWorkspace.tsx`
  - `tests/unit/ui-concurrency.test.ts`
  - `docs/handoffs/WP03-IMPLEMENTATION-LEDGER.md`
- **Next Exact Task:** `E2` — Strict delimited file adapter and raw staging.

---

## Checkpoint E2 — Strict Delimited File Adapter and Raw Staging

- **Status:** `CLOSED—VERIFIED`
- **TDD RED → GREEN Evidence:**
  - **RED:** Created `tests/unit/delimited-intake.test.ts` testing RFC-4180 CSV/TSV parsing with explicit delimiter, BOM handling, CRLF/LF/CR, quoted fields, escaped quotes, embedded newlines, empty/trailing fields, blank-line policies (`skip` / `error-row`), positional headers, duplicate/adversarial prototype headers (`__proto__`, `constructor`, `toString`), unclosed quotes, NUL byte rejection, exact boundary and boundary+1 limits (`2 MiB`, `200,000` UTF-16 chars, `1,000` data rows, `32` columns, `8,192` cell UTF-16 chars), and raw-byte SHA-256 fixture allowlist verification vs. WP02 canonical JSON semantic digest. Verified RED (`Cannot find package '@/domain/delimited-intake'`).
  - **GREEN:** Implemented `src/domain/delimited-intake.ts` and `src/application/delimited-file.ts` with 3 built-in project-owned synthetic fixtures (`synth-bilingual-dirty-csv-v1`, `synth-bilingual-symbols-tsv-v1`, `synth-privacy-recovery-drill-csv-v1`) pinned by exact raw UTF-8 byte SHA-256.
  - **Verification:** `npx vitest run tests/unit/delimited-intake.test.ts` -> **6/6 PASS**.
- **Changed Files:**
  - `src/domain/delimited-intake.ts`
  - `src/application/delimited-file.ts`
  - `tests/unit/delimited-intake.test.ts`
  - `docs/handoffs/WP03-IMPLEMENTATION-LEDGER.md`
- **Next Exact Task:** `E3` — Explicit mapping, transformation and validation.

---

## Checkpoint E3 — Explicit Mapping, Transformation and Validation

- **Status:** `CLOSED—VERIFIED`
- **TDD RED → GREEN Evidence:**
  - **RED:** Created `tests/unit/staging-mapping.test.ts` testing positional column mapping, explicit language/role rules (`column` with `error`/`undetermined`/`unspecified` policies or `fixed`), optional explicit group key, raw/staged before/after transformation (`none`, `trim-exterior`, `trim-collapse-spaces`), blank term / unknown language / unknown role rejection, formula-leading string warning (`FORMULA_LIKE_TEXT`), duplicate and adversarial headers (`__proto__`, `constructor`), unmapped column loss reporting, and deterministic session fingerprint invalidation. Verified RED (`Cannot find package '@/domain/staging-mapping'`).
  - **GREEN:** Implemented `src/domain/staging-mapping.ts` (`StagingMappingSpecSchema`, `applyStagingMapping`, `validateStagingMappingSpec`, `computeStagingSessionFingerprint`).
  - **Verification:** `npx vitest run tests/unit/staging-mapping.test.ts` -> **3/3 PASS**.
- **Changed Files:**
  - `src/domain/staging-mapping.ts`
  - `tests/unit/staging-mapping.test.ts`
  - `docs/handoffs/WP03-IMPLEMENTATION-LEDGER.md`
- **Next Exact Task:** `E4` — Duplicate/conflict and grouping review.

---

## Checkpoint E4 — Duplicate/Conflict and Grouping Review

- **Status:** `CLOSED—VERIFIED`
- **TDD RED → GREEN Evidence:**
  - **RED:** Created `tests/unit/staging-review.test.ts` testing exact single-concept duplicate vs. multi-concept homonym (`PD` across `c-pd-perio` and `c-pd-neuro`), protected user-confirmed assertion match (`PROTECTED_EXISTING_MATCH`), advisory case/whitespace similarity (`P53` vs `p53`) without auto-merge, intra-stage duplicates, intra-stage cross-group homonyms, group target conflicts (`GROUP_TARGET_CONFLICT`), and explicit user decisions (`skip`, `create-new-concept`, `link-existing-concept`, `link-staged-group`, `unresolved`). Verified RED (`Cannot find package '@/domain/staging-review'`).
  - **GREEN:** Implemented `src/domain/staging-review.ts` (`evaluateStagingReview`, `buildSuggestedInitialDecisions`) using $O(N + M)$ hash indexing and deterministic `CONFLICT_FLAG_ORDER`.
  - **Verification:** `npx vitest run tests/unit/staging-review.test.ts` -> **2/2 PASS**.
- **Changed Files:**
  - `src/domain/staging-review.ts`
  - `tests/unit/staging-review.test.ts`
  - `docs/handoffs/WP03-IMPLEMENTATION-LEDGER.md`
- **Next Exact Task:** `E5` — Additive import plan and immutable preview.

---

## Checkpoint E5 — Additive Import Plan and Immutable Preview

- **Status:** `CLOSED—VERIFIED`
- **TDD RED → GREEN Evidence:**
  - **RED:** Created `tests/unit/import-planner.test.ts` testing atomic `ChangePayload` generation (`createConcept` and `addExpression` only), exact `expectedConceptRevision` progression across newly created staged concepts (`0, 1, ...`) and existing library concepts (`rev, rev + 1, ...`), `kind: "manual", source: null` provenance with explicit source-row loss disclosure, zero verification assertions, idempotent replay of the same `ProposedChange`, fail-closed rejection of unresolved rows, stale snapshot revisions, ID collisions, and batches exceeding `250` operations (`251` rejected, `250` accepted). Verified RED (`Cannot find package '@/application/import-planner'`).
  - **GREEN:** Implemented `src/application/import-planner.ts` (`buildAdditiveImportPlan`, `ImportPlanningError`, `PROVENANCE_LIMITATION_DISCLOSURE`) building proposals strictly via `proposeChange` with zero direct writes.
  - **Verification:** `npx vitest run tests/unit/import-planner.test.ts` -> **2/2 PASS**.
- **Changed Files:**
  - `src/application/import-planner.ts`
  - `tests/unit/import-planner.test.ts`
  - `docs/handoffs/WP03-IMPLEMENTATION-LEDGER.md`
- **Next Exact Task:** `E6` (Data Operations workspace and reviewed apply) + `E7` (Read-only quality and maintenance inspector).

---

## Checkpoint E6 — Data Operations Workspace and Reviewed Apply UI

- **Status:** `CLOSED—VERIFIED`
- **Implementation & Verification Evidence:**
  - Implemented `src/features/exchange/DataOperationsPanel.tsx` and integrated it into `src/features/exchange/ExportWorkspace.tsx` (preserving all existing C1/C2/C3 export/backup/restore panels, headings, and E2E selectors as well as top-level nav links `/`, `/library`, `/extraction`, `/exchange`).
  - Features prominent G4 synthetic-only gate warning, built-in synthetic fixture selector (`synth-bilingual-dirty-csv-v1`, `synth-bilingual-symbols-tsv-v1`, `synth-privacy-recovery-drill-csv-v1`), fixture download button, file upload with `<= 2 MiB` pre-read guard + fatal UTF-8 + raw-byte SHA-256 allowlist, explicit delimiter (`,` / `\t`), blank-line policy (`skip` / `error-row`), positional column mapping (`0..totalColumns-1`), text transform selector (`none`, `trim-exterior`, `trim-collapse-spaces`), unmapped column loss summary, provenance limitation disclosure, 50-row paginated staging review table, immutable proposal preview, pre-commit backup download offer + explicit acknowledgment checkbox, and atomic commit via `approveChange` / `applyChange` + `RevisionReconciliationController`.
  - Verified via `tests/unit/wp03-recovery-privacy.test.ts`, `tests/e2e/s3-data-operations.spec.ts`, and live headless Chromium (`playwright-cli`) on `http://localhost:3000/exchange`.
- **Changed Files:**
  - `src/features/exchange/DataOperationsPanel.tsx`
  - `src/features/exchange/ExportWorkspace.tsx`
  - `tests/e2e/s3-data-operations.spec.ts`
- **Next Exact Task:** `E7` — Read-only quality and maintenance inspector.

---

## Checkpoint E7 — Read-Only Quality and Maintenance Inspector

- **Status:** `CLOSED—VERIFIED`
- **TDD RED → GREEN Evidence:**
  - **RED:** Created `tests/unit/quality-inspector.test.ts` testing empty snapshot handling, exact same-concept duplicate tuples (`(conceptId, text, language, role)`), non-error scientific homonym groups across distinct concepts (`isError: false`), EN/TR/preferred concept coverage flags, expression advisory flags (`UNDETERMINED_LANGUAGE`, `UNSPECIFIED_ROLE`, `FORMULA_LEADING_TEXT`, `EXTERIOR_OR_REPEATED_WHITESPACE`, `REPEATED_PUNCTUATION`), protected `user-confirmed` expression inventory, fail-closed referential integrity failure surfacing without auto-repair, and 50-item pagination at 2,500-concept / 5,000-expression scale. Verified RED (`Cannot find package '@/application/quality-inspector'`).
  - **GREEN:** Implemented `src/application/quality-inspector.ts` (`inspectLibraryQuality`, `paginateQualityItems`, `QUALITY_INSPECTOR_PAGE_SIZE = 50`) and `src/features/exchange/QualityInspectorPanel.tsx` with `/library?concept=<conceptId>` read-only focus deep links.
  - **Verification:** `npx vitest run tests/unit/quality-inspector.test.ts` -> **3/3 PASS** + live headless Chromium verification on `/exchange`.
- **Changed Files:**
  - `src/application/quality-inspector.ts`
  - `src/features/exchange/QualityInspectorPanel.tsx`
  - `tests/unit/quality-inspector.test.ts`
- **Next Exact Task:** `E8` — Recovery, privacy and atomic failure drill.

---

## Checkpoint E8 — Recovery, Privacy and Atomic Failure Drill

- **Status:** `CLOSED—VERIFIED`
- **TDD Verification Evidence:**
  - Created `tests/unit/wp03-recovery-privacy.test.ts` (`2/2` PASS) and `tests/e2e/s3-data-operations.spec.ts` exercising:
    1. Full synthetic workflow: stage `synth-privacy-recovery-drill-csv-v1` -> positional mapping -> skip row 3 (`SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST`) and leave column 4 (`raw_only_unmapped_secret` containing `SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST`) unmapped -> create pre-commit portable backup -> build immutable additive proposal -> commit atomically -> verify idempotent replay -> reload snapshot -> generate CSV/JSON presentation exports -> generate post-commit portable backup -> restore into independent empty repository -> verify identical canonical JSON and SHA-256 digest.
    2. Strict privacy & retention check: verified that neither `SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST` nor `SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST` appears in IndexedDB stores, `localStorage`, `sessionStorage`, console logs, URLs, network requests, presentation exports, or portable backups, while `SYNTH_APPROVED_IMPORT_TERM_E8` and `sentetik onaylı terim E8` persist.
    3. Atomic failure drills: mid-transaction `AbortError` rollback across all tables, stale competing write rejection (`status: 'stale'`), non-empty restore target refusal (`status: 'conflict'`), and tampered backup digest refusal.
- **Changed Files:**
  - `tests/unit/wp03-recovery-privacy.test.ts`
  - `tests/e2e/s3-data-operations.spec.ts`
- **Next Exact Task:** `E9` — G4 operational evidence (synthetic).

---

## Checkpoint E9 — G4 Operational Evidence (Synthetic)

- **Status:** `CLOSED—VERIFIED`
- **TDD & Measurement Evidence:**
  - Created `tests/unit/g4-operational-probes.test.ts` (`4/4` PASS) measuring:
    1. Simultaneous two-instance CAS contention against shared state (`winner` commits `applied` at Rev 1, `loser` receives `stale` without silent overwrite).
    2. Isolated representative `v1 -> v2` additive schema upgrade and `blocked-by-open-connection` awareness probe without touching production `termforge-library-v1` (schema v1).
    3. Simulated `QuotaExceededError` and `SecurityError` fail-closed handling (explicitly distinguished from physical OS disk pressure).
    4. Realistic `10,000` and `50,000` expression scale probes:
       - `10,000` expressions (`5,000` concepts): matcher rebuild + search `88–102 ms`, 250-op staged review + additive import plan `279–351 ms`, quality inspection `133–169 ms`, CSV export projection `29–35 ms`, portable backup `473–621 ms` (`6,398,153 bytes` / `~6.10 MiB`, within `16 MiB` limit).
       - `50,000` expressions (`25,000` concepts): matcher rebuild + search `1,378–1,744 ms`, 250-op staged review + additive import plan `931–1,165 ms`, quality inspection `658–727 ms`, CSV export projection `115–139 ms`, portable backup (`2,133–2,587 ms`) exceeds `16 MiB` (`16,777,216 bytes`) and fails closed (`exceeded16MiBFailClosed: true`) without truncation.
  - Non-destructively updated `docs/evaluation/G4-REAL-DATA-READINESS.md` with the WP03 E9 & E10 synthetic operational evidence table while keeping `G4 NOT READY`.
- **Changed Files:**
  - `tests/unit/g4-operational-probes.test.ts`
  - `docs/evaluation/G4-REAL-DATA-READINESS.md`
- **Next Exact Task:** `E10` — Format and maintenance roadmap closure.

---

## Checkpoint E10 — Format and Maintenance Roadmap Closure

- **Status:** `CLOSED—VERIFIED`
- **Documentation Evidence:**
  - Recorded the complete Format and Maintenance Roadmap Closure in `docs/evaluation/WP03-ACCEPTANCE.md` (Section 5) and `docs/evaluation/G4-REAL-DATA-READINESS.md`:
    - Explicit distinction between CSV/TSV Synthetic Delimited Intake, Presentation Exports (`termforge-export` v1), and Canonical Portable Backups (`termforge-backup` v1).
    - Standalone external OpenRefine preparation guidance (never embedded at runtime).
    - Deferred/blocked formats (`DOCX` D3, `XLSX`, `TBX`, `TMX`, arbitrary JSON ingest).
    - Blocked destructive maintenance (`mergeConcept`, `deleteConcept`, `deleteExpression`, compensation) pending future schema v2 revision/reference/protected-assertion rules.
    - Schema v1 provenance policy (`kind: "manual", source: null` with explicit pre-commit loss disclosure).
- **Changed Files:**
  - `docs/evaluation/WP03-ACCEPTANCE.md`
  - `docs/evaluation/G4-REAL-DATA-READINESS.md`
- **Next Exact Task:** `E11` — Integrated verification and delivery.

---

## Checkpoint E11 — Integrated Verification and Delivery

- **Status:** `IMPLEMENTED—VERIFICATION BLOCKED` (AI Studio verification `PASS`; native Linux `npm ci` + `test:gate` + `test:e2e` pending owner manual sync to GitHub Actions)
- **Verification Evidence:**
  - `npm run typecheck` (`tsc --noEmit`) -> `0` errors (`PASS`)
  - `npm run test` (`vitest run`) -> **31 test files / 138 tests PASS** (`0` failures)
  - `compile_applet` (`npm run build`) -> `PASS`
  - Live headless Chromium (`playwright-cli`) verification of `/exchange` -> `PASS` (`0` console errors, `0` external network requests)
  - Complete acceptance report written to `docs/evaluation/WP03-ACCEPTANCE.md` with verdict `IMPLEMENTED — INDEPENDENT QUALIFICATION PENDING`.
  - Updated `docs/handoffs/CURRENT-STATE.md`.
- **Next Exact Task:** Owner manual push to GitHub and independent native GitHub Actions run of `.github/workflows/termforge-native-qualification.yml`. **Stopped before WP04.**

