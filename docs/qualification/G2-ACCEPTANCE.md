# G2 acceptance — bounded S0 compatibility qualification

**Decision:** **ACCEPTED WITH BOUNDED LIMITATIONS** for the corrected S0 source and the observed/reported Google AI Studio HTTPS preview. This permits the synthetic-only production starter and WP01. It does not approve G3, G4 real-data readiness, G5 scientific accuracy, or release.

**Accepted artifact:** `Centaurioun/Scientific-Lexicon-S0` commit `7608522a8e4a5dae4c535013e3cd5c58717aae91`.

**Source identity:** The owner reports that the AI Studio dashboard's source identifier exactly matched the corrected source. The recorded identifier is `sha256-03859df6ccaefa7cf0f82fcd793e40a691f1cc1f6ac093fa124d98f325c10100`.

## Evidence and provenance

| Evidence class | Evidence | Bounded conclusion |
|---|---|---|
| Independent local verification (prior S0 review) | `S0-VERIFICATION.md`, based on commit `7608522…`; canonical `package-lock.json` SHA-256 `86f08dcb65f2d6e9b636ff3e34cb2fde943d778e24023f57d7cd996dcf5543ff` | Corrected engine, storage, backup, restore and reload behavior passed the local dependency gate, unit, type, build and Playwright checks. This task did not repeat S0 functional tests. |
| Owner-reported hosted evidence | Source ID exact match; hosted HTTPS probes PASS; AI Studio unit tests 9/9 PASS; TypeScript and production build PASS; hosted screenshots reviewed by ChatGPT | Supports compatibility of the corrected code with the actual preview. The screenshots and AI Studio project were not independently reopened in this task. |
| Owner-reported lock review | Complete `bun.lock` compared with canonical npm lock: 87 entries on each side; 86 match by version and SRI; all 12 direct dependencies match; no missing/additional entries; one `baseline-browser-mapping` patch version difference; three optional peer metadata differences involving `sharp` and `styled-jsx` | Supports a close development-graph correspondence. The full `bun.lock` artifact was not attached to this task, so the graph comparison is recorded as owner-supplied/reviewed evidence, not independently recomputed here. |
| Independently checked package metadata | npm registry metadata for `baseline-browser-mapping@2.11.39` and `2.11.40`: both Apache-2.0; project release `v2.11.0` says it removed the vulnerable `process.exit()` behavior | Both reported lock versions exceed the fixed version for CVE-2026-45819. The package difference is a patch-level metadata/data update, not a direct dependency mismatch. |
| Reported environmental limitation | AI Studio's native npm dependency gate and Playwright runner remain environmentally limited | Neither is recorded as passing. Canonical npm gate/build and independent Playwright evidence remain the reproducible verification reference. |

The project release notes identify `v2.11.0` as removing the `process.exit()` behavior associated with CVE-2026-45819; registry metadata identifies the compared versions as Apache-2.0. Both `2.11.39` and `2.11.40` are later than the fixed version. [Project v2.11.0 release](https://github.com/web-platform-dx/baseline-browser-mapping/releases/tag/v2.11.0) · [npm package metadata](https://www.npmjs.com/package/baseline-browser-mapping) · [CVE record](https://nvd.nist.gov/vuln/detail/CVE-2026-45819).

## Lockfile policy

- The S0 repository's npm `package-lock.json` remains the controlled, byte-identified lock for reproducible local installs and source exports.
- Google AI Studio's Bun resolution is accepted as a separately documented development environment because the owner reports a complete graph comparison with every direct dependency equal, no package-set drift, and only the single fixed patch-level mapping update plus optional peer metadata differences.
- The application starter has its own newly qualified root `package-lock.json` for the additional Zod/Vitest/Vite dependencies. Do not replace it with a generated Bun lock. If AI Studio produces or refreshes `bun.lock`, keep it separate and record its graph; this does not change the npm lock authority.
- The application `.gitignore` excludes AI Studio's generated `bun.lock` and `.bun/` state so the workspace can use Bun without silently overwriting or substituting the versioned npm lock. A future owner-reviewed Bun graph can be attached as separate evidence.

## Preview origin configuration

The S0 `next.config.ts` preview list was preserved: `127.0.0.1`, `*.run.app`, `**.run.app`, `*.scf.usercontent.goog`, and `**.scf.usercontent.goog`. Next.js documents `allowedDevOrigins` as development-only; `*` matches one hostname label and `**` matches one or more labels. These patterns broadly allow hosts below the preview suffixes. They are not production-origin restrictions. [Next.js allowedDevOrigins](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).

## Remaining limits

1. AI Studio's native `npm run test:gate` and its Playwright runner have not passed; do not claim otherwise. Their environment limitations do not block this bounded G2 decision because the canonical npm graph was independently gated and the complete Playwright suite passed independently on the accepted S0 source, while actual hosted probes and exact source identity are owner-reported PASS.
2. Hosted visual and runtime evidence was supplied and reviewed by the owner/ChatGPT; it was not independently re-opened in this Codex execution.
3. This decision does not qualify real terminology, manuscripts, scientific extraction accuracy, persistence durability beyond browser observations, multi-user/cloud operation, or production release.

## Six-cycle decision record

1. **Intent and scope:** decide only S0 host compatibility sufficiently to enter the synthetic S1 starter; no S1 functionality is inferred from S0.
2. **Architecture and semantics:** preserve the approved browser-local Next/React/TypeScript design and preview-only origins; keep canonical npm lock authoritative.
3. **Evidence and reuse:** reuse P0/G1/S0 verification and the owner-supplied final AI Studio/lock review; do not repeat functional research.
4. **Failure and integrity:** inspect the only reported package-version difference; both versions are Apache-2.0 and beyond the fixed CVE version. Keep native runner failures classified as environmental limits, not PASS.
5. **Efficiency and delivery:** record the decision once, then qualify only WP01's newly required packages and their resulting app lock.
6. **Challenge and reconcile:** separate reported hosted checks, independent local checks and unpassed AI Studio native gates; accept bounded S0 compatibility, while keeping G3/G4/G5 separate.
