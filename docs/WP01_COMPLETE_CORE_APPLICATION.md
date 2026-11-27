# WP01 — Complete Core Application

> **Status: READY TO EXECUTE — G2 ACCEPTED WITH BOUNDED LIMITATIONS.** See `qualification/G2-ACCEPTANCE.md`. The A1 shell and test infrastructure are bootstrapped in this repository; re-run A1's checks and create its task checkpoint, then continue in order. Use the qualified app lock, preserve the documented preview configuration, and keep the remaining AI Studio runner limits visible. This is not G3, G4, or real-data approval.

**Goal:** Deliver the complete synthetic-only S1 core application by executing S1a, S1b and S1c as one ordered work package.

**Approved source snapshot:** `Centaurioun/Scientific-Lexicon-Lab` commit `438da22aedcaa0eb51a8f5b49d249a0dd1d65c3a`; the authoritative source documents are included under this repository's `docs/` tree.

**Architecture:** Use the approved Next.js App Router, React and TypeScript shell with a pure domain layer, one validation/schema authority, one application change gateway, and a Dexie browser adapter. Keep canonical persistence local, and keep session-only extraction, explicit retention, presentation exports and full backups distinct.

**Execution order:** A1 → A2 → A3 → A4 → A5 → B1 → B2 → B3 → B4 → B5 → C1 → C2 → C3 → C4 → C5. Do not reorder tasks or skip their acceptance criteria.

**Execution cadence:** AI Studio may execute the package continuously without asking the owner to approve each minor task. Keep each task's failing test, green test and checkpoint. Stop for a failed task, a material change to approved semantics/privacy/architecture, an unresolved dependency qualification, or a stage stop-gate failure. No automatic merge.

## Entry checks (before A1)

1. Confirm the bounded G2 acceptance record covers S0 commit `7608522a8e4a5dae4c535013e3cd5c58717aae91`, source ID `sha256-03859df6ccaefa7cf0f82fcd793e40a691f1cc1f6ac093fa124d98f325c10100`, and the limits in `qualification/G2-ACCEPTANCE.md`.
2. Use this dedicated private application repository, created from approved documentation rather than the disposable S0 dashboard or its databases. Keep the production library empty and do not add user terminology data.
3. Qualify exact versions and full npm lock graph before adoption. Reuse the S0-qualified pins for Next.js, React, TypeScript, Wink, the English model, Aho–Corasick, Dexie and Playwright. Qualify Zod (runtime schema validation) and Vitest (unit test runner) separately for exact version, transitive graph, registry integrity, license/NOTICE, security advisories, scripts and intended Node/browser runtime. No silent substitution. No Tailwind, Testing Library or extra UI dependencies without a documented need and the same qualification.
4. Preserve npm's `package-lock.json` as the controlled source for local builds and exports. Do not substitute an absent or empty Bun lock. If AI Studio regenerates its own lock, keep that separate from the canonical npm lock and record the actual graph; do not claim equivalence without evidence.
5. Install with lifecycle scripts disabled for initial qualification; inspect scripts before permitting any lifecycle execution. Keep `npm run test`, `npm run test:e2e`, `npm run typecheck`, and `npm run build` reproducible.

## Global constraints

- Synthetic fixtures only. No real terminology, manuscripts, credentials, telemetry, external corpus, AI runtime, cloud storage/database, account/auth or server-side text processing.
- App Router client boundary only for the workspace. No server actions or API routes for text or the database.
- Production library starts empty. No S0 dashboard, probe databases or temporary verification code in the application.
- Persist only JSON-safe DTOs; use the contract schema and exact language/role enums. Preserve Unicode, case, source spans and concept identity. Never infer synonymy, translation or scientific verification.
- All canonical writes flow through the explicit proposal/approval/application gateway. Fail closed on invalid, stale, conflicting, protected or aborted updates.
- No raw document text in URLs, logs, batch metadata or audit. Source retention is explicit; source deletion clears source/run records and references atomically.
- Keep exports as projections; keep validated backups as full persisted snapshots. Restore only into a truly empty isolated target, rechecking inside one transaction.
- G3 acceptance and G4 real-data readiness remain separate. Do not ingest personal or research data before G4 and S3 safeguards.
- Preserve accessibility requirements, status clarity and exact acceptance tests. Never weaken tests to obtain a pass.

## Cross-package dependency flow

- A1 sets up the shell and test commands; A2 defines schema contracts; A3 defines immutable changes and approvals; A4 implements the Dexie repository; A5 adds the editor and search.
- B1 consumes the library schema/snapshot and creates the literal matcher; B2 adapts the NLP engine; B3 produces a unified extraction run; B4 turns explicit review into change proposals; B5 governs retention and source deletion.
- C1 consumes snapshots/runs for deterministic exports; C2 defines the validated backup; C3 adds restore through the existing gateway; C4 exposes export/recovery UI; C5 verifies G3 and separately records G4 readiness.
- Exact types and APIs in `specifications/S1-IMPLEMENTATION-CONTRACTS-v0.1.md` take precedence over informal descriptions below.

## Six-Cycle refinement record

1. **Intent and scope:** deliver the useful first slice—empty local library, approved edits, extraction review, export and recovery—without adding later S2–S7 work or real data.
2. **Architecture and semantics:** preserve concept/expression identities; use one schema, write gateway and storage adapter; keep candidate review distinct from verification and source retention.
3. **Evidence and reuse:** reuse P0, G1 and S0 evidence; do not repeat broad research. Keep exact existing qualified package versions. Qualify only required additions (Zod and Vitest) before adoption.
4. **Failure and integrity:** test idempotent replay, conflicts, stale revisions, protected values, atomic rollback, one consistent snapshot, exact backup checks and concurrent empty-target restore.
5. **Efficiency and delivery:** run A, B and C tasks sequentially with one task-local red/green checkpoint each; no per-minor-task owner approval, no wasted repetition of completed research.
6. **Challenge and reconcile:** G2 is accepted for the stated AI Studio preview/source and bounded lock evidence; native AI Studio npm and Playwright limitations remain explicit. This enables synthetic-only WP01 work, not G3/G4 or real-data use.

## Integrated task plan

The following three approved plans are reproduced in full, preserving all 15 engineering tasks, each task's files, interfaces, acceptance assertions, red/green commands, checkpoint message, cross-task dependencies and stage gates.

**Execution authorization clarification:** The owner has now requested these three plans as a single WP01 and explicitly directed that the agent not request approval after every minor task. Treat each task checkpoint as an internal engineering control, not a human approval pause. The G2 entry gate, task tests and stage stop-gates remain mandatory. If the source plans say “plan review pending,” that is superseded for the scope of this integrated WP01; it does not waive G2 or authorize merge, real data or scope changes.

# S1a — Foundation and Bilingual Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real empty local concept library with approved writes and search.

**Architecture:** Use a small App Router client workspace, pure domain schemas and one Dexie repository adapter. All canonical mutations use application gateway.

**Tech Stack:** Confirmed S0 stack, Dexie 4.4.7, Zod candidate, Vitest, Playwright.

**Spec:** [Master Design Baseline v1.0](architecture/MASTER-DESIGN-BASELINE-v1.0.md). [S1 contracts](specifications/S1-IMPLEMENTATION-CONTRACTS-v0.1.md) where applicable.

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
# S1b — Extraction and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local English scientific candidates and known-form recognition to S1a.

**Architecture:** Independent known matcher and unknown generator feed one occurrence model, with explicit human review and local session state; persisted source optional.

**Tech Stack:** S1a stack plus exact qualified Wink pair and R20; Worker if qualified.

**Spec:** [Master Design Baseline v1.0](architecture/MASTER-DESIGN-BASELINE-v1.0.md). [S1 contracts](specifications/S1-IMPLEMENTATION-CONTRACTS-v0.1.md) where applicable.

Status: REVIEWABLE PLAN — design approved, execution pending owner plan approval and predecessor gates. File paths are planned, not existing product code.

## Global Constraints
- Approved v1.0 §12–15 govern; no automatic merge; synthetic data only until G4 and S3 safeguards; no real seed, credentials, telemetry, server transmission, AI runtime, account or external corpus. Production library starts empty.
- Next.js App Router, React, TypeScript conditional on G2; selected exact candidates wink-nlp@2.4.0, wink-eng-lite-web-model@1.8.1, ahocorasick@1.0.2, dexie@4.4.7 subject to G1/G2; no R21. Other package versions selected and recorded before use. Do not substitute silently.
- Domain independent of vendor/framework. Original scientific Unicode, case, numbers, punctuation and source spans preserved. EN/TR/shared forms; no forced concept merge, invented translation or verified scientific claim.
- All master writes use approved change gateway; fail closed; no raw import; portable backup separate from presentation exports. No fake screens or unimplemented routes. No new product-wide license.
- Actual execution and commits only after plan approval. Use isolated project/worktree and exact Git base. If AI Studio cannot execute a command, record NOT TESTED, export code, and let Codex run it locally. Do not claim pass from generated UI or prose.

## Review Focus
- Unicode, digit and plus boundary mistakes (B1/B2).
- Empty library or nested candidate suppression (B3).
- Stale index after edits and ambiguous PD (B1/B4).
- Oversize/invalid TXT, crossed sentences, cancellation (B3/B4).
- Session-only manuscript leaks through logs/history or deletion (B5).

---
## Precondition
S1a verified checkpoint, approved continuation and qualified browser packages. Preserve all existing functions. Use contracts; scientific accuracy remains unvalidated until G5.
### Task B1: Registered matching and index invalidation

**Files:** Create src/domain/extraction.ts, src/adapters/matching/registered-matcher.ts, tests/unit/matcher.test.ts, tests/e2e/matcher-browser.spec.ts.

**Interfaces:** Produces RegisteredMatcher.match(text,expressions):Promise<Occurrence[]>; index cache keyed by library revision/policy in application wrapper; R20 and simple oracle same outputs.

- [ ] **Step 1: Write failing assertions.** expect(ids(scan('IL-11 IL-1'))).toEqual(['il11','il1']); no CD4+ inside CD4++; PD => one span two candidate concepts, unresolved; nested PDL/PDLSC retained; αTNF-α and TNF-αβ rejected; emoji prefix start=3 for '🧪 TNF-α'; p53 != P53; Turkish İ/ı, combining marks literal; x-TNF-α candidate unresolved; after revision change no stale result. Compare sorted/grouped outputs identical to oracle; empty patterns rejected.
- [ ] **Step 2: Run red check.** `npm run test -- tests/unit/matcher.test.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** R20 wraps inclusive end+1, Unicode boundary policy and exact raw slice, maps same keys to multiple expression IDs, group spans and stable sort. Run browser parity and equivalent full-output benchmark in tests/e2e/matcher-browser.spec.ts, measure build/scan/heap where available, use worker or explicit safe limit. No automatic semantic resolution. Store only derived cache, invalidate on revision.
- [ ] **Step 4: Run green check.** `npm run test -- tests/unit/matcher.test.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: add scientific-aware registered matcher` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task B2: Local English feature adapter

**Files:** Create src/adapters/nlp/wink-engine.ts, tests/unit/nlp.test.ts, tests/e2e/nlp-browser.spec.ts.

**Interfaces:** Produces NlpEngine.analyze(text):Promise<Token[]>; tokens use canonical POS and sentenceId, original offsets.

- [ ] **Step 1: Write failing assertions.** assert tokens.every(t=>text.slice(t.start,t.end)===t.surface); monotonic valid nonempty offsets; sentence separation; TNF-α, NF-κB, CD4+, Greek, emoji and Turkish surface preservation; thrown offset mismatch => rejected analysis; browser no network model download.
- [ ] **Step 2: Run red check.** `npm run test -- tests/unit/nlp.test.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Use public Wink API and exact engine/model; align token spans by sequential exact reconstruction, explicit gap validation, fail if cannot reconstruct; no private internal its.js path; keep raw symbols for separate grammar; browser test actual bundle/worker and report limits.
- [ ] **Step 4: Run green check.** `npm run test -- tests/unit/nlp.test.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: add local English NLP feature adapter` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task B3: Unknown discovery and unified run

**Files:** Create src/application/extraction.ts, src/features/extraction/read-text.ts, tests/unit/extraction.test.ts.

**Interfaces:** Produces readTxt(file):Promise<string>, CandidateGenerator.generate, analyzeText, selectCandidates per contracts; current run local state.

- [ ] **Step 1: Write failing assertions.** With empty library and fixture 'Periodontal ligament stem cells express TNF-α.' expect candidate surfaces include 'Periodontal ligament stem cells' and 'TNF-α' (using fixed synthetic token fixture); no numeric-only span; no cross-sentence; known nested 'periodontal ligament' not suppress longer candidate; all exact slices; oversize >2MiB or >200k UTF16 rejected, invalid UTF8 rejected, no silent truncation; duplicates same span grouped.
- [ ] **Step 2: Run red check.** `npm run test -- tests/unit/extraction.test.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Implement versioned deterministic grammar from contracts, bounded raw symbol recognition, independent unknown generation then union/dedup; preserve all candidate IDs/ambiguity; literal known-form not proof; review state separate. Use TextDecoder fatal UTF-8 for TXT, reject invalid input and clear error; cancel/stale run guards.
- [ ] **Step 4: Run green check.** `npm run test -- tests/unit/extraction.test.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: discover unknown scientific candidates locally` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task B4: Review workflow

**Files:** Create src/app/extraction/page.tsx, src/features/extraction/ExtractionWorkspace.tsx, CandidateTable.tsx, SourceContext.tsx, tests/e2e/extraction-review.spec.ts; update navigation.

**Interfaces:** Consumes analyzeText, selectCandidates, proposeChange/applyChange, current snapshot; review intent creates proposal or session reject/resolve.

- [ ] **Step 1: Write failing assertions.** Paste/TXT analyze with empty library yields candidates; select one shows exact context; reject leaves canonical DB unchanged; approve new concept or link explicit new form creates exact one approved change; PD ambiguous cannot auto resolve; stale library revision forces reanalysis or new preview; cancel in-flight input discards old result; known/new filter does not alter source or occurrences; keyboard accessible controls.
- [ ] **Step 2: Run red check.** `npm run test:e2e -- tests/e2e/extraction-review.spec.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Build real split workspace with source text and candidate rows, explicit choices create/link/reject/resolve existing, count occurrence/concept/expression separately, no invented confidence or AI. Session resolution distinct from persistent evidence. Use local-only processing and error/cancel state.
- [ ] **Step 4: Run green check.** `npm run test:e2e -- tests/e2e/extraction-review.spec.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: deliver candidate review and approval flow` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.
### Task B5: Source retention and deletion

**Files:** Modify src/domain/schema.ts, changes.ts, src/adapters/storage/dexie-library.ts, src/features/extraction/ExtractionWorkspace.tsx; create tests/e2e/retention.spec.ts.

**Interfaces:** Consumes RetainedDocument/Run and provenance contracts; produces explicit retain/delete commands through same gateway.

- [ ] **Step 1: Write failing assertions.** Analyze text containing marker 'PRIVATE-SYNTHETIC-123' outside the accepted term and save concept only => no document/run text or source pointer in snapshot, audit, batch or network; reload clears session; explicit retain stores correct span and source; delete retained source removes document/run and clears source pointers in same transaction; concept preserved; prior downloaded backup cannot be revoked message; failure rollback all stores; no raw text in logs.
- [ ] **Step 2: Run red check.** `npm run test:e2e -- tests/e2e/retention.spec.ts` — expect the new assertion to fail for absent behavior, not unrelated setup error.
- [ ] **Step 3: Implement minimal behavior.** Session-only default, explicit consent before retain, clear/delete actions, source metadata only when valid retained run; delete source clears derived cache and references; digest/audit metadata only, no raw payload log. Test via snapshot and network assertions. No production private inputs.
- [ ] **Step 4: Run green check.** `npm run test:e2e -- tests/e2e/retention.spec.ts` — all targeted assertions pass. Run earlier regression tests; record actual output and exit status. If unavailable, record BLOCKED/NOT TESTED and transfer to Codex.
- [ ] **Step 5: Checkpoint.** Commit only this task and its tests with message `feat: protect source text and retention consent` after diff review; if AI Studio cannot commit, export checkpoint for local commit. No merge.

## S1b stop gate
Run B1–B5 and all S1a tests, typecheck/build. Report actual selected package use, real browser results and limitations. Check performance with equivalent output; do not advertise validated ATE precision. Export/commit checkpoint, then proceed S1c only after acceptance.
# S1c — Export and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete first slice with deterministic presentation exports and independently verifiable portable backup/restore.

**Architecture:** Separate export projections from complete persisted snapshot; restore only into truly empty target through controlled gateway.

**Tech Stack:** S1a/S1b stack; native Blob and Web Crypto; no extra file library required.

**Spec:** [Master Design Baseline v1.0](architecture/MASTER-DESIGN-BASELINE-v1.0.md). [S1 contracts](specifications/S1-IMPLEMENTATION-CONTRACTS-v0.1.md) where applicable.

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
