# P0 runtime qualification report

**Date:** 2026-11-26 | **Base:** `origin/main` at `8bd9430bf1c980d195e1c8ceb64209c985108ab1` | **Branch:** `research/p0-codex-qualification` (unmerged)
**Scope:** isolated dependency, matching, English NLP, browser storage/transaction and AI Studio compatibility qualification. No application implementation.

## Summary

| Gate | Result | Evidence and limit |
|---|---|---|
| Existing independent references | **PASS** | Exact matcher 12/12 and SQLite 16/16; checked-in Git blob hashes match the hashes recorded in the prior report. |
| R20 literal Aho–Corasick matcher | **PASS, candidate only** | Published `ahocorasick@1.0.2` ran against 13 additional synthetic fixtures with exact parity to the independent oracle; overlap/repeat behavior and a 10–100,000-key microbenchmark ran. Boundary policy remains project-owned. |
| R21 TypeScript Aho–Corasick matcher | **FAIL, published artifact** | The pinned npm tarball `@jimtkelly/aho-corasick@1.0.1` declares `main: index.js`, but the installed artifact has no `index.js`; Node loading fails with `MODULE_NOT_FOUND`. The matcher was not run against fixtures. |
| Wink NLP + English web model | **PASS, narrow English candidate** | Exact registry versions imported and ran offline under Node and in a real Brave browser bundle. All 25 token spans reconstructed against the synthetic UTF-16 source. Candidate grammar found 6/6 annotated synthetic spans (23 predictions; precision 0.261, recall 1.000) on one small fixture. Not production ATE evidence. |
| Native IndexedDB / Dexie | **PASS, synthetic browser contract** | Real browser at loopback tested multi-store commit, abort/rollback, two open database connections, review gate, stale revision, batch replay/conflict, protected verified value, clean restore (including another origin), blocked upgrade and reload. Dexie commit and rollback passed. |
| Storage durability / capacity | **PARTIAL** | Reload succeeded. `navigator.storage.persist()` returned `false`; browser estimated a 2 GiB quota and about 26–28 KiB used. Quota exhaustion, denied database access and browser-process restart were not tested. |
| Google AI Studio compatibility | **DOCUMENTED, runtime NOT TESTED** | Official documentation describes GitHub import/two-way sync, ZIP export, npm/Node server runtime, and the official Google announcement says Next.js is supported. No AI Studio account or project was opened. Browser-origin persistence inside AI Studio remains unverified. |

These are qualification observations, not an approved final architecture or permission to integrate a dependency. The owner retains the approval decision. No third-party source or data was copied into the repository.

## Environment and reproducibility

- macOS arm64; Node `v26.12.1`, npm `11.20.0`; local Python `3.14.9` (used only to run the SQLite reference script and loopback static servers).
- Browser experiments ran in Brave desktop at `http://127.0.0.1:8128/` and a second origin, `http://127.0.0.1:8129/`. Browser version was not recorded.
- Candidate packages were installed outside the repository with `--ignore-scripts`; no package lifecycle or upstream test script was run. The test harness files committed here are synthetic qualification probes, not application code.
- The report records registry artifact integrity from npm metadata; those digests are for registry tarballs and do not prove equivalence to the listed upstream Git commits.

Example isolated install and Node commands (set `QUAL_ROOT` to a disposable temporary directory):

```sh
mkdir -p "$QUAL_ROOT"
(cd "$QUAL_ROOT" && npm init -y && npm install --ignore-scripts --no-audit --no-fund --no-save \
  wink-nlp@2.4.0 wink-eng-lite-web-model@1.8.1 \
  @jimtkelly/aho-corasick@1.0.1 ahocorasick@1.0.2 \
  dexie@4.4.7 fake-indexeddb@6.2.8 esbuild@0.25.12)
export TERMFORGE_QUAL_NODE_MODULES="$QUAL_ROOT/node_modules"
node tests/qualification/p0/exact-match-oracle.mjs
python3 tests/qualification/p0/sqlite-reference.py
node tests/qualification/p0/matcher-spike.mjs
node tests/qualification/p0/wink-spike.mjs
```

The browser page uses `tests/qualification/p0/browser-storage.html` and `.js`; serve that directory at port 8128 and `portable-restore-origin.html` and `.js` at port 8129, with `/dexie.js` pointing to the installed `dexie/dist/dexie.js`. For the browser NLP check, copy `wink-browser-entry.js` to the isolated package directory, bundle it with that directory’s `esbuild` executable (`--bundle --platform=browser --format=iife --minify`), and serve the result as `/wink-browser.bundle.js`. The harness deletes only its named synthetic test databases before each clean run.

### Existing reference tests

Executed from repository root:

```text
node tests/qualification/p0/exact-match-oracle.mjs
12/12 exact-match oracle cases passed

python3 tests/qualification/p0/sqlite-reference.py
16/16 SQLite reference checks passed
```

The raw file hashes differ from the documented values because the documentation records Git blob IDs. Recomputed blob IDs match exactly: matcher `b9eea5dc4a900b8ab4a6ed210ae7976f2484a782`; SQLite `005c0859f8c1aaedc766a2a30521afbe5df6a0c1`.

## Workstream A — matching

### Registry and artifact qualification

| Candidate | Pinned upstream evidence | Registry artifact | License / package details | Result |
|---|---|---|---|---|
| R20 `ahocorasick` | `https://github.com/BrunoRB/ahocorasick`, `374247f612a189ddb0f1cd7543495540753702fb` | `1.0.2`; SHA-512 SRI `sha512-hCOfMzbFx5IDutmWLAt6MZwOUjIfSM9G9FyVxytmE4Rs/5YDPWQrD/+IR1w+FweD9H2oOZEnv36TmkjhNURBVA==` | MIT; no runtime dependencies in package manifest; `main` is `src/main.js`; test script exists but was not run. | Loaded and executed. |
| R21 `@jimtkelly/aho-corasick` | `https://github.com/jamestkelly/aho-corasick`, `0548e812e0ebfcf24cd5f299d2cf1cd35b3fd58b` | `1.0.1`; SHA-512 SRI `sha512-VQ7fX4sANCFUlNqNxnFO5gO79cQZIBm0P++x8plOgT/nZu/11VM24WaHYRmgbG/p7gNsiJzPm822oN5E+Op9LQ==` | MIT; package declares `main: index.js`, but tarball includes TypeScript under `src/` and has no `index.js`. Its package manifest also declares `babel-jest`, `prettier` and `ts-jest` as runtime dependencies. | `require()` failed before matcher tests. |

`npm view` also returned a newer R21 release (`1.2.0`), but it was not substituted: the task pinned the 1.0.1 source revision, and silently changing the artifact/version would make the comparison non-equivalent. Corrected packaging and a new pinned review are needed before retesting.

### Synthetic parity and boundary contract

The R20 probe compares package results with a project-independent `String.indexOf` oracle and adapts inclusive end positions to half-open UTF-16 spans. It passed 13/13 cases: nested overlaps, repeated occurrences, two IDs associated with one same-surface match, IL-1/IL-11, CD4+/CD4++, HLA-B/HLA-B27, hyphen, underscore, punctuation, ligature literal behavior, composed/decomposed accents, Turkish I/İ/ı, Greek, emoji offset, and empty-key rejection.

The fixture policy explicitly treats letters, marks, numbers, underscore and adjacent `+` as token characters; hyphen remains a separator. Thus CD4+ is rejected inside CD4++, while an exact standalone CD4+ hits; HLA-B is rejected inside HLA-B27; a base TNF-α hit after a hyphen is accepted; and canonical-equivalent spellings do not match unless literally registered. These are experiment choices, not an approved universal scientific boundary policy. Context-sensitive gene/protein case, inflections, punctuation and normalization policy remain open.

The adapter deduplicates literal keys for matching and fans a matching span back out to associated candidate IDs. This preserves homograph candidates in the synthetic probe. It does not resolve concepts or report a single “correct” concept.

### Microbenchmark

Five scan repetitions after warmup; median reported. For each dictionary size, the indexOf baseline and R20 use the same deterministic synthetic keys and identical search text; the generated text is 10,000 UTF-16 code units for 1k, 10k and 100k keys. The 10-key fixture uses 100 code units. Build and scan were measured separately; both scanners returned identical 1,000-hit outputs for sizes ≥1,000. Heap deltas are single-process approximate deltas and can be noisy under GC.

| Keys | Text UTF-16 units | Build ms | Approx. build heap delta | Oracle median scan ms | R20 median scan ms |
|---:|---:|---:|---:|---:|---:|
| 10 | 100 | 0.010 | noisy / negative under GC | 0.003 | 0.010 |
| 1,000 | 10,000 | 0.579 | 467,912 B | 4.712 | 0.279 |
| 10,000 | 10,000 | 3.843 | 5,211,744 B | 52.466 | 0.337 |
| 100,000 | 10,000 | 1,895.703 | 46,194,088 B | 521.840 | 1.365 |

This synthetic run suggests R20 scan time becomes lower than repeated `indexOf` for the tested larger dictionaries. It also shows nontrivial build time and memory at 100,000 keys. It does not establish end-user latency, browser worker impact, update/rebuild costs, or realistic library size. At 10 keys, the simple baseline was faster.

**Recommendation:** retain R20 as an **ADOPT candidate**, subject to final owner decision, project-owned boundary fixtures, target browser measurements, and full dependency/notice review. Put the exact R21 npm artifact on **HOLD** pending packaging repair; do not select it based on the source-only tests in its upstream repository.

## Workstream B — NLP

`wink-nlp@2.4.0` and `wink-eng-lite-web-model@1.8.1` were available at the exact versions recorded in R07/R08. Registry SHA-512 SRI values:

- `wink-nlp@2.4.0`: `sha512-d02inlNJL0LLNTLoYfkxZYGrqnYDSZV4HI4WpeuyIEfpu7UcUqUW1ZYWr+JTFm4ZR6dQdzOW/FtHEQRO+o/zzA==`
- `wink-eng-lite-web-model@1.8.1`: `sha512-M2tSOU/rVNkDj8AS8IoKJaM7apJJjS0cN+hE8CPazfnB4A/ojyc9+7RMPk18UOiIdSyWk7MR6w8z9lWix2l5tA==`

Both declare MIT; the model package is separately licensed from the engine. No runtime model download occurred. Node import/token/POS/sentence execution succeeded offline. A generated browser bundle ran in Brave: minified output 3.5 MiB, gzip 1,026,655 bytes. One cold Node run showed about +32.1 MB heap and +69.2 MB RSS after engine/model load; this is a single-process observation, not a calibrated memory benchmark. The installed model README documents Node 16/18; this machine used Node 26.12.1, so that Node version was experimentally successful but outside the model's documented Node target.

The synthetic source includes `TNF-α`, `NF-κB`, `CD4+`, “loss of heterozygosity”, “Gram staining”, `p53`, an emoji, spaces and punctuation. Wink splits symbolic forms (for example `TNF`, `-`, `α`) and emits English POS tags. Exact source spans were reconstructed from token values and `precedingSpaces`; all 25 tokens matched their original half-open UTF-16 source slices in both Node and browser runs.

An illustrative rule grammar over six hand-annotated fixture spans produced:

| Candidate generator | Exact gold spans found | Candidates | Precision | Recall |
|---|---:|---:|---:|---:|
| Simple NOUN/PROPN/ADJ sequence baseline | 3/6 | 14 | 0.214 | 0.500 |
| Wink POS plus symbol-aware sequence grammar | 6/6 | 23 | 0.261 | 1.000 |

The Wink grammar emitted many fragments and adjacent noun phrases; its apparent perfect recall is only on six synthetic labels in one text. This is not a production accuracy claim, corpus benchmark, Turkish extraction result, or proof of candidate ranking quality. It does show that unknown candidates can be generated with an empty known-term dictionary; matching alone cannot do this. `CD4+` is handled by explicit symbol-aware grammar logic, not by an NLP model semantic judgment.

**Recommendation:** **ADAPT** Wink as a provisional English token/POS/sentence candidate-feature source, keeping literal matching and source spans separate. Do not use its general-English NER as scientific ATE or treat its output as verified terminology. Revisit runtime support at the project's chosen Node version, worker behavior, model bundle cost and an independent, adequately sized annotated corpus before approval.

## Workstream C — domain and browser storage

The test page used only synthetic records and minimal local stores for concepts, expressions, batches and staged records. It exercised native IndexedDB and Dexie 4.4.7 (Apache-2.0; 96,272-byte minified distribution, 31,036-byte gzip; no runtime dependencies in its package manifest). `fake-indexeddb@6.2.8` (Apache-2.0) was available in the isolated install but was not used as evidence because a real browser was available.

Observed checks in actual Brave browser:

- staged record remains separate from canonical concepts;
- write requires an explicit approved flag;
- one read/write transaction updates concept, expression and batch stores;
- exact batch/digest replay is a no-op; same batch ID with another digest conflicts;
- broken expression reference rejected by the adapter; stale revision from the second independent open connection does not write;
- injected transaction abort rolls back all three stores and preserves prior values;
- update of a verified expression is rejected and its value stays unchanged;
- Dexie multi-store transaction commits; injected exception rolls it back;
- versioned JSON restores into an empty database under the original origin and into a second clean origin on port 8129; invalid envelope/reference is rejected before writes;
- version 2 open receives a real `blocked` event while the other connection is held open; closing that connection allows an additive schema upgrade; prior data remains readable;
- page reload reads the persisted revision 2 record;
- `navigator.storage.persist()` returned `false`. The browser reported an estimated 2,147,483,648-byte quota with roughly 26–28 KiB used.

The database validation, approval check, digest comparison and protected-field policy here are small test adapters written for this probe, not an app/domain implementation. The “digest” values are synthetic strings; canonical payload hashing is not tested. Two database connections were opened in the same browser tab and writes were sequential; simultaneous multi-tab contention was not exercised. Version upgrade only added a marker store, not a real data migration. Restore validates a minimal synthetic envelope, not a frozen/export-compatible product schema. Persistence across page reload passed, but browser process restart and actual storage eviction were not tested. A false persistence grant is not proof that normal IndexedDB access is denied. Quota exhaustion and permission-denied storage paths remain open.

**Recommendation:** keep native IndexedDB as the **ADOPT candidate substrate** and Dexie as an **ADOPT candidate convenience adapter** for the browser-first proposal. The observed transaction ergonomics favor Dexie for scoped multi-store work, but do not approve either for product integration until the actual domain schema, genuine simultaneous cross-tab race, migration/recovery policy, quota/denial handling and deployed-origin persistence are verified. Do not select SQLite for the browser application based only on its passing independent reference test.

## Workstream D — Google AI Studio compatibility

Official Google documentation reports Build mode can import an existing project from GitHub, sync changes bidirectionally, export code as ZIP, use npm packages in a Node.js server runtime, and build web apps; Google's official March 2026 announcement says Next.js is supported. Sources: [AI Studio Build mode documentation](https://ai.google.dev/gemini-api/docs/aistudio-build-mode) and [Google's Build mode announcement](https://blog.google/innovation-and-ai/technology/developers-tools/full-stack-vibe-coding-google-ai-studio/).

This establishes a documentary fit for the proposed export-then-engineer route, not runtime proof. The owner's AI Studio account, project, import/sync flow, preview origin, browser worker support, IndexedDB persistence or credential behavior was not accessed or tested. A future owner-authorized compatibility probe should use an empty synthetic Next.js project, check package install/bundle and worker availability, determine whether preview origin is stable, and test IndexedDB reload/eviction separately; retain ZIP export as fallback.

## Licensing and supply-chain notes

Registry metadata declares MIT for Wink engine/model and both matcher packages; Dexie and fake-indexeddb declare Apache-2.0. No source was vendored and no package lock or dependency manifest was added to the project root. The isolated combined npm install produced a 571-package lock graph, largely due to R21's declared test/build dependencies being published under `dependencies`. Registry license metadata reported MIT, ISC, BSD, BlueOak, Apache-2.0, and a `caniuse-lite` entry marked CC-BY-4.0; no package lacked a metadata license field. This is not a full source-text, notice, provenance, vulnerability or transitive-rights audit. Do not redistribute or integrate the bundle until applicable dependency notices and compatibility are reviewed. The repository remains without a project-wide license.

## Open issues before final architecture approval

1. Define/approve a scientific EN/TR boundary, case, normalization and punctuation policy with gene, protein, chemical, abbreviation and inflection examples; expand beyond the 13 synthetic matcher cases.
2. Repair/release and pin a loadable R21 artifact, or keep R21 on hold and decide whether R20’s 100k build/memory profile is acceptable.
3. Evaluate candidate ranking on independent, annotated English data; add Turkish and mixed-language evaluation before any bilingual extraction claim.
4. Test Wink on the intended Node runtime and realistic app bundle/worker constraints; examine missing/adverse candidates instead of relying on upstream accuracy claims.
5. Validate the domain crosswalk in a real schema, add concurrent two-tab transactions, realistic migrations, denied/quota paths, backup compatibility, browser restart and persistence under a stable target origin.
6. Obtain owner authorization for an AI Studio compatibility probe and inspect actual account/runtime behavior; docs alone do not qualify platform persistence.
7. Complete version-pinned transitive license/NOTICE review and maintenance/security review before adopting any dependency.

No architecture is finalized by this report. Reconcile the evidence with the owner-supplied baseline and seek owner approval before application implementation.
