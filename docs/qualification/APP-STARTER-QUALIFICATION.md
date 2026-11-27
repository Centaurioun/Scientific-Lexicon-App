# Production starter and additional dependency qualification

**Prepared:** 2026-11-27  
**Scope:** Empty application shell and test infrastructure only. WP01 product behavior is not implemented.

## Six-cycle refinement

1. **Intent and scope:** take the accepted bounded G2 decision and prepare a private, empty S1 application starter. Do not copy the S0 dashboard/databases or begin WP01 product functionality.
2. **Architecture and semantics:** retain the approved App Router/React/TypeScript architecture, browser-local domain boundary, Dexie adapter seam and single Zod validation authority. Keep Next's working AI Studio development-origin list intact.
3. **Evidence and reuse:** preserve S0-qualified package versions and reuse the byte-verified approved architecture, contracts, workflow and S1a/S1b/S1c plan files. Qualify only Zod, Vitest and Vitest's required Vite peer as additions.
4. **Failure and integrity:** generate an npm v3 lock with exact pins and SRI; test the direct-version gate, excluded package, entry points and transitive integrity. Run npm audit and registry license metadata review. Keep npm canonical and AI Studio Bun separate.
5. **Efficiency and delivery:** bootstrap only the A1 shell/test infrastructure, run RED→GREEN on the shell assertion, then execute reproducible install, gate, unit, type, build and browser checks on Node 26 and the declared Node 22 floor used by AI Studio.
6. **Challenge and reconcile:** preserve the owner-reported AI Studio runner limitations without claiming those native commands passed. Record remaining LGPL/MPL/CC-BY notice considerations before any distribution; no project-wide license is assigned.

## Added dependency decisions

The existing qualified S0 direct dependency pins were reused without change. npm registry metadata at qualification time identified:

| Package | Exact version | License | Runtime / compatibility | Registry SRI |
|---|---:|---|---|---|
| `zod` | `4.6.7` | MIT | Exercised in unit tests on Node 22.23.5 and 26.12.1 | `sha512-g8W2D2kU6a8untc053fX1uVBKzM7yqAxW/3zwk83+6RyF2+SKOuV+c0wBDhUwzV1PaGapmZH+rmcUzPf+3CGwg==` |
| `vitest` | `5.1.2` | MIT | npm metadata requires `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 22.23.5 and 26.12.1 satisfy it. It has a required Vite peer in `^6.4.0 || ^7.0.0 || ^8.0.0`. | `sha512-VIa2wXV208WraXUbzH+dQUrGcFpPuaiRA8HlhXS8R6/sy9cynw6OMqGj8fmAlH1hot7huTCtWUE14+FdXU3eLw==` |
| `vite` | `8.4.0` | MIT | Required Vitest peer; npm metadata requires `^20.19.0 || >=22.12.0`; Node 22.23.5 and 26.12.1 satisfy it. | `sha512-X2nUJg+9cutlz3hzqyO6p+WTwk9H257DjwAEf9EQYUFrQbDItmetadi9gYmb+l7VDy4r3VXLUnmLTwuPmzejDw==` |

The direct `vite` dependency is present only because Vitest declares it as a non-optional peer. No Tailwind, Testing Library, or extra UI packages were added. The selected Zod API is represented by one setup smoke test; production schemas remain part of WP01 A2.

## Controlled application dependency graph

- Direct root packages: **15** (the 12 existing S0-qualified direct pins plus Zod, Vitest and required Vite).
- `package-lock.json`: lockfile version 3, **146 package entries** excluding the root package.
- Lock SHA-256: `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`.
- Every resolved tarball entry has integrity metadata; the root gate also checked exact direct versions, `@jimtkelly/aho-corasick` exclusion and entry-point resolution.
- Full npm audit: **0 info, 0 low, 0 moderate, 0 high, 0 critical findings** (`npm audit --json`, exit 0).
- The root lock is authoritative for local builds and exports. Do not replace it with or merge it into AI Studio's `bun.lock`.

All 146 lock entries were cross-checked against npm registry version metadata for license identifiers. Counts: MIT 73; Apache-2.0 42; LGPL-3.0-or-later 10; Apache-2.0 AND LGPL-3.0-or-later AND MIT 1; Apache-2.0 AND LGPL-3.0-or-later 3; MPL-2.0 12; CC-BY-4.0 1; ISC 2; BSD-3-Clause 1; 0BSD 1. No registry license metadata lookup failed. Most LGPL entries are platform-specific optional `@img/sharp-libvips-*` variants from Next's optional `sharp` dependency; optional binaries for other OS/CPU combinations remain in the lock graph as well. Lightning CSS uses MPL-2.0; `caniuse-lite` uses CC-BY-4.0. No project-wide license is assigned. Revisit notices and distribution obligations before packaging or distributing the application; this starter is not a release artifact.

The installed Zod, Vitest and Vite package directories include their MIT license files (`LICENSE`, `LICENSE.md`, and `LICENSE.md`). The installed `@img/sharp-libvips-darwin-arm64` package has LGPL-3.0-or-later registry metadata but no root-level license/notice file in the installed directory; obtain the relevant materials and review obligations before redistributing that optional binary.

## Verification record

Environment: macOS arm64; npm `11.20.0`; Playwright `1.65.1`; Chromium `159.0.8154.6`. The system Node was `v26.12.1`. Node `v22.23.5` was obtained for compatibility verification using a temporary npm-exec runtime and was not added to the project.

| Command | Result |
|---|---|
| `npm install --ignore-scripts --strict-peer-deps --no-audit --no-fund` | Exit 0; 69 packages added, with lifecycle scripts disabled |
| `npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund` | Exit 0; 69 packages installed from the generated lock |
| `npm run test:gate` | 4 passed, 0 failed |
| `npm run test` | Vitest: 1 file, 1 test passed |
| `npm run typecheck` | Exit 0 (`tsc --noEmit`) |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Exit 0; Next.js compiled and prerendered `/` and `/_not-found` |
| `NEXT_TELEMETRY_DISABLED=1 npm run test:e2e` | Playwright: 1 passed; shell/accessibility-state and no-external-or-synthetic-payload assertion |
| Same Vitest, typecheck, Next build, and Playwright commands under Node `v22.23.5` | All passed; Playwright 1/1, Vitest 1/1; typecheck/build exited 0 |

The Playwright shell assertion was first run against a placeholder page and failed because the expected `TermForge` heading was absent; after implementing the minimal shell, it passed. A first readiness attempt without any page returned 404 and timed out before the assertion; this was a harness startup issue, not treated as an application test result. The final reproducible E2E command passes with the application shell present.

## Remaining limits

- The owner reports AI Studio's native npm gate and Playwright runner remain environmentally limited. This starter has not been synchronized into AI Studio in this task. Do not claim native AI Studio npm or Playwright commands passed.
- Current starter checks exercise the empty shell and test/dependency infrastructure only. None of WP01 A2–C5 is implemented, and A1 still requires AI Studio to run its task checks and make the task-local checkpoint.
- No true user terminology or manuscripts were used. No production database, cloud service, external AI, authentication, or server processing exists.
- Optional native image packages and third-party notice obligations need review before an actual distribution; the dependency scan is technical license metadata evidence, not legal approval.
