# TermForge — Scientific Lexicon App

Private production application starter for the approved synthetic-only S1 work package. This repository contains only the initial Next.js shell and reproducible dependency/test infrastructure; it does not implement WP01 product features or contain the S0 probe dashboard, probe databases, real terminology, or manuscripts.

## Start here

1. Read [G2 bounded acceptance](docs/qualification/G2-ACCEPTANCE.md) and [starter qualification](docs/qualification/APP-STARTER-QUALIFICATION.md).
2. Read [WP01 — Complete Core Application](docs/WP01_COMPLETE_CORE_APPLICATION.md), then the approved baseline, S1 contracts, S1a/S1b/S1c plans and engineering decision workflow linked in [the documentation index](docs/README.md).
3. The A1 shell and test infrastructure are bootstrapped here but no product features are implemented. Google AI Studio should re-run the A1 checks, make its A1 checkpoint, and then execute A2 → A5 → B1 → B5 → C1 → C5 in order. Internal checkpoints are not owner approval pauses. Stop at any failed acceptance test or scope/dependency/gate change.

## Development

Requires Node.js `^22.12.0 || ^24.0.0 || >=26.0.0` and npm. The canonical local/export dependency graph is `package-lock.json`; install it with `npm ci`. Google AI Studio's Bun graph is recorded separately in the G2 report and is not this lockfile's authority.

```sh
npm ci
npm run dev
npm run test:gate
npm run test
npm run test:e2e
npm run typecheck
npm run build
```

The preview-origin wildcards in `next.config.ts` are development-server-only and documented in [G2 acceptance](docs/qualification/G2-ACCEPTANCE.md).

## Scope and privacy

The production library starts empty. Use synthetic fixtures only. No API keys, real source documents, external AI, cloud database/storage, analytics, authentication, or server-side text processing. Do not assign a project-wide license without an owner decision. G2 acceptance does not establish G3 acceptance, G4 real-data readiness, G5 scientific accuracy, or release approval.
