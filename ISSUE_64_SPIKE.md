# Issue #64: unchanged indexed note — freshness / duplicate detection spike

## Decision

- **A — Evaluation freshness: UNSAFE / INCOMPLETE** for authorization through
  mutation. `Vault.read()` plus the existing opaque fingerprint can compare the
  evaluated string with a newly read disk snapshot. That narrower comparison is
  possible using public API; it is not a lock or a proof about later content.
- **B — Duplicate prevention: UNSAFE / INCOMPLETE.** Frontmatter helpers bind
  their output to the supplied string, but do not parse inline tags. Cache
  positions can corroborate literals, not prove the absence of current tags.
  Exact literal detection has a documented case-insensitivity false negative;
  no complete Unicode/case/parser contract was established for a broader guard.
- **Overall: NO SAFE PUBLIC-API STRATEGY FOUND** for unchanged pre-indexed notes
  under the approved constraints. Keep the existing fail-closed preparation.

This is a bounded investigation result, not a claim that no future public API
could solve the problem. No production behavior, authorization, Apply wiring,
dependency, version, release, or user Vault has been changed. Desktop runtime
execution for this spike is **NOT VERIFIED**. The investigation and synthetic
evidence are reviewable; full Issue completion / HUMAN MERGE READY must not be
claimed from unit fakes or the earlier PR's runtime observations.

## Inputs and boundaries

Investigation date: 2026-10-02 JST. Human approval is the explicit request to
execute #64 and its pasted read-only scope. Initial detached HEAD was
`73ff52eaa3c30265481e3d04f00b2617476c9c3b`, with a clean working tree.
`git ls-remote` and `git fetch origin` established latest main as
`4f6958ad3ec159f9d17ae65afe9ba75ea814cd21`; work uses
`codex/issue-64-tag-freshness-spike` from that baseline.

Read [Issue #64](https://github.com/taichocop/jevault/issues/64),
[Issue #60](https://github.com/taichocop/jevault/issues/60),
[Issue #62](https://github.com/taichocop/jevault/issues/62),
[PR #61](https://github.com/taichocop/jevault/pull/61), and
[PR #63](https://github.com/taichocop/jevault/pull/63), plus [AGENTS.md](AGENTS.md),
[LOOP](agent/LOOP.md), [STOP](agent/STOP_CONDITIONS.md),
[REVIEW](agent/REVIEW.md), and [PR review loop](agent/PR_REVIEW_LOOP.md).
There is no local `docs/` tree at this baseline. Requirements used here are the
active Issue, relevant predecessor Issues, README's read-only Tag Suggest
section, PRIVACY's operation-scoped fingerprints, and current code/tests.
#64 explicitly permits a read-only current-body spike; #60's prohibition on a
production Apply body-read fallback remains unchanged.

Inspected the six requested `src/tags/` boundaries, `NoteSource`, preparation,
metadata, Apply, suggestion service, command, modal, and plugin tests. Baseline
focused validation passed: **144 tests / 7 files**. Installed `obsidian` is
**1.13.1**, reinstalled from the unchanged lockfile under Node **24.19.0**.
The package provides declarations, not an executable Obsidian helper runtime.

GitHub CLI reads returned HTTP 401. Public REST supplied the Issue/PR bodies;
the connected GitHub tool also successfully read #64. No credentials were
requested, printed, stored, or bypassed.

## Public contract evidence

The complete installed declaration surface and current official API were
checked, rather than reading private implementation. The inspected official
API revision is
[`cc1744324150c632416857c98964f87b1574a5fc`](https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts).
Its differences from installed 1.13.1 concern settings declarations, not these
freshness, metadata, or parsing boundaries. No dependency upgrade is proposed.

| Public surface | Documented contract / consequence |
| --- | --- |
| [Vault.read](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Vault/read.md) | Reads plaintext directly from disk. No content revision token, read lock lifetime, metadata binding, or unsaved editor-buffer guarantee. |
| [Vault guide](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Vault.md) / [cachedRead](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Vault/cachedRead.md) | `read` avoids stale read-cache problems; the guide recommends `process` for atomic modification. A separate read is not an atomic read–write transaction. |
| [getFileCache](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/MetadataCache/getFileCache.md) / [getCache](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/MetadataCache/getCache.md) | Return optional cached metadata without a source content/version token or freshness guarantee. |
| [changed](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/MetadataCache/on%28%27changed%27%29.md) | Supplies indexed file/data/cache together. No replay contract for a subscriber starting after indexing. Rename does not produce this event. |
| [resolve](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/MetadataCache/on%28%27resolve%27%29.md) / [resolved](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/MetadataCache/on%28%27resolved%27%29.md) | Link-resolution notifications, without a content-bound metadata token. |
| [CachedMetadata](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/CachedMetadata.md) | Optional metadata collections/positions; no documented source fingerprint or version. |
| [TagCache](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/TagCache.md), [CacheItem](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/CacheItem.md), [Loc](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Loc.md) | Tag string and position; offsets locate characters in the indexed document, not a revision identity. No guarantee that unchanged offsets imply unchanged Markdown context. |
| [getFrontMatterInfo](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/getFrontMatterInfo.md), [parseYaml](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/parseYaml.md), [parseFrontMatterTags](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/parseFrontMatterTags.md) | Operate on supplied string/object; return frontmatter info, unconstrained YAML result, and optional tag list. No inline Markdown-to-tag parser contract. |
| [processFrontMatter](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/FileManager/processFrontMatter.md) | Atomic frontmatter read/modify/save with synchronous object callback; propagates YAML/callback errors. Callback receives neither full current body nor a metadata/content token. Atomic frontmatter does not bind a prior external body read. Never invoked here. |
| [Vault.process](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Vault/process.md) | Atomic whole-note synchronous transformation. Could compare the callback's whole string under a different approved design, but supplies no inline parser and requires a different mutation/serialization boundary. Not used, including as a no-op reindex probe. |

`getAllTags` consumes cached metadata. Other public parse helpers concern
frontmatter, links or property identifiers. Markdown rendering APIs return
rendered content, not a documented complete content-bound `CachedMetadata`
parse result. No additional qualifying initial metadata API was found in the
examined public surfaces. Runtime implementation guesses are not evidence.

## A — what a current-body comparison proves

The test-only `CurrentBodyProbe` uses existing exact UTF-16 SHA-256 provenance
and `sameContent`. It compares the evaluation's opaque content token with a
freshly read target snapshot, under the existing cryptographic assumption.
It returns only `snapshot-match` or `unavailable`; never an authorization or
digest. The original `NoteSource`/TFile/path remains the target. Public source
validation and revision guards run before read, after read and after hashing.
Observed target modify/delete/rename invalidates the in-flight generation.
Events for unrelated files start no read/hash. Active note is never consulted
after capture. Source replacement/move/rename/delete is rejected.

mtime/size are conservative rejection guards, not equality evidence. Equal
stats with unequal read strings are rejected by fingerprint comparison. A
changed-and-restored file with identical content is not evidence that it was
unchanged throughout the interval. Pending reads and native Web Crypto cannot
be forcibly canceled with these APIs; Close/Retry/unload removes listeners and
prevents new work/publication, but already submitted work may finish and be
discarded. No “physical hashing stopped immediately” claim is made.

| Window / operation | Result and limit |
| --- | --- |
| Edit before read | Different returned string fails; observed event or changed stat also rejects. |
| Edit during read | If new string is returned, fingerprint rejects; identity/stat/generation checks catch observed changes. Public read has no linearization/version token. |
| Edit during fingerprint | Observed event/stat change rejects. A delayed event with unchanged stats can leave an OLD captured read matching while current body is NEW. Deterministic unit counterexample included. |
| Immediately after fingerprint / result | A previous match proves only the returned read snapshot. No reusable proof lifetime or later mutation protection. Another read only moves the race. |
| Rename / move / delete / replacement | Re-resolve original path and original object around awaits; reject mismatches. Returning to an old path before observation is not a documented transaction guarantee. |
| Active-note switch | Original source alone remains captured. |
| Cancellation / Close / Retry / unload | Suppress pending results, remove exact-operation listeners; Retry creates a distinct probe, no proof reuse. |
| Unsaved editor changes / external writes | Disk-read contract is not an editor-buffer flush or an immediate stat/event notification guarantee. Desktop timing remains NOT VERIFIED. |

Thus public read supports **snapshot equality**, not the full A claim up to the
`processFrontMatter` transaction. That callback exposes only frontmatter, so it
cannot recompare the inline-bearing body under the same transaction. A future
design needs a documented version-conditioned mutation or whole-content
validation within the mutation transaction. This spike changes no existing
production revalidation policy and makes no broader audit claim about #60.

## B — separate paths

### B1: cache binding

Retain the changed-event/data pairing when available. Pre-indexed cache presence
alone cannot seed it. `getCache`, resolution events, positions and stat do not
add the missing binding. PR #63 records an earlier real runtime observation
of successful suggestions with zero post-session changed events and unavailable
preparation. That is historical evidence, not this spike's reproduced runtime.

### B2: frontmatter from the read string

`getFrontMatterInfo(body) → parseYaml(info.frontmatter) → parseFrontMatterTags`
can keep the frontmatter interpretation bound to that supplied snapshot.
The prototype rejects malformed/helper failures, non-object YAML roots,
unexpected `tags` values, mixed invalid list entries and a null/unexpected
helper result. They never become “no tags”. No frontmatter or missing `tags`
can mean no frontmatter tags in that snapshot; it says nothing about inline
tags. The official help recommends list-valued tags. Scalar handling is exposed
by helper signatures and predecessor code, but exact scalar splitting,
hierarchy, Unicode and error behavior in current Desktop helpers are
**NOT VERIFIED** here. Unit fakes validate delegation/guard behavior only.

### B3: cached positions

Matching `body.slice(start.offset, end.offset)` against a cached tag corroborates
a literal at that location. Bad/moved/out-of-range spans fail. Cached omission
does not constrain a newer body's additional tags. Even a positive literal
match may now be inside code or escaped syntax; same characters can survive a
context change. Therefore positions alone do not prove a semantic current tag,
although conservative skip-on-literal can be safe for that positive case.
Offset behavior around supplementary Unicode/line endings also needs runtime
verification. Never infer absence from zero position matches.

### B4: conservative body guard

[Official tag help](https://help.obsidian.md/tags) documents hierarchy, Unicode
(including emojis/symbols), and case-insensitivity. `body.includes(selected)`
detects exact inline, hierarchical and Japanese literals but misses `#AWS`
for selected `#aws`. That is a concrete false negative, independent of stale
metadata. Frontmatter may contain `aws` without a hash, so a literal guard alone
also fails there. Combining frontmatter helpers with literal search still
leaves the case problem and complete Unicode comparison unspecified.

Searching lower/upper case is not a proven substitute for Obsidian's Unicode
case equivalence. Neither tags' broad “case-insensitive” statement nor public
helper typings specify the complete normalization/comparison/encoding contract
needed to establish zero false negatives for all supported syntax. The report
does not assert a particular runtime Unicode mismatch without measuring it.

Code fences, inline code, escapes, URL fragments, ordinary embedded hashes,
longer tag prefixes and some headings can trigger conservative false positives
or ambiguous-context skips. Excluding these regions with a custom parser could
introduce false negatives; no such parser is built. A heading `# aws heading`
does not contain the literal `#aws`. Detecting a literal inside other heading
text says nothing about whether Obsidian treats it as a tag. False positives
cost UX but can safely suppress an addition; false negatives cannot be accepted.
Always skipping everything is vacuously safe but cannot establish the requested
usable Apply strategy or an absence proof.

## Strategy matrix

“Snapshot” below never means that subsequent mutation is authorized. FN/FP are
relative to the claim made, not a claim about measured Desktop parser coverage.
All considered reads/hashes are explicit-operation, exact-target only.

| Strategy | Public API only? | Proves A? | Proves B positive? | Proves B absence? | False-negative risk | False-positive risk | Race window | Background processing | Requires mutation? | Privacy impact | Production recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Current changed-event proof | Yes | Event/evaluation snapshot plus existing guards; not an independent transaction lock | Paired indexed tags for matching content | Paired indexed snapshot only; unavailable without event | Stale/out-of-lifetime reuse must be rejected | No new heuristic | Event/hash/stat observation → mutation | Only active target session | No | Existing memory-only target hash | Keep current fail-closed; no replay fallback |
| Current-body fingerprint via Vault.read | Yes | Read snapshot only | No | No | Changes after captured read or delayed notifications | Conservative rejection on revision changes | Read → hash → transaction | Operation-only | No | Additional local target read/hash, ephemeral | Research only; incomplete A |
| getFileCache/getCache alone | Yes | No | Cache claims only | No | New tags absent from stale cache | Removed/context-changed stale tags | Index lag plus later edits | None added | No | Metadata only | Reject as initial authorization proof |
| Frontmatter helpers | Yes | No | Supplied-string frontmatter only; runtime semantics pending | Frontmatter snapshot only; never inline | Unverified/malformed input must reject | No new body heuristic | Read snapshot → mutation | Operation-only | No | Local target string/YAML only | Partial evidence; insufficient B |
| TagCache position validation | Yes | No | Current literal only, not grammar/context | No | Cache misses and newly inserted tags | Context moved to code/escape | Captured body → mutation | Operation-only | No | Local target string/metadata | Positive conservative skip only |
| Conservative literal/body guard | Yes, string operation | No | Literal only | No proven full coverage | Exact search demonstrably misses case variants; broader coverage unproven | Code/escape/URL/prefix/ordinary text | Captured body → mutation | Operation-only | No | Local target string only | Reject production fallback; no custom parser |
| Public API gap / keep fail-closed | Existing API only; proposed contracts absent | Does not issue new proof | No new claim | No new claim | No unsafe addition because unavailable authorization blocks it | Legitimate operations blocked | No new mutation window | None added | No | No added production data flow | Recommended #64 outcome |

## Required public API gap

One of these **hypothetical contracts**, with documented error and lifetime
semantics, could address B; these are not existing Obsidian API names:

1. A cache snapshot paired with an opaque content/version token that can be
   compared to the exact read/evaluated source. Require complete frontmatter and
   inline tag coverage plus documented case/Unicode equality.
2. A public parser for a supplied plaintext string returning complete
   content-bound tag metadata and canonical equivalence behavior. No private
   renderer/parser or newly installed parser dependency.

Both still need A at mutation: a conditional frontmatter update with the same
source/content token, or a documented full-content validation callback within
the atomic frontmatter transaction. Tokens must become invalid on content or
identity changes; missing/invalid metadata must never be interpreted as empty.
Keep source identity/path checks, selection subset, operation lifetime,
pre-start cancellation and disposal. No dependency or production follow-up
implementation Issue is justified until these gaps are resolved.

The unchanged pre-indexed UX limitation remains: suggestions can succeed while
preparation is `freshness-unverified` because no matching changed pair arrived.
Do not ask users to edit notes merely to manufacture proof. Do not add polling,
sleep, startup hashing, no-op writes, or private cache/version access.

## Synthetic evidence and limits

`tests/tag-freshness-spike.test.ts` has **45 passing tests**. Only
`tests/helpers/tag-freshness-spike.ts` contains the candidate logic. All bodies,
paths, tags and files are synthetic; results contain no body/digest. The
separate optional runtime plugin is not imported by production or normal tests.

| Required case | Automated evidence | Desktop status |
| --- | --- | --- |
| 1 / evidence 1,5: unchanged pre-indexed/no changed | Matching read snapshot succeeds; actual production preparation remains freshness-unverified without emitting changed | NOT VERIFIED in this spike; PR #63 historical observation only |
| 2 / evidence 2: evaluated vs changed body | Same-stat different string rejects; pending read/hash edits reject when observed; delayed-event race explicitly remains | NOT VERIFIED |
| 3 / evidence 6: existing inline selected tag | Literal/position positive and stale cache omission exercised; no additions ever performed | Parser recognition NOT VERIFIED |
| 4 / evidence 7: existing frontmatter | Fake scalar/list delegation and failures; supplied body passed unchanged to helper boundary | Real helpers NOT VERIFIED |
| 5 / evidence 8: hierarchy / Unicode | #programming/aws and #日本語 positive literals, positions, helper-output fixtures | Real semantics/offsets NOT VERIFIED |
| 6: conservative false positives | Code fence, inline code, escape, URL, heading, ordinary hash, longer prefix; case false negative | Markdown context recognition NOT VERIFIED |
| 7 / evidence 9,10: stale cache/new body | Empty old cache fails to discover present current literal; matching position in changed code context cannot certify grammar | Cache timing NOT VERIFIED |
| 8 / evidence 3,4: exact source | Rename/move/delete/replacement before/during read reject; active switch/unrelated events read/hash original only | NOT VERIFIED |
| Evidence 11: Close/Retry/unload/cancel | Pending read starts no later hash on invalidation; pending hash cannot publish; listeners removed; Retry distinct; prior lifecycle tests retained | NOT VERIFIED |
| Evidence 12: forbidden I/O | Probe has no provider/Secret dependency; fail-on-call fake mutation/Secret boundaries and fetch sentinel unused; no mutation/network path in B helpers | Runtime counters NOT VERIFIED |

Deterministic promises coordinate races, without fixed sleeps/polling. The
standalone heading assertion records exact literal behavior, not parser
recognition. The runtime helper plugin uses only public Obsidian imports/APIs,
explicit Start/Inspect/Close commands, and sanitized statuses/booleans. It
does not evaluate with TypeSafe or access SecretStorage. Its successive read
results are independent snapshots; the console output does not assert that all
fields refer to one atomically current body. It never claims tag absence.

## Human-only isolated runtime procedure (NOT EXECUTED)

Do not open a real user Vault for this spike. Use a disposable Synthetic Vault
with synthetic fixtures prepared before testing. This agent has not opened or
modified any Vault, installed the spike, or run a real Desktop command. These
steps are a handoff, not VERIFIED evidence.

1. Build the separate helper into a temporary directory (not production main):
   `node_modules/.bin/esbuild tests/helpers/tag-freshness-runtime-plugin.ts --bundle --platform=browser --format=cjs --external:obsidian --outfile=/private/tmp/jevault-64-runtime/main.js`.
2. In that directory supply a separate manifest: id `jevault-64-runtime`, name
   `Jevault 64 Runtime Spike`, version `0.0.0`, minAppVersion `1.13.1`, author
   `local`, description `Read-only synthetic freshness investigation`,
   isDesktopOnly `true`. Install this temporary plugin only in the isolated
   Vault, alongside the unchanged Jevault build if needed. Never replace the
   normal Jevault main.js or settings.
3. Prepare distinct notes for: plain synthetic text; inline #aws; frontmatter
   scalar `tags: aws`; list tags `aws`, `programming/aws`, `日本語`; inline
   hierarchy/Japanese tags; #AWS; fenced/inline code, escaped hash, URL fragment,
   heading and ordinary hash; malformed YAML and unexpected tags shapes.
   Preparation is a human fixture action, not a write by the spike plugin.
4. Record Desktop/API versions. Let indexing complete using observable app
   readiness; do not induce reindex or use a fixed sleep. Start on an unchanged
   pre-indexed fixture, then Inspect. Inspect statuses in Developer Tools;
   outputs have booleans in fixed order aws / programming/aws / 日本語.
   Record `postSessionTargetChanged`, `evaluationSnapshot`, `metadataSnapshot`,
   and helper availability, never note contents, paths, tag collections or hashes.
   Zero changed plus snapshot-match/freshness-unverified is the expected case 1.
   Unexpected observed events are recorded, not hidden or treated as replay.
5. Repeat Start/Inspect/Close per prepared fixture. Scalar/list/helper failure
   results are actual helper evidence only after this execution. Compare the
   disposable fixture's Obsidian tag recognition with literal status; malformed
   YAML must remain unverified. No candidate may be promoted on these samples
   alone. Code-context examples need human observation of actual recognition.
6. Switch the active note after Start, then Inspect: captured original source
   remains the target. Close, repeat Start to model Retry, disable the temporary
   plugin to unload. Every prior session is disposed. Observe no late results
   after closure and no body processing caused by unrelated events.
7. Edit/rename/move/delete/replacement interleavings and deliberately stale
   runtime cache states remain NOT VERIFIED unless the human separately runs
   those fixture manipulations. The read-only plugin performs none of them.
   Do not automate writes, use a user Vault, sleep/poll, or force reindex to
   obtain evidence. The deterministic unit fixtures cover the logical guards;
   they do not substitute for Desktop timing evidence.
8. Confirm the helper source contains no network/Secret/mutation calls; record
   actual runtime counts only if a read-only observer is available. No absence
   of visible error or console message establishes zero calls. Remove/disable
   the temporary plugin after use. Never log body or digest to capture evidence.

## Validation and Safety Gate

- `npm ci --cache /private/tmp/jevault-64-npm-cache`: passed, unchanged lockfile,
  supported Node 24.19.0. Existing npm audit reported two moderate advisories;
  no dependency change or audit-fix was performed.
- Focused baseline: 144 tests / 7 files passed. Spike focused: 45 tests passed.
- `npm run typecheck`: passed separately before full verification.
- Final `npm run verify`: **498 tests / 32 files**, lint, build (nested
  typecheck, production bundle, license notices), working/staged whitespace
  passed. The first full run stopped at one unused fake-read parameter lint
  error; a target-identity assertion fixed it. Full-verification repairs: 1.
- Independent read-only review requested fixed fixture expectations instead of
  mirroring the literal guard in one test table. Local-review repairs: 1;
  explicit expected booleans now record the intended conservative outcomes.
- Separate esbuild of the optional runtime plugin: passed. This proves
  compilation only, not Desktop execution.
- Production bundle contains no `CurrentBodyProbe`, `TagFreshnessRuntimeSpike`
  or `conservativeLiteralPresent` symbols. All four candidate files are new
  Issue-only research/report/test files. No source, package/lock, manifest,
  privacy, release or workflow changes. Test helper reachability and its
  forbidden-boundary assertions support zero provider/Secret/mutation calls;
  real runtime counts remain NOT VERIFIED.

Safety Gate: scope, production runtime, Vault mutation, dependencies, Secrets,
body/digest logging, telemetry, network behavior and background behavior have
no production change. Prototype listeners are exact-target operation scoped,
and async disposal limits are disclosed. Synthetic fixtures contain no real
Secret. npm registry/GitHub/documentation access used to prepare this
investigation is separate from the zero-network spike execution contract.
No `spike:typesafe`, real API key or real user Vault was used by validation.
Desktop timing/helpers and pending runtime cases remain NOT VERIFIED; a safe
production strategy must not be inferred from green validation.
