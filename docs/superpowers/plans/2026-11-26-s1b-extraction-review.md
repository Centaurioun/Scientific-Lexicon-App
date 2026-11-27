# S1b — Extraction and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local English scientific candidates and known-form recognition to S1a.

**Architecture:** Independent known matcher and unknown generator feed one occurrence model, with explicit human review and local session state; persisted source optional.

**Tech Stack:** S1a stack plus exact qualified Wink pair and R20; Worker if qualified.

**Spec:** [Master Design Baseline v1.0](../../architecture/MASTER-DESIGN-BASELINE-v1.0.md). [S1 contracts](../../specifications/S1-IMPLEMENTATION-CONTRACTS-v0.1.md) where applicable.

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
