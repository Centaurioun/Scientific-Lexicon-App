# TermForge application instructions

- Treat `docs/architecture/MASTER-DESIGN-BASELINE-v1.0.md`, `docs/specifications/S1-IMPLEMENTATION-CONTRACTS-v0.1.md`, and the approved S1 plans as implementation authority. The accepted G2 boundary is in `docs/qualification/G2-ACCEPTANCE.md`.
- WP01 is integrated and G3 passed for synthetic scope. Execute WP02 only when the owner supplies the WP02 execution prompt; read `docs/WP02_SCIENTIFIC_INTELLIGENCE.md` and its linked design. Preserve WP01 regression behavior. Execute tasks in their documented order. Write a failing test before behavior changes, verify RED, implement the smallest change, verify GREEN, run regressions, review the diff and checkpoint. Checkpoints are internal controls; the owner authorizes the bounded work package via the execution prompt without approval after each minor task; material gates remain.
- Synthetic fixtures only. Keep canonical processing, source text and IndexedDB in the browser. Never add real terminology/manuscripts, server processing, cloud storage, external AI calls, credentials, analytics, authentication, or network transfer of document text.
- Preserve concept/expression identity, Unicode and exact source spans. All master writes must use the approved gateway and fail closed on stale, conflicting, invalid or aborted updates.
- Do not silently change qualified versions or `package-lock.json`. npm's root lock is authoritative for local builds/exports. AI Studio's Bun graph is a separately recorded development environment; do not claim native npm gate or Playwright runner passes there.
- The `allowedDevOrigins` wildcard list is development-only and must be preserved unless an approved change says otherwise. Do not treat it as production origin security configuration.
- Keep G3 acceptance, G4 real-data readiness, G5 scientific accuracy and release approval distinct from G2. No automatic merge or real-data use.
- Apply the six-cycle decision workflow proportionately and use relevant Superpowers skills for substantial changes. Do not repeat completed S0/G1 research or tests unless a new change requires them.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Current checkpoint
WP01 integrated source baseline `09a505b12db12b5830921120020d3084fe080e8c`; [continuation](docs/handoffs/CHATGPT-CONTINUATION-2026-11-27.md). Do not implement WP03. G4 NOT READY; G5 NOT ESTABLISHED. AI Studio user performs all sync operations manually.
