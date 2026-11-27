# S1 Acceptance Evaluation Report — Gate G3 (Synthetic First Slice)

**Application:** TermForge (`Centaurioun/Scientific-Lexicon-App`)  
**Baseline Commit:** `40045aa056cd0033a8c2d4586ee9f8f5fa703230`  
**Work Package:** WP01 — Complete Core Application Implementation (S1a A1–A5, S1b B1–B5, S1c C1–C5)  
**Evaluation Date:** 2026-11-27  
**Authoring Environment:** Google AI Studio container (Node `v22.23.5`, npm `10.9.9`, Bun-managed `node_modules`, preinstalled headless Chromium via `playwright-cli`)

---

## 1. G3 Acceptance Recommendation

**Verdict: CONDITIONAL PASS (Synthetic First Slice Implemented & Live-Chromium Verified) — PENDING INDEPENDENT CODEX LOCAL VERIFICATION (`npm run test:gate` + `npm run test:e2e`) BEFORE MERGE**

- All 15 WP01 tasks (A1–C5) are implemented against `MASTER-DESIGN-BASELINE-v1.0.md` and `S1-IMPLEMENTATION-CONTRACTS-v0.1.md`.
- All 12 Vitest unit test suites (35/35 tests), TypeScript strict typecheck (`tsc --noEmit`), and Next.js 16 Turbopack production build (`npm run build`) **PASS** after the final code edit.
- All browser-real IndexedDB invariants (A4 16/16 assertions, C3 8/8 assertions) and the complete G3 end-to-end UI journey (empty library → EN/TR creation → `user-confirmed` protection → homonym preservation → local English extraction → approval → session-only privacy → opt-in retention/deletion → CSV/MD/TXT/JSON presentation exports → SHA-256 backup → isolated empty-context exact snapshot restore → two-tab stale write rejection) **PASS** in live headless Chromium via `playwright-cli` with zero console errors, zero external requests, and zero leaked synthetic document markers.
- **Why CONDITIONAL rather than UNCONDITIONAL:** In the AI Studio container, authoritative `package-lock.json` is absent (blocking `npm run test:gate` lockfile assertions 1–3) and the running port-3000 dev server holds `.next/dev/lock` (blocking native `npm run test:e2e` on port 3100). Per `AGENTS.md` and `G2-ACCEPTANCE.md`, native npm gate and Playwright runner passes are **not** claimed from AI Studio and must be confirmed by independent Codex execution in the local repository before any merge decision.

**Boundary Separations (Strictly Preserved):**
- **G4 Real-Data Readiness:** Assessed separately in `docs/evaluation/G4-REAL-DATA-READINESS.md` (**NOT READY / BLOCKED**). Synthetic G3 completion does **not** authorize real personal manuscripts or legacy data use.
- **G5 Scientific Accuracy:** **NOT ESTABLISHED**. Extraction output is explicitly labeled pre-G5 unvalidated ATE.
- **S2–S7 Scope:** Not implemented. No Phrasebank, AI runtime, bulk import, concept merge, destructive delete of concepts/expressions, or Turkish NLP routes exist.

---

## 2. Architecture & Contract Compliance Matrix

| Contract / Invariant | Authority | Implementation | Verification Status |
|---|---|---|---|
| Local-first browser-only processing & IndexedDB (no server text/DB, no AI/cloud/auth/analytics) | Baseline §3–6, §12 | Pure client components + Dexie 4.4.7 + local Wink NLP Web Worker + Aho–Corasick; zero `app/api/*` routes or server actions | **PASS** (code audit + Chromium network monitor: 0 external requests) |
| Production library starts genuinely empty; synthetic fixtures only | Baseline §12 | Empty IndexedDB rev 0 initializes cleanly; zero real data or seeds | **PASS** (Chromium empty-DB check) |
| Independent `Concept` and `Expression` identities; EN/TR/shared/undetermined; partial bilingual records; homonyms (`PD`) allowed | Contracts §1–2 | `src/domain/schema.ts` Zod v4 authority | **PASS** (`schema.test.ts` + Chromium `/library`) |
| Exact scientific Unicode, case, numbers, punctuation, and UTF-16 half-open spans preserved | Contracts §1, §5 | No case-folding or normalization on stored forms; exact `text.slice(start, end) === surface` | **PASS** (`schema.test.ts`, `matcher.test.ts`, `nlp.test.ts`, `extraction.test.ts`, Chromium) |
| Single approved revision-bound write gateway (`proposeChange` → `approveChange` → `applyChange`) with SHA-256 digest & immutable preview | Contracts §3–4 | `src/domain/changes.ts`, `src/application/library.ts`, `src/components/ChangeApprovalDialog.tsx` | **PASS** (`changes.test.ts`, `transaction-invariants.test.ts`, Chromium) |
| Fail-closed Dexie multi-store transactions (stale, conflict, replay, duplicate op, orphan, protected, abort rollback; no in-memory fallback) | Contracts §4 | `src/adapters/storage/dexie-library.ts` | **PASS** (Chromium `storage-harness.ts` 16/16 + `library-ui.spec.ts`) |
| Registered scientific matching with R20 oracle parity, scientific boundaries, provisional hyphen handling, homonym ambiguity | Contracts §5 | `src/adapters/matching/registered-matcher.ts`, `src/domain/extraction.ts` | **PASS** (`matcher.test.ts` 5/5 vs oracle + Chromium) |
| Local English NLP adapter with monotonic UTF-16 offset reconstruction, abortable Web Worker, no external model download | Contracts §5 | `src/adapters/nlp/wink-core.ts`, `extraction.worker.ts`, `wink-engine.ts` | **PASS** (`nlp.test.ts` 3/3 + acyclic Turbopack build + Chromium) |
| Unknown discovery (`s1-grammar-1`), 2 MiB / 200k strict limits, fatal UTF-8 decode, no silent truncation | Contracts §5 | `src/application/extraction.ts`, `src/features/extraction/read-text.ts` | **PASS** (`extraction.test.ts` 4/4 + Chromium) |
| Session-only source text default; explicit opt-in local retention; atomic retained-source deletion preserving concepts | Contracts §6 | `src/features/extraction/session-run-store.ts`, `ExtractionWorkspace.tsx`, `changes.ts` | **PASS** (`retention.test.ts` 2/2 + Chromium Round 1 & 2) |
| Deterministic presentation exports (TXT/MD/CSV/JSON), CSV formula-injection protection, UTF-16 sort, `null`-last frequency, no invented TR | Contracts §7 | `src/application/exchange.ts` | **PASS** (`export.test.ts` 2/2 + Chromium) |
| Complete SHA-256 portable backup (`termforge-backup` v1) separate from exports; strict validation rejecting corrupt/export files | Contracts §8 | `src/domain/backup.ts` | **PASS** (`backup.test.ts` 2/2 + Chromium) |
| Controlled atomic empty-target restore (`restoreEmpty`); refuses non-empty target; rolls back on abort; concurrent race at most 1 succeeds; matcher cache invalidated | Contracts §8 | `src/adapters/storage/dexie-library.ts`, `src/application/library.ts` | **PASS** (`restore-gateway.test.ts` + Chromium `restore-harness.ts` 8/8 + empty-context UI restore) |
| Dev launcher compatibility (AI Studio `--host` & Playwright `-- --port 3100`) & preserved `allowedDevOrigins` | WP01 §2, `AGENTS.md` | `scripts/dev.mjs`, `package.json`, `next.config.ts` | **PASS** (`dev-launcher.test.ts` 4/4 + port 3000 HTTP 200) |

---

## 3. Actual Verification & Test Matrix

| Check / Command | Status | Exact Evidence |
|---|---|---|
| `npm run test` (`vitest run`) | **PASS** | 12/12 test files, 35/35 unit tests passed (`dev-launcher`, `runtime-tooling`, `schema`, `changes`, `transaction-invariants`, `matcher`, `nlp`, `extraction`, `retention`, `export`, `backup`, `restore-gateway`). |
| `npm run typecheck` (`tsc --noEmit`) | **PASS** | Exit code 0; zero TypeScript errors across `src/`, `tests/`, and `scripts/`. |
| `npm run build` (`next build` / `compile_applet`) | **PASS** | Next.js 16.4.6 Turbopack production build succeeded cleanly (~10s after splitting `wink-core.ts` to eliminate circular Worker bundling). |
| `playwright-cli` Chromium A4 IndexedDB harness (`tests/browser/storage-harness.ts`) | **PASS** | 16/16 real Chromium IndexedDB transaction, concurrency, replay, protection, and abort-rollback assertions passed. |
| `playwright-cli` Chromium C3 Restore harness (`tests/browser/restore-harness.ts`) | **PASS** | 8/8 real Chromium IndexedDB atomic restore, non-empty conflict, wrong digest, abort rollback, concurrent restore race, and matcher invalidation assertions passed. |
| `playwright-cli` Chromium Round 1 + Round 2 live full-slice UI & two-tab verification | **PASS** | Verified `/`, `/library`, `/extraction`, `/exchange` at 1440×900: empty init, EN/TR creation, `user-confirmed` rejection, `PD` homonyms, local Wink + Aho–Corasick extraction, `CD4+` concept creation, session-only clear on reload, opt-in retain/delete, CSV preview, backup download, invalid file rejection, non-empty restore refusal, isolated empty-context exact SHA-256 restore, two-tab stale write rejection; 0 console errors, 0 page errors, 0 external network requests, 0 synthetic marker leaks. |
| `npm run test:gate` (`scripts/dependency-gate.test.mjs`) | **BLOCKED** | 1/4 PASS (direct dependency entry points resolve), 3/4 FAIL because authoritative `package-lock.json` is absent in the AI Studio container (`bun.lock` is used by AI Studio). Must be executed locally by Codex against canonical `package-lock.json`. |
| `npm run test:e2e` (`playwright test`) | **BLOCKED** | Blocked in AI Studio container because Next.js 16 enforces `.next/dev/lock` while AI Studio's preview server runs on port 3000. All 10 specs in `tests/e2e/` (`shell`, `library-storage`, `library-ui`, `matcher-browser`, `nlp-browser`, `extraction-review`, `retention`, `restore`, `export-recovery-ui`, `first-slice`, `readiness`) are authored and ready for Codex local execution. |
| `npm run lint` (`lint_applet`) | **NOT CONFIGURED** | Starter `package.json` defines no `lint` script (`dev`, `build`, `start`, `typecheck`, `test`, `test:gate`, `test:e2e` only). |

---

## 4. Dependency & Environment Reconciliation

- **`package.json` integrity:** Unchanged 5 runtime dependencies (`ahocorasick@1.0.2`, `dexie@4.4.7`, `wink-eng-lite-web-model@1.8.1`, `wink-nlp@2.4.0`, `zod@4.6.7`) and 10 devDependencies (`@playwright/test@1.65.1`, `@types/node@26.6.11`, `@types/react@19.3.3`, `@types/react-dom@19.3.0`, `next@16.4.6`, `react@19.3.1`, `react-dom@19.3.1`, `typescript@7.0.2`, `vite@8.4.0`, `vitest@5.1.2`). Zero unauthorized packages added.
- **Lockfile authority:** `package-lock.json` was NOT fabricated inside AI Studio. Upon export to local Git, `npm ci` + `npm run test:gate` against the repository's authoritative `package-lock.json` remains the binding dependency verification.
- **Dev server compatibility:** `scripts/dev.mjs` translates AI Studio's `--host` flag to Next.js `--hostname` and strips any stray leading `--` from `npm run dev -- --port 3100`, keeping both AI Studio preview and local Playwright `webServer` operational.

---

## 5. Known Limitations & Codex Handoff Checklist

1. **Pre-G5 Extraction Recall/Precision:** `wink-eng-lite-web-model` occasionally tags domain-ambiguous words like `"stem"` as `VERB` in `"Periodontal ligament stem cells"`, so scientific recall/precision is explicitly unvalidated until G5 evaluation on domain benchmarks.
2. **No S2–S7 Workflows:** Phrasebank, AI assistance, legacy bulk import, concept merge, destructive delete of concepts/expressions, and Turkish NLP are intentionally absent.
3. **Independent Codex Verification Commands (Run Locally Before Merge):**
   ```bash
   npm ci
   npm run test:gate
   npm run typecheck
   npm run test
   npm run build
   npm run test:e2e
   ```
4. **Git & Review Discipline:** Review complete diff, verify no secrets or real data exist, keep commits organized per WP01 ledger checkpoints, and obtain owner approval prior to merging or opening WP02 / G4 drills.
