# WP03 Transition Hardening Report (`WP04 F1`: `H1–H3`)

- **Date:** `2026-11-27`
- **Starting Baseline:** `e9f91a3b816b999599f19172cdcd84fd9f9cda23` (WP03 native `173/173` tests PASS in GitHub Actions run `46058256556`, engineering acceptance `CONDITIONAL` pending targeted `H1–H3` hardening)
- **Local Gate Status:** `CLOSED—VERIFIED` (local typecheck, unit/controller regression suite, Next.js production build, and live headless Chromium H1+H2 verification PASS; independent native CI rerun on combined `H1–H3 + WP04` delivery **PENDING**).
- **Gate Boundaries Unchanged:** `G2 ACCEPTED`, `WP01 & WP02 ACCEPTED` (`D3 DOCX BLOCKED—CONDITIONAL EXCLUDED`), `G4 NOT READY`, `G5 NOT ESTABLISHED`, `G6 NOT APPROVED`. Canonical npm lockfile (`package-lock.json` SHA-256 `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`), 15 direct dependencies, schema v1, and backup v1 preserved unchanged.

---

## 1. Hardening Scope & Root-Cause Fixes (`H1–H3`)

### `H1` — Exact Proposal-Bound Pre-Commit Backup Gate
- **Prior Risk:** `DataOperationsPanel` permitted checking `precommitAckChecked` and committing an additive import without initiating and validating a pre-commit portable backup bound to the exact current proposal and library revision (demonstrated on the second import batch in `tests/e2e/s3-data-operations.spec.ts`).
- **Root-Cause Resolution (`src/domain/review-guard.ts`, `src/features/exchange/data-operations-controller.ts`, `src/features/exchange/DataOperationsPanel.tsx`):**
  - Added structured `PreCommitBackupProof` (`proposalDigest`, `batchId`, `reviewIntentDigest`, `snapshotRevision`, `backupDigest`, `filename`, `byteLength`, `offeredAt`) created by `createValidatedPreCommitBackupOffer`, which executes `createBackup` + `serializeBackupFile` within the unmodified `MAX_BACKUP_FILE_BYTES` (`16 MiB`) limit.
  - Enforced `verifyPreCommitCommitAuthorization` both in the UI gating (`precommit-ack-checkbox` and `approve-apply-import-btn` disabled until valid proof matches current proposal, current review intent, and authoritative snapshot revision) and fail-closed inside `DataOperationsSessionController.approveAndApply` before calling the gateway.
  - Any change to source, delimiter, blank-line policy, mapping, row/target decision, library revision, proposal rebuild, clear/cancellation, or failed/overlimit backup immediately invalidates prior backup proofs and resets `preCommitAckChecked` to `false`.
  - Retained explicit honesty notice that browser download initiation cannot verify external filesystem persistence on user disk.

### `H2` — Lossless Review-Intent Identity & Async Lifecycle Hardening
- **Prior Risk:** `computeStagingSessionFingerprint` omitted row decisions/targets; `DataOperationsPanel` had no monotonic generation guards across async file reads, built-in fixture staging, `buildAdditiveImportPlan`, backup serialization, snapshot reload, or commit; duplicate clicks lacked synchronous locking before awaiting digest computation; `DataOperationsPanel` opened an unrequested `BroadcastChannel('termforge-library-sync')` and bypassed `RevisionReconciliationController`; and `ExportWorkspace.loadSnapshot` lacked out-of-order sequence guarding.
- **Root-Cause Resolution:**
  - Added lossless canonical review-intent digesting (`buildDelimitedReviewIntentPayload`, `computeDelimitedReviewIntentCanonical`, `computeDelimitedReviewIntentDigest`) covering `rawByteSha256`, `delimiter`, `blankLinePolicy`, `baseLibraryRevision`, `mappingVersion`, `mapping`, and deterministically sorted row decisions (`skip`, `unresolved`, `create-new-concept`, `link-existing-concept` + target ID, `link-staged-group` + group key). Also prepared shared `ENRICHMENT_REVIEW_INTENT_VERSION` helpers for reuse in `WP04 F7`.
  - Built `DataOperationsSessionController` (`src/features/exchange/data-operations-controller.ts`) with monotonic request counters (`intakeGen`, `reviewGen`, `proposalGen`, `backupGen`), React 19 StrictMode `remount()`/`unmount()` guards, synchronous `commitInFlightLock` before any `await`, `RevisionReconciliationController.runCommit` integration, and stale async rejection across file upload/fixture load/plan build/backup offer/commit/unmount.
  - Removed the unnecessary `BroadcastChannel('termforge-library-sync')` from `DataOperationsPanel.tsx`; CAS + `RevisionReconciliationController` + explicit authoritative snapshot reload remain the single cross-instance safety boundary.
  - Added `mountedRef` + monotonic `snapshotLoadSeqRef` + `shouldApplySnapshotLoad` inside `ExportWorkspace.tsx` (`loadSnapshot`).

### `H3` — Documentation Errata
- **`docs/evaluation/WP03-ACCEPTANCE.md`:** Appended `## H3 Documentation Erratum — Section 5.5` correcting `ProvenanceSchema.kind` (`'manual' | 'reviewed-candidate'`, not `'extracted'`).
- **`docs/evaluation/G4-REAL-DATA-READINESS.md`:** Appended `## WP04 F1 H3 Hardening & Measurement Clarifications` noting conditional H1/H2 remediation pending combined native CI rerun and distinguishing synthetic 10k/50k measurement observations from universal capacity guarantees.

---

## 2. Changed Files in `F1`
- Created: `src/domain/review-guard.ts`
- Created: `src/features/exchange/data-operations-controller.ts`
- Modified: `src/features/exchange/DataOperationsPanel.tsx`
- Modified: `src/features/exchange/ExportWorkspace.tsx`
- Created: `tests/unit/h1-h2-data-operations-hardening.test.ts`
- Modified: `tests/e2e/s3-data-operations.spec.ts`
- Modified: `docs/evaluation/WP03-ACCEPTANCE.md`
- Modified: `docs/evaluation/G4-REAL-DATA-READINESS.md`
- Created: `docs/evaluation/WP03-TRANSITION-HARDENING.md`
- Updated: `docs/handoffs/WP04-IMPLEMENTATION-LEDGER.md`

---

## 3. Verification Evidence (`F1` Local Gate)

- **TDD RED -> GREEN Cycle:**
  - Wrote failing hardening suite `tests/unit/h1-h2-data-operations-hardening.test.ts` and fixed discovered defects (`DataOperationsSessionController.approveAndApply` synchronous lock acquisition before awaiting review-intent digest; `DataOperationsPanel.tsx` React 19 StrictMode `remount()` lifecycle).
- **Commands Executed After Final `F1` Edits:**
  - `npm run typecheck`: `0` errors (`PASS`).
  - `npm run test`: `32` test files / `142` tests (`PASS`), including `4/4` tests in `tests/unit/h1-h2-data-operations-hardening.test.ts` (`H2-unit`, `H1-unit`, `H2-controller`, `H1+H2-controller`).
  - `next build` (`compile_applet`): `PASS` (`0` errors).
- **Live Headless Chromium Verification (`playwright-cli` on `http://127.0.0.1:3000/exchange`):** `PASS` (`0` console/page errors):
  - Confirmed `precommit-ack-checkbox` and `approve-apply-import-btn` remain disabled prior to pre-commit backup offer.
  - Offered Rev 0 pre-commit backup -> ack checkbox enabled.
  - Changed row-3 decision -> proposal preview and backup proof immediately cleared; rebuilt proposal -> old proof did not transfer and ack remained disabled until fresh Rev 0 offer; committed Batch 1 (`2` ops) at library `Rev 1`.
  - Staged Batch 2 (`synth-bilingual-dirty-csv-v1`), rebuilt proposal -> confirmed ack remained disabled at `Rev 1` until fresh `termforge-pre-import-backup-rev1` offer was generated; checked ack and committed Batch 2 (`12` ops) atomically at `Rev 2`, updating Quality Inspector (`VALID`, `Homonyms (1)`).
- **Native Runner / Pending Verification Disclosure:**
  - Updated `tests/e2e/s3-data-operations.spec.ts` adds negative H1/H2 assertions and requires fresh Rev 1 backup offer on batch 2. Full native `npm ci` + `npm run test:gate` + full 29+ Playwright `s3-data-operations.spec.ts` runner execution on GitHub Actions remains **PENDING** owner manual push of the combined `H1–H3 + WP04` delivery.
