# Continuous engineering decision workflow
Date: 2026-11-26. Owner explicitly requests relevant Superpowers skills and Six-Cycle Iterative Refinement in current and subsequent decision stages. This is a project working convention; no automatic implementation or approval.

## When and how
For a substantive feature, integration, schema change, platform decision or scope change: read current approved spec and evidence; invoke relevant installed Superpowers skills; use brainstorming to resolve intent, alternatives and tradeoffs; apply the six cycles below to the decision; record evidence, decision, alternatives, risks and approval status. Obtain owner approval of material design changes before building, then invoke writing-plans. For small fixes do not restart project-wide brainstorming: use relevant debugging/TDD/review/verification, apply the cycles proportionately to risk, document meaningful deviations. Do not invoke unavailable skills or pretend to have dispatched an agent. No redundant research or agent fan-out. Where a skill is not installed, state the limitation and follow the equivalent documented process.

| Cycle | Question | Required output |
|---|---|---|
| 1 Intent and scope | Does this serve the actual user workflow? | Goal, non-goals, smallest useful deliverable, alternatives |
| 2 Architecture and semantics | Are responsibilities, identities and interfaces correct? | Boundaries, invariants, dependencies and migration effects |
| 3 Evidence and reuse | What exists already and what has actually been verified? | Pinned references, tests, license/quality caveats, adopt/adapt/reference/build decision |
| 4 Failure and integrity | What could corrupt data, violate privacy or silently fail? | Failure cases, rollback and explicit safety gates |
| 5 Efficiency and delivery | What can be simpler, deferred or reused? | Increment order, cost/complexity tradeoff, testable criteria |
| 6 Challenge and reconcile | Would a builder or reviewer need to guess? | Builder check, contradictions repaired, decision status and next gate |

Iterate on findings within each cycle; do not confuse six cycles with six independent agents or empirical proof. If an installed dedicated Six-Cycle skill is unavailable, this explicit local procedure is the project implementation of that method.

## Superpowers stage map
Brainstorming for substantive design (alternatives discussed, design written, owner approval). Builder check for project-sized design, use fresh independent reviewer if available; otherwise explicitly self-review. Writing Plans only after design approval, with small testable tasks and actual interfaces. Using Git Worktrees when isolated local implementation begins; TDD before feature/fix code; Systematic Debugging for unexpected failures; Requesting/Receiving Code Review for relevant changes; Verification Before Completion with current evidence; Finishing a Development Branch when implementation and tests are complete, subject to owner decision. Use the owner's selected execution model (AI Studio first; Codex engineering as needed); no unnecessary subagents and follow existing owner instructions if spawning. Separate design approval, implementation plan approval, runtime qualification, real-data readiness and merge approval. No fabricated verification.

## Decision record minimum
ID/status/date; context and owner intent; alternatives and evidence; recommendation and tradeoffs; six-cycle findings; constraints/acceptance tests; unresolved risks, owner decisions and superseded records. Keep this lean for minor changes and detailed for high-impact ones. Preserve original research and decisions; update handoff with current authoritative document, phase and exact commit.
