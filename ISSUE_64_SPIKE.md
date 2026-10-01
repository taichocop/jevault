# Issue #64: unchanged indexed note — freshness / duplicate detection spike

## Decision

- **A — Evaluation freshness: UNSAFE / INCOMPLETE** for authorization through
  mutation. `Vault.read()` plus the existing opaque fingerprint can compare the
  evaluated string with a newly read disk snapshot. That narrower comparison is
  possible using public API; it is not a lock or a proof about later content.
- **B — Duplicate prevention: UNSAFE / INCOMPLETE** for general notes. Frontmatter helpers bind
  their output to the supplied string, but do not parse inline tags. Cache
  positions can corroborate literals, not prove the absence of current tags.
  Exact literal detection has a documented case-insensitivity false negative;
  no complete Unicode/case/parser contract was established for a broader guard.
  A useful restricted absence proof exists for a supplied string with no
  frontmatter and no `#` anywhere; see B4's conservative subset below.
- **Overall: NO SAFE PUBLIC-API STRATEGY FOUND** for unchanged pre-indexed notes
  within the existing `processFrontMatter` mutation requirement. Keep the
  existing fail-closed preparation. A restricted `Vault.process` design is a
  public-API candidate requiring a separate mutation-boundary decision and
  further source/lifecycle, serialization and Desktop evidence; it is not
  ruled out by the general parser gap.

This is a bounded investigation result, not a claim that no future public API
could solve the problem. No production behavior, authorization, Apply wiring,
dependency, version, release, or user Vault has been changed. Human-assisted
Desktop helper execution verified the limited unchanged-A, active-switch and
C/D/E observations recorded below. A later agent-only Computer Use re-execution
confirmed every observed helper result. Cleanup was confirmed after both runs.
Remaining fixture semantics and interleavings are **NOT VERIFIED**.
HUMAN MERGE READY must not be claimed from unit fakes, earlier PR observations, or review of the prior
HEAD before these report updates are committed and reviewed.

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
| [Vault.process](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Vault/process.md) | Atomic whole-note synchronous transformation. The [Vault guide](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Vault.md) explicitly recommends comparing callback content with a retained read after async work. This addresses the content race in a different design; the restricted no-frontmatter/no-hash subset needs no inline parser. Requires a different mutation/serialization boundary. Never invoked here, including as a no-op probe. |
| [stringifyYaml](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/stringifyYaml.md) | Public object-to-YAML string helper available for a proposed new frontmatter block. Signature alone is not evidence of correct delimiter assembly, preservation or Desktop tag round-trip. No new frontmatter is generated or written by this spike. |

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

#### Useful conservative subset: no frontmatter and no hash marker

The literal-specific failure above does **not** rule out a coarser guard.
Reject every string containing any ASCII `#`, and every string for which public
`getFrontMatterInfo` reports frontmatter. Missing/unexpected helper output or
errors must also reject. Under the documented inline syntax (an ASCII `#`
followed by a keyword) and frontmatter `tags` property, an accepted string has
neither inline nor frontmatter tags. This is a supplied-string **absence**
argument for any selected tag, not a parser or a positive-tag detector.
It avoids case, hierarchy and Unicode comparison because no inline marker is
present, and rejects scalar/list frontmatter equally. A plain untagged note
without headings or hashes is accepted, so this is not “skip everything”.

False positives are deliberately broad: any heading marker, URL fragment,
escaped hash, code block/inline-code hash, ordinary hash or any frontmatter
(even unrelated properties) rejects the note. No context is parsed or excluded.
This trades significant UX coverage for absence safety; a different Unicode
symbol resembling `#` is not the documented ASCII tag marker. Real Desktop
helper behavior for malformed delimiters/BOM/line endings remains NOT VERIFIED
and must be tested conservatively before production; uncertain input rejects.

This guard alone still cannot bind a separate `Vault.read` snapshot to the
existing `processFrontMatter` callback. A **different proposed design** would:

1. Explicitly read only the captured original source; validate identity and
   operation lifetime around awaits; compare its fingerprint to evaluation.
   Retain that matching string only in the active operation, never persist/log
   it. The restricted absence guard may reject before requesting an Apply.
2. Only after separate approved user selection/confirmation, use
   `Vault.process` on that exact source. Its synchronous callback must recheck
   source identity/lifetime and require exact string equality with the retained
   snapshot, then re-run the no-frontmatter/no-hash guard on callback data.
   A mismatch or invalid operation must abort, never continue or fall back to
   the active note. A delayed event/same-stat edit returning old read data is
   caught by unequal callback data; equal current content meets content equality,
   not a historical claim that no intermediate edit ever occurred.
3. Construct only a new `tags` frontmatter list from the validated selected
   existing tags using public YAML helpers, preserving the original body.
   Reject empty/invalid selection or helper/serialization errors. Do not remove
   tags/properties or invent tags; existing frontmatter already rejects.

The public atomic-content contract closes the **content** read-to-write race
for this proposal. It does not, by itself, establish exact path/object identity
through an asynchronous save, unsaved editor reconciliation, cancellation after
write starts, callback-error/no-write behavior, or generated YAML round-trip.
Those contracts/runtime cases and disposal of the retained string still need
evidence. There is no new persistent/background read/hash requirement.

Classification: **NEEDS MORE API EVIDENCE / separate approval**, rather than
rejected for parser coverage. Conceptually A's full-content equality and B's
restricted absence can coexist at the proposed transaction; this is not a
verified production-safe strategy or reusable authorization. No `Vault.process`
call, serialization prototype or note mutation was performed. The approved
product requirement uses `processFrontMatter` for actual mutation, so this
spike cannot substitute `Vault.process` or enable Apply. Codex's P2 finding
[4158712489](https://github.com/taichocop/jevault/pull/65#discussion_r4158712489)
correctly identified this missing conceptual evaluation.

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
| No-frontmatter/no-hash guard + proposed Vault.process | Yes, existing public helpers/atomic content API | Callback current string must equal evaluation-matching retained string; identity/lifecycle/save evidence pending | No; rejects every possible tagged note | Supplied-string restricted absence; recheck inside proposed callback | No marker/frontmatter-based miss within accepted subset under public syntax; uncertain helper/identity/save cases must reject | All hashes/headings/URL/code/escapes and any frontmatter reject | Separate-read race addressed by atomic callback comparison; identity/editor/cancel-save limits pending | Explicit operation only | Proposed production design yes; spike performs none | Retained original-target string in operation memory; clear on disposal, no logging/persistence | Evaluate in a separately approved boundary investigation; not a #64 production change |
| Public API gap / keep fail-closed | Existing API only; proposed contracts absent | Does not issue new proof | No new claim | No new claim | No unsafe addition because unavailable authorization blocks it | Legitimate operations blocked | No new mutation window | None added | No | No added production data flow | Recommended #64 outcome |

## General-note API gap and possible restricted follow-up

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
pre-start cancellation and disposal. These gaps apply to general-note coverage
and the current `processFrontMatter` boundary, not to every conceivable
conservative subset. A new parser dependency is not justified by this spike.

A minimum separately approved follow-up could investigate whether the
no-frontmatter/no-hash subset may replace the mutation boundary with
`Vault.process`. It should first settle the product boundary decision, exact
source/save and abort contracts, operation-memory disposal, editor behavior,
body preservation and public YAML round-trip with disposable fixtures. Only
then consider adapting authorization/Apply validation for that subset while
all other notes remain fail-closed. Existing selection, explicit confirmation,
read-only suggestion/provider boundaries and no-background/no-telemetry rules
remain required. This is a proposed follow-up scope, not authorization to create
an Issue, implement it, mutate a note or claim production safety.

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
| 1 / evidence 1,5: unchanged pre-indexed/no changed | Matching read snapshot succeeds; actual production preparation remains freshness-unverified without emitting changed | Read-only helper VERIFIED on unchanged A: snapshot-match / freshness-unverified / changed 0; real TypeSafe suggestion and production Apply UI NOT VERIFIED |
| 2 / evidence 2: evaluated vs changed body | Same-stat different string rejects; pending read/hash edits reject when observed; delayed-event race explicitly remains | NOT VERIFIED |
| 3 / evidence 6: existing inline selected tag | Literal/position positive and stale cache omission exercised; no additions ever performed | A's two synthetic inline tags visibly rendered by Obsidian and matched cached positions/current literals; duplicate-free mutation NOT VERIFIED |
| 4 / evidence 7: existing frontmatter | Fake scalar/list delegation and failures; supplied body passed unchanged to helper boundary | Real helpers NOT VERIFIED |
| 5 / evidence 8: hierarchy / Unicode | #programming/aws and #日本語 positive literals, positions, helper-output fixtures | A's hierarchy literal and cached position matched; Unicode and general semantics NOT VERIFIED |
| 6: conservative false positives | Code fence, inline code, escape, URL, heading, ordinary hash, longer prefix; case false negative | Markdown context recognition NOT VERIFIED |
| 7 / evidence 9,10: stale cache/new body | Empty old cache fails to discover present current literal; matching position in changed code context cannot certify grammar | Cache timing NOT VERIFIED |
| 8 / evidence 3,4: exact source | Rename/move/delete/replacement before/during read reject; active switch/unrelated events read/hash original only | Active switch A → B without restarting reproduced original A's matching read and tag pairs; remaining interleavings NOT VERIFIED |
| Evidence 11: Close/Retry/unload/cancel | Pending read starts no later hash on invalidation; pending hash cannot publish; listeners removed; Retry distinct; prior lifecycle tests retained | Repeated Start, Close invocation and disabled/removed helper confirmed; physical listener/hash counters and pending-work timing NOT VERIFIED |
| Evidence 12: forbidden I/O | Probe has no provider/Secret dependency; fail-on-call fake mutation/Secret boundaries and fetch sentinel unused; no mutation/network path in B helpers | Runtime counters NOT VERIFIED |

Deterministic promises coordinate races, without fixed sleeps/polling. The
standalone heading assertion records exact literal behavior, not parser
recognition. The runtime helper plugin uses only public Obsidian imports/APIs,
explicit Start/Inspect/Close commands, and sanitized statuses/booleans. It
does not evaluate with TypeSafe or access SecretStorage. Its successive read
results are independent snapshots; the console output does not assert that all
fields refer to one atomically current body. It never claims tag absence.

## Isolated runtime setup and remaining human procedure

Do not open a real user Vault for this spike. Use a disposable Synthetic Vault
with synthetic fixtures prepared before testing. After the human supplied its
location, native UI confirmed **SyntheticVault / Obsidian 1.13.7**. Steps 1–2
were completed: the separate plugin was installed and its enable toggle was
observed. Existing Jevault `main.js` remains byte-for-byte identical to the
repository production build. No note write, rename, move, delete, folder
creation via Vault API, provider request or Secret access was initiated.

Human-operated Start/Inspect on unchanged A subsequently produced the sanitized
log recorded below. This establishes the limited helper observations in the
matrix, not every required runtime outcome. Cleanup and remaining limitations
are recorded below. No real user Vault was inspected. Unexecuted procedure
steps remain a handoff, not VERIFIED command evidence.

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

### Computer Use STOP and human continuation

Native UI initially showed the correct Synthetic Vault. Settings refresh and
the separate plugin's enable toggle succeeded. Native input then returned
`timeoutReached` three times: settings close, app rebind, and command-palette
key input after the human returned to A. Automatic UI operations stopped at
the same-failure limit in [STOP_CONDITIONS](agent/STOP_CONDITIONS.md). An earlier
`noWindowsAvailable` and an invalid-element error are also preserved as
infrastructure observations. No alternate OS automation, private Obsidian API,
product repair or counter reset was used to bypass this STOP.

These are Computer Use server errors; their root cause is not established and
they are not evidence of an Obsidian API or plugin failure. The human confirmed
returning to A; unchanged-A Start/Inspect and sanitized console fields were
requested next. At that checkpoint, all runtime outcome rows remained
**NOT VERIFIED**. Later human-operated output is recorded below. The temporary
plugin remained enabled at that checkpoint; later Close, disable and removal
are recorded below.

The human then explicitly authorized one retry while leaving mouse/keyboard
untouched. Rebinding again confirmed A / SyntheticVault / Obsidian 1.13.7,
but `super+p` returned the same `timeoutReached` (cumulative occurrence 4).
The authorized retry ended there; failure history was not reset. Concurrent
human input alone therefore does not explain the observed failure. Native
key delivery remains blocked, and no runtime command outcome was obtained.

During the subsequent permission investigation, native System Settings showed
Codex Computer Use's Accessibility and Screen/System Audio Recording switches
already on. No permission was added or broadened. After the human moved the
display to another monitor and explicitly requested another retry, rebinding
again confirmed A / SyntheticVault / Obsidian 1.13.7; `super+p` again returned
`timeoutReached` (cumulative occurrence 5). That retry stopped immediately.
The monitor change did not resolve this observation; root cause remains unknown.

After current-HEAD Code Review completed, the human requested resuming runtime
verification. Native palette-button input was tried instead of `super+p`.
A coordinate click reported `noWindowsAvailable` (cumulative occurrence 2),
but a subsequent read-only app rebind visibly showed the command palette with
the three spike commands. Palette display is therefore observed; the input
error alone cannot establish that no UI action occurred. Selecting Start then
reported `timeoutReached` (cumulative occurrence 6). A read-only observation
still showed the palette; no ready Notice or command result was verified.
Automatic input stopped. The human was asked to select Start then Inspect on
unchanged A and report the readiness/recording notices. Actual snapshot fields,
required cases and Close/unload/removal remain pending.

The human reported pressing the command and asked for slower continuation.
Read-only observation showed the palette closed, but did not verify a ready
Notice or session output. A single subsequent palette-button click returned
`timeoutReached` again (cumulative occurrence 7); no chained input or fixed
delay was used. Automatic input stopped again. The human was asked to run
Inspect without editing A and provide only its sanitized console fields.
Palette closure alone is not evidence that Start or Inspect succeeded.

### Human-operated unchanged-A observation

The human ran Inspect without editing A, opened Developer Tools, and expanded
its logged object. Read-only Computer Use observed the named spike log and all
fields on Obsidian 1.13.7. Automatic input remained stopped during this
human-operated observation.

| Sanitized field | Observed result |
| --- | --- |
| evaluationSnapshot | snapshot-match |
| metadataSnapshot | freshness-unverified |
| postSessionTargetChanged | 0 |
| frontmatterHelpers | returned |
| selectedFrontmatterPresent | [false, false, false] |
| selectedCachedLiteralPresent | [true, true, false] |
| selectedBodyLiteralPresent | [true, true, false] |
| tagAbsenceProof | unverified |

The boolean order is the helper's fixed aws / programming/aws / Japanese
selection. The unchanged-A helper therefore reproduced matching read evidence
without post-start target changed events while metadata remained unverified.
Obsidian visibly rendered the fixture's two existing inline tags. This is
limited positive literal/cache-position evidence, including the hierarchy;
false results do not prove tag absence. A had no frontmatter, so this does not
exercise actual scalar/list YAML parsing. Start uses locally captured opaque
provenance, with no TypeSafe evaluation request; the full production suggestion
and Apply flow, atomic freshness and duplicate-free writes remain NOT VERIFIED.
The separate reads do not become one atomic snapshot because their booleans
agree. No runtime forbidden-call counters were collected. Subsequent fixtures
and cleanup are recorded below.

The human then switched from A to B without restarting the session and ran
Inspect. The B window was observed; bringing Developer Tools to the foreground
showed a newly appended second spike log. After human expansion, all its fields
matched the table above, including the two original-A positive tag pairs and
zero target changed events. The unrelated B fixture visibly had a different
synthetic tag. Together with the helper's exact-source read path, this supports
the active-switch case: Inspect retained A rather than falling back to B. No
target identifier or note body was logged. This does not verify rename, move,
delete, replacement, unrelated-event timing or cancellation interleavings.

The human next ran Start then Inspect on C. A third spike log was appended
(four Console messages including the developer-console banner), distinguishing
it from the two earlier A-session logs. Its expanded object showed
snapshot-match / freshness-unverified / target changed 0 / helpers returned;
all three selected-tag arrays were [false, false, false], with tagAbsenceProof
still unverified. C's contents were not exported. These negative booleans do
not certify tag absence or exercise known scalar/list frontmatter fixtures.

The human-operated D session appended a fourth spike log with the same fields
as C. The human reported existing tags in D/E but no Japanese-tag fixture.
These selections are fixed; an unrelated existing tag is not expected to make
one of the selected booleans true. This did not establish a prepared selected
scalar/list frontmatter case or a conservative Markdown-context case.

After another human monitor change and explicit request to resume automatic
input, native clicks successfully ran Start on E and visibly produced the ready
Notice. Inspect visibly produced the recording Notice. Opening Developer Tools
and expanding the newly appended fifth spike object succeeded; E also returned
the same sanitized fields as C. No fixed delay, parser/private API, counter
reset or OS automation workaround was used. Click, key and object-expansion
delivery recovered in this arrangement; the prior timeout count remains 7 and
noWindowsAvailable count 2. DisplayLink/monitor configuration as root cause is
unconfirmed. One later input was interrupted by a user window change; fresh
observation and the visible application Preferences menu completed cleanup.

After cleanup, the human explicitly requested another UI test. A command-palette
keyboard attempt was interrupted by a window change. Rebinding confirmed E,
then a single super+p attempt again timed out (cumulative timeout occurrence 8).
Read-only observation showed no palette. Automatic input stopped again; no
search text was sent to the note. The earlier native click/Start/Inspect/Console
successes are real but do not establish stable keyboard delivery or a resolved
DisplayLink root cause. Cleanup remains confirmed and this infrastructure
failure does not invalidate the already observed helper output.

The human then suggested fullscreen as a cause and explicitly requested one
more retry after changing the window arrangement. Fresh binding showed the
window controls; super+p visibly opened the palette, typing Jevault visibly
filtered its commands, and Escape visibly closed it without executing a
production command. This successful comparison supports a window/Space-related
hypothesis, not a proven fullscreen or DisplayLink defect. Timeout history
remains 8. The temporary spike commands were absent after disabled-file cleanup.

### Agent-operated Computer Use re-execution

The human requested repeating the manually executed observations using Computer
Use. The same generated read-only helper was temporarily reinstalled and enabled
through native Preferences; no production build was replaced. The agent selected
and visibly confirmed A, invoked Start and observed its ready Notice, invoked
Inspect and observed its recording Notice, opened Console and expanded the newly
appended sixth spike log. All fields matched the unchanged-A table above.

Without restarting, the agent switched to B, confirmed the B window, and invoked
Inspect. The seventh spike log retained A's two positive literal/cache pairs,
snapshot-match, freshness-unverified and target changed 0. Separate Start/Inspect
runs on visibly confirmed C, D and E appended eighth, ninth and tenth spike logs;
each matched the earlier C/D/E fields and negative fixed-selected-tag booleans.
Ready and recording Notices were observed for every new session; all five new
objects were expanded by the agent. Counts included the unchanged developer
banner (7 through 11 total Console messages), separating rerun outputs from old
logs. No manual command execution was used during this rerun.

An initial AX row selection opened D instead of A; the agent observed that title
and selected A from the screenshot before starting any session. One subsequent
window-transition delivery was interrupted after Console closed; the displayed
C window was re-observed and rebound before continuing. No new timeout occurred
and prior failure history was preserved. These input observations are not
Obsidian API failures. No new note contents, fingerprints or collections were
logged, and no production suggestion or Apply command was invoked.

The agent then invoked Close and disabled the helper through native Preferences.
Enabled IDs again confirmed helper absent and normal Jevault present. Only the
same byte-matching generated pair was removed, the temporary directory was
confirmed absent and production main.js was byte-for-byte unchanged. Preferences
was closed to E. This independently reproduced the earlier bounded observations
and cleanup; it does not promote untested helper semantics or physical I/O/hash
counts to verified evidence.

### Cleanup and remaining runtime limits

The native Close command was selected and returned to the E view. The temporary
plugin's enable toggle was then turned off. Read-only inspection of the enabled
plugin IDs confirmed spike disabled and production Jevault still enabled.
Only generated main.js and manifest.json were present in the temporary plugin
directory; both matched their generated copies before removal. Those two files
and the now-empty directory were removed. The temporary plugin directory's
absence was confirmed, and production Jevault main.js still matched the repo
build byte-for-byte. Settings was closed back to the E view. No notes or normal
plugin data/settings were removed.

This verifies command invocation and disabled/removed-artifact cleanup, not
physical listener/hash counters or pending-work cancellation timing. Repeated
Start commands exercise the helper's retry entry point; no late-work scenario
was induced. No prepared selected scalar/list frontmatter, code/escape/URL
context or malformed-YAML fixture was identified; the human confirmed no
Japanese-tag fixture in D/E. Those helper semantics remain NOT VERIFIED on
Desktop. No new note was written to manufacture evidence.
Edit/rename/move/delete/replacement and stale
cache timing interleavings were not performed in this read-only run; deterministic
unit fixtures remain their evidence. No read-only forbidden-call observer was
available, so runtime I/O counters remain NOT VERIFIED. The Issue permits these
unavailable runtime-only outcomes to be disclosed; they do not justify an unsafe
production strategy or a prohibited mutation/real-provider test.

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
  mirroring the literal guard in one test table. A later report review corrected
  an obsolete blanket NOT VERIFIED statement after actual helper execution.
  Local-review repairs: 2; explicit expected booleans record conservative outcomes,
  and observed Desktop results remain separated from outstanding limitations.
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
Remaining Desktop timing/helper semantics and pending runtime cases remain
NOT VERIFIED; limited observed helper results above and green validation do
not establish a safe production strategy.
