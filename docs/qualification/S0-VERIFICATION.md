# S0 Independent Verification Report

> **Historical evidence, not the current G2 verdict.** This report preserves the local independent verification and the limits known during that review. Its earlier G2 HOLD reflects evidence available at that time; the current bounded acceptance decision is in [G2-ACCEPTANCE.md](G2-ACCEPTANCE.md), based on the later owner-supplied hosted report, source-identity match, and Bun/npm graph comparison.

## Disposition

**Recommendation: G2 HOLD / NOT PASS.** The S0 implementation passes the requested local checks in a real local browser, including actual Web Worker and IndexedDB/Dexie execution. There is no evidence here that the repository was imported into or executed by Google AI Studio. S0's runtime portability is therefore locally qualified, while AI Studio compatibility remains **NOT TESTED**. Do not treat this report as G2 approval.

This review remains within S0. It does not implement the actual planned compatibility probes or begin S1.

## Reviewed source and isolation

- Source repository: `Centaurioun/Scientific-Lexicon-S0`
- Reviewed source commit: `1ae730907116573adfdf4b4fc8d1001008b63d02`
- Source branch supplied for the review: `s0/ai-studio-starter`
- Review changes are on a separate branch: `codex/s0-independent-verification`
- Original research repository: untouched
- The starter's `package-lock.json` was not edited. SHA-256 at the reviewed source commit and in the verified tree is `86f08dcb65f2d6e9b636ff3e34cb2fde943d778e24023f57d7cd996dcf5543ff`.

The G1 direct package versions still installed are `ahocorasick@1.0.2`, `dexie@4.4.7`, `wink-eng-lite-web-model@1.8.1`, `wink-nlp@2.4.0`, `@playwright/test@1.65.1`, `@types/node@26.6.11`, `@types/react@19.3.3`, `@types/react-dom@19.3.0`, `next@16.4.6`, `react@19.3.1`, `react-dom@19.3.1`, and `typescript@7.0.2`. `npm ls --depth=0` reported these versions without missing or invalid direct dependencies.

## Six review and refinement cycles

No repository-specific written definition of “Six-Cycle Iterative Refinement” was present in the supplied starter or source guidance. To make the requested methodology auditable, this report records six bounded cycles used in this review:

1. **Baseline:** inspect the import handoff, exact source commit, dependency lock, and existing checks; run the initial gates to expose failures.
2. **Engine correctness:** add an expected-positive regression, observe that missing expected matches could otherwise pass, and require exact positive span equality in the engine result.
3. **Restore atomicity:** examine the empty-target check and restore writes together; move the guard read and both writes into one read-write transaction.
4. **Snapshot and reload integrity:** use a single readonly transaction across both stores for backups; compare reload rows against exact expected records rather than accepting mere nonempty stores.
5. **Execution and test reproducibility:** wire the unit tests to `npm run test:unit`; verify actual worker messages, same-origin worker loading, and absence of fixture-bearing network/WebSocket traffic in browser tests.
6. **Final qualification:** rerun all requested gates on the final tree, inspect lock integrity and the staged diff, and classify local versus hosted evidence for G2.

These are the review's recorded iterations, not a claim that a separately versioned project procedure was found.

## Main-branch reconciliation and source identification

The integration preserves the exact G1 `package-lock.json` blob (`86f08dcb65f2d6e9b636ff3e34cb2fde943d778e24023f57d7cd996dcf5543ff`) and direct dependency versions listed above. The `allowedDevOrigins` list is retained from the latest AI Studio `main` configuration: localhost, `*.run.app`, `**.run.app`, `*.scf.usercontent.goog`, and `**.scf.usercontent.goog`. This is a Next.js development-server setting; `*` matches one hostname label and `**` one or more labels, so the patterns allow broad matching under those preview suffixes. They are not production-origin restrictions. The current production build and browser tests are the local checks for the reconciled configuration. [Next.js documents the development-only behavior and wildcard semantics](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).

The dashboard displays a deterministic `sha256-…` Source ID. It hashes engine, worker, storage, test, package manifest, Next.js and TypeScript configuration, and the generator source. `npm run source:id:check` confirms the checked-in/generated marker matches those files; `npm run dev` and `npm run build` regenerate it. A Playwright assertion verifies the marker is available in the browser. This identifies the imported implementation source; it does not independently prove which AI Studio workspace revision is active until the owner pulls the update and checks the displayed ID.

### Final reconciliation verification

Environment: macOS `Darwin arm64`, Node `v26.12.1`, npm `11.20.0`, Playwright `1.65.1`, Chromium `159.0.8154.6` (revision 1255). Clean dependency install: `npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund` — exited 0, 36 packages added. The installed direct dependencies exactly match the qualified versions above.

- `npm run test:gate` — 4 passed, 0 failed.
- `npm run test:unit` — 9 passed, 0 failed (eight previously verified probe tests plus source-ID determinism/change-sensitivity coverage). Node emitted nonfatal `MODULE_TYPELESS_PACKAGE_JSON` warnings for the TypeScript test modules.
- `npm run source:id:check` — passed; final Source ID `sha256-03859df6ccaefa7cf0f82fcd793e40a691f1cc1f6ac093fa124d98f325c10100`.
- `npm run typecheck` — exited 0 (`tsc --noEmit`).
- `NEXT_TELEMETRY_DISABLED=1 npm run build` — exited 0; production compilation and static route generation succeeded.
- `npm run test:e2e` — 4 passed, 0 failed, including the source-ID browser assertion, actual worker execution, and IndexedDB/restore checks. Playwright printed a nonfatal `NO_COLOR`/`FORCE_COLOR` environment warning.

The lockfile was byte-identical to `origin/main` and retained SHA-256 `86f08dcb65f2d6e9b636ff3e34cb2fde943d778e24023f57d7cd996dcf5543ff`; no dependency versions or lock contents changed.

## Findings and dispositions

1. **Engine positive assertions — fixed.** Engine PASS now requires the complete expected positive match set, including exact offsets and terms, in addition to valid spans and successful negative controls. The new unit regression `runEngineProbe fails when expected positive matches are missing` covers an incomplete positive response.
2. **Empty restore target — fixed.** Both target-store reads that establish emptiness and both bulk inserts are inside the same Dexie read-write transaction. Concurrent restore coverage requires a single winner and verifies resulting records match that backup.
3. **Backup consistency — fixed.** Snapshot reads of `left` and `right` run in one Dexie readonly transaction spanning both stores.
4. **Reload comparison — fixed.** Reload verification checks exact expected records in both stores. Browser coverage tampers with a saved value and adds an extra record; the check must report FAIL and return those actual rows.
5. **Unit test entry point — fixed.** `npm run test:unit` reproducibly runs both TypeScript unit test files via Node's type stripping and source-ID coverage. The independent verification added the seven supplied tests plus the positive-match regression; integration now runs nine total including the source-ID test.
6. **Worker and local processing evidence — strengthened.** Playwright instruments the browser, confirms a same-origin worker is constructed and receives messages, verifies local result spans, and checks that no external network/WebSocket or fixture-bearing WebSocket traffic is used. Storage tests observe native IndexedDB transactions and exercise actual browser persistence, restore, rollback, reload, and storage-denial paths.

## Runtime and commands

Observed environment: macOS `Darwin arm64`; Node `v26.12.1`; npm `11.20.0`; Playwright `1.65.1`; Chromium `159.0.8154.6` (Playwright Chromium revision 1255). The install command from the handoff was `npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund` (36 packages added).

Commands below were run on the final fixed tree. `NEXT_TELEMETRY_DISABLED=1` was set for Next.js commands.

### Dependency gate

Command: `npm run test:gate`

```text
✔ exact direct versions are recorded in the lockfile
✔ excluded R21 package is absent from the complete lock graph
✔ every locked tarball has Subresource Integrity metadata
✔ all direct entry points resolve
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

### Unit tests

Command: `npm run test:unit`

```text
✔ tokenizeWithExactOffsets preserves UTF-16 spans with emoji, Greek letters, and punctuation
✔ matchRegisteredTerms distinguishes IL-1 from IL-11 and CD4+ from CD4++
✔ scientific boundary check handles letters, combining marks, numbers, underscore, and plus
✔ analyzeScientificText produces deterministic parity-comparable output
✔ runEngineProbe fails when expected positive matches are missing
✔ createSyntheticBackupJson produces a valid backup that passes strict validation
✔ parseAndValidateProbeBackup rejects malformed JSON, wrong schemaVersion, extra keys, and duplicate IDs
✔ areProbeStoreSnapshotsEqual compares both stores accurately
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

Node printed nonfatal `MODULE_TYPELESS_PACKAGE_JSON` warnings for the TypeScript test files; all eight tests passed. The command is explicit and requires no added dependency.

### TypeScript and production build

Commands: `npm run typecheck`; `npm run build`

```text
> tsc --noEmit
```

TypeScript exited 0. The build exited 0: Next.js compiled, completed TypeScript, generated static pages, and emitted `/` and `/_not-found` as static routes. Next.js warned that it ignored `/Users/yusuf/Repos/package-lock.json` because it is outside the cloned repository; this is a workspace parent-directory warning, not a lockfile modification or build failure.

### Playwright browser tests

Command: `npm run test:e2e`

```text
✓ actual local engine and worker preserve exact synthetic source spans
✓ blocked Web Worker reports BLOCKED with measured main-thread fallback and never PASS
✓ actual Dexie transactions, rollback, reload and empty-target recovery
✓ injected storage denial cannot report success
4 passed (3.2s)
```

All four existing Playwright tests ran; none was removed or weakened. The dev server printed a nonfatal `NO_COLOR`/`FORCE_COLOR` warning and the parent lockfile warning noted above.

### Lock and installed package verification

Commands: `shasum -a 256 package-lock.json`; `npm ls --depth=0`; `node -v`; `npm -v`; `uname -sm`; `npx playwright --version`.

```text
86f08dcb65f2d6e9b636ff3e34cb2fde943d778e24023f57d7cd996dcf5543ff  package-lock.json
v26.12.1
11.20.0
Darwin arm64
Version 1.65.1
```

The exact source commit's lockfile independently hashes to the same SHA-256. `npm ls --depth=0` showed all twelve direct dependencies at the qualified versions listed above.

## Scope and limitations

- Browser evidence is from local macOS Chromium at a localhost origin. It is not Google AI Studio evidence.
- `navigator.storage.persist()` returned `false` in the recorded local run; that is an observed browser decision, not a failing probe. Storage estimate was available. The app correctly reports browser-dependent persistence rather than assuming persistence was granted.
- Local Next.js emitted a workspace parent-lockfile warning. The optimized production build still succeeded.
- Node emitted a module-typeless warning while running TypeScript tests. Tests succeeded; no dependency or package module mode was changed to suppress it.
- The browser tests establish local worker construction/message execution and browser-local IndexedDB behavior for the tested cases. They do not establish all browser engines, hosted deployment behavior, AI Studio packaging/import behavior, or untested storage failure modes.
- No G1 research was repeated, no qualified dependency changed, and no S1 work began.

## G2 recommendation

**HOLD / NOT PASS.** The dependency gate and local S0 verification are positive evidence. G2 requires review of the implementation in its intended Google AI Studio environment; no import, hosted runtime, or AI Studio browser evidence was available or claimed in this run. Obtain that evidence and review it before revising this recommendation.
