# WP01 Independent Engineering Review and Qualification

**Application:** TermForge (`Centaurioun/Scientific-Lexicon-App`)
**Reviewed branch:** `codex/wp01-independent-verification`
**Exact reviewed source commit:** `9379062c5554839286bfb6165ee348358157a1a8`
**Qualified starter:** `40045aa056cd0033a8c2d4586ee9f8f5fa703230`
**Qualification date:** 2026-11-27
**Data boundary:** Synthetic fixtures only. No manuscripts, personal term lists, or production data were used.

## Executive verdict

**G3 synthetic application correctness: NOT QUALIFIED.** The browser-backed functional suite is green after remediation, but the approved S1 limit requirement is not fully met. Input byte/character caps are fixed constants (though rejected-input messages display the limit), no candidate-count limit/configuration exists, and the backup cap is normally surfaced only when an oversized backup is attempted. No numeric candidate-count bound was approved, so this review did not invent one. G3 can be reconsidered after the limit behavior is configured and shown as required, candidate count receives an owner-approved bound with explicit reject/cancel behavior, and the backup size limitation is surfaced before a too-large backup is generated. The existing 2 MiB UTF-8 file, 200,000 UTF-16 input, and 16 MiB backup limits remain in place.

**G4 real-data readiness: NOT READY / BLOCKED.** This review did not use production data or run target-workstation durability, migration, quota, stable-origin, restart, or S3 intake qualification.

**G5 scientific extraction accuracy: NOT ESTABLISHED.** Synthetic software tests establish deterministic behavior and span integrity only; no scientific recall/precision study was conducted.

The exact implementation checkpoint tested after corrections is identified below in the final branch record. The report publication commit contains qualification documentation only; the final branch tip is also reported in the handoff. A Git commit cannot embed its own hash in its contents.

## Authority and method

Reviewed the repository `AGENTS.md`; WP01 complete application plan; v1.0 master design baseline; S1 implementation contracts; approved S1a, S1b, and S1c plans; AI Studio implementation ledger; S1 acceptance and G4 readiness reports; G2 acceptance; and app-starter qualification. The original qualification ledger was treated as author-provided evidence, not independent proof.

The independent pass followed six iterative cycles: (1) establish exact source, lockfile, and execution baseline; (2) map A1–C5 acceptance criteria and inspect cross-contract paths; (3) reproduce suspected persistence, size, concurrency, and stale-source defects; (4) make focused corrections and add regression cases; (5) review privacy, recovery, Unicode, exports, worker behavior, and the full task matrix; and (6) rerun the complete local gate and browser suite and record unresolved criteria. The complete reviewed branch diff was checked against the qualified starter.

A read-only independent code reviewer was asked to inspect the WP01 implementation and then the corrections. It raised two important issues: candidate-generation subspan checks could be quadratic and synchronous, and changing source text could leave old candidates actionable. Both were reproduced/confirmed and corrected here. Follow-up inspection confirmed the corrected batch, backup, concurrency and source invalidation paths. It also identified residual synchronous final sorting and that the backup cap is not presented until attempted; these are reflected in the remaining limits. The reviewer did not rerun the corrected suite; the command evidence below is from this qualification run.

## Baseline, source, and environment

| Item | Independent evidence |
|---|---|
| Source | Branch created from fetched `origin/main` at exact commit `9379062c5554839286bfb6165ee348358157a1a8`; starter `40045aa056cd0033a8c2d4586ee9f8f5fa703230` is the comparison baseline. The existing Scientific-Lexicon-Lab checkout was not modified. |
| Lockfile | `package-lock.json` SHA-256 `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`, matching the required value before and after `npm ci`. No dependency versions were edited. |
| Runtime | macOS arm64; Node `v26.12.1`; npm `11.20.0`. |
| E2E inventory | The original implementation contains 11 `tests/e2e/*.spec.ts` files, not 10 as the ledger stated. The independent regression adds `multibatch-persistence.spec.ts`, making 12 spec files and 15 tests. |
| Launcher / preview | `package.json` continues to use `node scripts/dev.mjs`; the launcher regression test is included in the passing unit suite. `next.config.ts` retains the development-only AI Studio `allowedDevOrigins` entries. Production build and Playwright webServer both started successfully. |

## Contract-by-contract A1–C5 matrix

Status refers to independent inspection and this run's evidence. **PASS** means the reviewed acceptance behavior is covered by code and evidence, subject to the explicit candidate-count blocker below. **PARTIAL** identifies an unsatisfied or not fully qualified requirement.

| Task | Independent review result | Evidence and qualification boundary |
|---|---|---|
| A1 — Shell and test infrastructure | PASS | Launcher unit checks, dev-server startup via Playwright, production build, visible route inventory, and no server data route. Required preview origins remain configured. |
| A2 — Canonical records and validation | PASS | Unit suite covers strict DTO parsing, reference/uniqueness constraints, exact Unicode values, empty snapshot, and protected assertion representation. Browser persistence flows cover valid concepts and expressions. |
| A3 — Approved change envelope and preview | PASS | Digest/approval binding and immutability covered by unit tests and real browser writes; explicit approval path used. A later multi-operation persistence defect was found and fixed (Finding F1). |
| A4 — Dexie repository and transactions | PASS after correction | Real IndexedDB E2E covers replay, stale/conflict, revision/protected values, abort rollback, and simultaneous competing writes. New multi-operation parity test checks persisted snapshot equality (F1). |
| A5 — Library editor and search | PASS | Browser flows cover empty state, EN/TR creation, homonyms, preview cancellation, search/reload, stale edit, denied storage, and corrected exact label selection. |
| B1 — Registered matching | PASS within synthetic scope | Unit oracle and browser parity tests cover Unicode boundaries, nested occurrences, ambiguity and revision invalidation. No claim of scientific accuracy. |
| B2 — Local English NLP adapter | PASS within synthetic scope | Unit/browser tests cover exact UTF-16 slices, worker execution, and no external model download. The fallback path can run synchronous NLP on the main thread if Worker setup fails; large-input responsiveness is not qualified. |
| B3 — Candidate discovery and unified run | PARTIAL | Grammar, span, cancellation, and input size behavior are tested. Subspan filtering was changed from nested scans to binary search and async generation now yields/checks cancellation. Input caps are fixed constants, and candidate-count limits are absent (no approved numeric value); this is a mandatory unresolved acceptance item. The 40,000-symbol benchmark is synthetic and is not production-scale qualification. |
| B4 — Review workflow | PASS within synthetic scope | E2E covers discover/reject/create/link/resolve/approval and stale library behavior. A new regression proves source edits clear old candidate actions (F5). |
| B5 — Retention and deletion | PASS within synthetic scope | Browser assertions verify session-only data, explicit retention, deletion of retained source/run/provenance pointers, concept preservation, rollback, and zero raw marker in network/audit/backup when not retained. Already downloaded backup copies remain user-controlled and cannot be revoked. |
| C1 — Deterministic exports | PASS | Existing export tests cover stable projection, Unicode, CSV formula protection, quoting and format separation. Browser workflow downloads TXT/MD/CSV/JSON. |
| C2 — Portable backup | PASS after correction | Backup validation tests plus UI size-rejection case. Generation now uses the parser's 16 MiB byte limit and refuses over-limit backup instead of claiming success (F2). |
| C3 — Empty-target restore | PASS after correction | Browser tests cover complete restore parity, corrupt/invalid input, abort, non-empty rejection, matcher invalidation and concurrent restore. Concurrent empty restore and malformed existing metadata are covered (F3). |
| C4 — Export/recovery UI | PASS | Browser workflow verifies download, clear errors and invalid backup rejection; oversized file is rejected before `File.text()` reads it. |
| C5 — Integrated verification and readiness record | PARTIAL | Full local gates and 15 browser tests pass; actual simultaneous two-tab requests are now concurrent. G4 remains NOT READY, and G3 remains NOT QUALIFIED pending the candidate-count contract. |

### Cross-contract review coverage

Reviewed canonical/reference integrity, batch replay and operation-ID conflicts, immutable approval binding, verified-value protection, cross-store transaction/snapshot parity, revision handling, restore races and metadata, scientific Unicode boundaries and nested occurrences, empty-library discovery, CSV formula injection and deterministic export, worker/network isolation, accessibility/error states, retention cleanup, downloaded-backup limits, dependency integrity, and accidental secret/data exposure. No new API/server route, analytics, external NLP/model request, or credential-bearing source was found in the inspected application paths. `npm audit` reported no advisories at the time of review. These checks do not establish G4 durability or scientific accuracy.

## Findings register

### F1 — Multi-operation create then update persisted a stale record

- **Severity:** High — successful apply could persist data different from the validated snapshot and later make reads invalid.
- **Affected contract:** A3/A4; one approved change must be applied atomically and persist the evaluator's canonical next state.
- **Evidence and reproduction:** A real IndexedDB harness creates a concept and then, in the same batch, adds/edits/asserts an expression and retains/deletes a source. Before the fix it returned `applied` while parity was false: created concept revision remained 0 instead of 3, expression revision remained 0 instead of 2, and the resulting assertion referenced a later revision. Read validation then failed. Reverting the provenance part of the fix also made the retained-source cleanup regression fail.
- **Correction:** `evaluateChangeOnSnapshot` now returns the final map values for created entities that were subsequently updated and excludes created retained documents/runs removed later in the same batch. Dexie persists that final evaluated outcome.
- **Regression:** `tests/e2e/multibatch-persistence.spec.ts` and its browser harness assert canonical JSON parity, revisions, protected assertion, source/run deletion and cleared provenance, truthful applied status, and abort atomicity. PASS in final Playwright run.

### F2 — Backup generation could succeed beyond restore's 16 MiB limit

- **Severity:** High — a “successful” backup could be rejected by the application's own restore path; large files could be read before rejection.
- **Affected contract:** C2/C4; supported backup must be recoverable and limits must be explicit.
- **Evidence and reproduction:** A synthetic snapshot with retained data larger than 16 MiB previously serialized as a download although parser limit was 16 MiB. The UI read an uploaded file's text before applying the cap.
- **Correction:** `serializeBackupFile` checks generated UTF-8 bytes against the parser limit and refuses oversize generation. `BackupPanel` checks `File.size` before reading. Parser checks string length before UTF-8 allocation and then enforces actual byte size. No truncation or limit removal.
- **Regression:** Unit test checks oversized source snapshot refusal and oversized parse rejection. E2E spies on `File.text`, supplies a >16 MiB file, verifies it is not read and no backup-success message appears. PASS.

### F3 — Competing writes and empty-target restore metadata were not sufficiently exercised/guarded

- **Severity:** High — sequential proposals do not demonstrate a race; restore could overwrite or accept corrupt metadata.
- **Affected contract:** A4/C3/C5; simultaneous attempts, fail-closed restore, no silent overwrite.
- **Evidence and reproduction:** Prior readiness browser test prepared two proposals but clicked them sequentially. A concurrent empty-backup restore race previously returned two successful applies; metadata with unsupported schema version could be overwritten.
- **Correction:** Readiness and storage harnesses issue both repository writes concurrently. `restoreEmpty` validates existing meta rows inside its transaction and treats any existing metadata as a non-empty target; corrupt/unsupported metadata is returned invalid and left intact.
- **Regression:** E2E reports exactly one concurrent write applied and one stale, with both tabs converging on one record; restore harness verifies one empty-target winner, one conflict, and corrupt metadata remains unchanged. PASS.

### F4 — Candidate discovery had quadratic subspan checks and weak cancellation

- **Severity:** Important — large candidate/token inputs could block the UI and could not be cancelled during candidate generation.
- **Affected contract:** B3; local generation, explicit cancellation, equivalent-output performance evidence.
- **Evidence and reproduction:** Candidate span filtering scanned every symbol span for each phrase span; generation was synchronous. Reviewer identified this path. Synthetic 4,000-symbol run measured roughly 102 ms before and 14–16 ms after the indexed subspan implementation (machine-local observations). A fixed-token 40,000-symbol/200,000-character case produced identical expected spans in about 210 ms in one final run.
- **Correction:** Sorted non-overlapping symbol spans are searched with binary search; generation is asynchronous, yields periodically, and checks `AbortSignal`.
- **Regression/limit:** Unit tests verify equivalent expected spans and cancellation. The benchmark uses fixed synthetic tokens, does not measure full NLP, UI rendering, heap, large libraries, or production-scale latency; no performance threshold or readiness claim is made. Main-thread synchronous NLP fallback and final sort remain potential responsiveness limits.

### F5 — Editing source could leave previous analysis actionable

- **Severity:** Important — a user could approve stale candidates after changing the source text.
- **Affected contract:** B4; cancellation/stale-result safety and candidate-to-source traceability.
- **Evidence and reproduction:** E2E changed source A to source B and observed four old candidate rows remain before correction.
- **Correction:** Source edits abort in-flight NLP, invalidate sequence state, clear the run and session store, selections/resolutions, pending proposals, retention link and consent. File change clears old results before reading; source/file controls are disabled during apply.
- **Regression:** `extraction-review.spec.ts` verifies old candidates disappear and cannot be acted on. PASS.

### F6 — E2E label lookup was ambiguous

- **Severity:** Low — the library UI test could target either the filter or editor control and failed despite correct behavior.
- **Affected contract:** A5 test reliability.
- **Evidence and correction:** `getByLabel('Language')` and `getByLabel('Role')` matched multiple controls. Tests now use exact label matching. Focused tests and full suite pass.

## Dependency and privacy reconciliation

`npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund` succeeded against the preserved lockfile. The package gate reports all four checks passed: approved direct versions, excluded R21 dependency, integrity metadata, and resolvable tool entry points. No package manifest or lockfile version change was introduced. `npm audit --json` returned zero vulnerabilities in the earlier independent scan. Static credential-pattern scan found no matches in application source/docs. App routes have no API route; browser tests assert no external model/network requests and no unretained synthetic source marker in network/audit/backup.

## Final verification evidence

Commands ran in the environment listed above after source corrections:

| Command | Exit | Actual result |
|---|---:|---|
| `npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund` | 0 | Added 69 packages; lock hash remained exact. Scripts intentionally disabled during install. |
| `npm run test:gate` | 0 | 4 tests passed, 0 failed. |
| `npm run test` | 0 | 12 test files; 38 tests passed, 0 failed. |
| `npm run typecheck` | 0 | `tsc --noEmit`, no diagnostics. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | 0 | Next.js 16.4.6/Turbopack production build; `/`, `/_not-found`, `/exchange`, `/extraction`, `/library` generated. |
| `npm run test:e2e` | 0 | Playwright 15/15 passed using one worker; actual Chromium browser run included concurrent tabs, IndexedDB, downloads and UI workflow. |

E2E spec reconciliation: 11 specs were present in the author ledger's original inventory, despite its stated count of 10. The independent added regression spec makes 12 spec files and the full run executed 15 test cases.

## Remaining blockers and verdicts

1. **G3:** NOT QUALIFIED until file/input/backup limits are configured and shown at the relevant workflow decision points, and candidate count has an owner-approved bound with explicit reject/cancel behavior. Current 200,000 UTF-16 text cap does not substitute for a candidate-count limit. The contract does not set the numeric candidate cap; this review did not invent one.
2. **G4:** NOT READY. No real data used. Stable origin, restart/OS reboot durability, real quota exhaustion, realistic migration/blocked-upgrade, production-scale storage/latency, S3 intake controls, and owner sign-off remain outside this run.
3. **G5:** NOT ESTABLISHED. No labeled scientific corpus, expert review, recall/precision evaluation, or extraction accuracy claim.
4. Worker failure can fall back to synchronous NLP on the main thread; matcher index rebuild and large-library UI/rendering capacity are not qualified. Candidate output's final sort is synchronous and cannot be interrupted until it completes. The synthetic candidate benchmark is not production capacity evidence.
5. Previously downloaded backup files are outside application control; deletion of a retained source from IndexedDB cannot revoke old downloaded copies.

No WP02/S2–S7 implementation or G4 production-data qualification was started.

## Branch and checkpoint record

- **Branch:** `codex/wp01-independent-verification`
- **Reviewed source base:** `9379062c5554839286bfb6165ee348358157a1a8`
- **Qualified starter:** `40045aa056cd0033a8c2d4586ee9f8f5fa703230`
- **Verified implementation checkpoint:** `ce3519a38acbf23b300d7fc9f4d12ad96a259586` (the exact source and tests that passed the full command matrix above).
- **Final branch tip:** documentation-only qualification publication commit follows the verified implementation checkpoint and is reported in the completion handoff. A report publication commit cannot store its own Git SHA without changing that SHA.
- **Integration:** not merged; `main` was not modified.
