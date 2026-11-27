# S1a — Foundation and Bilingual Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real empty local concept library with approved writes and search.

**Architecture:** Use a small App Router client workspace, pure domain schemas and one Dexie repository adapter. All canonical mutations use application gateway.

**Tech Stack:** Confirmed S0 stack, Dexie 4.4.7, Zod candidate, Vitest, Playwright.

**Spec:** [Master Design Baseline v1.0](../../architecture/MASTER-DESIGN-BASELINE-v1.0.md). [S1 contracts](../../specifications/S1-IMPLEMENTATION-CONTRACTS-v0.1.md) where applicable.

Status: REVIEWABLE PLAN — design approved, execution pending owner plan approval and predecessor gates. File paths are planned, not existing product code.

## Global Constraints
- Approved v1.0 §12–15 govern; no automatic merge; synthetic data only until G4 and S3 safeguards; no real seed, credentials, telemetry, server transmission, AI runtime, account or external corpus. Production library starts empty.
- Next.js App Router, React, TypeScript conditional on G2; selected exact candidates wink-nlp@2.4.0, wink-eng-lite-web-model@1.8.1, ahocorasick@1.0.2, dexie@4.4.7 subject to G1/G2; no R21. Other package versions selected and recorded before use. Do not substitute silently.
- Domain independent of vendor/framework. Original scientific Unicode, case, numbers, punctuation and source spans preserved. EN/TR/shared forms; no forced concept merge, invented translation or verified scientific claim.
- All master writes use approved change gateway; fail closed; no raw import; portable backup separate from presentation exports. No fake screens or unimplemented routes. No new product-wide license.
- Actual execution and commits only after plan approval. Use isolated project/worktree and exact Git base. If AI Studio cannot execute a command, record NOT TESTED, export code, and let Codex run it locally. Do not claim pass from generated UI or prose.

## Review Focus
- Empty/whitespace form, partial EN/TR, same spelling different concepts (A2).
- Approval tampering, replay and same batch changed payload (A3/A4).
- Unexpected abort and existing ID overwrite (A4).
- Verified-value mutation through alternate path (A4).
- Reload, database denied, stale second view (A5).

---
## Precondition
Approved plan and actual G1/G2 results. S0 code is disposable, do not promote its probe DB. Integrate app export on dedicated branch from approved documentation commit; preserve docs and existing tests. Use authorized worktree, no main sync. S1 contract file is shared authority. S1a synthetic only.

### Task A1: Application shell and test infrastructure

**Files:** Create package.json, lock, tsconfig.json, next.config.*, src/app/layout.tsx, src/app/page.tsx, src/app/globals.css, vitest.config.ts, playwright.config.ts, tests/e2e/shell.spec.ts.

**Interfaces:** Produces npm run test, test:e2e, typecheck, build; browser client entry, no server data route.

- [ ] **Step 1: Write failing assertions.** Playwright: getByRole('heading',{name:'TermForge'}).isVisible(); shell shows a real initial workspace status 'Library setup' without claiming a database or library exists; no visible unsupported Phrasebank/AI/import routes; no network payload containing synthetic marker.
- [ ] **Step 2: Run red check.** `npm run test:e2e -- tests/e2e/shell.spec.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Create only functioning initial client workspace and real navigation as implemented; the empty-library message belongs to A5 after reading an actual empty database. Use approved versions, no placeholder capabilities. Set tests server config and isolated origins. Record baseline build and dependency lock; no app database data yet.
- [ ] **Step 4: Run green check.** `npm run test:e2e -- tests/e2e/shell.spec.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: establish minimal local workspace` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task A2: Canonical records and validation

**Files:** Create src/domain/schema.ts, src/domain/repository.ts, tests/unit/schema.test.ts.

**Interfaces:** Produces Concept, Expression, LanguageUse, ExpressionRole, VerificationAssertion, Provenance, LibrarySnapshot and runtime parsers per contracts.

- [ ] **Step 1: Write failing assertions.** expect(parseExpression(validTr).language).toEqual({kind:'language',tag:'tr'}); reject whitespace-only text, unsupported language code, unknown keys, negative revision; two PD expressions under different concepts valid; assert empty snapshot validates; one concept with no expression and orphan expression invalid in snapshot validator.
- [ ] **Step 2: Run red check.** `npm run test -- tests/unit/schema.test.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Use one runtime schema authority and derive types; validate referential/unique constraints on full snapshot; preserve original Unicode, no casefold/dedup on surface globally; one expression enough, no mandatory translation. Validate supported scalar and record shapes; shared use explicit.
- [ ] **Step 4: Run green check.** `npm run test -- tests/unit/schema.test.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: define bilingual canonical record schema` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task A3: Approved change envelope and preview

**Files:** Create src/domain/changes.ts, src/application/library.ts, tests/unit/changes.test.ts.

**Interfaces:** Produces ChangePayload, ProposedChange, Approval, ApplyResult, proposeChange(snapshot,payload), approveChange(proposal), applyChange(repo,proposal,approval) per contracts.

- [ ] **Step 1: Write failing assertions.** expect(await digest({b:1,a:2})).toBe(await digest({a:2,b:1})); expect digest array reorder differs; reject non-JSON payload, duplicate opId, blank expression, changed payload after preview, mismatched approval batch/digest. Fake repo must not be called when approval invalid; verify no implicit approval on preview.
- [ ] **Step 2: Run red check.** `npm run test -- tests/unit/changes.test.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Implement canonical JSON and SHA-256, immutable copy, explicit preview, approval binding and gateway validation. Fake repo only in unit tests; no production in-memory fallback. Use strict discriminated operations and no generic put.
- [ ] **Step 4: Run green check.** `npm run test -- tests/unit/changes.test.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: add approved revision-bound change gateway` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task A4: Dexie repository and transaction invariants

**Files:** Create src/adapters/storage/dexie-library.ts, tests/e2e/library-storage.spec.ts, tests/browser/storage-harness.ts; modify src/domain/repository.ts for actual adapter.

**Interfaces:** Produces LibraryRepository.snapshot/apply; real browser isolated DB, schema version 1; consumes approved ChangePayload.

- [ ] **Step 1: Write failing assertions.** Hard assertions: create concept+form revision 1; add form yields two forms; PD under two concepts allowed; orphan/duplicate ID rejected; replay same digest revision unchanged; same batch different digest conflict; stale base revision rejected; duplicate operation ID rejected across batch; explicit user assertion then change text/language rejected; inject exception mid-transaction => snapshot exactly equals before and status aborted; two connections stale; snapshot reads all stores consistently. No conditional logging-only tests.
- [ ] **Step 2: Run red check.** `npm run test:e2e -- tests/e2e/library-storage.spec.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Implement transaction over meta, concepts, expressions, assertions, provenance, documents, runs, batches, audit as needed; enforce all record references and protected values; add creates, revision-checked updates; compare approval inside transaction and return only after commit; no unrelated await. Record actual persistent storage response. If runtime blocks real DB, report not tested and stop acceptance.
- [ ] **Step 4: Run green check.** `npm run test:e2e -- tests/e2e/library-storage.spec.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: persist approved changes atomically` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task A5: Real library editor and search

**Files:** Create src/app/library/page.tsx, src/features/library/LibraryWorkspace.tsx, ConceptEditor.tsx, ExpressionList.tsx, tests/e2e/library-ui.spec.ts; update src/app/page.tsx.

**Interfaces:** Consumes listLibrary/findExpressions/proposeChange/approveChange/applyChange; UI only calls use cases.

- [ ] **Step 1: Write failing assertions.** Actual empty database displays 'Your terminology library is empty'; create English-only TNF-α, add tr form, reload and find both; create two concepts with PD, both visible; cancel preview leaves snapshot unchanged; stale edit from second view fails with message; denied storage shows error and cannot save; keyboard labels and focus after invalid form; no fake rows after empty DB reset.
- [ ] **Step 2: Run red check.** `npm run test:e2e -- tests/e2e/library-ui.spec.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Accessible concept and expression views, actual create/edit/add form and explicit user-confirmation assertion, preview and confirm, search/filter language, clear errors/loading/empty states. No unsupported deletes, merge, automatic translation, AI or fake counters. Stable local revision on refresh.
- [ ] **Step 4: Run green check.** `npm run test:e2e -- tests/e2e/library-ui.spec.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: deliver working bilingual library` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.

## S1a stop gate
Run npm run typecheck, npm run test, npm run test:e2e, npm run build; review diff and selected dependencies. Commit/export dedicated checkpoint. Record actual evidence; if AI Studio cannot run, Codex validates exported code. S1b only after S1a regression and owner-authorized continuation. No private data.
