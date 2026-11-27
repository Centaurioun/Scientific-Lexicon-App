# WP01 Implementation Ledger — TermForge S1 Core Application

**Repository:** `Centaurioun/Scientific-Lexicon-App`  
**Baseline commit:** `40045aa056cd0033a8c2d4586ee9f8f5fa703230`  
**Execution Date:** 2026-11-26 to 2026-11-27  
**Execution Order:** A1 → A2 → A3 → A4 → A5 → B1 → B2 → B3 → B4 → B5 → C1 → C2 → C3 → C4 → C5  
**Current Checkpoint:** **INTEGRATED WP01 COMPLETE (STOP GATE REACHED — NO WP02 / S2–S7 WORK STARTED)**

**Environment Record:**
- Runtime: Google AI Studio container — Node `v22.23.5`, npm `10.9.9`.
- Dependency graph: Bun-managed `node_modules` (`bun.lock` present); authoritative `package-lock.json` is absent in the AI Studio workspace and was **not** fabricated or regenerated. All 15 qualified direct dependencies/devDependencies in `package.json` remain unchanged at their exact approved versions.
- Git metadata: `.git` is absent inside `/app/applet`; task checkpoints are recorded in this ledger for local Git commit and independent Codex verification upon export.
- Browser verification: Executed live in preinstalled headless Chromium (`/ms-playwright/chrome-headless-shell-linux64`) via `playwright-cli` against `http://localhost:3000`. Native `npm run test:e2e` is `BLOCKED` inside the AI Studio container because `playwright.config.ts` spawns a second `next dev --port 3100` which hits Next.js 16 `.next/dev/lock` against the running AI Studio preview server on port 3000.

---

## Task Progress Summary (A1–C5)

| Task | Phase | Status | Checkpoint Commit Message | Unit / Browser Evidence |
|---|---|---|---|---|
| **A1** | S1a | **DONE** | `feat: establish minimal local workspace` | `tests/unit/dev-launcher.test.ts` (4/4 PASS), `tests/unit/runtime-tooling.test.ts` (1/1 PASS), live Chromium `/` verified |
| **A2** | S1a | **DONE** | `feat: define bilingual canonical record schema` | `tests/unit/schema.test.ts` (5/5 PASS; RED→GREEN) |
| **A3** | S1a | **DONE** | `feat: add approved revision-bound change gateway` | `tests/unit/changes.test.ts` (5/5 PASS; RED→GREEN) |
| **A4** | S1a | **DONE** | `feat: persist approved changes atomically` | `tests/unit/transaction-invariants.test.ts` (1/1 PASS), Chromium IndexedDB harness `tests/browser/storage-harness.ts` (16/16 PASS) |
| **A5** | S1a | **DONE** | `feat: deliver working bilingual library` | Live Chromium `/library` verified (empty state, EN/TR creation, `PD` homonyms, `user-confirmed` protection, case-sensitive search, reload persistence); Playwright spec `tests/e2e/library-ui.spec.ts` authored for Codex |
| **B1** | S1b | **DONE** | `feat: add scientific-aware registered matcher` | `tests/unit/matcher.test.ts` (5/5 PASS vs oracle; RED→GREEN); Playwright spec `tests/e2e/matcher-browser.spec.ts` authored |
| **B2** | S1b | **DONE** | `feat: add local English NLP feature adapter` | `tests/unit/nlp.test.ts` (3/3 PASS; RED→GREEN), acyclic Web Worker split (`wink-core.ts` / `extraction.worker.ts` / `wink-engine.ts`), Playwright spec `tests/e2e/nlp-browser.spec.ts` authored |
| **B3** | S1b | **DONE** | `feat: discover unknown scientific candidates locally` | `tests/unit/extraction.test.ts` (4/4 PASS including sub-symbol regression; RED→GREEN) |
| **B4** | S1b | **DONE** | `feat: deliver candidate review and approval flow` | Live Chromium `/extraction` verified (Wink + Aho–Corasick known/ambiguous/new classification, context pinning, `CD4+` approval); Playwright spec `tests/e2e/extraction-review.spec.ts` authored |
| **B5** | S1b | **DONE** | `feat: protect source text and retention consent` | `tests/unit/retention.test.ts` (2/2 PASS; RED→GREEN), live Chromium session-only reload clear + explicit retain/delete verified; Playwright spec `tests/e2e/retention.spec.ts` authored |
| **C1** | S1c | **DONE** | `feat: add deterministic scientific presentation exports` | `tests/unit/export.test.ts` (2/2 PASS; RED→GREEN), live Chromium CSV preview verified |
| **C2** | S1c | **DONE** | `feat: define portable validated library backup` | `tests/unit/backup.test.ts` (2/2 PASS; RED→GREEN) |
| **C3** | S1c | **DONE** | `feat: restore validated backups atomically into empty library` | `tests/unit/restore-gateway.test.ts` (1/1 PASS; RED→GREEN), Chromium IndexedDB harness `tests/browser/restore-harness.ts` (8/8 PASS) |
| **C4** | S1c | **DONE** | `feat: deliver export and portable recovery workspace` | Live Chromium `/exchange` verified (CSV/backup downloads, invalid file rejection, non-empty restore refusal, empty-context exact SHA-256 restore); Playwright spec `tests/e2e/export-recovery-ui.spec.ts` authored |
| **C5** | S1c | **DONE** | `test: verify first slice and record real-data readiness gaps` | `tests/e2e/first-slice.spec.ts`, `tests/e2e/readiness.spec.ts`, `docs/evaluation/S1-ACCEPTANCE.md`, `docs/evaluation/G4-REAL-DATA-READINESS.md`; live Chromium Round 1 + Round 2 full-slice + two-tab stale write verified |

---

## Detailed Task Records

### A1 — Application shell and test infrastructure
- **Status:** DONE
- **Files:** `scripts/dev.mjs`, `package.json`, `vitest.config.ts`, `src/app/error.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/AppHeader.tsx`, `src/types/ahocorasick.d.ts`, `tests/unit/dev-launcher.test.ts`, `tests/e2e/shell.spec.ts`
- **RED evidence:** `tests/unit/dev-launcher.test.ts` failed 1/4 on stray leading `--` separator passed by `npm run dev -- --port 3100`; fixed in `scripts/dev.mjs`.
- **GREEN evidence:** `tests/unit/dev-launcher.test.ts` 4/4 PASS; `tests/unit/runtime-tooling.test.ts` 1/1 PASS; HTTP 200 on port 3000; Chromium verified only `/`, `/library`, `/extraction`, `/exchange` links exist.
- **Technical decisions:** Preserved `allowedDevOrigins` in `next.config.ts` (development-only) and `"dev": "node scripts/dev.mjs"` in `package.json`. Added `@` -> `./src` alias to `vitest.config.ts` matching `tsconfig.json`.

### A2 — Canonical records and runtime validation
- **Status:** DONE
- **Files:** `src/domain/schema.ts`, `src/domain/repository.ts`, `tests/unit/schema.test.ts`
- **RED → GREEN evidence:** Failing test authored first -> 5/5 PASS in Vitest.
- **Contracts verified:** Independent `Concept` and `Expression` IDs, `en`/`en-US`/`en-GB`/`tr`/`shared`/`undetermined` language states, partial bilingual concepts, exact Unicode/case preservation, duplicate surface forms across distinct concepts (`PD`), `VerificationAssertion` (`user-confirmed`), `Provenance`, `RetainedDocument`, `RetainedRun`, strict JSON-safe validation, referential integrity, concept-must-have-expression invariant, exact UTF-16 retained-span verification, history coherence.

### A3 — Approved change envelope and preview
- **Status:** DONE
- **Files:** `src/domain/changes.ts`, `src/application/library.ts`, `tests/unit/changes.test.ts`
- **RED → GREEN evidence:** 5/5 PASS in Vitest.
- **Contracts verified:** Canonical JSON serialization + Web Crypto SHA-256 digest, `deepFreeze` immutability of proposed payload/preview, strict discriminated operations (`createConcept`, `addExpression`, `editExpression`, `assertExpression`, `retainDocument`, `deleteRetainedDocument`), `buildChangePreview` excludes raw retained document text, pure `evaluateChangeOnSnapshot` enforces revision checks, idempotent replay vs conflicting batch reuse, `user-confirmed` protection on text/language while allowing role edits, and atomic retained-document deletion preserving concepts/expressions.
- **Defect fixed during build:** Split `ApplyResult` union `{ status: 'applied'; revision: number } | { status: 'replay'; revision: number }` for strict TypeScript 7 narrowing.

### A4 — IndexedDB repository and transaction invariants
- **Status:** DONE
- **Files:** `src/adapters/storage/dexie-library.ts`, `tests/unit/transaction-invariants.test.ts`, `tests/browser/storage-harness.ts`, `tests/e2e/library-storage.spec.ts`
- **RED → GREEN evidence:** Unit test 1/1 PASS; live Chromium IndexedDB verification (`tests/browser/storage-harness.ts`) 16/16 assertions PASS (`emptyRevision: 0`, `afterCreateRevision: 1`, `formCountAfterAdd: 2`, `pdConceptCount: 2`, `orphanStatus: "invalid"`, `duplicateIdStatus: "conflict"`, `replayStatus: "replay"`, `conflictStatus: "conflict"`, `staleStatus: "stale"`, `duplicateOpStatus: "conflict"`, `protectedTextStatus: "protected"`, `protectedLanguageStatus: "protected"`, `abortedStatus: "aborted"`, `snapshotUnchangedAfterAbort: true`, `twoConnectionStaleStatus: "stale"`, `persistenceSupport: true`).
- **Defect caught & fixed in Chromium:** Removed redundant `&` prefix on primary keys in Dexie `version(1).stores(...)` (`meta: 'key'`, ..., `audit: 'id, batchId, &opId'`). Zero in-memory fallback if IndexedDB is denied/unavailable.

### A5 — Real library editor and search UI
- **Status:** DONE
- **Files:** `src/app/globals.css`, `src/app/library/page.tsx`, `src/components/ChangeApprovalDialog.tsx`, `src/features/library/ConceptEditor.tsx`, `src/features/library/ExpressionList.tsx`, `src/features/library/LibraryWorkspace.tsx`, `tests/e2e/library-ui.spec.ts`
- **Verification evidence:** Verified live in Chromium Rounds 1 & 2: genuinely empty initial state, EN + TR concept creation through immutable SHA-256 preview modal, `user-confirmed` assertion + `PROTECTED` edit rejection, two distinct `PD` concepts, reload persistence, case-sensitive search (`TNF-α` vs `tnf-α`). Round 1 visual critique caught `Edit`/`Confirm` button wrapping and non-sticky editor panel; fixed and verified in Round 2.

### B1 — Registered scientific term matching
- **Status:** DONE
- **Files:** `src/domain/extraction.ts`, `src/adapters/matching/registered-matcher.ts`, `tests/unit/matcher.test.ts`, `tests/e2e/matcher-browser.spec.ts`
- **RED → GREEN evidence:** 5/5 PASS in Vitest, including R20 parity against `SimpleOracleRegisteredMatcher` across overlapping, scientific-symbol, Greek, hyphenated, and Turkish cases.
- **Contracts verified:** Left/right boundary rule disallowing `[\p{L}\p{M}\p{N}_+]`, provisional hyphenated boundary (`x-TNF-α` -> `possible-new-form`), homonym preservation (`PD` -> `ambiguous`, `resolvedConceptId: null`), `RevisionCachedRegisteredMatcher` invalidation on revision changes.

### B2 — Local English NLP adapter
- **Status:** DONE
- **Files:** `src/adapters/nlp/wink-core.ts`, `src/adapters/nlp/wink-engine.ts`, `src/adapters/nlp/extraction.worker.ts`, `tests/unit/nlp.test.ts`, `tests/e2e/nlp-browser.spec.ts`
- **RED → GREEN evidence:** 3/3 PASS in Vitest.
- **Defects caught & fixed:**
  1. Wink merged `B.` in `NF-κB. CD4+` as an author initial; fixed in `shouldSplitAfterSentencePunct()` in `wink-core.ts`.
  2. Wink split Turkish words at non-ASCII letters (`İltihap`, `ısı`); fixed via `mergeSplitUnicodeWordTokens()` preserving exact UTF-16 slices.
  3. **Build defect caught during `next build`:** Circular Worker graph (`wink-engine.ts` → `extraction.worker.ts` → `wink-engine.ts`) caused Turbopack build hang. Refactored pure Wink logic into `wink-core.ts` so module graph is strictly acyclic (`wink-engine.ts` → `extraction.worker.ts` → `wink-core.ts`), bringing production build time to ~10 seconds.

### B3 — Unknown discovery and unified extraction run
- **Status:** DONE
- **Files:** `src/application/extraction.ts`, `src/features/extraction/read-text.ts`, `tests/unit/extraction.test.ts`
- **RED → GREEN evidence:** 4/4 PASS in Vitest.
- **Contracts verified:** Deterministic `s1-grammar-1` 1–8 token POS noun phrase grammar + bounded scientific symbol spans, never suppresses longer unknown candidates over shorter nested known terms, excludes numeric-only and cross-sentence spans, enforces 2 MiB TXT / 200k UTF-16 caps without truncation, fatal UTF-8 `TextDecoder`, `AbortSignal` cancellation.
- **Round 1 improvement + regression test:** Ordered bounded scientific-symbol scan before POS noun-phrase scan and suppressed strictly-contained sub-fragments inside a single contiguous scientific symbol (eliminating bogus `TNF` inside `TNF-α` and `CD4` inside `CD4+`). Verified in Vitest and live Chromium Round 2.

### B4 & B5 — Extraction review UI, source retention consent, and privacy
- **Status:** DONE
- **Files:** `src/app/extraction/page.tsx`, `src/features/extraction/session-run-store.ts`, `src/features/extraction/SourceContext.tsx`, `src/features/extraction/CandidateTable.tsx`, `src/features/extraction/ExtractionWorkspace.tsx`, `tests/unit/retention.test.ts`, `tests/e2e/extraction-review.spec.ts`, `tests/e2e/retention.spec.ts`
- **Verification evidence:** `tests/unit/retention.test.ts` 2/2 PASS; live Chromium Rounds 1 & 2 verified session-only default (cleared on reload, zero synthetic marker in IndexedDB/backup/requests/logs), explicit opt-in retain + atomic delete preserving concepts, sticky `SourceContext` panel, and explicit pre-G5 unvalidated ATE disclosure.

### C1 — Deterministic presentation exports
- **Status:** DONE
- **Files:** `src/application/exchange.ts`, `tests/unit/export.test.ts`
- **RED → GREEN evidence:** 2/2 PASS in Vitest.
- **Contracts verified:** Deterministic UTF-16 binary alphabetical sort + descending frequency (`null` last), CSV formula-injection neutralization (including leading whitespace) + RFC 4180 comma/quote escaping without mutating stored terminology, Markdown pipe escaping, `termforge-export` v1 JSON distinct from backups, unresolved `conceptId: null`, zero invented translations.

### C2 — Complete portable backups
- **Status:** DONE
- **Files:** `src/domain/backup.ts`, `tests/unit/backup.test.ts` (re-exported in `src/application/exchange.ts`)
- **RED → GREEN evidence:** 2/2 PASS in Vitest.
- **Contracts verified:** `termforge-backup` v1 envelope + canonical SHA-256 digest over complete persisted `LibrarySnapshot`; rejects wrong digest/version, duplicate IDs, orphan expressions, invalid retained spans, corrupt history/revisions, unknown fields, and presentation exports without mutating state.

### C3 — Controlled empty-target atomic restore
- **Status:** DONE
- **Files:** `src/domain/repository.ts`, `src/application/library.ts`, `src/adapters/storage/dexie-library.ts`, `tests/unit/restore-gateway.test.ts`, `tests/browser/restore-harness.ts`, `tests/e2e/restore.spec.ts`
- **RED → GREEN evidence:** Unit test 1/1 PASS; live Chromium IndexedDB verification (`tests/browser/restore-harness.ts`) 8/8 assertions PASS (`exactSnapshotMatch: true`, `nonEmptyRestoreStatus: "conflict"`, `wrongApprovalStatus: "invalid"`, `abortRestoreStatus: "aborted"`, `targetStillEmptyAfterAbort: true`, `concurrentSuccessCount: 1`, `concurrentConflictCount: 1`, `matcherInvalidatedAfterRestore: true`).

### C4 — Export and recovery workspace UI
- **Status:** DONE
- **Files:** `src/app/exchange/page.tsx`, `src/features/exchange/ExportWorkspace.tsx`, `src/features/exchange/BackupPanel.tsx`, `tests/e2e/export-recovery-ui.spec.ts`
- **Verification evidence:** Verified live in Chromium Rounds 1 & 2: deterministic CSV preview & download, complete backup download, invalid backup file error without mutation, non-empty restore refusal (`CONFLICT`), empty-context atomic restore producing bit-for-bit identical SHA-256 backup digest, storage persistence status + origin-isolation warning.

### C5 — Integrated G3 verification and G4 readiness evidence
- **Status:** DONE
- **Files:** `tests/e2e/first-slice.spec.ts`, `tests/e2e/readiness.spec.ts`, `docs/evaluation/S1-ACCEPTANCE.md`, `docs/evaluation/G4-REAL-DATA-READINESS.md`
- **Verification evidence:** Live Chromium Round 2 verified complete G3 journey (empty app → EN/TR creation → user-confirmed guard → homonyms → extraction → `CD4+` approval → session-only reload clear → CSV export → backup → isolated empty-context exact SHA-256 restore) plus two-tab simultaneous stale-write rejection (one succeeds, second fails closed with `STALE`) and zero console errors / zero external network calls / zero synthetic marker leaks.

---

## Remaining Blockers & Codex Handoff
1. **Authoritative lockfile dependency gate (`npm run test:gate`)** — `BLOCKED` in AI Studio (3/4 fail because `package-lock.json` is absent in container; check 4/4 passes). Must be run in Codex local repo with authoritative `package-lock.json`.
2. **Native Playwright E2E runner (`npm run test:e2e`)** — `BLOCKED` in AI Studio (Next.js 16 `.next/dev/lock` conflicts with port 3000 dev server). All 10 Playwright specs under `tests/e2e/` are written, alert-scoped against `__next-route-announcer__`, typechecked, and ready for independent Codex execution.
3. **G4 Real-Data Readiness** — `NOT READY / BLOCKED` (see `docs/evaluation/G4-REAL-DATA-READINESS.md`).
4. **G5 Scientific Accuracy** — `NOT ESTABLISHED` (pre-G5 unvalidated ATE).
5. **Next Incomplete Task:** None within WP01. Stop at integrated WP01 checkpoint for independent Codex review and owner approval before any merge or WP02/S2–S7 planning.
