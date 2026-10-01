# Issue #69 — restricted Tag Apply fallback investigation

## Decision

**RESTRICTED FALLBACK NOT PRODUCTION SAFE** on the evidence obtained here.
The atomic content comparison is a supported public-API strategy, and the
parser-free absence proof has a useful conservative subset. This decision
does **not** assert that `Vault.process` is unsafe or that the subset is
impossible. Required Desktop/editor/source-lifecycle and failure evidence is
still **NOT VERIFIED**. No production fallback or Apply UI is connected.

Keep existing fail-closed preparation and the changed-event path. #68 may use
only currently issued metadata-bound authorization; successful Tag Suggest
alone must never enable Apply. A future production implementation requires
the runtime gates below, a separately approved scope, and shared locking with
the current mutation service. No new Issue is created here.

## Baseline, approval and authoritative inputs

Investigated 2026-10-02 JST. Human approval is the explicit pasted request to
execute #69 as research only, including a test-only prototype and an isolated
synthetic runtime investigation. It explicitly prohibits production wiring,
new Issue creation, merge/auto-merge, tags and releases.

Initial clean detached HEAD: `6f4e089c47c6d70803c888cb3d10630dcf5ca9bb`.
`git fetch origin` and `git ls-remote origin refs/heads/main` independently
established latest main: `72be0fe97aee72f782f4d3b0fadc8110cf638b1c`.
Branch: `codex/issue-69-restricted-fallback`, created from that main.

Inputs: [#69](https://github.com/taichocop/jevault/issues/69),
[#64](https://github.com/taichocop/jevault/issues/64),
[PR #65](https://github.com/taichocop/jevault/pull/65),
[#66](https://github.com/taichocop/jevault/issues/66),
[PR #67](https://github.com/taichocop/jevault/pull/67),
[#68](https://github.com/taichocop/jevault/issues/68),
[ISSUE_64_SPIKE.md](ISSUE_64_SPIKE.md), [AGENTS.md](AGENTS.md),
[LOOP](agent/LOOP.md), [REVIEW](agent/REVIEW.md),
[STOP](agent/STOP_CONDITIONS.md), and [PR review loop](agent/PR_REVIEW_LOOP.md).
There is no `docs/` tree. Relevant README/PRIVACY sections and all six requested
production files were inspected, as were suggestion service/command/modal
lifecycle, #66's identity helper and relevant Apply/preparation/spike tests.

PR #65's parser-free subset finding is the hypothesis evaluated here. PR #67's
final approved behavior deduplicates both existing-vs-selected and
selected-vs-selected ASCII case variants, retaining the first selected
representation. Its original contrary scope finding was superseded by explicit
human approval. Neither predecessor review substitutes for this PR's review.
The active Issue suggests creating a later implementation Issue; the current
human request explicitly says to present scope and stop without creating one.

## Public contracts, including limits

Installed typings: Obsidian **1.13.1**, `node_modules/obsidian/obsidian.d.ts`.
The official public declarations and documentation were rechecked; no private
implementation, extracted parser or new parser dependency is used.

| API / official source | Established contract and limit |
| --- | --- |
| [Vault guide](https://docs.obsidian.md/Plugins/Vault), [process](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Vault/process.md) | Synchronous whole-content callback inside atomic read/modify/save; returns the written string. The guide guarantees content does not change between read and write and explicitly recommends callback equality against retained content after async work. This closes the separate read-to-write content gap. Do not weaken it to a pre-read comparison alone. |
| [read](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Vault/read.md) | Reads plaintext directly from disk. A prior read has no lasting lock, metadata binding or promise of including unsaved editor text. |
| [processFrontMatter](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/FileManager/processFrontMatter.md) | Atomic frontmatter object mutation; propagates YAML/callback errors. Callback has no whole body. Keep this existing path when its metadata proof is available. |
| [getFrontMatterInfo](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/getFrontMatterInfo.md), [FrontMatterInfo](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/FrontMatterInfo.md) | Public helper describes frontmatter existence/text/offsets for the supplied string. Detailed malformed/BOM/empty-block behavior is not specified. Unexpected results must reject, never broaden eligibility. |
| [parseYaml](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/parseYaml.md), [stringifyYaml](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/stringifyYaml.md) | Public string/object helpers; signatures do not specify quoting, scalar coercion, Unicode spelling, final newline or formatting. Validate generated data and delimiter/body boundaries by public round-trip; the fixed Desktop case passed; broader helper and lifecycle behavior still needs evidence. |
| [rename](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Vault/on%28%27rename%27%29.md), [delete](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Vault/on%28%27delete%27%29.md), [modify](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Vault/on%28%27modify%27%29.md), [create](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/TypeScript%20API/Vault/on%28%27create%27%29.md) | Public lifecycle notifications, with no documented synchronous external filesystem identity lock. Create also runs for existing files on initial load. Events cannot be invented as proof of an unobserved replacement. |

`Vault.process` atomicity concerns the whole-content transaction. The public
surface does not separately specify file-object generation pinning through an
unobserved OS delete/recreate, editor unsaved-save reconciliation, exact
callback-throw/no-write behavior, unchanged-return/no-write behavior, disk
encoding preservation or undo/history semantics. These are evidence gaps,
not experimentally observed defects. Do not infer that arbitrary OS writes
are prevented by a kernel lock, or that a synchronous callback pins file
identity until the asynchronous Promise resolves. Required external-edit and
source/editor interleavings remain runtime gates.

## Exact eligibility and source contracts

All conditions must hold for the **actual callback current string**:

1. The original `NoteSource` still resolves to the same TFile object at its
   captured path, with valid Markdown file/path structure. Never consult the
   active note. Check before read, after read, before process, at callback
   entry and immediately before returning the candidate.
2. Evaluation provenance belongs to that exact source. A read made during an
   explicit Apply operation is fingerprinted with the existing UTF-16-safe
   fingerprint helper and must match that provenance. This only establishes
   the retained snapshot's relation to evaluation.
3. `current === retainedSnapshot` inside `process`, using exact string
   equality, independently of equal mtime/size. No async callback, cached
   metadata omission, stat-only proof, timeout or polling substitutes for it.
4. No existing frontmatter, no ASCII U+0023 `#` anywhere in current. Also reject
   leading BOM, a first non-whitespace prefix `---`, and bare CR. Require helper
   `exists === false`, empty frontmatter, and zero offsets. Unknown/throwing
   helper output rejects. These additional restrictions narrow the subset.
5. Every selected name belongs to the frozen exact authorized successful
   suggestion set of existing Vault tags. Authorization is checked **before**
   semantic deduplication; allowed `#aws` never permits unlisted `#AWS`.
   Use #66's ASCII comparison to retain only the first equivalent selection.
6. Operation is live, explicit selection/confirmation is supplied by the
   future caller, and the same Vault/source lock is held. The prototype has no
   production confirmation UI and cannot issue production authorization.

Rename/move makes the captured path mismatch even if the object survives.
Delete resolves to null. Same-path replacement resolves to a different object
and rejects even with identical content/stats. Active-note switch has no
effect. Synthetic tests cover these before process and at callback entry.
They do not prove rejection of an unobserved replacement **after** the final
guard or establish event delivery timing. Production needs scoped lifecycle
invalidation and public-contract/runtime evidence for the process boundary;
no active-note fallback or attempt to operate on a replacement is permitted.

## Absence proof and conservative coverage

[Official Tags syntax](https://help.obsidian.md/tags) describes inline tags as
hash-prefixed keywords and tags in the frontmatter `tags` property.
[Properties](https://help.obsidian.md/properties) locates that property block
at the beginning of the file. Thus, **conditional on the public helper's
no-frontmatter result being supported for the accepted string**, no frontmatter
eliminates property tags and zero U+0023 eliminates every inline tag marker.
Selected spelling, case, Unicode and Markdown contexts cannot create a marker
that is absent from the entire callback string. No general Markdown parser or
Unicode normalization is needed for this restricted proof. This is a source
syntax proof, not a claim that stale cache omission establishes absence.

The unexpected-helper/malformed guards fail closed. Desktop execution accepted
the fixed plain/LF/CRLF/leading-content cases and rejected heading, normal/empty
frontmatter, malformed delimiter and BOM cases. These are observations of the
combined guard, not a general helper specification; some rejections precede
the helper call. Unit fixtures alone do not certify actual helper behavior.
Normal/empty frontmatter, malformed opening delimiters, BOM, BOM-frontmatter,
leading blank delimiter and bare CR are rejected even with a fake absent
helper. An ambiguous helper result cannot become eligible.

| Synthetic corpus | Candidate eligible | Observation |
| --- | --- | --- |
| Plain prose | yes | No frontmatter or marker |
| Markdown heading | no | Conservative false positive |
| URL fragment | no | Conservative false positive |
| Inline code containing hash | no | Conservative false positive |
| Fenced code containing hash | no | Conservative false positive |
| Escaped hash | no | Conservative false positive |
| Actual inline tag | no | Necessary rejection |
| Ordinary hash text | no | Conservative false positive |
| Long no-frontmatter note (10,000 lines) | yes | Size does not broaden syntax |
| Frontmatter tag note | no | Necessary rejection |

2/10 eligible in this deliberately selected corpus, **not an estimate of real
Vault coverage**. Six rejected samples have no actual inline tag and illustrate
the UX cost. A tag-bearing string being accepted would be an unacceptable
false negative. The conditional syntax proof above rules it out within the
accepted public-helper subset; broader helper/runtime semantics are not
silently declared verified.

## Retained snapshot and privacy

The prototype retains a snapshot only during explicit `apply()`: exact-target
read → provenance comparison → private in-memory string → callback equality.
No extra read/hash at session creation, plugin load, idle, UI display or
unrelated-file activity. The original Tag Suggest evaluation/tracker hashing
already in production is unchanged; “outside Apply = 0” here refers to new
fallback reads/hashes, not erasing existing authorized Suggest behavior.

`finally` clears the retained field and releases locks on every terminal
result. `dispose()` immediately clears that field, and later async work checks
disposal before installing retention or calling process. Close, Retry, failure,
cancel and unload must dispose any future owner. Local variables in pending
read/hash/process Promises remain reachable until those Promises settle;
JavaScript strings cannot be securely zeroed or their GC timing guaranteed.
No indefinite global retention/session history is proposed. Prefer this
Apply-only read/provenance match over holding evaluated body for Modal lifetime.

Body/digest persist/log/UI = 0; telemetry = 0; new plugin external destinations
= 0; fallback TypeSafe requests/Secret lookups = 0. The fallback doesn't scan
other note bodies or create listeners/background work. Fixed synthetic fixture
strings in tests and the isolated fixture files are test data, not retained
user-body persistence. Development GitHub/docs/npm access is separate from
the zero-network fallback execution contract.

## Serialization and representations

For a proven eligible current string, serialize only `{ tags: additions.map(
name => name.slice(1)) }` with public `stringifyYaml`. Prepend opening delimiter,
generated YAML, closing delimiter and separator; append the original current
string directly. Do not trim/split/rejoin/normalize body, or add a final body
newline. Use the first body newline's LF/CRLF style for the **new header**;
default to LF when no body newline exists. Mixed body endings remain mixed.
Only generated-header newlines are converted.

Validate the complete candidate with `getFrontMatterInfo` and `parseYaml`:
frontmatter exists, `contentStart` equals generated header length, suffix equals
original current string, parsed object has only `tags`, and every string value
equals the ordered intended persistence name. Reject helper errors, YAML
coercion, case/Unicode changes and boundary mismatches. This requires no new
parser dependency or hand-written frontmatter parser.

`#AWS`, `#Programming/AWS`, `#日本語`, NFC `#é`, and NFD `#e\u0301` retain their
representation apart from the single leading persistence `#`. ASCII semantic
duplicates are suppressed before serialization; hierarchy is not expanded to
parents and Unicode is not normalized/folded. Tests establish construction
and original string preservation for empty, leading, LF, CRLF, mixed-ending,
trailing-newline and Unicode fixture bodies using **fixed helper responses**.
Desktop Run and Inspect subsequently verified real public-helper round-trip,
ordered case/hierarchy/Japanese representation and metadata recognition for
the fixed three-tag CRLF fixture. Independent comparison of the generated
synthetic file confirmed the original UTF-8 body bytes and terminal CRLF.
Broader Unicode normalization variants, mixed-ending disk behavior and editor
reconciliation remain NOT VERIFIED. No unrelated frontmatter properties exist
in this subset.

## Cancellation, concurrency and failures

- Abort/dispose before operation or during read/hash: process calls 0,
  mutation 0. Abort/dispose before returning candidate: throw a fixed error,
  return sanitized cancelled result. Fake-process tests model no write on throw;
  actual throw behavior is NOT VERIFIED.
- Once candidate is returned, do not implement rollback. If process resolves
  with that candidate, report the synthetic write even if a late cancel occurred.
  If process rejects, return fixed `unexpected` failure, never false “applied”.
  A post-write I/O failure may leave state uncertain; don't claim mutation 0
  for all actual operation failures or automatically retry/rollback.
- Returning unchanged content is deliberately avoided: no public no-write
  guarantee was established. Validation failure returns no mutation candidate.
- Prototype locks path **and** TFile across instances in a WeakMap keyed by
  Vault. A concurrent second Apply rejects busy; a sequential fresh operation
  sees changed content and rejects against old provenance. Same object is
  one-shot. Tests prove mutation max 1 in the modeled double-Apply schedule.
- Prototype locks are separate from the production service's private map.
  Before any production use, both paths must acquire a **single shared lock**
  for the whole operation. The prototype must never run beside production on
  user notes. Sharing a lock only inside the fallback would be insufficient.

## Coexistence and proposed typed availability (report only)

```ts
type ApplyAvailability =
  | { status: "available"; capability: OpaqueApplyCapability }
  | { status: "unavailable"; reason:
      "freshness-unverified" | "content-not-eligible" | "source-changed" };
// Internal capability union: metadata-bound | restricted-content-safe.
// Capability is issued/bound to Vault, source, successful evaluation and lifetime.
// UI never receives retained strings, digests, proof objects or helper algorithms.
```

Use the existing changed-event content-bound authorization first. Only if no
normal proof exists and a separately proven restricted capability can be
issued should the future orchestrator consider process. Invalid/stale source
or provenance cannot be bypassed by trying another path. Recheck at mutation;
an earlier availability display is not a write permission by itself. Empty
selection creates no work. UI maps either valid capability to “Tags can be
safely applied”; unavailable maps to “This result can be reviewed, but tags
cannot be safely applied to this note yet.” A changed source should direct the
user to a new explicit Suggest. Avoid UI proof-algorithm details and automatic
re-evaluation. Current production types/preparation/UI are unchanged.

## Strategy matrix

| Strategy | Public API only? | Exact source safe? | Atomic freshness? | Duplicate absence proof? | Serialization safe? | Editor behavior? | Cancellation | Concurrency | Privacy | Coverage | Runtime verified? | Production recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Existing changed-event + processFrontMatter | yes | Existing guards | Existing content-bound proof/guards | Verified metadata + #66 semantic filter | Existing boundary | No new behavior here | Existing no rollback | Existing shared service locks | Existing scoped tracking | Requires post-session proof | Predecessor evidence only | Keep unchanged |
| Separate read/provenance + processFrontMatter | yes | Guards only | **No** body binding at write | No current inline absence | Existing boundary | No solution | Not a remedy | Lock alone insufficient | Target-only possible | General notes | Not needed to reject | Reject |
| process + no-frontmatter/no-hash + exact retained snapshot | yes | Pre/callback guards; boundary gap remains | **Yes for callback content**, per public guide | Conditional parser-free syntax proof | Candidate/string and round-trip guards; fixed Desktop case passed | NOT VERIFIED | Pre-start 0; callback throw unverified; no rollback | Prototype shared fallback lock; production integration required | Apply-only target read/hash; memory only | Very narrow, 2/10 corpus | Limited fixed round-trip only; races NOT VERIFIED | Promising research candidate; do not ship |
| read then modify, or stat/cache alone | yes | Insufficient | **No** | **No** | Cannot rescue freshness | Unverified | No safe remedy | Cannot close read/write gap | Target-only possible | Apparently broad | Not needed to reject | Reject |
| Keep fail-closed / #68 safe message | yes | No new writes | No new claim | No new claim | No new serialization | No new behavior | No operation | No new writer | No new body handling | Suggestions remain useful | Current production baseline | Current recommendation |

## Synthetic evidence and runtime gates

`tests/restricted-tag-fallback-spike.test.ts` covers all ten requested cases:
eligible candidate; changed body; newly appearing hash; newly appearing
frontmatter; rename/move/delete/replacement before and during callback; original
target after active switch; one multi-tag transform; hierarchy/Japanese/case/NFD;
callback/operation/post-candidate failure sanitization; and double Apply max 1.
Additional cases cover exact authorization before dedupe, missing/mismatched
provenance, abort/dispose timing, late cancel/no rollback, representation
round-trip rejection, body newline preservation and unexpected helper output.
All Vaults/helpers are fakes; no provider, Secret or real Vault is used.

The optional runtime helper is
`tests/helpers/restricted-tag-fallback-runtime-plugin.ts`, separately bundled
with only `obsidian` external. It is not imported from `src` or the production
entrypoint. On load it registers explicit research commands without reading
bodies. It refuses a Vault name other than `Jevault-Issue69-Synthetic`, uses
fixed fixture paths/content, confirms selected tags in the synthetic catalog,
and emits only status/boolean observations. The name guard is an additional
misuse guard, **not** proof of isolation; the operator must confirm the actual
prepared fixture directory before enabling it.

A standalone fixture Vault and generated helper were prepared at
`/private/tmp/Jevault-Issue69-Synthetic`. No existing user Vault/plugin was
edited. Initial Computer Use selection was rejected because isolation had not
yet been proved and real Vault data might be exposed; that rejection was
respected without an indirect execution or private/alternative OS API. The
human explicitly authorized operating only the prepared Vault. Initial UI
input then produced no observed accessibility change on three bounded attempts,
so Desktop input stopped. These observations and their counters are retained.

The human reported Obsidian frozen, restarted it, and explicitly reported it
open. This environment change authorized resume. The native folder picker and
visible Vault title then confirmed the prepared directory. Only the generated
synthetic helper was enabled; the isolated `community-plugins.json` independently
confirmed that single plugin ID. Obsidian's visible version was **1.13.7**;
installed development API typings remain **1.13.1**.

The explicit Run command returned **written** in the actual Obsidian Modal.
Its observations were all true: plain, headingRejected, frontmatterRejected,
emptyFrontmatterRejected, malformedRejected, bomRejected, crlf, lf and
leadingContent. Run uses fixed synthetic provenance, no TypeSafe/Secret calls,
and the public helper functions. The fixed target received one new header;
comparison with the known fixture bytes confirmed the original UTF-8 body
suffix, its final CRLF, and CRLF-only new header. This is limited real-runtime
evidence, not a proof of races or editor behavior.

Inspect input initially again had three attempts without observed palette
state, so input stopped. The human explicitly requested another automatic
attempt. On that bounded resume the palette was visible, Inspect executed,
and both accessibility text and screenshot showed:

- `frontmatter: true`
- `bodyPreserved: true`
- `representationPreserved: true`
- `recognized: true`

These values were observed automatically, not supplied by the human. Inspect
reads the generated fixture and checks public helper output and actual
metadata tag recognition. It does not perform another mutation. The earlier
lack of immediate UI change is not promoted into a claim of failed dispatch:
commands sometimes became visible on a later rebind, and no root cause was
established. No sleep/polling or private app execution was used.

Cleanup input initially stopped again: the result Modal remained visible after
keyboard attempts; coordinate close reported `windowNotFoundAtPosition`, and
AX close reported `elementHasNoFrame`. The human explicitly requested another
automatic retry. Selecting the named Issue 69 Vault through the native Window
menu showed the Modal closed. The palette then dispatched Dispose, and settings
allowed helper disabling. The actual settings screenshot showed its toggle off;
the isolated `community-plugins.json` independently contained an empty array.
Thus cleanup is verified as command dispatch and disabled configuration, with
no separate instrumentation of the private owner state. The helper's public
`onunload` calls the same disposal method. This terminal cleanup does **not**
certify Close/unload interleavings around an in-flight process.

The UI blocking condition was resolved on the human-authorized retry; historical
failures and earlier stops remain recorded rather than silently discarded.
No generated fixture was deleted, no other Vault was mutated, and no new Run
was dispatched. The completed Apply's `finally` clears its retained snapshot
and lock. No background read/hash/listener or pending mutation is introduced.

| Required Desktop observation | Status |
| --- | --- |
| Public helper no-frontmatter corpus, including BOM/CRLF/malformed cases | Fixed combined guard cases passed; broader helper semantics NOT VERIFIED |
| New frontmatter creation and stringify/parse round-trip | VERIFIED for the fixed three-tag CRLF fixture |
| Obsidian actual Tag recognition | VERIFIED for all three selected tags by Inspect |
| Case/hierarchy/Japanese representation | VERIFIED for the ordered fixed selection; broader NFC/NFD cases NOT VERIFIED |
| Original body string and disk bytes/line endings | VERIFIED for fixed UTF-8/CRLF body and terminal newline; broader cases NOT VERIFIED |
| Target note open in editor, unsaved edits and subsequent saves | NOT VERIFIED |
| External edit race, rename/move/delete/same-path replacement boundary | NOT VERIFIED |
| Process callback throw / operation failure behavior | NOT VERIFIED |
| Undo/history/dirty-state effect | NOT VERIFIED |
| Close/unload around process start | NOT VERIFIED |
| Terminal Dispose dispatch and helper disabling | VERIFIED; live owner state not separately instrumented |

Separate bounded synthetic scenarios remain required for editor unsaved/save,
external writes, source replacement, callback throws and Close/unload/undo.
The current helper does not exercise those races. Past failures and repair
counts are retained; the resolved UI stop does not fill the missing production
contract evidence. The helper is disabled and generated fixtures are preserved.
Any later cleanup must remove only known generated artifacts/fixtures and never
a user Vault.

## Next minimum scope and stop

There is **no approved production implementation recommendation yet**.
The next minimum work is the missing isolated Desktop contract verification,
especially identity through the transaction, editor save reconciliation and
callback failure/no-write behavior. If these cannot be established publicly,
keep unavailable; do not replace the gaps with a parser, private implementation,
refresh mutation, background hashes or sleeps.

Only after those gates pass should a separately approved implementation scope
consider: an opaque lifetime-bound restricted capability, explicit-Apply-only
snapshot/provenance comparison, existing exact source guards plus lifecycle
invalidation, callback-local equality/absence/round-trip guards, one shared
normal/fallback Vault-source lock, fixed failure/cancel semantics, and disposal
integration for Close/Retry/unload. Keep normal changed-event priority and use
the #68 presentation contract without leaking proof/body data. No UI connection,
production source/type change or new Issue is made in this investigation.

## Validation and Safety Gate

Supported runtime: Node **24.19.0**. The first exploratory install/test used
host Node 23.11.0 (unsupported); it is not canonical evidence. `npm ci` and the
146-test focused baseline were rerun on Node 24.19.0 with the unchanged lockfile.
Existing npm audit reported two moderate advisories; no dependency changes or
audit fix were performed.

Focused prototype: **63 tests passed**; runtime-owner regressions: **4 tests**.
Separate typecheck/lint passed.
The initial focused run had one mock alias recursion defect in a cancellation
test, repaired by preserving the mock implementation; the first typecheck
found one implicit-any fixture parameter, repaired by explicit typing.
Focused/typing repairs: 2, distinct causes; no repeated root-cause failure.
Standalone runtime helper bundle: compiled and executed only in the prepared
isolated Vault, with the limited Run/Inspect results above.

Final `npm run verify`: **594 tests / 35 files passed**, lint passed, production build
passed (nested typecheck, bundle and license notices), working/staged whitespace
passed. Separate `npm run typecheck`/`npm run lint` passed; the canonical verify
command executes `npm test` and `npm run build`. Full-verification repairs: 0.
Production bundle inspection found no restricted-spike symbols/imports.
Independent read-only review found a runtime-helper ownership race: two Run
commands could overwrite the controller during read/provenance waits, allowing
the older command to survive Close/unload. Local-review repair 1 acquires
ownership before the first await, rejects overlapping Run commands and checks
the captured controller after awaits. Four fake-app regressions cover double
Run + Close/unload, old completion after a new Run, and wrong-Vault refusal.
Post-PR repair 1 addresses a valid Codex test-evidence finding: the original
old-completion regression cancelled both Runs and shared one deferred read,
so it did not exercise an old completion while its replacement remained live.
The repaired test supplies two independent command reads, an authorized fake
catalog and fixed public-helper responses. It resolves the old read while the
new Run is still pending, verifies no catalog access/process from the stale
completion, then resolves the new read and verifies exactly one successful
transform. This positive control establishes that the fake can reach the writer;
it does not add a claim about actual Desktop lifecycle semantics.
Final verification/re-review and current-HEAD CI/Codex status are recorded in
the PR/completion report; none can certify Desktop gates above.

Safety audit for this diff: **production behavior change = 0**. Changed files
are this report and four new test-only files. No `src`, production UI, package,
lockfile, manifest/version, dependency, workflow, release, normal preparation
or normal mutation path changes. No user-Vault mutation, TypeSafe request,
Secret lookup, telemetry, body/digest logging or background scan is introduced.
The runtime helper is a separately compiled, explicit synthetic-only writer;
its fixture setup and single observed synthetic write are not production
behavior. Unit fakes model process writes and do not certify the missing
Obsidian interleavings. Required runtime gates remain NOT VERIFIED, and a
green research PR must never be interpreted as approval to ship fallback.
