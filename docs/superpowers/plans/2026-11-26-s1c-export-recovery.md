# S1c — Export and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete first slice with deterministic presentation exports and independently verifiable portable backup/restore.

**Architecture:** Separate export projections from complete persisted snapshot; restore only into truly empty target through controlled gateway.

**Tech Stack:** S1a/S1b stack; native Blob and Web Crypto; no extra file library required.

**Spec:** [Master Design Baseline v1.0](../../architecture/MASTER-DESIGN-BASELINE-v1.0.md). [S1 contracts](../../specifications/S1-IMPLEMENTATION-CONTRACTS-v0.1.md) where applicable.

Status: REVIEWABLE PLAN — design approved, execution pending owner plan approval and predecessor gates. File paths are planned, not existing product code.

## Global Constraints
- Approved v1.0 §12–15 govern; no automatic merge; synthetic data only until G4 and S3 safeguards; no real seed, credentials, telemetry, server transmission, AI runtime, account or external corpus. Production library starts empty.
- Next.js App Router, React, TypeScript conditional on G2; selected exact candidates wink-nlp@2.4.0, wink-eng-lite-web-model@1.8.1, ahocorasick@1.0.2, dexie@4.4.7 subject to G1/G2; no R21. Other package versions selected and recorded before use. Do not substitute silently.
- Domain independent of vendor/framework. Original scientific Unicode, case, numbers, punctuation and source spans preserved. EN/TR/shared forms; no forced concept merge, invented translation or verified scientific claim.
- All master writes use approved change gateway; fail closed; no raw import; portable backup separate from presentation exports. No fake screens or unimplemented routes. No new product-wide license.
- Actual execution and commits only after plan approval. Use isolated project/worktree and exact Git base. If AI Studio cannot execute a command, record NOT TESTED, export code, and let Codex run it locally. Do not claim pass from generated UI or prose.

## Review Focus
- CSV injection and literal commas/quotes (C1).
- Null frequency, ambiguity and deterministic ordering (C1).
- Corrupted JSON, duplicate IDs and missing references (C2).
- Concurrent restore into nonempty target and injected abort (C3).
- Restart, quota, migration and actual multi-tab race (C5 real-data gate).

---
## Precondition
S1a/b accepted and plan continuation approved. No import of legacy lists/real data; S3 separately planned. G3 must pass for S1 acceptance; G4 must pass before personal data and S3 intake safeguards.
### Task C1: Export projections and formats

**Files:** Create src/application/exchange.ts, tests/unit/export.test.ts.

**Interfaces:** Produces ExportSelection, ExportRow, selectExportRows(snapshot,run,selection), formatExport per contracts.

- [ ] **Step 1: Write failing assertions.** expect CSV for text '=1+1' contains escaped apostrophe prefix; quote comma in '2,4-dinitrophenol', preserve Unicode and stored form; Markdown escapes pipe; JSON format termforge-export/version1; alphabetic stable tie id, frequency null last, unresolved conceptId null, known filter honored, two occurrences grouped without losing identity; no inferred tr.
- [ ] **Step 2: Run red check.** `npm run test -- tests/unit/export.test.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Implement deterministic projection/sort and serializers, CSV formula safety including leading whitespace, JSON rich projection vs backup explicit. Library counts only retained resolved evidence; missing null, current-run counts exact. UTF-8, no server.
- [ ] **Step 4: Run green check.** `npm run test -- tests/unit/export.test.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: add deterministic scientific presentation exports` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task C2: Complete backup validation

**Files:** Create src/domain/backup.ts, tests/unit/backup.test.ts; extend exchange.ts.

**Interfaces:** Produces BackupEnvelope, RestoreApproval, createBackup(snapshot), validateBackup(input) per contracts.

- [ ] **Step 1: Write failing assertions.** assert backup.format==='termforge-backup'; valid round-trip exact canonical snapshot; wrong digest/version, duplicate IDs, orphan expression, invalid retained span, invalid history/revision, non-JSON/unknown fields, presentation export rejected; no mutation on validation failure.
- [ ] **Step 2: Run red check.** `npm run test -- tests/unit/backup.test.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Validate complete canonical snapshot schema and integrity; digest over snapshot, revalidate source spans and all references, history, batch/operation consistency, no derived cache/session-only documents. Backup includes persisted library and history, no raw text unless explicitly retained. Safe bounded parse, exact error.
- [ ] **Step 4: Run green check.** `npm run test -- tests/unit/backup.test.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: define portable validated library backup` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task C3: Controlled empty-target restore

**Files:** Extend src/domain/repository.ts with RecoveryRepository, src/application/library.ts with restore gateway, src/adapters/storage/dexie-library.ts; create tests/e2e/restore.spec.ts.

**Interfaces:** Produces restoreEmpty(backup,approval):Promise<ApplyResult> via controlled gateway, snapshot preserves canonical data exactly.

- [ ] **Step 1: Write failing assertions.** actual browser: restore to separate empty DB/origin and compare entire snapshot; target with only audit or revision nonzero rejected; same backup into nonempty target rejected; wrong digest approval rejected; inject write failure and assert all stores unchanged; two simultaneous restore requests at most one succeeds; read snapshot during write consistent; invalidate derived matcher index after restore.
- [ ] **Step 2: Run red check.** `npm run test:e2e -- tests/e2e/restore.spec.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Validate before transaction, recheck empty all stores/meta and approval inside atomic transaction; add records, preserve revisions and history, no overwrite existing state; return after commit only. Refuse unsupported version and destructive replacement. No unguarded importer.
- [ ] **Step 4: Run green check.** `npm run test:e2e -- tests/e2e/restore.spec.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: restore validated backups atomically into empty library` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task C4: Export and recovery UI

**Files:** Create src/app/exchange/page.tsx, src/features/exchange/ExportWorkspace.tsx, BackupPanel.tsx, tests/e2e/export-recovery-ui.spec.ts; update navigation.

**Interfaces:** Consumes formatExport/createBackup/validateBackup/restore gateway; file Blob download local.

- [ ] **Step 1: Write failing assertions.** Download TXT/MD/CSV/JSON current run/library, inspect content; backup includes all persisted records; invalid file shows error and no mutation; restore preview shows counts and explicit confirm; refuse nonempty restore; keyboard accessible, persistence false warning and backup reminder, no implied backup success until download offered; no raw private content in URL/log.
- [ ] **Step 2: Run red check.** `npm run test:e2e -- tests/e2e/export-recovery-ui.spec.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Real selectors, format and sort controls, browser downloads, dedicated backup/restore workflow, clear format distinction. Explain persistence and origin limits, backup files under user control. No scheduled backup guarantee or generic import.
- [ ] **Step 4: Run green check.** `npm run test:e2e -- tests/e2e/export-recovery-ui.spec.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: deliver export and portable recovery workspace` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task C5: Integrated G3 verification and G4 readiness evidence

**Files:** Create tests/e2e/first-slice.spec.ts, tests/e2e/readiness.spec.ts, docs/evaluation/S1-ACCEPTANCE.md, docs/evaluation/G4-REAL-DATA-READINESS.md.

**Interfaces:** Consumes actual app and all previous contracts; produces separate G3 and G4 verdicts, no automatic release.

- [ ] **Step 1: Write failing assertions.** G3: fresh empty app -> paste -> review -> save EN/TR -> reload -> search -> export -> backup -> empty-origin restore exact snapshot; regress all A/B/C tests; assert all writes protected. G4: real two-tab simultaneous conflicting writes (one success, one stale), browser restart, realistic version migration on test copy, blocked upgrade, actual quota/denial or faithful injected failure explicitly distinguished, backup drill, stable origin and scale sample; assert no loss on failure and show clear status.
- [ ] **Step 2: Run red check.** `npm run test:e2e -- tests/e2e/first-slice.spec.ts tests/e2e/readiness.spec.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Run actual tests and record environment/commands/output; G4 checks separate, not block synthetic S1 acceptance if G3 passes. Mark unavailable actual quota/restart/migration BLOCKED/NOT TESTED, never substitute fake success. Document G4 capacity and retention risks, no private data until G4 and S3 safeguards. Review selected lock/license and no secrets.
- [ ] **Step 4: Run green check.** `npm run test:e2e -- tests/e2e/first-slice.spec.ts tests/e2e/readiness.spec.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `test: verify first slice and record real-data readiness gaps` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.

## Stop gate
Run npm run typecheck, npm run test, npm run test:e2e, npm run build; publish actual G3 verdict, G4 separately, known limitations and complete diff. Export/commit unmerged integration candidate; independent Codex review before any merge decision. G5 scientific accuracy not established. S2–S7 need own plans and proportionate decision review; no automatic implementation.
