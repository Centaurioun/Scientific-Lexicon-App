# TermForge — WP02 Qualification Closure (Google AI Studio execution)

**Status:** AUTHORIZED EXECUTION HANDOFF, NOT a qualification or release approval.  
**Product:** Centaurioun/Scientific-Lexicon-App. Use the existing Google AI Studio project imported from main. Do not create another app. The human owner handles GitHub pull/push manually. Do not modify the separate Scientific-Lexicon-Lab research repository.

## 1. Starting state and mandatory transfer

GitHub main originally contains Gemini WP02 at `2e4a5894e92f3439330aa019d337ac04a08b794f`. Codex independently remediated it, but did not qualify it. The exact Codex branch tip is `a935c186f27e829d42f5370b3840391e8fe64ed4` (implementation verified at `6b8736b6186fc4f5d7e78197188f1139ad0d095e`). WP01 integrated baseline: `09a505b12db12b5830921120020d3084fe080e8c`; WP02 specification: `41473feec38708c34902dc3710ed00569c791198`.

AI Studio imports main only. Therefore the owner requested this continuation via main. Main's application files have NOT been merged or silently changed by this handoff. The exact 22 changed Codex files, including historical reports and tests, are present as inert .txt Git blob copies under `docs/handoffs/wp02-codex-transfer/`. Their manifest is `docs/handoffs/wp02-codex-transfer/manifest.json`. Do not recreate Codex's changes from prose, and do not fetch another branch. Apply this transfer locally before implementing any closure work.

Run the following in the app root (Node only; no extra packages). It validates all copied blobs and all destination preimages before writing anything. If a destination differs from both expected states, stop transfer and report the conflict; never silently discard unrelated edits. The only exception is the tool-generated next-env.d.ts, which may differ after starting Next; preserve the environment-generated file if different and record it. Missing base files are conflicts except new files. The operation is idempotent. If the environment does not provide a shell, inspect the manifest, verify exact copied contents and perform equivalent file edits using available tooling; report any inability to validate hashes instead of claiming success. No network or Git branch access is needed.

```bash
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const folder = 'docs/handoffs/wp02-codex-transfer';
const m = JSON.parse(readFileSync(folder + '/manifest.json', 'utf8'));
if (m.format !== 'termforge-pinned-source-transfer-v1' || m.sourceCommit !== 'a935c186f27e829d42f5370b3840391e8fe64ed4' || m.files.length !== 22) throw Error('Unexpected manifest');
const hash = b => { const header = Buffer.concat([Buffer.from('blob ' + b.length), Buffer.from([0])]); return createHash('sha1').update(header).update(b).digest('hex'); };
const work = []; const skipped = [];
for (const f of m.files) {
  if (!/^(src\/|tests\/|docs\/|next-env\.d\.ts$)/.test(f.path) || f.path.split('/').includes('..') || f.copy !== folder + '/' + f.path + '.txt') throw Error('Unsafe transfer path ' + f.path);
  const dest = resolve(root, f.path);
  if (relative(root, dest).startsWith('..')) throw Error('Path escape');
  const data = readFileSync(f.copy);
  if (data.length !== f.bytes || hash(data) !== f.targetBlob) throw Error('Corrupt transfer ' + f.path);
  const current = existsSync(dest) ? hash(readFileSync(dest)) : null;
  if (current === f.targetBlob) continue;
  if (current !== f.baseBlob) {
    if (f.path === 'next-env.d.ts') { skipped.push(f.path); continue; }
    throw Error('Unexpected destination state: ' + f.path + ' (' + current + ')');
  }
  work.push({ dest, data, path: f.path, sha: f.targetBlob });
}
for (const f of work) { mkdirSync(dirname(f.dest), { recursive: true }); writeFileSync(f.dest, f.data); if (hash(readFileSync(f.dest)) !== f.sha) throw Error('Write mismatch: ' + f.path); }
console.log(JSON.stringify({ transfer: 'verified', applied: work.map(f => f.path), generatedFileSkipped: skipped }, null, 2));
NODE
```

Read AGENTS.md, docs/WP02_SCIENTIFIC_INTELLIGENCE.md, docs/superpowers/specs/2026-11-27-wp02-scientific-intelligence-design.md, docs/handoffs/WP02-IMPLEMENTATION-LEDGER.md, docs/evaluation/WP02-INDEPENDENT-QUALIFICATION.md (after transfer), docs/evaluation/WP02-ACCEPTANCE.md, docs/evaluation/WP02-SYNTHETIC-COMPARISON.md, docs/evaluation/WP02-BENCHMARK-PROTOCOL.md, docs/qualification/WP02-DOCX-CANDIDATE.md and their linked approved contracts. Read the entire closure document before editing.

Previous Codex evidence (historical, do not re-label as current AI Studio results): npm gate 4/4, typecheck/build pass, 91/91 Vitest tests in 22 files, 25/25 native Playwright tests, npm audit zero vulnerabilities, canonical lock hash unchanged. Native environment macOS ARM64. 5k/10k repeated browser workloads 1063/1849 ms, not thresholds. Six controlled grammar/ranking combinations already exist; preserve and recompute only if affected. Remaining gaps are D2/D4/D5/D6/D7/D8/D12 and conditional D3; see historical report.

## 2. Execution policy and environment boundary

Perform actual engineering remediation, not a plan-only response. One consolidated package with checkpoints QC01–QC09. Use relevant available Superpowers skills (brainstorming for material decisions, writing/executing plans, TDD, systematic debugging, review, verification); do not pretend unavailable skills or independent agents exist. Apply six-cycle iterative refinement proportionately: intent, architecture, evidence/reuse, integrity/security, efficiency, adversarial challenge/reconciliation. Use actual RED/GREEN evidence for behavior changes. Do not redo completed research or accepted work without a specific cause. No routine approval pauses; material dependency/rights decisions remain owner-controlled.

Preserve WP01 behavior; browser-only modular monolith; exact case and UTF-16 half-open offsets; concept/expression identity and unresolved ambiguity; canonical IndexedDB and backup v1; immutable ChangeSet explicit approval, CAS, replay and atomicity; existing TXT/MD 2 MiB/200k UTF-16, occurrence 100–10k default 5k, backup 16 MiB; no silent truncation. S1 default, S2 experimental. All WP02 analysis metadata/tokens/evidence/pack/ranking session-only. No real manuscripts, real terminology, external corpora or dictionaries, server document processing, external AI calls, analytics, accounts or network transfer. No WP03.

Preserve exact 15 direct packages, canonical package-lock.json SHA-256 `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`, scripts/dev.mjs and dev-only allowedDevOrigins. AI Studio may omit npm lock and use Bun. Never fabricate, regenerate, delete or replace canonical lock; do not run npm install to alter managed dependencies. Do not approve install scripts, add dependencies or alter lock to obtain green tests. Do not change repo visibility or protection. If canonical lock is missing locally, mark native gate blocked and preserve the GitHub copy during owner's later sync.

Native npm qualification and native Playwright may be blocked in AI Studio. Try supported existing commands where safe; distinguish blocked infrastructure from product failure and actual pass. Use actual headless Chromium/playwright-cli checks where available, not as a substitute for native E2E. Never stop independent implementation tasks just because native verification is blocked. No Codex execution is requested. A future independent verification can be performed in any appropriate environment, including the owner's local machine, without assuming a particular agent.

## 3. Closure packages

### QC01 — Synthetic dictionary boundary
Implement the proposed bounded qualification policy: trusted project-owned synthetic fixture manifest or equivalent immutable content allowlist. Make exact content digest verification part of activation; self-declared filename, pack ID, URI, license or authority is insufficient. Keep D6 functionality, schema, suggestions and hints; reject tampered and arbitrary schema-valid packs, no UI bypass. Preserve pre-read limits, strict UTF-8, provenance, RAM-only operation and no revision change. This is not rights verification for general dictionaries. Test accepted fixture, tampered content, arbitrary pack rejection, overlapping uploads/clear and backup isolation. Internal synthetic stress fixtures may use pure lookup APIs without exposing unrestricted upload. Document the product restriction and any material policy decisions.

### QC02 — Ranking semantics and bounds
Review ranking.ts, ExtractionWorkspace.tsx, CandidateTable.tsx. Current subsequence index assumes at most eight tokens; registered/pack/fallback spans are not necessarily bounded by that grammar rule. Test long registered/pack expressions, actual eligible token sequences, contextual tokenization of identical surfaces, partial token coverage and fallback. Avoid unnecessary C-value index in source-order/frequency. Bound intermediate allocation and main-thread work without silent truncation; keep exact canonical C-value, distinct containers, deterministic order, unigram separation, full-run stats independent of display filter, compatible groups and reference oracle. Extend adversarial oracle cases. Audit rendering amplification by concepts and entry multiplicity. Reject excessive workloads explicitly with no partial actionable run if necessary; do not enlarge approved limits or invent weights.

### QC03 — Worker lifecycle and cancellation
Review wink-engine.ts, extraction.worker.ts, extraction.ts. Current shared worker termination on one abort may leave other pending promises unsettled. Reproduce concurrent requests, cancel one, cancel/restart, init and runtime error, terminate pending, stale messages, listener cleanup, synchronous postMessage error, signal propagation, large-input failure. Establish deterministic ownership, settle every pending promise, no stale completion or large synchronous fallback. Single-active-request design acceptable if explicit. Audit cooperative cancellation/bounds in matching, generation, lookup, ranking, sort and index construction. Isolate heavy synchronous work or document measured bounds where adequate.

### QC04 — Parser/grammar challenge closure
Add independent synthetic cases, not just the 26 existing labels: malformed Markdown, escaped syntax, nested backticks, irregular/unclosed fences, links, tables, lists, headings, CRLF/CR/LF, combining marks, supplementary characters, metadata mismatch, exact slices, excluded/cross-section spans, chemical and molecular boundaries, Greek/alphanumeric symbols, compounds/function words, eponyms, bibliographic noise, nested terms, false acronym pairings and homonyms. Deterministic bounded generated tests are welcome, no new deps. Explicit unsupported syntax warnings, no scientific generalization. Preserve baseline regression behavior.

### QC05 — UI concurrency/accessibility
Focus on handleApproveAndSave and asynchronous completion after applyChange/loadSnapshot. Distinguish an authorized already-committed transaction from stale view effects; never reverse a valid commit because view changed. Test delayed proposal generation, source/policy changes during approval and retention, external library revisions, overlapping uploads/analysis, cancel/restart, multiple proposals, dismissal, grouped/flat occurrence actions, homonym navigation, keyboard-only operation, focus and labels/error/empty states. Context guards supplement CAS, not replace it. Avoid unrelated redesign.

### QC06 — Actual browser performance
Retain historical 5k/10k observations; test actual browser repeated AND diverse workload, known plus real S2 discovery, long valid forms, bounded library sizes, dense pack hints and suggestions, multiplicity, cold/warm, limit+1, cancel/restart and output parity. Measure build, match, NLP, generation, lookup, rank, render separately; main-thread responsiveness/memory where available. Repeat workloads and state methodology. If a requested 5k/10k diverse case cannot be constructed within limits, explain and use closest valid workload with actual counts. Never claim production capacity or substitute mocked NLP/unit ranking for full browser work. Preserve complete raw outputs or reproducible fixture evidence.

### QC07 — Privacy, persistence and recovery
Use unique synthetic sentinels in source, pack and evidence. Integrated ingestion→S2→rank→pack→review→approval→reload→presentation export→backup→independent empty-context restore→retention/delete→session clear. Audit same-origin and external network destinations and payloads, workers and restored context, URL/log/storage/backup surfaces. Verify semantic equivalence of canonical snapshots and restored backup (IDs, revisions, references, audit/integrity fields); verify no canonical writes from rank/pack and no unauthorized persistence. Existing WP01 tests remain. Record limitations of environment instrumentation; do not equate zero external requests with complete privacy audit.

### QC08 — Conditional DOCX
D3 remains BLOCKED, disabled and explicitly excluded. AI Studio cannot safely run the previously proposed native G1 dependency probe because the authoritative npm lock may be absent and changes are not authorized. Do not add DOCX code, selector, packages, custom ZIP/XML stack or remote converter. Reuse existing dossier and record precise remaining G1 evidence: exact candidate pins, SRI, transitive license/notice/vulnerability, browser bundle, bounded decompression including malformed/encrypted/macro/archive amplification, entity/external relationship rejection, cancellation, coordinate/omission semantics. No broad renewed research. Core bounded WP02 engineering can complete with D3 excluded; separate G1 and owner approval required to enable later.

### QC09 — Reconcile and verify
Finite matrix D1–D12 and QC01–QC09: CLOSED—VERIFIED, BLOCKED—CONDITIONAL/EXCLUDED, OPEN—MANDATORY BLOCKER, and where needed IMPLEMENTED—VERIFICATION BLOCKED (environment). Complete mandatory work, do not expand scope with speculative optimizations. Recompute controlled six-way S1/S2 x source-order/frequency/C-value if changed; use same corpus/settings, exact counts, matched cold/warm where feasible, negative cases, no G5 claim. Final review of source/tests; if no independent reviewer available explicitly label self-review.

Run supported typecheck, full unit tests, build, gate and native E2E where safe and possible; use browser inspection to cover integrated and adversarial flows. Capture exact commands, exit codes, counts, environment versions, measured data, blocked reasons, regression outcomes, lock integrity where present. Do not claim npm ci or native gate/E2E passed unless actually run. No lint script exists; do not invent one. Do not remove valid tests to obtain green results.

## 4. Deliverables and verdict

Create docs/evaluation/WP02-AI-STUDIO-CLOSURE.md with actual evidence and finite closure matrix, initial transfer result, changed paths, confirmed fixes, regression results, browser measurements, privacy/backup evidence, controlled comparison changes, DOCX exclusion, residual limitations, decisions and next action. Update acceptance and implementation ledger without deleting historical reports. Keep transfer manifest/copies intact for reproducibility; they are inert documentation, not a runtime data source.

Use verdict:
- IMPLEMENTED — INDEPENDENT QUALIFICATION PENDING (if mandatory engineering work completed but native/independent qualification unavailable);
- NOT QUALIFIED — REMEDIATION REQUIRED (if mandatory defects or implementation gaps remain).

Do not issue independent qualification on the basis of AI Studio self-verification. Existing independent report remains historical. G4 NOT READY, G5 NOT ESTABLISHED, no release approval. No WP03. Do not push/merge automatically; owner performs sync manually. If interrupted, record completed checkpoints and precise next item. Return concise actual report and stop before WP03.

Begin implementation now, starting with verified local transfer.
