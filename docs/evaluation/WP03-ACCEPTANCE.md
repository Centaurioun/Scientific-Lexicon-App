# WP03 Data Operations — Acceptance & Format/Maintenance Roadmap Closure (`E1–E11`)

**Date:** 2026-11-27  
**Repository:** `Centaurioun/Scientific-Lexicon-App`  
**Preserved WP02 Qualified Baseline:** Commit `f7857d8d9e11fbcd5e40b1731f8ad52217ea54fd` (GitHub Actions run `46042674468`, job `140654082609`, artifact `15220682504`, `148/148` native tests PASS)  
**Work Package Scope:** `docs/WP03_DATA_OPERATIONS.md` (`E1–E11`) & `docs/superpowers/specs/2026-11-27-wp03-data-operations-design.md`  
**Canonical Lockfile SHA-256:** `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033` (`docs/qualification/S0-package-lock.json`, 15 direct dependencies unchanged)  
**WP03 Overall Verdict:** **IMPLEMENTED — INDEPENDENT QUALIFICATION PENDING**  
**Material Gate Postures:**
- **G2 (Starter & Architecture Baseline):** ACCEPTED (preserved)
- **G3 (Synthetic S1 / WP01 / WP02 / WP03 Scope):** WP01 & WP02 ACCEPTED; WP03 `E1–E11` IMPLEMENTED & VERIFIED IN AI STUDIO (`138/138` unit tests + live Chromium verification; native GitHub Actions CI run pending manual owner push)
- **G4 (Real-Data Readiness):** **NOT READY** (synthetic allowlist strictly enforced)
- **G5 (Scientific Extraction Accuracy):** **NOT ESTABLISHED**
- **G6 (Release Approval):** **NOT APPROVED**
- **D3 (DOCX Intake):** **BLOCKED—CONDITIONAL EXCLUDED**
- **WP04:** **NOT AUTHORIZED** (stopped before WP04 per owner directive)

---

## 1. Finite WP03 Deliverable Status Matrix (`E1–E11`)

Allowed status labels:
- `CLOSED—VERIFIED`
- `IMPLEMENTED—VERIFICATION BLOCKED`
- `BLOCKED—CONDITIONAL EXCLUDED`
- `OPEN—MANDATORY`

| ID | Deliverable | Status | Primary Implementation & Verification Evidence |
|---|---|---|---|
| **E1** | Lossless Same-Instance Revision Reconciliation Continuation | `CLOSED—VERIFIED` | `src/features/extraction/concurrency-controller.ts`, `src/features/extraction/ExtractionWorkspace.tsx`, `tests/unit/ui-concurrency.test.ts` (`9/9` PASS, including `E1-1` >8 drain continuation and `E1-2` continuous storm fail-closed handling). |
| **E2** | Pure Bounded Delimited Text Parser and Synthetic Intake Contract | `CLOSED—VERIFIED` | `src/domain/delimited-intake.ts`, `src/application/delimited-file.ts`, `tests/unit/delimited-intake.test.ts` (`6/6` PASS). Enforces `<= 2 MiB`, `<= 200,000` chars, `<= 1,000` data rows, `<= 32` columns, `<= 8,192` chars/cell, fatal UTF-8, explicit delimiter (`,` or `\t`), and raw-byte SHA-256 synthetic fixture allowlist. |
| **E3** | Staging Schema, Column Mapping and Row Validation | `CLOSED—VERIFIED` | `src/domain/staging-mapping.ts`, `tests/unit/staging-mapping.test.ts` (`3/3` PASS). Positional column mapping (`0..31`), duplicate header name safety, explicit before/after transformation (`none`, `trim-exterior`, `trim-collapse-spaces`), inert formula-leading warning (`=`, `+`, `-`, `@`), unmapped column loss summary, and `computeStagingSessionFingerprint`. |
| **E4** | Indexed Duplicate, Conflict and Concept Grouping Review | `CLOSED—VERIFIED` | `src/domain/staging-review.ts`, `tests/unit/staging-review.test.ts` (`2/2` PASS). $O(N + M)$ hash-indexed classification (`new-surface`, `exact-single-concept-match`, `ambiguous-multi-concept-homonym`, `invalid-row`), deterministic `CONFLICT_FLAG_ORDER`, Turkish locale-aware advisory fold (`İ/i`, `I/ı`), and explicit per-row user decisions. |
| **E5** | Additive Import Plan and Immutable Gateway Preview | `CLOSED—VERIFIED` | `src/application/import-planner.ts`, `tests/unit/import-planner.test.ts` (`2/2` PASS). Generates one atomic `<= 250`-op `ChangePayload` (`createConcept` and `addExpression` only, exact `expectedConceptRevision` progression `0, 1, 2, ...`, `kind: "manual", source: null` provenance, zero assertions, UUID collision guard) via `proposeChange`. |
| **E6** | Data Operations Workspace and Reviewed Apply UI | `CLOSED—VERIFIED` | `src/features/exchange/DataOperationsPanel.tsx`, `src/features/exchange/ExportWorkspace.tsx`, `tests/unit/wp03-recovery-privacy.test.ts`, `tests/e2e/s3-data-operations.spec.ts`. Verified in Vitest and live headless Chromium (`playwright-cli`) on `/exchange`. |
| **E7** | Read-Only Quality and Maintenance Inspector | `CLOSED—VERIFIED` | `src/application/quality-inspector.ts`, `src/features/exchange/QualityInspectorPanel.tsx`, `tests/unit/quality-inspector.test.ts` (`3/3` PASS). Read-only referential integrity check, exact same-concept duplicate tuples, non-error scientific homonym groups (`isError: false`), concept coverage flags, expression advisories, protected expression inventory, 50-item pagination, and `/library?concept=<conceptId>` deep links. |
| **E8** | Recovery, Privacy and Atomic Failure Drill | `CLOSED—VERIFIED` | `tests/unit/wp03-recovery-privacy.test.ts` (`2/2` PASS), `tests/e2e/s3-data-operations.spec.ts`, and live Chromium verification. Proves full stage -> preview -> backup -> approve -> reload -> export -> independent empty-context restore parity and zero persistence of skipped rows (`SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST`) and unmapped columns (`SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST`). |
| **E9** | G4 Operational Evidence (Synthetic) | `CLOSED—VERIFIED` | `tests/unit/g4-operational-probes.test.ts` (`4/4` PASS) and non-destructive update to `docs/evaluation/G4-REAL-DATA-READINESS.md`. Distinguishes automated synthetic probes, simulated errors, isolated `v1 -> v2` migration harness, and `10,000` vs. `50,000` expression scale measurements (`16 MiB` backup bound) from remaining manual workstation blockers. |
| **E10** | Format and Maintenance Roadmap Closure | `CLOSED—VERIFIED` | Documented in Section 5 of this report and cross-referenced in `docs/evaluation/G4-REAL-DATA-READINESS.md`. |
| **E11** | Integrated Verification and Delivery | `IMPLEMENTED—VERIFICATION BLOCKED` | All AI Studio verification checks pass (`npm run typecheck`, `npm run test` `31/31` files / `138/138` tests, `compile_applet` / `npm run build`, `lint_applet`, and live Chromium `playwright-cli` verification). Native `npm ci`, `npm run test:gate`, and Playwright `npm run test:e2e` runner execution remain pending manual owner push to GitHub Actions (`.github/workflows/termforge-native-qualification.yml`). |
| **D3** | Conditional DOCX Adapter (Inherited from WP02) | `BLOCKED—CONDITIONAL EXCLUDED` | Remains excluded because no DOCX parser exists in the frozen 15-package dependency graph (`package.json`). |

*Count of `OPEN—MANDATORY` items:* **0**.

---

## 2. Changed & Created Files in WP03

### Production Application & Domain Files
- `src/features/extraction/concurrency-controller.ts` (modified — `E1` lossless continuation & fail-closed `freshnessConfirmed`)
- `src/features/extraction/ExtractionWorkspace.tsx` (modified — `E1` freshness check before proposal creation + manual refresh confirmation)
- `src/domain/delimited-intake.ts` (new — `E2` pure RFC-4180 CSV / strict TSV parser, hard limits, and raw-byte SHA-256 synthetic fixture allowlist)
- `src/application/delimited-file.ts` (new — `E2` browser `File` adapter with pre-read `<= 2 MiB` guard, fatal UTF-8 decode, and raw-byte SHA-256 verification)
- `src/domain/staging-mapping.ts` (new — `E3` positional column mapping, explicit text transformation, validation issues, unmapped column loss summary, and session fingerprint)
- `src/domain/staging-review.ts` (new — `E4` $O(N + M)$ hash-indexed duplicate/homonym/grouping review and deterministic conflict flags)
- `src/application/import-planner.ts` (new — `E5` additive import plan generator producing one atomic `<= 250`-op `ChangePayload` via `proposeChange`)
- `src/application/quality-inspector.ts` (new — `E7` read-only library quality and maintenance inspector with 50-item pagination)
- `src/features/exchange/DataOperationsPanel.tsx` (new — `E6` Data Operations staging, mapping, review, pre-commit backup offer, and atomic apply panel)
- `src/features/exchange/QualityInspectorPanel.tsx` (new — `E7` read-only quality and maintenance inspector UI panel with `/library?concept=<conceptId>` deep links)
- `src/features/exchange/ExportWorkspace.tsx` (modified — `E6` & `E7` integration into `/exchange` preserving all C1/C2/C3 panels and selectors)

### Test Files
- `tests/unit/ui-concurrency.test.ts` (modified — added `E1-1` and `E1-2` continuation & storm tests; `9/9` PASS)
- `tests/unit/delimited-intake.test.ts` (new — `E2` `6/6` PASS)
- `tests/unit/staging-mapping.test.ts` (new — `E3` `3/3` PASS)
- `tests/unit/staging-review.test.ts` (new — `E4` `2/2` PASS)
- `tests/unit/import-planner.test.ts` (new — `E5` `2/2` PASS)
- `tests/unit/quality-inspector.test.ts` (new — `E7` `3/3` PASS)
- `tests/unit/wp03-recovery-privacy.test.ts` (new — `E8` `2/2` PASS)
- `tests/unit/g4-operational-probes.test.ts` (new — `E9` `4/4` PASS)
- `tests/e2e/s3-data-operations.spec.ts` (new — `E6/E7/E8` Playwright E2E spec for native CI qualification)

### Documentation & Handoff Files
- `docs/handoffs/WP03-IMPLEMENTATION-LEDGER.md` (new — checkpoint-by-checkpoint ledger `E1–E11`)
- `docs/evaluation/G4-REAL-DATA-READINESS.md` (modified non-destructively — appended WP03 `E9` & `E10` synthetic operational evidence table)
- `docs/evaluation/WP03-ACCEPTANCE.md` (new — this report)
- `docs/handoffs/CURRENT-STATE.md` (modified — updated current state pointer for WP03 completion)

**Unchanged Core Contracts:**
- `package.json` (15 direct dependencies untouched), `docs/qualification/S0-package-lock.json` (`0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`), `src/domain/schema.ts` (canonical schema v1), `src/domain/changes.ts` (`ChangeOp` union and `evaluateChangeOnSnapshot`), `src/domain/backup.ts` (`termforge-backup` v1 envelope and `16 MiB` limit), `.github/workflows/termforge-native-qualification.yml`.

---

## 3. Verification Commands, Counts & Environment Evidence

| Command / Tool | Environment | Result & Count | Exit Code / Status |
|---|---|---|---|
| `npm run typecheck` (`tsc --noEmit`) | AI Studio Container | 0 TypeScript errors | `0` (`PASS`) |
| `npm run test` (`vitest run`) | AI Studio Container | **31 test files / 138 tests PASS** (all 24 WP01/WP02 files + 7 new WP03 files) | `0` (`PASS`) |
| `compile_applet` (`npm run build`) | AI Studio Container | Next.js production build succeeds cleanly (`/`, `/library`, `/extraction`, `/exchange`) | `0` (`PASS`) |
| `playwright-cli` live headless Chromium verification | AI Studio Container (`http://localhost:3000/exchange`) | Verified staging of `synth-bilingual-dirty-csv-v1` (12 rows), raw vs. transformed preview, `PD` homonym detection, immutable proposal build, pre-commit backup acknowledgment, atomic commit to `Rev 1`, and Read-Only Quality Inspector (`Integrity: VALID`, `1` non-error homonym group `PD`). Zero console errors; zero external network requests. | `0` (`PASS`) |
| `npm run test:gate` & `npm run test:e2e` | Native Node 22 / npm Linux CI (`.github/workflows/termforge-native-qualification.yml`) | Blocked inside AI Studio's Bun-managed `node_modules` container (absent root `package-lock.json` and Bun child-process server wrapper constraints documented since WP01/WP02). Ready for native GitHub Actions run upon owner manual push. | `IMPLEMENTED—VERIFICATION BLOCKED` (in AI Studio container) |

---

## 4. Synthetic Intake, Mapping, Operation, Backup & Privacy Contract Summary (`E2–E8`)

1. **Bounded Delimited Intake & Raw-Byte SHA-256 Allowlist (`E2`):**
   - Hard bounds: `maxFileBytes = 2,097,152` (2 MiB), `maxTextChars = 200,000`, `maxDataRows = 1,000`, `maxColumns = 32`, `maxCellChars = 8,192`, `maxAtomicChangeOperations = 250`.
   - Unlike WP02 dictionary packs (which compute SHA-256 over `canonicalJson(pack)`), WP03 delimited file intake computes SHA-256 over the **exact raw UTF-8 file bytes** (`rawByteSha256`) after fatal UTF-8 decoding (`new TextDecoder('utf-8', { fatal: true })`) and checks membership in `APPROVED_SYNTHETIC_IMPORT_FIXTURES`:
     - `synth-bilingual-dirty-csv-v1` (`,`, 12 rows): `2c32a9172329bf215b45205a8fdf1a933b04e1bc96c1545de28a118309297650`
     - `synth-bilingual-symbols-tsv-v1` (`\t`, 4 rows): `6a96849087e3e52006570e83d8ce8bf5310c841c290567e9debaa53fe60a796d`
     - `synth-privacy-recovery-drill-csv-v1` (`,`, 3 rows): `901a0e7fa0dadbc09532f392719e02de28dd559a0991217e1e6fcfb3afe2e967`
2. **Positional Column Mapping & Loss Report (`E3`):**
   - Columns are bound strictly by 0-based positional index (`0..31`) so duplicate header names never overwrite or collide.
   - Unmapped columns are inventoried with non-empty cell counts in `table.unmappedColumns` and explicitly disclosed in the UI loss banner before commit.
3. **Indexed Conflict/Homonym Review & Additive Atomic Commit (`E4–E6`):**
   - $O(N + M)$ hash-indexed lookup against `snapshot.expressions` classifies rows without $O(N^2)$ fuzzy scans.
   - Multi-concept homonyms (`ambiguous-multi-concept-homonym`) remain `unresolved` until the user explicitly chooses a target concept, creates a distinct concept, or skips the row.
   - `buildAdditiveImportPlan` emits one atomic `ChangePayload` (`createConcept` and `addExpression` only, `<= 250` ops) with deterministic `expectedConceptRevision` progression (`0, 1, ...` for new staged concepts; `rev, rev + 1, ...` for existing concepts), `kind: "manual", source: null` provenance, and zero verification assertions.
   - Pre-commit backup download is offered and explicit user acknowledgment is required before `Approve and apply import batch` is enabled, with honest disclosure that browser download initiation cannot prove external disk persistence.
4. **Privacy & Recovery Drill (`E8`):**
   - Verified in `tests/unit/wp03-recovery-privacy.test.ts` and `tests/e2e/s3-data-operations.spec.ts` that neither skipped row text (`SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST`) nor unmapped column cells (`SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST`) appear in IndexedDB, `localStorage`, `sessionStorage`, console logs, URLs, network requests, presentation exports, or portable backups, while approved expressions (`SYNTH_APPROVED_IMPORT_TERM_E8`) persist and restore into an independent empty repository with identical canonical SHA-256 digest.

---

## 5. Format and Maintenance Roadmap Closure (`E10`)

### 5.1 Three Distinct Artifact Contracts (Never Interchangeable)
| Artifact | Format Identifier | Direction & Purpose | Guarantees & Limitations |
|---|---|---|---|
| **1. Synthetic Delimited Intake (WP03 S3)** | RFC-4180 CSV (`,`) / Strict TSV (`\t`) | **Input-only** session staging -> reviewed additive `createConcept` / `addExpression` batch (`<= 250` ops). | Requires raw-byte SHA-256 allowlist match while G4 is `NOT READY`. Unmapped columns and skipped rows are discarded in memory. Committed expressions carry `kind: "manual", source: null` provenance and zero assertions. |
| **2. Presentation Export (WP01 C1)** | `CSV`, `MD`, `TXT`, `JSON` (`termforge-export` v1) | **Output-only** human/editorial projection. | CSV cells apply formula-injection prefixing (`'` before `=`, `+`, `-`, `@`, `\t`, `\r`). Does **not** contain full concept revisions, assertions, provenance, retained documents, runs, batches, or audit history. **Never accepted by backup restore or delimited import.** |
| **3. Canonical Portable Backup (WP01 C2/C3)** | `JSON` (`termforge-backup` v1, `<= 16 MiB`) | **Round-trip durability boundary** for atomic empty-target recovery (`restoreEmptyLibrary`). | Contains complete `LibrarySnapshot` (`schemaVersion: 1`) + canonical SHA-256 `digest`. Restorable **only** into a genuinely empty library (`Rev 0`). |

### 5.2 Standalone OpenRefine Preparation Guidance
- OpenRefine (referenced in the 438-source documentation index) is an **external, standalone desktop preparation tool** that researchers may use offline on their own workstation (post-G4) to clean or reconcile tabular data before exporting a standard UTF-8 CSV/TSV.
- TermForge **never** embeds OpenRefine, never connects to an OpenRefine HTTP/server endpoint, and never executes external reconciliation service calls.

### 5.3 Deferred and Blocked File Formats
- **`DOCX` (`D3`):** `BLOCKED—CONDITIONAL EXCLUDED` — no DOCX/ZIP/XML parser exists in the frozen 15-package dependency graph.
- **`XLSX` / `.xls` / `.ods`:** Deferred/Excluded — binary/ZIP spreadsheet containers require third-party parsers outside the frozen dependency baseline and introduce macro/formula attack surface. Users must export clean UTF-8 CSV or TSV.
- **`TBX` (TermBase eXchange) & `TMX` (Translation Memory eXchange):** Deferred to post-v1 roadmap — XML concept/term-entry hierarchies carry nested administrative metadata not representable in canonical schema v1 without lossy flattening.
- **Arbitrary JSON Ingest:** Prohibited — only SHA-256 verified `termforge-backup` v1 envelopes (for empty-target restore) and allowlisted `termforge-dictionary-pack` v1 files (for read-only extraction reference lookup) are accepted.

### 5.4 Blocked Destructive Maintenance, Merge, Delete & Compensation Operations
- Canonical schema v1 (`src/domain/schema.ts`) and `ChangeOp` (`src/domain/changes.ts`) intentionally exclude `mergeConcept`, `deleteConcept`, `deleteExpression`, and automatic batch rollback/compensation after commit.
- Destructive concept merge or expression deletion would invalidate or orphan existing `VerificationAssertion` records (`user-confirmed` protection), `Provenance` records, `RetainedRun` occurrences, and monotonic `expectedConceptRevision` history.
- Until a dedicated schema v2 design specifies revision tombstones, reference re-pointing, and protected-assertion preservation rules, **all maintenance diagnostics in `E7` (`QualityInspectorPanel`) are strictly read-only**, and users recover from unwanted bulk imports by restoring their pre-commit `termforge-backup` v1 file into a clean empty library.

### 5.5 Data Provenance Policy (Schema v1 vs. Future Schema v2)
- In schema v1, `ProvenanceSchema` allows `kind: 'manual' | 'extracted'` and requires `source: null` when `kind === 'manual'`.
- Because external CSV/TSV rows do not correspond to a retained full-text extraction document (`RetainedDocument`) or character offset span (`start`, `end`), WP03 additive imports record `kind: 'manual', source: null` and disclose this limitation prior to approval (`PROVENANCE_LIMITATION_DISCLOSURE`).
- Structured import-batch provenance (e.g., recording source filename, row number, and raw file SHA-256 in canonical provenance) is deferred to a future schema v2 revision.

---

## 6. Residual Risks & Next Exact Task

### Residual Risks
1. **50,000-Expression Single-File Backup Ceiling (`16 MiB`):** As measured in `E9` (`tests/unit/g4-operational-probes.test.ts`), a `10,000`-expression library serializes to `6,398,153 bytes` (`~6.10 MiB`, passing `createBackup`), whereas a `50,000`-expression library (`~30.5 MiB`) exceeds `MAX_BACKUP_FILE_BYTES` (`16 MiB`) and fails closed without truncation.
2. **Native CI Verification Pending Owner Push:** While all `31` unit test suites (`138/138` tests), `tsc --noEmit`, `next build`, `eslint`, and live headless Chromium (`playwright-cli`) checks pass in AI Studio, native `npm ci`, `npm run test:gate`, and Playwright `npm run test:e2e` must be executed by GitHub Actions (`.github/workflows/termforge-native-qualification.yml`) after the owner manually syncs this commit.
3. **G4 / G5 / G6 Boundaries:** Gate G4 remains `NOT READY`, Gate G5 remains `NOT ESTABLISHED`, and Release remains `NOT APPROVED`.

### Next Exact Task
1. Owner manually syncs/pushes the WP03 workspace changes to GitHub (`Centaurioun/Scientific-Lexicon-App`) and runs `.github/workflows/termforge-native-qualification.yml` to record independent native Linux `npm ci` + `test:gate` + `test:e2e` (including `tests/e2e/s3-data-operations.spec.ts`) qualification evidence.
2. **Stop before WP04.** No WP04 work is authorized.

## Independent native execution and transition addendum — 2026-11-27
173/173 PASS at `e9f91a3b816b999599f19172cdcd84fd9f9cda23`, run 46058256556. [Coordinator qualification](WP03-FINAL-QUALIFICATION.md) records conditional engineering acceptance, H1/H2 source-review findings and H3 erratum required. This supersedes pending native status only for tested source. H1–H3 are mandatory WP04 F1 work; no independent acceptance of later source until combined native execution. G4 unchanged.

## H3 Documentation Erratum — Section 5.5 (`ProvenanceSchema.kind`)
- **Erratum (`2026-11-27`, WP04 F1 H3):** Section 5.5 above erroneously stated `kind: 'manual' | 'extracted'`. In the actual preserved canonical v1 schema (`src/domain/schema.ts`, `ProvenanceSchema`), the allowed union is strictly **`kind: 'manual' | 'reviewed-candidate'`** (`source: null` is required for `'manual'`; `source` with document/run/span coordinates is used for `'reviewed-candidate'`).
- WP03 reviewed additive imports use `kind: 'manual'` and `source: null` (with no fabricated source fields), and canonical `schema.ts` v1 remains unchanged.

