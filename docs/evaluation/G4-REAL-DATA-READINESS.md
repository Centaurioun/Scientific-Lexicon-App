# Gate G4 — Real-Data Readiness Assessment (Separate from G3)

> **Independent local update (2026-11-27):** The two-tab conflicting-write E2E now issues the two approvals concurrently, and the full local browser suite passed (15/15). See [WP01 independent qualification](WP01-INDEPENDENT-QUALIFICATION.md). This updates criterion 1's former “Codex confirmation required” note. It does not lift G4: stable origin, process restart, actual quota, migration/blocked-upgrade, realistic scale, S3 intake, and owner approval remain unresolved. Candidate-count limits also remain an S1/G3 contract gap.

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
| **10. Independent Codex Local Gate (`npm run test:gate` + `npm run test:e2e`)** | **PASS (Local WP01 qualification)** | On 2026-11-27, lockfile hash matched the expected SHA-256; `npm ci`, dependency gate (4/4), unit suite (38/38), typecheck, production build, and Playwright (15/15) passed. G4 remains blocked by the separate criteria above. |

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
