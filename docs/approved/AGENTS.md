# Engineering principles

- The human project owner is the final decision-making authority.
- Separate approved requirements, proposed decisions, experimental findings, and deferred features.
- Prefer established, reliable solutions; evaluate third-party components before adoption or adaptation.
- Preserve source provenance, licensing, attribution, and modification history. Never blindly copy third-party implementations.
- Do not introduce frameworks, dependencies, architectures, or implementation decisions without an approved requirement or justified engineering need.
- Prefer modular, maintainable, extensible, loosely coupled architecture and incremental development.
- Keep documentation, architecture decisions, specifications, and implementation plans synchronized. Do not silently overwrite approved documentation or verified data.
- Distinguish implemented functionality from proposed or planned functionality. Require evidence for claims of implementation or verification.
- Protect private data, unpublished manuscripts, credentials, and API keys.
- Use meaningful commits and preserve traceable development history.
- Do not start application implementation until the design baseline and implementation scope are approved.
- Do not fabricate research findings, citations, source verification, or test results.

## Current workspace workflow
- Read docs/handoffs/CURRENT-STATE.md and docs/README.md before changing the project.
- Preserve original versioned brainstorming and research reports; do not rewrite them silently.
- Treat candidate dispositions as provisional until pinned source inspection, rights review and required verification. Do not execute untrusted setup scripts or bulk copy repositories into public history.
- Keep public research documentation separate from private terminology, manuscripts, credentials, databases and restricted datasets.
- Use isolated synthetic fixtures for tests; production library starts empty.
- Preserve concept identity, original expressions, verification provenance, and staged/transactional write boundaries in future designs.
- Research/design gate now approved; do not scaffold before implementation plan approval and applicable G1/G2 gates.

## Continuous decision and implementation method
- Owner directive: for substantial decisions and new modules, use relevant Superpowers skills and Six-Cycle Iterative Refinement as described in docs/decisions/ENGINEERING-DECISION-WORKFLOW.md. Apply proportionately; do not restart broad research for minor fixes.
- Distinguish design approval, Writing Plans/implementation scope approval, actual dependency/runtime qualification, real-data readiness and merge approval. Never infer a passed gate from a proposed choice or a synthetic probe.
- Read docs/decisions/MASTER-DESIGN-APPROVAL.md and the latest Master Design candidate/approved revision before planning. Design v1.0 is approved; plans require owner review and applicable G1/G2 before scaffolding or installing product dependencies. Use stage-specific actual tests and verification. Preserve the original reports and branch history.
- No automatic merge, real-data upload, private manuscript transmission or project-wide license selection. Document any unavailable skill, reviewer or verification environment; do not fabricate evidence.

## Approved design and current execution boundary
- Read docs/architecture/MASTER-DESIGN-BASELINE-v1.0.md and docs/superpowers/plans/README.md. Approval of rc2 recorded at immutable 88fa4acfd2a12ef4daae925c97fdddf8a8d4faae. Plans pending execution approval; S0 selected dependency preflight first, disposable AI Studio probe next, S1 conditional. No merge or private data.
