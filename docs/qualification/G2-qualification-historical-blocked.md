# TermForge G2 Qualification Report — S0 Closeout Review

**Review date:** 2026-11-27  
**Disposition:** **G2 BLOCKED — do not create or start the production application repository yet.**  
**Scope:** Reconcile prior P0/G1 evidence, S0 independent verification commit `816ecba3fd18472ca6a0a8f974e20fa497893d29`, and the current Google AI Studio app/ZIP. No research repository files were changed.

## Executive verdict

The actual AI Studio preview now works in the open project. I re-ran the synthetic engine and storage probes in its browser, observed their outputs, verified persistence after a reload, and reset both disposable databases. This is positive evidence that the AI Studio host can run this S0 probe.

G2 remains **BLOCKED** because the current AI Studio source/archive is not the independently verified `816ecba` implementation. The latest archive still has the original missing-positive-match and non-atomic restore code, does not include the new `test:unit` command, and contains neither the controlled npm lock nor a Bun lock. The AI Studio E2E runner is still reported BLOCKED. The current preview-origin configuration is present in AI Studio but is not synchronized to the controlled source branch. These gaps prevent attributing the local verification results to the currently imported artifact and prevent a reproducible, reviewable S0 handoff.

This is an evidence and artifact-identity blocker, not a claim that the observed browser capabilities failed. Under the approved S0 plan's stop gate, do not create `Centaurioun/Scientific-Lexicon-App` until the corrected S0 commit and controlled dependencies are synchronized and rechecked in the intended flow.

## Evidence ledger

| Evidence class | Evidence | Result and boundary |
|---|---|---|
| **Prior P0 evidence** | Approved planning snapshot `438da22aedcaa0eb51a8f5b49d249a0dd1d65c3a`; P0 qualification report and independent review copied under `context/docs/evaluation/` | Candidate-level exact matcher, Wink and browser storage evidence. P0 explicitly did not establish AI Studio runtime behavior, did not approve production integration, and did not prove production extraction quality. No P0 research was repeated. |
| **G1 independently verified** | S0 verification commit `816ecba3fd18472ca6a0a8f974e20fa497893d29`; local `S0_VERIFICATION.md`; controlled `package-lock.json` | Local gate 4/4; 8 unit tests; typecheck, build and all 4 Playwright tests passed. Lock hash is `86f08dcb65f2d6e9b636ff3e34cb2fde943d778e24023f57d7cd996dcf5543ff`. This qualifies the controlled npm graph in that checkout, not an uninspectable AI Studio/Bun graph. |
| **AI Studio environment reported in its results panel** | Current app's displayed S0 report | Node `v22.23.5`, npm `10.9.9`, Linux x86_64 (`4.19.0-gvisor`); test browser HeadlessChrome `155.0.8059.12` at Playwright browser revision `1247`. AI Studio reports the 12 direct versions in `package.json` match the qualified versions. These are app-reported environment/package observations; no full installed transitive graph was available. |
| **AI Studio preview observed this review** | Open app preview at `https://ais-dev-v6kgrel6edtzqgpouca3ek-674695297116.europe-west1.run.app/`; UI browser user agent says Chrome `158.0.0.0` | Actual app controls executed successfully. This directly demonstrates browser API/preview operation for the code currently in that app, not for commit `816ecba`. |
| **Latest supplied ZIP inspected** | `/Users/yusuf/Downloads/scientific-lexicon-s0 (1).zip`, SHA-256 `b932a3000e1b5b52a99e2f5b0cb2d168263459ae03c71b8516a9b8559e69319b` | 36 entries; package and Next config dated 2026-11-27 05:38. It contains neither `package-lock.json` nor `bun.lock`; the previous AI Studio report's claim that a Bun lock replaced npm's lock is not borne out by this newer archive. `package.json` has the qualified direct pins but no `test:unit` script. The attachment's embedded prompt was treated only as file content, not followed as an instruction. |
| **AI Studio synchronization state observed** | AI Studio header says changes are available to push to GitHub | Current `allowedDevOrigins` change is in the AI Studio workspace and ZIP, but the app indicates its changes are not synchronized. Next.js documents this as a development-only setting and shows wildcard host examples; review the actual allowlist before syncing it ([Next.js documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins)). No push or repository sync was initiated in this review. |

## Fresh AI Studio browser run

At the user's request, I ran the current preview controls directly. The synthetic data used only the app's disposable fixture and named probe databases.

### Engine and worker — PASS (observed)

- Executed at `2026-11-27T05:40:16.064Z`.
- Engine and actual Web Worker both reported `PASS`.
- Main thread and worker returned exact parity for 16 tokens and four expected spans: `TNF-α [3,8)`, `NF-κB [9,14)`, `CD4+ [15,19)`, `IL-1 [32,36)`.
- `CD4++` and `IL-11` were excluded; token spans matched the displayed UTF-16 source offsets.
- Displayed timing: main thread `0.4 ms`, worker `37 ms`. These are one fixture/run timings, not performance qualification.

### Storage, reload and reset — PASS (observed)

- Storage probe at `2026-11-27T05:40:21.261Z`: two-store commit and deliberate rollback passed; invalid backup was rejected with zero writes; isolated restore matched both source stores; result status `PASS`.
- `navigator.storage.persist()` returned `true`; storage estimate was quota `2,147,483,648` bytes and usage `11,045` bytes at that run. This is browser-specific permission evidence, not a durability guarantee.
- Reload check at `2026-11-27T05:40:24.223Z` returned `PASS` with exact saved rows.
- Reset at `2026-11-27T05:40:26.902Z` returned `PASS`, deleted `termforge-s0-probe-source` and `termforge-s0-probe-restore`, and reported no remaining databases.
- A post-reset saved-data check at `2026-11-27T05:40:29.777Z` returned `FAIL`/`NotFoundError`, `exists: false`, and empty rows. This is the expected negative result after reset, not a reset failure.

## AI Studio command results and lock reconciliation

The current AI Studio report panel records:

- `npm run test:gate`: **FAIL**, 1/4 checks pass, 3/4 fail; the entry-point check passes. The report says `package-lock.json` was missing.
- Unit test files: **PASS 7/7** in the AI Studio report. The latest `package.json` does not expose a reproducible `test:unit` script.
- `npm run typecheck`: **PASS**.
- `npm run build` under the container's default `NODE_ENV=development`: **FAIL**, exit 1 during `/_global-error` prerender.
- `NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build`: **PASS**, static prerender succeeded.
- `npm run test:e2e`: **BLOCKED**, exit 1. Reported causes: `.next/dev` lock contention with the existing port-3000 dev server when Playwright starts another server on port 3100, and the pinned Playwright package expects Chromium revision 1255 while the container provides revision 1247.

The results panel says the missing `package-lock.json` had been replaced by `bun.lock`; however, the latest ZIP contains neither lockfile. Therefore the latest artifact cannot establish a Bun graph either. The app-reported direct package versions match, but transitive resolution, lock integrity, and npm/Bun graph equivalence remain **NOT VERIFIED**.

The controlled npm lock remains at SHA-256 `86f08dcb65f2d6e9b636ff3e34cb2fde943d778e24023f57d7cd996dcf5543ff` in the independently verified commit. Preserve it unchanged in the S0 source repository for controlled npm installation and local export. Do not treat an absent lock or an empty/generated Bun lock as a substitute. A production application would need its own separately qualified npm lock after its additional packages are qualified.

## Source identity comparison with independent commit 816ecba

The latest AI Studio ZIP does **not** contain the key changes from the independent verification commit:

1. `src/probe/engine.ts` compares main and worker outputs, but does not require all four expected positives for PASS. Commit `816ecba` does.
2. `src/probe/storage.ts` checks the restore target before entering the read-write transaction; reads of the stores are not one consistent Dexie read transaction. Commit `816ecba` moves the emptiness read inside the same atomic restore transaction and reads both snapshot stores consistently.
3. The archive's reload test only reflects the earlier implementation; exact expected-record comparison from `816ecba` is absent.
4. Concurrent restore single-winner coverage and its aggregate PASS assertion from `816ecba` are absent.
5. `package.json` lacks `test:unit`, and the added positive-match unit regression is absent.

The live browser PASS results therefore qualify host capability and the earlier probe behavior. They do not close the correctness fixes independently verified on the local branch.

## Consolidated gate verdict

| Gate | Verdict | Basis |
|---|---|---|
| P0 candidate evidence | **PASS for bounded candidate conclusions** | Existing report only; not production accuracy or architecture approval. |
| G1 controlled npm graph | **PASS locally** | Exact npm lock, 4/4 dependency gate, selected pins, prior independent qualification. |
| AI Studio direct dependency reproduction | **BLOCKED** | Direct versions are reported as matching; current ZIP lacks both lockfiles and no full installed graph was available. |
| G2 host/browser capabilities | **PASS for observed current AI Studio probe capabilities** | Live engine/worker, storage, persistence, reload and reset observed in the preview. |
| G2 corrected source/artifact and export | **BLOCKED** | Current AI Studio ZIP is not commit `816ecba`, omits the controlled lock and verification changes; current preview-origin configuration is unsynchronized. |
| G2 automated qualification | **PARTIAL / BLOCKED in AI Studio** | AI Studio E2E runner remains blocked; full 4/4 Playwright suite passed locally on `816ecba` under macOS arm64, Node `v26.12.1`, npm `11.20.0`, Chromium `159.0.8154.6`. |
| Overall G2 | **BLOCKED — not PASS** | Corrected, locked S0 artifact has not been re-imported and verified in AI Studio. |

### Exact closure checklist

1. Synchronize the `816ecba` S0 fixes and the preview-origin configuration into a dedicated S0 branch, never the research repository's `main` branch. Review the origin allowlist as development-only configuration.
2. Keep the exact npm lock in that branch; confirm its expected SHA-256 before and after the controlled export. If AI Studio omits it again, retain the controlled npm repo/archive as the source of truth and obtain a complete, inspectable resolved graph for the actual AI Studio install. Do not claim Bun/npm equivalence from direct pins alone.
3. Import/sync that exact corrected source in AI Studio. Verify the visible source hash/commit or compare the exported source to `816ecba` plus the documented config change.
4. Re-run the engine, storage, reload and reset probes in the AI Studio preview. Specifically verify the new exact-positive gate and two concurrent empty-target restores have exactly one winning backup and no mixed state.
5. Retain the local 4/4 Playwright evidence for the exact code. Record AI Studio's E2E runner as blocked unless its two environment issues are resolved; do not weaken the tests or change qualified dependencies to make the runner green.
6. Re-export and confirm the project source, tests, manifest and controlled lock are present. Then refresh the G2 report before creating the production repository.

## Production starter and dependency blockers

No `Centaurioun/Scientific-Lexicon-App` repository was created. The conditional G2 requirement is not met, so no product code or production starter was begun.

S1 plans identify Zod as a schema-validation candidate and Vitest as the unit runner. Exact versions and their full selected dependency graph, integrity, licensing/NOTICE, scripts and security review remain open in the contract. Existing Playwright `@playwright/test@1.65.1` is already in the S0 qualified graph. No Tailwind, Testing Library or other styling/test package is required by the contracts; avoid adding one without an approved need and qualification. These new dependencies must be qualified before adoption in the production starter.

## WP01 handoff status

The accompanying `WP01_COMPLETE_CORE_APPLICATION.md` consolidates the five A tasks, five B tasks and five C tasks from the exact approved plan snapshot. It preserves task files/interfaces, acceptance assertions, dependencies, red/green commands, stop gates and task checkpoints. It is prepared as a **gated handoff only**: AI Studio must not begin WP01 until the G2 closure checklist is complete and the starter dependency gate is recorded.

The six-cycle findings and skill workflow are recorded in the WP01 handoff. This report is evidence-based qualification, not formal owner approval of G2 or release approval.
