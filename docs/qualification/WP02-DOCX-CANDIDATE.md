# WP02 Task D3 — Local DOCX Parser Candidate Qualification Boundary

**Status:** **BLOCKED (Deferred Pending Independent G1 Qualification in Local Codex + Owner Approval)**  
**Date:** 2026-11-27  
**Application:** TermForge (`Centaurioun/Scientific-Lexicon-App`)  
**Feature State:** Disabled / Absent. No `src/adapters/documents/docx.ts` module is enabled, no `.docx` option is offered in the UI file picker, and `readDocument()` explicitly rejects `.docx` files without modifying `package.json` or canonical `package-lock.json`.

---

## 1. Why D3 Is Blocked in This Execution Environment

Per `AGENTS.md`, `docs/WP02_SCIENTIFIC_INTELLIGENCE.md`, and `docs/superpowers/specs/2026-11-27-wp02-scientific-intelligence-design.md`:

1. **No Unqualified Dependency Addition:** Adding any new browser-capable DOCX dependency requires separate Gate G1 qualification: exact pinned registry version, authoritative `package-lock.json` update with Subresource Integrity (SRI) verification, transitive license/notice audit, `npm audit`, Next.js/Turbopack browser bundle verification, and hostile ZIP/XML fixture execution.
2. **Authoritative Lockfile Absent in AI Studio:** This Google AI Studio container uses a Bun-managed `node_modules` graph and omits the repository's canonical `package-lock.json` (SHA-256 `0fa57c7ce340084716277312ce7e6f7d1b36a134857fde6400c97c4629267033`). Fabricating or regenerating `package-lock.json` is strictly prohibited.
3. **No Homemade Unsafe ZIP/XML Stack or Remote Converter:** Implementing an ad-hoc unreviewed ZIP/XML parser or transmitting DOCX bytes to a remote service violates approved architecture and security invariants.

Accordingly, DOCX parsing is **not enabled**, **not claimed as PASS**, and independent WP02 tasks D4–D12 continue cleanly.

---

## 2. Candidate Comparison (Static Architectural Review Only)

| Option | Summary | Key Benefits | Key Risks / Open G1 Requirements | Decision |
|---|---|---|---|---|
| **Candidate A: `mammoth` (`extractRawText` / structured AST)** | Widely used JS DOCX reader (BSD-2-Clause) capable of browser builds; wraps `jszip` + `@xmldom/xmldom` + `lop`. | Small raw-text extraction API; does not require rendering untrusted HTML when using raw text / AST hooks. | Transitive graph includes `jszip` (MIT/GPLv3 dual) and `@xmldom/xmldom` / `xmlbuilder` / `bluebird` depending on version; must inspect exact transitive licenses, bundle size, XXE/entity-expansion safeguards, zip-bomb decompression ceilings, and table/heading reading order before adoption. | **CANDIDATE FOR CODEX G1** |
| **Candidate B: Separate minimal `fflate` + browser `DOMParser` (XML) OOXML subset** | Decompress only `word/document.xml` with strict byte/entry caps via `fflate` (MIT) and parse XML via native browser `DOMParser` (no external DTD fetching in standard browsers) extracting `<w:p>`, `<w:tbl>`, `<w:t>`. | Minimal transitive dependency surface; deterministic reading order and exact section mapping (`heading`, `paragraph`, `table`) with explicit omission notices (comments, footnotes, images, revisions, headers). | Requires strict G1 qualification of `fflate`, formal OOXML namespace/tracked-changes (`<w:ins>`/`<w:del>`) test matrix, and hostile archive suite (zip bombs, path traversal, XXE/billion laughs, encrypted OOXML). | **ALTERNATIVE CANDIDATE FOR CODEX G1** |
| **Option C: Defer DOCX until G1 passes** | Keep UTF-8 `.txt` and conservative `.md` active in WP02; reject `.docx` explicitly with actionable guidance. | Zero lockfile mutation, zero security regression, zero unverified archive attack surface. | Users convert `.docx` to `.md` or `.txt` externally until G1 completes. | **SELECTED FOR CURRENT WP02 CHECKPOINT** |

---

## 3. Proposed Safe Archive Bounds & Security Contract (For Future G1 Enablement)

Before any DOCX adapter (`src/adapters/documents/docx.ts`) may be enabled after G1 approval, it must enforce all of the following fail-closed invariants (exact numeric ceilings require owner approval based on G1 benchmark evidence):

1. **Pre-read compressed archive limit:** Reject `file.size` before `arrayBuffer()` above configured DOCX compressed ceiling (proposed candidate default: `4,194,304` bytes / 4 MiB, configurable downward, subject to G1 evidence).
2. **ZIP bomb / decompression bounds:** Before inflating entries, verify ZIP entry count (proposed max `256` entries), total uncompressed XML bytes (proposed max `8,388,608` bytes / 8 MiB), and compression ratio ceiling (e.g., max `100:1`) with abort checks between entries.
3. **Hostile Archive & XML Rejection:**
   - Reject encrypted / password-protected OOXML containers (`EncryptedPackage` / CFBF header).
   - Reject macro-enabled containers (`vbaProject.bin` / `.docm`).
   - Reject XML containing `<!DOCTYPE`, `<!ENTITY`, external `SYSTEM`/`PUBLIC` identifiers, or unresolved external relationships (`TargetMode="External"` must never be fetched).
   - Never render untrusted HTML; extract immutable plain text only (`ParsedDocument.text`), with `DocumentSection` offsets referencing ONLY extracted immutable UTF-16 text (never DOCX bytes or Word layout).
4. **Explicit Omission Disclosures:** Always populate `ParsedDocument.warnings` whenever unsupported DOCX structures are encountered (images, comments, tracked revisions, fields, footnotes/endnotes, headers/footers, embedded equations/OMML).
5. **Existing Ceiling Preservation:** Final extracted text must still pass `maxTextUtf16CodeUnits` (hard max `200,000` UTF-16 code units) and `maxCandidateOccurrences` (`100`–`10,000`, default `5,000`) with zero silent truncation.

---

## 4. Exact Codex G1 Qualification Checklist

To unblock D3 in a subsequent local Codex pass:
1. Pin exact candidate version in an isolated branch and verify `npm ci --ignore-scripts --strict-peer-deps`, `package-lock.json` SRI, `npm audit`, and full transitive license/notice compliance.
2. Verify Next.js 16 Turbopack browser production build with zero Node-only polyfill leaks and zero external network calls.
3. Run synthetic round-trip + hostile fixture tests (valid paragraphs/headings/tables, zip bomb, >limit entry count, malformed ZIP, encrypted archive, `<!DOCTYPE>`/`<!ENTITY>` XXE payload, external relationship link, macro attachment, omission warnings, `AbortSignal` cancellation).
4. Present exact G1 qualification evidence to the owner for explicit approval before enabling `.docx` in `ExtractionWorkspace.tsx`.
