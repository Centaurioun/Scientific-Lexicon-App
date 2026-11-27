# Owner approval brief — Master Design v1.0-rc2
Status: APPROVED by owner on 2026-11-26; original brief preserved below. Approved candidate: [Master Design Baseline v1.0-rc2](../architecture/MASTER-DESIGN-BASELINE-v1.0-rc2.md). [Review](../evaluation/MASTER-DESIGN-SIX-CYCLE-REVIEW.md).

## Decisions requested as one coherent package
| ID | Decision proposed | Why |
|---|---|---|
| A01 | Long-term C vision; first synthetic S0 then S1a–c English extractor/bilingual library | Retain whole vision without scope creep |
| A02 | Next.js/React/TS modular monolith, browser-local core, Dexie 4.4.7 on IndexedDB conditional | P0 browser feasibility, AI Studio workflow; keep SQLite fallback |
| A03 | R20 ahocorasick 1.0.2, Wink 2.4.0 + model 1.8.1, all behind narrow adapters and G1/G2 | P0 observed behavior; R21 exact artifact broken; no mandatory AI |
| A04 | Concept + expression identity, EN/TR from day one, ambiguity preserved, no unconditional normalization | Scientific semantics and bilingual usability |
| A05 | Staging, explicit reviewed changes, revision/idempotency, fail-closed writes and portable backup before real data | Protect irreplaceable library |
| A06 | Default session-only manuscript text, opt-in local retention, no implicit transmission | Minimize sensitive data; provenance only where retained |
| A07 | S1a manual library, S1b extraction, S1c output/backup; S2–S7 roadmap retained | Small working increments; no fake screens |
| A08 | Risk-based acceptance gates G0–G6; no real-data use before actual integrity and intake gates | Separate feasibility, correctness, durability and scientific validity |
| A09 | Relevant Superpowers and Six-Cycle workflow for subsequent substantial decisions | Repeatable discipline without repetitive full research |

Alternatives and tradeoffs: baseline §11; provisional technical decisions: §§2,5,12; scope and gates §§12–13; deferred features and rejected approaches preserved from brainstorming v0.2. No project-wide license selected. Product name remains provisional. No claim that AI Studio runtime, scientific accuracy or product storage has passed.

Approval wording: "Master Design Baseline v1.0-rc2 is approved. Proceed with Superpowers Writing Plans for S0 and the first S1 slice, preserving all gates." This authorizes planning, not merge or real-data use. Record the exact approved commit in the subsequent approved v1.0 revision; do not mark this document approved before explicit owner response.

## Recorded decision
Exact approved commit: [88fa4acfd2a12ef4daae925c97fdddf8a8d4faae](https://github.com/Centaurioun/Scientific-Lexicon-Lab/commit/88fa4acfd2a12ef4daae925c97fdddf8a8d4faae).
Owner statement: “Master Design Baseline v1.0-rc2 tasarımını bütün kararları ve doğrulama koşullarıyla onaylıyorum. v1.0 olarak kesinleştir ve Superpowers Writing Plans aşamasına geç.”
A01–A09 accepted as a package. Approved release: [v1.0](../architecture/MASTER-DESIGN-BASELINE-v1.0.md). This authorizes writing plans, not execution, passing G1–G6, real-data import or merge. No project license chosen. See [plan index](../superpowers/plans/README.md).
