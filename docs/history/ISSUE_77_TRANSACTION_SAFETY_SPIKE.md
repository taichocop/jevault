# Issue #77 — transaction-bound Tag duplicate safety

## Decision and executive summary

**NO SAFE GENERAL STRATEGY FOUND.** No evaluated strategy establishes all of
Issue #77's general-note duplicate, identity, preservation and runtime gates.
This is the permitted negative research result, not an approval to weaken a
requirement. Production behavior change: **none**.

`Vault.process` has a documented atomic whole-content transformation boundary.
It is materially stronger than a separate read followed by frontmatter mutation.
However, the examined public API has no complete inline-Tag parser accepting
that callback's Markdown string, nor a metadata version token tying cached Tags
to it. Current frontmatter alone cannot prove inline absence. A changed-event
observation remains evidence about its accepted event, not later mutations.

A **conditional restricted absence proof** exists: inspect the actual process
callback content, reject every U+0023 `#`, and reject every frontmatter block.
An untagged plain string can pass without any evaluation-snapshot equality.
This is a useful supplied-string subset, not a verified production strategy.
Critical editor/save, external-write, source identity through save, error and
serialization evidence remains **NOT VERIFIED**. No strategy receives SAFE.

This finding is bounded by the public surfaces/versions below; it does not prove
that every conceivable future API or conservative algorithm is impossible.
It does not unblock #68 or authorize migration of TagApplyService.

## Authority, baseline and scope

Investigation: 2026-10-02 JST. Authority: [Issue #77][issue77] in full and the
human's explicit `EXECUTE #77 SAFETY SPIKE` action. Initial HEAD was
`287fd516dbfd6bed7bb4d82e76fa184a535a0a37`, working tree clean. Fetch established
authoritative main `32c02284cf32c686f8da13d30f24fbf7c41cb82c`; branch
`codex/issue-77-transaction-safety-spike` starts there. No existing #77 PR was
found among all 36 repository PRs returned by the public REST listing.

Latest Issue/PR reads at entry confirmed #77 and #68 open; #71/#73/#75/#64/#66
closed/completed with #72/#74/#76/#65/#67 merged. #69 is closed/not_planned;
#70 is closed/unmerged. These agree with the Issue's handoff. GitHub CLI returned
HTTP 401; public REST provided the authoritative Issue and related state, and
the connected GitHub plugin returned repository access successfully.

Read [AGENTS](../../AGENTS.md), the then-current execution, review,
stop, and PR review-loop contracts,
[the #71 architecture](../architecture/ISSUE_71_ARCHITECTURE.md), [the #64 spike](ISSUE_64_SPIKE.md),
the requested metadata/grant/freshness/preparation/authorization/Apply/identity,
NoteSource/main boundaries, and their requested tests/helpers. There is no
`docs/` directory. Predecessor reports' runtime observations are historical
context, never this spike's verified runtime evidence.

Only this report and two synthetic research files are added. No production
service, parser, intent/readiness contract, UI, main wiring, dependency, version,
manifest, release or workflow changes. No production mutation is connected.

## Current race: correctness, currency and transaction binding

| Concept | What it establishes | What it does not establish |
| --- | --- | --- |
| Observation correctness | #75 accepts one target changed-event data/cache pair and copied Tag sets | Event data is still current at mutation |
| Observation currency | Would require evidence that the observation represents the state at the later boundary | Equal stat, accepted provenance or an unchanged generation alone cannot establish it |
| Transaction binding | Duplicate check and additive mutation use the same current content in an atomic/equivalent boundary | A prior read/event/cache lookup followed by a different mutation boundary |

Canonical counterexample (fixed in tests): t0 accepts an event with selected Tag
absent; t1 editor/external write adds it inline; t2 corresponding changed event
has not arrived; t3 old observation says absent; t4 frontmatter callback adds it.
The result has both inline and frontmatter representations. Current frontmatter
can be unchanged while current inline Tags differ.

The two deterministic schedules use the real IndexedTagMetadataTracker,
TagApplyAuthorizationService and TagApplyService with fake Vault/FileManager
boundaries: edit before API start, and edit during the API's modeled read before
callback. They hold exposed stat constant and withhold the later changed event.
Both result in an additive frontmatter duplicate, while accepted observation
Tags stay empty and advisory freshness stays `matching`. This is a
public-contract countermodel, **not evidence that Desktop actually delays stat
updates in precisely that way**. Public contracts do not rule out that state;
mtime/size are not collision-free version tokens. Normally delivered stat/event
changes may reject the operation; that does not prove the remaining window safe.

`matching`, `changed` and `unknown` stay advisory. Suggestion Grant stays the
displayed intent set. Neither becomes transaction permission. AI correctness is
advisory, explicit user selection/confirmation is intent authority, and
wrong-target mutation, data loss, frontmatter corruption and duplicate creation
remain hard safety concerns under the approved architecture.

## Public API evidence

Installed declarations: **obsidian 1.13.1**, unchanged lockfile. Current official
[API declarations][api] at `40301c12bb922dd8b954c60d674069b6818f0be4` and
[developer documentation][docs] at `c56c7e770ba25dd0ea392aacf4588f9425970d36`
were inspected. The declaration diff adds/changes Bases, settings, Side,
TExternalFile and unrelated formatting; it does not add a current-content Tag
parser or version-bound mutation contract to these APIs. No upgrade is made.
“Not stated” below means no guarantee found in the examined public sources,
not a claim about hidden implementation behavior.

| ID / public surface and source | Documented guarantee / what it proves | Non-guarantee / what it does not prove |
| --- | --- | --- |
| E1: [Vault.process][process], [Vault guide][vaultguide]; since 1.1.0 | Atomic read/modify/save; synchronous callback receives current note string and returns new string. Guide explicitly says the file does not change between read and write. Supplies the content boundary needed for a synchronous duplicate check plus transform. | No AbortSignal, buffer-flush contract, documented source-object generation condition through save, complete Tag interpretation, YAML/body preservation algorithm, unchanged-return no-write contract, or exhaustive failure/OS-write reconciliation contract. Runtime cases are still required. |
| E2: [processFrontMatter][pfm]; since 1.4.4 | Atomic frontmatter read/modify/save, mutable JS object, synchronous callback, Markdown file only; YAML parsing and callback errors propagate. Current frontmatter can be checked before assignment. | Callback has no whole body, current inline Tags, metadata generation/content token or comparison to a prior read. No textual YAML formatting guarantee. Atomic frontmatter does not promote a separately observed body into the transaction. |
| E3: [Vault.read][read]; since 0.9.7 | Plaintext read directly from disk; avoids relying on cachedRead for modification. | No lock extending to a later mutation, content-version token, or unsaved editor-buffer inclusion promise. |
| E4: [MetadataCache.changed][changed] | Indexed file/data/cache pair; renamed files require separate Vault rename handling. Supports #75 event correctness. | No post-subscription replay, zero notification lag or binding to a later write. |
| E5: [getFileCache][getfilecache] (0.9.21), [getCache][getcache] (0.14.5) | Optional CachedMetadata by file/path. | No documented current plaintext/version token, conditional-write capability or synchronously complete indexing at mutation. Null is unavailable, not absence. |
| E6: [CachedMetadata][cached], [TagCache][tagcache] | Optional tag/frontmatter collections; TagCache includes tag and inherited source position. | No content/version identity; positions are not a revision and do not prove completeness or current Markdown context. |
| E7: [getAllTags][alltags] | Combines frontmatter and note-content Tags **from supplied CachedMetadata**. | Not a plaintext parser; inherited cache currency cannot be repaired by calling the helper again. |
| E8: [parseFrontMatterTags][fmtags] | Frontmatter object to optional Tag list. | No inline parsing or whole-body/version binding; typings do not fully specify scalar/malformed semantics. |
| E9: [getFrontMatterInfo][fminfo] (1.5.7), [parseYaml][yaml] | Supplied content to frontmatter existence/text/offsets; supplied YAML to a JS value. Can interpret the frontmatter part of callback content. | No inline Tag interpretation, lossless round-trip contract, or strong result schema for parseYaml. Errors/unexpected shapes cannot count as absence. |
| E10: [stringifyYaml][stringify] | JS object to YAML string. | No source-format preservation, comment/anchor/style/BOM/line-ending guarantee, nor correct whole-note assembly by Jevault. |
| E11: [official Tags help][tagshelp] | Inline Tags use hash plus keyword; tags property supports YAML lists; ASCII case variants share identity; hierarchy and Unicode characters are supported. | No exhaustive raw-Markdown context/encoding/parser contract or instruction to add Unicode normalization/locale folding. Search's parent matching is not duplicate identity. |
| E12: [Editor][editor], [MarkdownRenderer][renderer], [DataAdapter][adapter], [TagValue][tagvalue] | Editor exposes buffer getValue/transaction; renderer produces HTML asynchronously; adapter exposes path-level process; TagValue wraps a tag string. | None exposes a complete plaintext Tag cache within the same Vault mutation callback, or an editor+disk+metadata transaction with original TFile identity. Renderer Promise cannot be awaited inside the synchronous process transform. |

## Strategy matrix

Every status carries the evidence IDs above. `CONDITIONAL` is a limited public
contract/theoretical consequence, not a completed production gate. `NO` in a
read/cache row means that surface alone supplies no mutation/preservation
boundary. Editor/external closure includes open unsaved buffers, not just the
documented persisted-content atomicity.

| Strategy | Public API only | Whole current content at mutation | Inline duplicate absence proof | Frontmatter preservation | Editor/external race closed | Production candidate |
| --- | --- | --- | --- | --- | --- | --- |
| processFrontMatter + Observation | YES E2/E4 | NO E2 | NO E2/E4; canonical counterexample | CONDITIONAL E2; current values, not formatting | NO E2/E4; unnotified inline edit | NO; general duplicate gap |
| Vault.process | YES E1 | YES E1 for callback string | NO E7/E9 for general public-parser coverage | CONDITIONAL E9/E10; transformation must establish preservation | CONDITIONAL E1 persisted-content atomicity; editor/OS cases NOT VERIFIED | NO for general notes; parser/preservation/runtime gates absent |
| Vault.read + processFrontMatter | YES E2/E3 | NO E2/E3 | NO; sampled read can become obsolete | CONDITIONAL E2, same caveat | NO; read-to-write interleaving in tests | NO; separate read is not a lock |
| getFileCache / getCache | YES E5 | NO E5/E6 | NO E5/E7; stale omission | NO E5; read surface only | NO E5; no binding token | NO; cannot authorize mutation |
| other public API combination | YES E12 for inspected surfaces | NO E12 for combined original-file/editor/disk boundary | NO E7/E12; no complete content-bound result | NOT VERIFIED E10/E12 | NOT VERIFIED E12; no combined contract established | NO; no qualifying general combination found |
| restricted conservative subset + Vault.process | YES E1/E9/E11 | YES E1 for callback string | CONDITIONAL E9/E11: no hash and no frontmatter in that string | CONDITIONAL: reject existing frontmatter; new-header/body assembly NOT VERIFIED | CONDITIONAL E1; critical runtime cases NOT VERIFIED | NOT VERIFIED; useful subset argument, no SAFE approval |

G, `NO SAFE GENERAL STRATEGY FOUND`, is the supported decision across this
matrix. Green tests validate the countermodels and guards, not Obsidian's actual
runtime transaction implementation.

## processFrontMatter analysis

E2 permits validation of current parsed frontmatter within its callback.
It can prevent an addition already present in supported frontmatter under
existing ASCII identity when the callback state is used appropriately.
It supplies neither the body nor transaction-bound inline metadata. Existing
observation/proof-object/generation checks cannot see a notification that has
not arrived. Calling observation inside the callback does not close that gap.
**Frontmatter duplicate prevention is not general Tag duplicate prevention.**

Current service compares callback frontmatter Tags and metadata/proof with its
authorization before assignment. This remains unchanged. Its object-level
preservation behavior and cancellation/lock semantics are retained; no current
general-body safety claim is added. This spike records the gap instead of
removing legacy checks or exposing a new Apply path.

## Vault.process analysis

E1 answers the new #77 question differently from #69's evaluation-equality
question: a duplicate check can inspect the current callback string and return
an additive transformation synchronously in the same atomic content operation.
It need not equal the evaluated content. A pre-callback edit appears in the
callback's current string under that contract; no metadata wait is needed.

But atomic current **content** is only one ingredient. General parsing still
needs a complete public string-to-inline-Tag interpretation; E7 instead consumes
metadata. Existing YAML requires a preservation strategy; E10 does not provide
lossless rewriting. Original target must survive the asynchronous read/save
boundary, and live editor/external behavior must be verified. The API signature
does not provide a source-generation precondition or cancellation option.

The test-only probe binds original-source resolution, conservative absence
guard and an injected fixed-fixture transform to the same synchronous callback.
Fake process commits only after that callback returns. Later content with an
inline selected Tag fails before transform; same-path replacement before/start
callback rejects without retargeting. These prove placement and rejection in
the model, not Desktop identity through the eventual save. The probe has no
grant/selection authorization, shared production lock or production serializer;
it must never be installed or called against an actual Vault as an Apply service.

Returning unchanged content is not a documented zero-write/no-op; the probe
throws on rejected callback content. Even throwing does not establish all
Desktop post-start failure effects. A fake callback failure's zero commits is
model evidence only; a production catch must sanitize uncertainty, never
promise zero disk effects after API start or retry automatically.

## Separate read, metadata and other public API analysis

E3 can supply a fresh sampled string, but not hold it through E2. A deterministic
test samples no-hash content, edits it before processFrontMatter, then observes
the duplicate addition. Comparing/reading again simply moves the window. A
separate read is neither a transaction lock nor permission. Nesting an async
read or second mutation API into a synchronous callback is not a documented
combined atomic transaction.

E5/E6/E7 cannot repair index lag. Matching cached offsets corroborate literals,
not absence of new Tags or their present Markdown context. A cache-derived
empty list and null cache cannot become current absence proof. #75 already
solves event-pair correctness; it is reused without reimplementation.

E12 was considered beyond the required four candidates. Editor buffer reads
or Editor.transaction do not establish exact original-file disk/cache binding;
they also leave closed-note and external-save cases. Rendering HTML would
introduce asynchronous work and no complete Tag inventory contract. Adapter
path-based processing weakens original TFile targeting without supplying a Tag
parser. Bases/TagValue abstractions do not take current raw Markdown and return
complete transaction-bound metadata. No private cache/parser/editor access is
used. A future public parser or metadata generation token plus an atomic
conditional mutation could address the general gap; none was found here.

## Inline boundary and restricted strategy

General inline inspection includes Tags, headings, inline/fenced code, escaped
hashes and URL fragments. Exact literal search misses an ASCII case variant;
the existing ASCII comparator solves identity **given Tag names**, not extracting
complete names from a current body. An ASCII-folded literal can conservatively
skip a positive occurrence, but complete general absence/context/Unicode
coverage is not established by E11 or unit strings. A custom general Markdown
parser is not implemented or assumed. Private parsing, sleep, polling or cache
catch-up are not candidate remedies.

After general strategies failed their evidence gates, the smaller subset was
evaluated. On the actual process callback string:

1. Reject every ASCII hash, regardless of syntax context or selected Tag.
2. Reject frontmatter reported by getFrontMatterInfo, unexpected/helper errors,
   BOM, and strings beginning with `---` (including ambiguous delimiters).
3. Accept only the remaining string for this **conditional absence experiment**.

E11 requires a hash for inline Tags; E9 detects frontmatter. Thus no inline
marker plus no frontmatter implies no selected Tag in that accepted supplied
string. ASCII/hierarchy/Japanese equivalence cannot create a missed Tag when
there are no Tags at all. False positives include all headings, URL fragments,
code hashes, escaped hashes and even unrelated frontmatter. This is not a parser
and not vacuous: ordinary untagged text (including Japanese) passes the model.

No hash **alone** is insufficient: frontmatter list/scalar Tags may omit hashes.
A broader no-hash subset allowing current frontmatter could delegate parsing to
E8/E9, but would additionally require supported-shape/representation validation
and preservation of existing YAML. That broader subset was not certified.
The investigated subset rejects all existing frontmatter instead. BOM and
delimiter handling are conservatively narrowed pending real helper evidence.

The subset argument exists; a fully safe subset strategy is **NOT VERIFIED**.
The human has not chosen its product coverage tradeoff. #69's exact evaluation
snapshot premise is not revived, and the existing #71 architecture is unchanged.

## Preservation, source identity, concurrency and cancellation

| Concern | Evaluation / limit |
| --- | --- |
| Existing frontmatter and Tags | E2 owns serialization for its object callback, but not inline safety. E9/E10 parse/serialize values, not a promise to preserve comments, anchors, formatting, quoted/unquoted styles or existing Tag representations. General whole-YAML rewriting is not selected. |
| Body, LF/CRLF, terminal newline, Unicode | Fixed synthetic new-header transforms concatenate the original callback body without editing it; tests preserve each suffix exactly. This is string-model evidence, not a general whole-note serializer or actual Desktop byte round-trip. Mixed line endings/new header policy and encoding remain NOT VERIFIED. |
| BOM | Rejected by the subset experiment; no relocation or normalization. Any later broader support requires explicit preservation evidence. |
| Wrong target | All mutable strategies must use exact original NoteSource/original TFile/path, Markdown only, no active-note fallback. Re-resolution before API and inside callback catches modeled replacements/rename/move/delete. Read/cache strategy cannot inherit permission merely from the same path. Identity after callback/during save remains NOT VERIFIED for a future process migration. |
| Jevault vs Jevault | Existing WeakMap lock covers Vault/path/TFile across service instances, released in finally. New tests use the real service: second invocation is busy with one API start. A production migration must share/preserve this lock, not add an independent competing lock. The experimental probe is not a production service and has no such integration. |
| Editor/user/external vs Jevault | That lock does not cover editor or OS writes; the modeled external edit during a held Jevault lock still produces the canonical duplicate. E1's persisted-content atomicity is relevant positive evidence; unsaved buffers, save reconciliation and arbitrary external writes require runtime evidence. No mutex invented by Jevault can establish that evidence. |
| Cancel before API | Existing contract and probe check abort before start; tests assert 0 mutation API calls. No await is placed between final guard and API call. |
| Cancel/Close/unload after start | No API AbortSignal/rollback contract; observe actual outcome, suppress late UI in owning lifecycle and release locks. Modeled post-start abort does not initiate rollback. Actual Desktop behavior and lifecycle integration for a new strategy remain NOT VERIFIED. |
| Errors | Unexpected helper state rejects; callbacks/API failures produce sanitized status, no raw body/path, automatic retry or lossy fallback. Fake failure-before-commit is not a runtime no-write guarantee. |

Separate production serialization implementation would need its own approved
Issue after a safety/coverage decision; it is not hidden inside this spike.

## Synthetic evidence

[New tests](../../tests/tag-transaction-safety-spike.test.ts) and
[test-only helper](../../tests/helpers/tag-transaction-safety-spike.ts) use fakes and
synthetic fixtures. API types are public Obsidian types; runtime helper
getFrontMatterInfo outputs are explicit fakes, never a custom YAML/Markdown
parser. Tests use promises to control interleavings; no timing/polling cure.

| Required case | Repository evidence | What it establishes |
| --- | --- | --- |
| Old observation / new inline Tag / no later event | Two canonical schedules using real tracker/capture/service | Observation correctness and even matching advisory freshness cannot certify later duplicate safety |
| Existing inline and frontmatter selected Tag | Explicit observed Tag sets and real service; subset rejects tagged content | Known-current names dedupe; general current inline discovery is not proven |
| ASCII variant | Existing uppercase representation vs selected lowercase; comparator unchanged | #66/#67 identity retained |
| Hierarchical and Japanese | Separate parent/child, exact Japanese existing value; tagged subset inputs reject | No invented hierarchy equivalence, mutation normalization or broader Unicode folding |
| Same-path replacement | Legacy service and experimental process before/callback schedules | Reject modeled replacement, no retarget; actual save-time case pending |
| Same-source double operation | Two real service instances with held callback | Existing shared lock retained; external edit still possible |
| Separate read window | Sample then delayed edit then real service callback | Read does not lock frontmatter mutation |
| Whole-content callback | Current no-hash string changes to tagged string before probe start | Restriction must inspect actual callback data, not earlier read/evaluation |
| Pre-start cancellation | Real service/probe mutation counters | 0 API calls |
| Close/unload after start | Modeled abort inside transform | Actual modeled outcome, no rollback; not Desktop lifecycle verification |
| Callback/transform/API/helper failure | Explicit failures, console/network sentinels, no fake commit | Sanitized status, one attempt, no retry/fallback; real disk consequences pending |
| False positives/preservation | Fixed hash/frontmatter/BOM fixture outcomes; exact LF/CRLF/Unicode/body suffixes | Conservative coverage and string preservation, not parser or serialization runtime semantics |

Relevant baseline: **187 tests / 4 files passed** before edits. Spike focused:
**39 tests / 1 file passed**. Full canonical validation and
Safety Gate results are recorded below; no test count or runtime
claim is inferred from predecessor reports.

## Runtime evidence and limitations

**No isolated Obsidian runtime was executed in this spike.** The negative
decision follows the public-contract/general-parser gap plus unclosed candidate
gates. No actual Vault was used, no temporary runtime plugin was installed, and
no simulated result is promoted to runtime evidence. The Issue requires these
observations before SAFE; this report deliberately does not claim SAFE.

| Critical isolated-runtime scenario | #77 evidence |
| --- | --- |
| Note open in editor; saved/unsaved buffer vs callback content | NOT VERIFIED |
| Existing inline selected Tag | NOT VERIFIED |
| Existing frontmatter selected Tag | NOT VERIFIED |
| ASCII case variant | NOT VERIFIED |
| Hierarchical Tag | NOT VERIFIED |
| Japanese Tag | NOT VERIFIED |
| Edit immediately before/during operation | NOT VERIFIED |
| External/delayed write and metadata lag | NOT VERIFIED |
| Same-path replacement across read/callback/save | NOT VERIFIED |
| Same-source double invocation in Desktop | NOT VERIFIED |
| Cancel before mutation in Desktop | NOT VERIFIED |
| Close/unload before/after API start | NOT VERIFIED |
| Callback/transform/API failure and real save effects | NOT VERIFIED |
| New frontmatter YAML round-trip, encoding/line-ending preservation, undo/history and unchanged-return effects | NOT VERIFIED |

Tests cannot substitute for these observations. E1's documented atomicity is
accepted at its stated level; this report does not disprove it or speculate
about private locking. A claim of complete editor/OS atomicity, identity through
save or lossless serialization would overstate the current evidence. No SAFE
restricted candidate is published until these critical gates are verified.

## Privacy and Safety Gate

Synthetic fixture strings live only in test source and fake operation memory;
there are no real notes, API keys, SecretStorage values or environment dumps.
No raw body/digest/metadata is written to result/status/log/settings/UI/PR/Issue,
and no real Vault content is inspected or persisted. The tests return status
only; the report describes scenarios/results rather than raw fixture bodies.
No provider/Secret/network/telemetry/background work is added. Documentation,
GitHub and existing npm-registry access are investigation tooling, not new
plugin destinations. No dependency was added to obtain a parser or runtime.

Scope, Vault, privacy, Secrets, TypeSafe/main architecture and dependency gates
must be judged from the complete baseline diff. All new mutation calls occur
against fake boundaries in synthetic tests; production remains byte-source
unchanged and still has no Manual Tag Apply UI reachability. Missing candidate
runtime safety is disclosed as a negative research result, never converted into
production permission. No prohibited workaround was needed or attempted.

## Next minimum step and human options

Do not create another Issue automatically. The human must choose the product
coverage/safety direction before production migration:

- **A:** Retain strict duplicate safety; consider only a restricted subset.
  The identified no-frontmatter/no-hash condition still requires a separate
  isolated-runtime/identity/preservation investigation before adoption.
- **B:** Explicitly relax duplicate prevention as a product requirement.
- **C:** Keep frontmatter duplicates strict and define a separate inline rule.
- **D:** Reduce Manual Tag Apply scope.
- **E:** Wait for public API supporting content-bound Tag interpretation or
  conditional metadata/content mutation.

This report selects none of A–E. If A is chosen, the smallest proposed Issue is
**“Verify restricted transaction-time Tag absence with isolated Obsidian
editor/save, original-source and serialization evidence.”** It should cover the
runtime table above before proposing a separate production mutation contract
migration. Choosing B/C/D requires explicit product/architecture approval;
tests or this spike do not grant it. #68 remains downstream of core mutation,
confirmed-intent/readiness migration and its own approval.

## Validation record

- Supported Node **24.19.0** from the existing bundled runtime; `npm ci --cache
  /private/tmp/jevault-77-npm-cache` passed using the unchanged lockfile. Initial
  system Node 23 produced engine warnings; it was replaced for validation by
  the existing supported runtime. No runtime/dependency was installed or upgraded.
  Existing audit output reported two moderate advisories; no audit fix was made.
- Baseline relevant tests: 187 / 4 files passed. New focused tests: 39 / 1 file
  passed. `npm run verify`: **631 tests / 35 files**, lint, build (nested
  typecheck, production bundle and license notices), working/staged whitespace
  passed. Separate typecheck/lint passed before the final additional test.
- All 17 pinned raw documentation reference URLs returned HTTP 200. Referenced
  repository files exist. Installed vs current official declarations were
  compared; only public contracts were used.
- Scope audit: only this report and two new synthetic files; tracked production,
  package/lock/manifest/versions/workflow diff is empty. No research helper symbol
  or import is present in src or the production bundle. Fake-only mutation call
  sites, console/network sentinels and absence of storage/Secret/provider imports
  support the scope/privacy/architecture/dependency Safety Gate. Actual runtime
  I/O counters remain NOT VERIFIED because no runtime was executed.
- Code/full-verification repair iterations: 0. GitHub current-HEAD CI/Code Review
  evidence belongs in the completion report; this local validation record does
  not claim HUMAN MERGE READY or a safe production strategy.

[issue77]: https://github.com/taichocop/jevault/issues/77
[api]: https://github.com/obsidianmd/obsidian-api/blob/40301c12bb922dd8b954c60d674069b6818f0be4/obsidian.d.ts
[docs]: https://github.com/obsidianmd/obsidian-developer-docs/tree/c56c7e770ba25dd0ea392aacf4588f9425970d36
[process]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/Vault/process.md
[vaultguide]: https://docs.obsidian.md/Plugins/Vault
[pfm]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/FileManager/processFrontMatter.md
[read]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/Vault/read.md
[changed]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/MetadataCache/on%28%27changed%27%29.md
[getfilecache]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/MetadataCache/getFileCache.md
[getcache]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/MetadataCache/getCache.md
[cached]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/CachedMetadata.md
[tagcache]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/TagCache.md
[alltags]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/getAllTags.md
[fmtags]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/parseFrontMatterTags.md
[fminfo]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/getFrontMatterInfo.md
[yaml]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/parseYaml.md
[stringify]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/stringifyYaml.md
[tagshelp]: https://help.obsidian.md/tags
[editor]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/Editor.md
[renderer]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/MarkdownRenderer.md
[adapter]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/DataAdapter.md
[tagvalue]: https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/TypeScript%20API/TagValue.md
