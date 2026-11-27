# Gate G4 — Real-Data Readiness Assessment (Separate from G3)

> **Independent local update (2026-11-27):** The two-tab conflicting-write E2E now issues the two approvals concurrently, and the final local browser suite passed (19/19 across 13 spec files). See [WP01 independent qualification](WP01-INDEPENDENT-QUALIFICATION.md). This updates criterion 1's former “Codex confirmation required” note. It does not lift G4: stable origin, process restart, actual quota, migration/blocked-upgrade, realistic scale, S3 intake, and owner approval remain unresolved. The separate processing-limit contract closure is documented in the qualification report; this does not lift any real-data G4 blocker.

**Application:** TermForge (`Centaurioun/Scientific-Lexicon-App`)  
**Assessment Date:** 2026-11-27  
**Relationship to G3:** Strictly separate from synthetic S1 acceptance (`docs/evaluation/S1-ACCEPTANCE.md`). Synthetic G3 verification does **not** grant real-data authorization.  
**Relationship to G5:** Scientific terminology extraction accuracy (G5) is **NOT ESTABLISHED**.

---

## 1. G4 Real-Data Readiness Verdict

**Verdict: NOT READY / BLOCKED FOR REAL PERSONAL TERMINOLOGY OR MANUSCRIPTS**

Real unpublished manuscripts, real personal terminology lists, and legacy data imports remain **PROHIBITED** until all G4 durability/origin/operational gates below and planned **S3 intake safeguards** are explicitly completed and approved by the owner.

---

## 2. G4 Readiness Evidence Table

| G4 Readiness Criterion | Status | Observed Evidence & Gaps |
|---|---|---|
| **1. Two-tab simultaneous conflicting writes** | **PASS (Synthetic local Playwright)** | Independently rerun in local Chromium on 2026-11-27: both independently approved Rev 0 proposals are submitted concurrently; one applies, one fails stale, both tabs converge on exactly one Rev 1 record. This is synthetic browser evidence, not a production data test. |
| **2. Explicit browser storage persistence status & origin-isolation disclosure** | **PASS (UI & API Integration)** | `BackupPanel.tsx` calls `navigator.storage.persisted()` / `estimate()` / `persist()`, displays explicit `not granted (false)` warning, reminds users that browser storage is origin-isolated and not a permanent backup, and provides one-click persistence request + SHA-256 backup export. |
| **3. Atomic abort rollback & empty-target restore drill** | **PASS (Synthetic Chromium IndexedDB)** | Verified via `tests/browser/storage-harness.ts` (16/16) and `tests/browser/restore-harness.ts` (8/8) + empty-context browser UI restore round-trip producing exact SHA-256 digest parity. |
| **4. Stable, non-disposable production origin** | **BLOCKED** | Current testing runs on localhost / disposable AI Studio preview origins (`*.run.app` / `*.scf.usercontent.goog`). IndexedDB is strictly bound to origin; switching preview URLs strands or loses local data. Real data requires a permanent, dedicated local or self-hosted stable origin before use. |
| **5. Full browser process restart & OS reboot durability** | **NOT TESTED** | Headless Chromium sessions in container use ephemeral profiles. Real-browser persistence across full Chromium/Firefox/Safari restart with `navigator.storage.persist()` grant must be tested manually on the target personal workstation. |
| **6. Real browser storage quota exhaustion & eviction handling** | **NOT TESTED (Real Quota)** | Synthetic denied-`indexedDB` handling (`SecurityError`) and transaction abort rollback are verified (`library-ui.spec.ts`, `storage-harness.ts`), clearly distinguished from true OS/browser `QuotaExceededError` under disk pressure. Must be exercised on target hardware before retaining large manuscript corpora. |
| **7. Realistic IndexedDB schema migration (`v1 → v2`) & blocked-upgrade drill** | **NOT TESTED** | Currently at Dexie schema `version(1)`. No real v1→v2 upgrade path or multi-tab `versionchange` / `blocked` event drill has been executed yet (no v2 schema exists in S1). Must be validated on a backup copy before any future schema migration touches real data. |
| **8. Realistic scale & latency stress test (e.g., 10k–50k expressions + 200k-char manuscript)** | **NOT TESTED** | Synthetic functional tests verified small libraries and 200k char boundary rejection (`extraction.test.ts`). Full interactive latency, Worker memory footprint, backup JSON serialization time, and Aho–Corasick index rebuild cost at production lexicon scale remain unmeasured. |
| **9. S3 Legacy / Personal Data Intake Safeguards** | **BLOCKED (Not Planned/Implemented in WP01)** | Per `MASTER-DESIGN-BASELINE-v1.0.md`, importing legacy spreadsheets/terminology lists requires dedicated S3 staging, diffing, conflict review, and rollback safeguards not included in WP01. |
| **10. Independent Codex Local Gate (`npm run test:gate` + `npm run test:e2e`)** | **PASS (Local WP01 qualification)** | On 2026-11-27, lockfile hash matched the expected SHA-256; `npm ci`, dependency gate (4/4), unit suite (51/51 across 13 files), typecheck, production build, and Playwright (19/19 across 13 spec files) passed. The lockfile SHA-256 remained `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`. G4 remains blocked by the separate criteria above. |

---

## 3. Capacity, Retention & Privacy Risks to Manage Before G4 Approval

1. **Irrevocability of Downloaded Backups Containing Retained Sources:** Deleting a retained source in TermForge removes it atomically from IndexedDB, but any previously exported portable backup file (`.json`) that included that retained source remains on the user's filesystem until manually deleted by the user. (Explicitly disclosed in both the retention consent checkbox and the retained-sources table.)
2. **Origin Eviction Risk:** Without `navigator.storage.persist() === true` on a stable origin, browsers may evict IndexedDB under storage pressure. Users must treat downloaded SHA-256 verified portable backup files stored outside the browser as the durability boundary.
3. **Unvalidated Scientific Accuracy (Pre-G5):** Candidate discovery uses local Wink NLP (`wink-eng-lite-web-model@1.8.1`) plus `s1-grammar-1` deterministic noun-phrase/symbol heuristics. Every candidate requires explicit human terminology review; `"preferred"` denotes a local editorial designation, not independent scientific verification.

---

## 4. Required Exit Criteria Before Lifting the Synthetic-Only Restriction

1. Independent Codex local execution passes `npm ci`, `npm run test:gate`, `npm run typecheck`, `npm run test`, `npm run build`, and `npm run test:e2e`.
2. Target workstation deployment runs on a permanent, non-disposable origin with documented backup-file storage routine.
3. Manual workstation G4 drills pass and are logged: full browser restart durability, real storage-persistence verification, realistic scale sample timing, and backup-restore drill on a separate clean profile.
4. S3 intake safeguards are separately planned, implemented, and approved before any bulk import of existing personal terminology lists.
5. Explicit human owner sign-off on Gate G4.

## WP02 transition update — 2026-11-27
Independent native GitHub Actions (not Codex-specific) passed at `f7857d8d9e11fbcd5e40b1731f8ad52217ea54fd`, run 46042674468: npm ci, 4/4 gate, 114 unit, 28 E2E, 2 production observations, typecheck/build/audit/lock integrity. Criterion 10 evidence refreshed only for this commit. [WP02 bounded acceptance](WP02-FINAL-QUALIFICATION.md). [WP03 E1–E11](../WP03_DATA_OPERATIONS.md) authorizes synthetic development of intake safeguards and additional operational probes, not real intake. Criterion 9 is planned, not yet implemented; remaining actual origin/restart/quota/migration/scale/rights/approval blockers remain. G4 NOT READY. No real data.

---

## WP03 E9 & E10 Synthetic Operational Evidence Update — 2026-11-27

**G4 Verdict Remains: NOT READY / BLOCKED FOR REAL PERSONAL TERMINOLOGY OR MANUSCRIPTS**

WP03 (`E1–E11`) implemented the bounded synthetic S3 intake safeguards (`src/domain/delimited-intake.ts`, `src/application/delimited-file.ts`, `src/domain/staging-mapping.ts`, `src/domain/staging-review.ts`, `src/application/import-planner.ts`, `src/features/exchange/DataOperationsPanel.tsx`), the read-only library quality and maintenance inspector (`src/application/quality-inspector.ts`, `src/features/exchange/QualityInspectorPanel.tsx`), and automated synthetic operational probes (`tests/unit/wp03-recovery-privacy.test.ts`, `tests/unit/g4-operational-probes.test.ts`, `tests/e2e/s3-data-operations.spec.ts`).

### 1. Classification of WP03 G4 Evidence vs. Remaining Manual Workstation Blockers

| G4 Readiness Dimension | Evidence Class | WP03 Synthetic Observation (`tests/unit/g4-operational-probes.test.ts` & `wp03-recovery-privacy.test.ts`) | Remaining Real-Data Blocker |
|---|---|---|---|
| **Criterion 1 & 3: Two-instance CAS race, atomic rollback, and independent empty-context restore parity** | **Automated Synthetic Probe (`PASS`)** | Simultaneous two-instance CAS race at `baseLibraryRevision: 0` commits winner (`status: 'applied', revision: 1`) and rejects loser (`status: 'stale'`) without silent overwrite. Full stage -> preview -> pre-commit backup -> atomic 250-op limit commit -> reload -> presentation export -> independent empty-context restore reproduces identical canonical JSON and SHA-256 digest. | Must still be exercised on the owner's stable workstation profile as part of manual G4 sign-off. |
| **Criterion 6: Storage denial, quota exhaustion, and mid-transaction abort** | **Simulated Error Probe (`PASS — SIMULATED ONLY`)** | Injected `SecurityError`, `QuotaExceededError`, and mid-transaction `AbortError` fail closed without silent in-memory fallback and roll back all stores (`concepts`, `expressions`, `assertions`, `provenance`, `documents`, `runs`, `batches`, `audit`). | **NOT TESTED on real OS disk pressure.** Simulated exceptions do not replace physical workstation disk/quota exhaustion testing. |
| **Criterion 7: Schema migration (`v1 → v2`) & blocked-connection awareness** | **Isolated Synthetic Harness Probe (`PASS — ISOLATED HARNESS`)** | Isolated representative `v1 → v2` additive upgrade harness verifies `blocked-by-open-connection` detection when an older v1 connection remains open and clean additive upgrade once closed, without modifying production `termforge-library-v1` (which remains strictly at schema `v1`). | Any future production Dexie `version(2)` migration must be tested against a backup copy on a real browser profile before touching real data. |
| **Criterion 8: Realistic 10,000 and 50,000 expression scale & 16 MiB backup bound** | **Automated Synthetic Scale Probe (`MEASURED`)** | **10,000 expressions (5,000 concepts):** Aho-Corasick matcher rebuild + search `88–102 ms`; 250-op staged review + additive import plan `279–351 ms`; quality inspection `133–169 ms`; CSV export projection `29–35 ms`; portable backup `473–621 ms` producing `6,398,153 bytes` (`~6.10 MiB`, within the `16 MiB` limit).<br>**50,000 expressions (25,000 concepts):** Matcher rebuild + search `1,378–1,744 ms`; 250-op staged review + additive import plan `931–1,165 ms`; quality inspection `658–727 ms`; CSV export projection `115–139 ms`; portable backup serialization (`2,133–2,587 ms`) **exceeds the fixed `16 MiB` (`16,777,216 bytes`) single-file backup bound and fails closed (`exceeded16MiBFailClosed: true`) without truncation**. | Single-file portable backup v1 (`<= 16 MiB`) comfortably supports `~10,000–20,000` expressions (`~6.1 MiB` at 10k) but intentionally refuses `50,000`-expression snapshots (`~30.5 MiB`) rather than truncating. Workstation corpora exceeding `~20,000` expressions or retaining large source texts will require chunked/streaming archive design before G4 approval at that scale. |
| **Criterion 9: S3 Intake & Privacy Safeguards** | **Implemented in Synthetic Scope (`PASS — SYNTHETIC ONLY`)** | Bounded CSV/TSV intake (`<= 2 MiB`, `<= 1,000` rows, `<= 32` columns, `<= 250` atomic additive ops), raw-byte SHA-256 synthetic fixture allowlist, positional column mapping, explicit loss summary, pre-commit backup offer + acknowledgment, and strict zero-persistence of skipped rows and unmapped columns (`SYNTH_SKIPPED_STAGED_TERM_E8_DO_NOT_PERSIST` and `SYNTH_UNMAPPED_SECRET_SENTINEL_E8_DO_NOT_PERSIST` verified absent from IndexedDB, Web Storage, backups, exports, logs, and URLs). | Product UI actively blocks non-allowlisted files while G4 is `NOT READY`. Lifting the allowlist requires explicit owner G4 sign-off after manual workstation drills. |
| **Criterion 4 & 5: Stable non-disposable origin & full browser/OS restart durability** | **Manual Workstation Blocker (`BLOCKED / NOT TESTED`)** | Cannot be satisfied inside ephemeral CI or AI Studio preview origins. | Requires permanent dedicated origin, manual browser/OS restart drill with `navigator.storage.persist()`, and explicit owner G4 approval. |


## WP03 independent native transition update
Run 46058256556 at `e9f91a3b816b999599f19172cdcd84fd9f9cda23` passed 173/173 tests including new S3 E2E. [Qualification](WP03-FINAL-QUALIFICATION.md) identifies backup acknowledgment bypass and stale review plan risk; criterion 9 not fully accepted until H1/H2 fixed and independently rerun. 10k/50k backup evidence is fixture-specific, not a general capacity guarantee. G4 NOT READY; manual origin/restart/quota/migration/rights/owner gates still open.
