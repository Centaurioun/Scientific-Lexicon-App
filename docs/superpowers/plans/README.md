# Implementation plan index — approved design, plans pending review
Design: [Master Design v1.0](../../architecture/MASTER-DESIGN-BASELINE-v1.0.md), owner approval recorded on 2026-11-26. Plans are not executed. User chose Google AI Studio first, ChatGPT documentation/review and Codex local engineering/verification. No need to choose a different execution method. 
| Order | Plan | Tasks | Dependency |
|---|---|---:|---|
| 0 | [S0 compatibility](2026-11-26-s0-ai-studio-compatibility.md) | 4 | Owner plan approval; G1 before package use |
| 1 | [S1a foundation/library](2026-11-26-s1a-foundation-library.md) | 5 | Actual S0 G1/G2 pass and authorized continuation |
| 2 | [S1b extraction/review](2026-11-26-s1b-extraction-review.md) | 5 | Verified S1a checkpoint |
| 3 | [S1c export/recovery](2026-11-26-s1c-export-recovery.md) | 5 | Verified S1b checkpoint |
Shared [S1 contracts](../../specifications/S1-IMPLEMENTATION-CONTRACTS-v0.1.md). [S0 handoff prompts](../../implementation-plans/AI-STUDIO-S0-EXECUTION-HANDOFF.md). [Plan review](../../evaluation/S1-WRITING-PLANS-REVIEW.md).
19 independently checkable tasks; not 19 simultaneously dispatched agents. AI Studio receives one stage prompt at a time; Codex executes actual tests and records evidence when AI Studio cannot. Any material environment/semantic/privacy change returns to owner. No product code, no real data, no merge. S0 is disposable; S1 remains conditional. S2–S7 retained in v1.0 and planned at their own gates, not prematurely decomposed.
