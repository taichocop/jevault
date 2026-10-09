# Issue #113 — v0.5.0 Release Readiness audit

**V0.5.0 RELEASE READINESS: NO-GO**

Initial audit: 2026-10-09 JST; resumed host/provider verification: 2026-10-10 JST. Scope: [#113](https://github.com/taichocop/jevault/issues/113).
This is a readiness audit, not release execution. No version change, tag, Release,
deployment or merge is authorized or performed. On 2026-10-10 JST the human
separately authorized the two release-protection settings described below and
then requested this PR evidence update. That authorization does not accept
residual risks or authorize credential changes or #114 execution.
The human later authorized a dedicated SecretStorage credential and a ceiling of
100 TypeSafe requests; four were performed successfully. #114 remains gated and
#42 remains open.
Residual risks have not been accepted by the owner.

## Baseline and evidence identity

- Existing Codex/Orca worktree reused from a dedicated local worktree directory (absolute path omitted).
- Orca identity: `wt2:local:6e70f3fa-7fe8-46ef-b732-7098becd4010`;
  Orca 1.4.222, linked Issue 113, display name Jevault Issue 113 Release Readiness.
- Initial detached HEAD: `1d20040766892b9e63a9d5df26b06a401d6281b4`; clean tracked/untracked status.
- Fetched base/current main: `46f7a724bd8840c5dceeb905fd11739c9d418c39`.
- Branch: `codex/issue-113-release-readiness`, created from that latest `origin/main`.
- At audit start: open Issues #42, #113, #114; open PRs 0; only tag/Release 0.1.0.
- Read latest AGENTS.md, complete #113/#42/#114, PR #112 discussion/body, its
  `docs/history/ISSUE_111_APPLY_UI_VERIFICATION.md`, release checklist/workflow/script,
  README/SECURITY/PRIVACY, metadata and current Organizer safety/lifecycle code/tests.
- PR #112 merged as the base above. Its 1.14.4 synthetic 15-case native evidence is
  historical evidence with fake analysis; actual Plugin Disable and real provider
  smoke were explicitly NOT VERIFIED. It is not a new #113 host pass.
- Final audit PR HEAD, exact-HEAD local verification, Actions URL/results and
  independent Codex Review are recorded in the PR evidence after this document is
  committed. No candidate SHA is inferred from a previous PR or a local build.

## Version target and later #114 plan

0.5.0 matches the implemented v0.5 roadmap. [SemVer](https://semver.org/) does not
require intermediate releases; 0.x is initial development. Current metadata uses
plain numeric versions. The current official Community Directory entry has id
`jevault` and repository `taichocop/Jevault`, without a release-version field that
requires an intermediate version. No inspected repository/directory constraint
contradicts 0.5.0. This does not replace future Community scanner/install checks.

Unchanged: manifest/package 0.1.0; versions `{ "0.1.0": "1.11.4" }`;
Desktop-only; minAppVersion 1.11.4. After GO and fresh human authorization, #114
would set manifest/package to 0.5.0 and synchronize existing package-lock root
version metadata if required by that version change. No redundant versions entry
is needed if the 1.11.4 minimum is retained under existing compatibility policy.
If actual minimum compatibility requires a different minimum, #114 needs an
approved manifest minimum and explicit `0.5.0` mapping to it. Tag must be plain
`0.5.0`, never `v0.5.0`. No minimum change is recommended without runtime evidence.

## Document reconciliation

RELEASE_CHECKLIST now covers Preview → Analyze → Review → Finish review →
Apply selected changes → Confirm Apply → Progress / Stop → Result, final
single-use authority, original source/snapshot, stale/destination/collision checks,
shared leases, additive Tags, no-op choices, Tag→Move partial success, settlement,
no rollback/retry, local Apply, unavailable/unattempted truth, actual disable,
minimum/current host, provider, upgrade and explicit readiness gates.

README's Manual Move paragraph previously made a plugin-wide statement that it
never rewrites frontmatter; it now distinguishes Manual Move from confirmed Tag
operations. SECURITY's Manual Move paragraph previously said only Manual Tag Apply
could add Tags; it now also names explicitly confirmed Organizer Apply. PRIVACY
already describes the final confirmation and local Apply correctly and is unchanged.
The three documents agree on triggers, payloads, BYOK/SecretStorage references,
credits, local Preview/Review/Apply, partial success, no rollback, no background
mutation/upload and no telemetry. No workflow/product changes were made.

## Automated verification

Executed first on exact base SHA `46f7a724bd8840c5dceeb905fd11739c9d418c39`:

| Check | Result |
| --- | --- |
| Host initial npm ci, Node 23.11.0 / npm 10.9.2 | Installed; unsupported-engine warnings. Superseded by supported-runtime install below. |
| npm ci, Node 22.13.0 / npm 10.9.2 | PASS; committed lockfile unchanged; 154 packages installed. |
| npm run verify | PASS: 47 test files / 1,382 tests. |
| npm test | PASS via verify; integration/network suites excluded by vitest.config.ts. |
| npm run lint | PASS via verify. |
| npm run typecheck | PASS via production build inside verify. |
| npm run build | PASS via verify, production bundle generated. |
| npm run verify:licenses | PASS via build; full TypeSafe SDK notice found in main.js. |
| git diff --check and staged equivalent | PASS via verify; documentation diff checked again. |
| prepare-release with no tag; shasum -a 256 -c | PASS; exactly three nonempty regular files and three matching hashes. |
| prepare-release with 0.5.0 against current 0.1.0 metadata | Correctly rejected before staging; no metadata mutation/tag created. |
| Existing prepare-release unit cases | PASS: inheritance, exact tag/package equality, minimum changes/conflicts, numeric ordering, missing/empty assets. |

Node 22.13.0 was reused from the isolated prior verification cache; PATH was scoped
to the commands, not installed globally. `verify` invokes tests, lint, production
build/typecheck/licenses and both whitespace checks; these results are not claimed
as separately repeated commands. Final committed audit HEAD must pass the same
verify path and npm ci; see PR evidence for its exact SHA.

Production/staged SHA-256 on that code tree:

| Asset | SHA-256 |
| --- | --- |
| main.js | 9f942ff1372b6f9d4b947191f4b139aec97abc006f16fc28ba434f72cf1fc3f2 |
| manifest.json | ddbda3a16ca88ff2cae9dd7b66f28fcb551f037a8524d8b59be27bedca400c92 |
| styles.css | b946afcc33dacaccbf2178fc8f01f5a84c8ce8867ed2c1117611075e23e94add |

### Dependency advisory assessment

`npm audit`: 6 affected package entries (2 moderate, 4 high), from two root
advisories, not six independent vulnerabilities. `npm audit --omit=dev`: 0.

| Advisory / affected chain | Boundary and disposition |
| --- | --- |
| [moment path traversal](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw), moment → obsidian (moderate) | Development API package; production externalizes obsidian. Jevault does not bundle this moment dependency. Installed Obsidian's own runtime dependency security is not established by npm audit. |
| [source-map-js indexed-map denial of service](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), source-map-js → postcss → vite → vitest (high) | Development/test chain; absent from the production dependency graph. Untrusted source-map processing remains a development concern. |

No shipped dependency advisory was reported by this audit. Development advisories
are a KNOWN LIMITATION, not owner-ACCEPTED and not dismissed as harmless. No
unrelated dependency upgrade was performed. Any remediation belongs in a bounded
separate Issue; no product/release-workflow defect was established during this audit.

## Non-publishing release validation and owner prerequisites

Existing release.yml and prepare-release.mjs are unchanged. PR/workflow_dispatch
runs only the read-only validate job. Only a push to a tag can run the release job;
readiness never triggers that path. Default contents:read, checkout credentials
not persisted, actions pinned to commits. Release-only contents/id-token/
attestations/artifact-metadata write scopes support publishing and attestation;
PR/dispatch receives none of those job-specific write scopes.

The workflow stages, attests and uploads the same three paths, checks hashes before
upload, requires exact tag/version, main ancestry, protected tag rules, current tag
identity, and rejects an existing Release. Non-publishing validation cannot prove
real attestation or immutable publication; those remain #42/#114 future evidence.
Current audit-PR validate success/release skipped must be confirmed on exact HEAD
and linked in PR evidence; historical PR #112 CI is not a substitute.

The initial audit found no tag ruleset and did not establish future-release
immutability. Those historical results are superseded by the separately authorized
settings change and authenticated owner API read-back on 2026-10-10 JST:

| Prerequisite | Current observed value | Disposition |
| --- | --- | --- |
| [Protect all release tags](https://github.com/taichocop/jevault/rules/24800998), ID 24800998 | target `tag`; enforcement `active`; include `["~ALL"]`; exclude `[]`; rules `update`, `deletion`; bypass actors `[]` | VERIFIED; the initial missing-ruleset blocker is resolved. |
| Future Release immutability | `GET /repos/taichocop/jevault/immutable-releases`: `enabled=true`, `enforced_by_owner=false` | VERIFIED repository setting; actual future publication remains #114 evidence. |
| Private Vulnerability Reporting | `enabled=true` | VERIFIED; unchanged. |
| Collaborators and deploy keys | Only `taichocop`, role `admin`; deploy keys count 0 | VERIFIED for these API-visible actors only; not a complete credential inventory. |
| Existing tag and Release | Only `0.1.0`; tag object `ec1dc9f9a6f40629a269d6110aac4e8370d5ccf5`; Release `immutable=false` | Historical Release unchanged; all-tag rules now protect its tag. |

Owner-authorized operations were limited to creating that ruleset and enabling
future Release immutability. No collaborator role, App permission, OAuth scope,
PAT or deploy key was changed. No destructive tag-update/deletion probe was run.
Read-back confirms the existing release workflow's protection prerequisites;
the tag-triggered release job was not executed.

The ruleset has no `creation` rule: existing writers can still create a new tag
and trigger the release job. An empty bypass list applies the rules to normal
owner operations too, but an administrator can still edit repository rules.
[Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
protect future published assets and associated tags; draft uploads and editable
release text still require trusted editors. Existing 0.1.0 is not retroactively
immutable. Neither setting establishes that every publishing credential is trusted.

Earlier authenticated read-only account UI inspection identified the installed
ChatGPT Codex Connector and one fine-grained PAT. Their detailed repository
selection/permissions remain **NOT VERIFIED** behind GitHub's human reauthentication
gate. Six OAuth authorizations exposed `repo` and `workflow` scopes: GitHub CLI,
GitHub Copilot IDE Plugin, GitHub iOS, GitKraken, JetBrains IDE Integration, and
Visual Studio Code. These are potential writers under the owner's authority,
not a finding that they have performed a release operation. Authorized GitHub App
credentials and any credentials held outside GitHub's visible inventory are not
established by collaborator/deploy-key APIs. Owner review of trusted tag creators
and draft/release editors remains a GO blocker; no credential was revoked or
silently approved.

## Initial native host attempt and mandatory safety stop — historical

Official installed Desktop: 1.14.4, also current official latest release returned
by the [vendor release API](https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest)
at audit time. Official 1.11.4 DMG was downloaded and read-only mounted in a disposable local temporary directory,
and its CFBundleShortVersionString confirmed 1.11.4. These are version/setup
observations, not plugin compatibility passes.

Fresh disposable production Vaults/profiles were prepared only in isolated local temporary directories:

- Stable: `Jevault-113-Synthetic-Stable-j5aj69fv`.
- Minimum: `Jevault-113-Synthetic-Min-cf1yc3sg`.
- Marker: `SYNTHETIC-113.marker.md`; Inbox/Sub and Dest synthetic fixtures.
- Only production main.js/manifest/styles installed, no API key/Secret values.
- A separate fresh #111 fake-analysis fixture was prepared but never executed.

Orca's initial discovery returned no visible windows. An isolated 1.14.4 process
later exposed a window whose title, Vault name and marker matched the stable
fixture. Its native trust/enable prompt was visible. Semantic enable click did
not change observed UI. Coordinate input failed closed with window_not_focused;
a restore attempt followed by another input attempt also failed focus validation.
Plugin enable, Settings, commands and Preview were therefore not verified.

A fallback Computer Use `getApp("Obsidian")` selected an already-running real-user
Vault instead of the isolated process and automatically returned its visible
accessibility state. **Native work stopped immediately.** No click, edit, command,
plugin operation or filesystem inspection was performed on that real-user Vault;
its title, paths and contents are not copied into this evidence. The fallback read
is an unintended observation, not proof of data mutation or a successful test.
No OS accessibility/security setting was changed. Only the isolated processes
created for this audit were terminated; the existing user process was untouched.

The human subsequently requested actual desktop verification and safely resumed
this work with PID-specific isolated selection. The historical stop above is
preserved. Generic Obsidian selectors and Vault pickers were not reused. The
current authoritative outcomes are in [resumed runtime verification](ISSUE_113_RUNTIME_VERIFICATION.md)
and its [finite evidence](ISSUE_113_RUNTIME_EVIDENCE.json).

| Required actual host check | Current #113 result |
| --- | --- |
| Minimum 1.11.4 enable/Settings/commands/Explorer/Preview/startup | VERIFIED: actual apiVersion 1.11.4, fake provider UI, host file-menu event, direct/recursive Preview, no observed startup failure. |
| Current 1.14.4 clean install/enable | VERIFIED in fresh synthetic profile; actual production assets unchanged. |
| Manual Move/Manual Tag Apply | VERIFIED in actual host with fake analysis, explicit confirmation and original-source checks. |
| Complete Organizer UI/Tag-only/Move-only/both/Keep/partial/Stop | VERIFIED: complete 23-case host local suite; fake analysis, real FileManager operations, partial/settlement gates. |
| Actual Plugin Disable: idle/analysis/Review/final confirmation/in-flight Tag/in-flight Move | VERIFIED in all six boundaries through actual host Disable/onunload/unregistration; in-flight cases also prove shared lease retention/release and no original UI revival. |
| 0.1.0 → candidate settings/Secret-reference upgrade | VERIFIED: actual public 0.1.0 then exact candidate assets, typed settings/reference and file hashes retained. Candidate remains 0.1.0 metadata; actual 0.5.0 updater/real credential transfer not verified. |
| Real TypeSafe Classify/Tag Suggest/Organizer both | VERIFIED: explicitly approved dedicated SecretStorage credential, ceiling 100, actual requests four, retry zero, no mutation. |

These are bounded actual-host results, not unit-test substitutes. Most flow inputs
were DOM-driven by temporary diagnostic plugins. Physical right-click, all keyboard
interactions/layouts/platforms and external-sync races remain outside this evidence.
Minimum/upgrade one-time startup diagnostics performed no real provider/mutation
work; temporary helpers are now disabled. See the resumed record for failed harness
attempts, isolation checks, instrumentation limits and cleanup.

## Security boundary review

Read-only inspection found SDK import only in TypeSafeAdapter. The production
console call is a fixed settings-save failure message; no body/key/provider-response
logging path was identified. Ordinary tests exclude integration requests. The
release staging whitelist excludes source maps, environment files and test helpers.
No new external destination, telemetry, background upload or automatic mutation
was introduced by this documentation-only diff.

Reviewed main lifecycle composition/unload; NoteSource and exact snapshots;
single-use confirmation registry and same owner/result/Vault checks; Apply flow
synchronous one-attempt transition, detach/settlement cleanup; strict Apply guards,
current frontmatter duplicate/preservation authority; Tag-before-Move and post-Tag
baseline; shared path/TFile leases; public processFrontMatter/renameFile boundary;
finite safe result reasons. Existing synthetic regression coverage passed. These
are source/test findings with host/provider limits stated above, not guarantees
against external writes or all runtime failures. No mutation occurs from suggestion,
Review completion, load, or settings changes in inspected implementation.

## Release risk register

| Risk | Classification | Required disposition |
| --- | --- | --- |
| Supported-runtime unit/static/build/license/hash checks | VERIFIED (base; exact final HEAD evidence in PR) | Keep exact-HEAD CI/local evidence. |
| Actual Plugin Disable at six boundaries | VERIFIED | Actual host dispatch, settlement/lease/UI observations; timing-gate limits documented. |
| Real TypeSafe integration | VERIFIED (bounded smoke) | Human-approved ceiling 100; four requests passed, no retry or mutation; not a reliability guarantee. |
| Obsidian minimum 1.11.4 | VERIFIED (bounded runtime) | Actual apiVersion/title, production enable/Settings/fake command UI/Explorer event/Preview passed. |
| Current stable 1.14.4 / clean install / representative regressions | VERIFIED | Actual host/production code, 23 local cases and real provider smoke; exhaustive physical input/layout not claimed. |
| Windows/Linux runtime | NOT VERIFIED; NOT ACCEPTED | Recommend owner acceptance with release notes stating macOS-only runtime evidence. Cross-platform claims require actual additional host validation. |
| Editor/other-plugin/external sync races | NOT VERIFIED; NOT ACCEPTED | Recommend acceptance of the remaining timing limits, disclosed to users. Existing rechecks do not prove every external race safe; a discovered data-loss defect would block release. |
| Jevault locking versus external writes | KNOWN LIMITATION; NOT ACCEPTED | Recommend acceptance: shared leases serialize Jevault mutations only. Explain that external writers are not isolated; do not promise global Vault locking. |
| Non-atomic Tag+Move | KNOWN LIMITATION; NOT ACCEPTED | Recommend acceptance based on verified partial/Stop/Disable results. Explain that Tags can remain after failed/cancelled Move, with no rollback or automatic retry. |
| 0.1.0 → candidate upgrade and preserved settings/reference | VERIFIED with limit; actual 0.5.0 updater NOT VERIFIED | Additional staged #114 validation needed: exact 0.5.0 package before tag; published attachments and actual Community updater afterward. Owner must explicitly accept this staged plan and remaining credential-transfer limit before GO. |
| Active protected tag ruleset / empty bypass | VERIFIED | Owner-authorized active all-tag update/deletion restrictions, no exclusions, bypass `[]`; recheck before future tag push. |
| Future Release immutability setting | VERIFIED | `enabled=true`; historical 0.1.0 unchanged. Verify actual future Release is Immutable in #114. |
| Trusted tag creators / release editors | NOT VERIFIED; GO blocker | Complete App/PAT permission inspection and owner disposition of all write-capable actors/credentials. Setting approval is not credential trust approval. |
| Private Vulnerability Reporting | VERIFIED | enabled=true API observation. |
| Six development advisory entries / no prod advisory | KNOWN LIMITATION; NOT ACCEPTED | Recommend owner acceptance of the two disclosed development chains with controlled build/test inputs; no shipped advisory found. Do not claim runtime-wide safety or silently upgrade dependencies. |
| Native safety stop / unintended fallback observation | Historical incident; continuation resolved | Human resumed; PID/Vault/marker guards used. Unintended read remains disclosed, no user data retained. |

## Acceptance criteria accounting

The numbers below follow #113's Acceptance Criteria in order. A recorded blocker
satisfies only the explicit qualify/block alternative, not the corresponding test.

| # | Criterion | Status |
| --- | --- | --- |
| 1 | 0.5.0 target or version blocker | Target confirmed in inspected metadata/policy. |
| 2 | Release checklist covers Organizer Apply | Updated. |
| 3 | README/SECURITY/PRIVACY consistency | Concrete conflicting wording corrected; privacy unchanged. |
| 4 | npm ci + verify on exact candidate | Base PASS; final committed HEAD result in PR evidence. |
| 5 | Non-publishing workflow passes | Final audit-PR Actions result in PR evidence. |
| 6 | Exact 3 assets | VERIFIED locally. |
| 7–12 | Minimum, stable, clean install, Manual Move, Manual Tag Apply, full Organizer host flow | VERIFIED within documented diagnostic/input/platform limits. |
| 13 | Actual disable verified or explicitly qualifies/blocks GO | VERIFIED: six actual host boundaries; settlement/shared lease/no revival observed. |
| 14 | Real provider verified or explicitly qualifies/blocks GO | VERIFIED: human-approved SecretStorage, four of ceiling 100 requests; no retry. |
| 15 | Upgrade/settings compatibility checked | VERIFIED bounded host replacement from public 0.1.0; real 0.5.0 package limit disclosed. |
| 16 | No unapproved flow/Secret/body logging/telemetry found | Source/diff review found no product logging/new-flow defect; unintended fallback observation disclosed above. |
| 17 | No automatic/background mutation found | Source/diff review PASS; host no-op/pre-confirm/upgrade checks passed. |
| 18 | No version/tag/release created | Scope preserved; final remote read-back in PR evidence. |
| 19 | Residual risks classified | Table above; none silently ACCEPTED. |
| 20 | Release-notes draft exists | Draft below and audit PR. |
| 21 | Explicit GO/NO-GO | NO-GO. |

## 0.5.0 release notes draft — unpublished

Jevault 0.5.0 adds Folder Organizer for existing Markdown notes: select a folder
scope, Preview exact targets, choose independent Folder/Tag Analysis Options,
Analyze, Review choices, Finish review, then confirm Apply separately. Progress,
Stop and per-note results show actual changes, including partial success.

Existing Manual Move and additive Manual Tag Apply remain available. No automatic
organization, overwrites, folder creation or Tag removal/rename. Keep-current and
zero-Tag choices can be no-ops. Tag+Move is not atomic; already-started host APIs
may complete after Stop/close/disable, and no automatic rollback/retry is promised.
Jevault's shared locking covers its own mutations, not external editor/plugin/sync
writes. Suggestions require a TypeSafe account, your SecretStorage API key, network
access and TypeSafe-managed credits. Preview/Review/Apply are local; analysis can
send synthetic or user-selected note data as disclosed in PRIVACY.

Desktop only. Minimum 1.11.4 was verified in the bounded macOS host checks above;
Windows/Linux runtime and all external writer/sync races were not verified.
Do not publish this draft until release blockers are resolved and
limitations are explicitly reviewed by the owner.

## Required human gates before #114

1. Complete human GitHub reauthentication for read-only App/PAT details, then
   document the owner-approved trusted tag creators/release editors. If a required
   permission cannot be verified, retain NOT VERIFIED and NO-GO. Revoking or changing
   credentials requires its own authorization and may affect other repositories.
2. Explicitly disposition all six residual items: Windows/Linux, external races,
   non-atomic Tag+Move, Jevault-local locking, development advisories and the staged
   actual 0.5.0 updater/credential-transfer validation. No item is ACCEPTED yet.
3. Read back protections again and confirm exact candidate identity, CI and review
   after this documentation update. Reuse the existing runtime/provider evidence
   only while product code, dependencies and production assets remain identical;
   no additional TypeSafe request is justified by a settings/documentation change.
4. Only after those gates pass, issue GO for the exact SHA. Merging this audit PR
   needs separate explicit approval and does not itself produce GO. #114 still
   needs fresh explicit authorization for version/tag/Release actions.
5. Under authorized #114 execution, verify exact 0.5.0 package installation/upgrade
   before tag creation, then published bytes and actual Community updater behavior
   after publication. The current 0.1.0-metadata replacement is bounded evidence,
   not an actual 0.5.0 updater pass. Reuse #42's workflow; close #42 only with real
   same-byte asset and independently verified attestation evidence.
