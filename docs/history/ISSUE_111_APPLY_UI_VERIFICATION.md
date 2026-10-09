# Issue #111 — Folder Organizer Apply UI verification

## Scope and ownership

Base and fetched `origin/main` before implementation:
`1d20040766892b9e63a9d5df26b06a401d6281b4` (PR #110). GitHub Issue #111
was read in full; open PRs were zero. Work is confined to
`codex/issue-111-apply-ui` in the dedicated Orca checkout.

`OrganizationReviewModal` offers Apply navigation only after explicit Finish
produces a nonempty exact immutable result. Navigation relinquishes ownership
before Review closes, and transfers the original session to
`OrganizationApplyFlow`. Review's old/detached events cannot edit or transfer it
again. Before transfer, close/unload still disposes Review.

The flow owns a dedicated AbortController and the existing confirmation session.
The read-only `OrganizationApplyModal` receives intent/progress/service-result
presentations. Only the final Confirm action calls `confirm()` and immediately
passes that token to the existing service. The synchronous phase transition and
DOM generation guards prevent repeated click/Enter confirmation or stale buttons.
`main.ts` only adds service composition with actual Vault/fileManager/current
settings. Existing confirmation, Apply service and shared mutation coordinator
implementations are unchanged.

Stop aborts once and leaves the UI/owner alive while APIs settle. Close/Esc/X or
entry/plugin disposal detaches UI before aborting; cleanup of authority waits for
actual service settlement. Rendering failures also detach/abort rather than
reviving UI or abandoning a live owner. Teardown is idempotent. Terminal rows use
the immutable service index and original reviewed source path; phase statuses,
partial changes, failures and cancellation remain distinct. Unavailable and
unattempted Notes receive no fabricated mutation results.

## Executed local verification

- `npm ci` installed the existing lockfile. No package/lockfile changes. The host
  Node was 23.11.0 and warned about unsupported engines; audit reported six
  existing dependency vulnerabilities (2 moderate, 4 high). Dependencies were
  not changed under this Issue.
- The attempted Homebrew Node 22 path was actually a symlink to Node 23.11.0.
  Initial green checks using that path were therefore Node 23 checks, not Node 22
  evidence. A registry-provided Node 22.13.0 was then used from an isolated
  `/private/tmp/jevault-111-npm-cache` without modifying project dependencies.
- Focused `npm test -- tests/organization-apply-ui.test.ts
  tests/organization-review.test.ts tests/folder-organizer-entry.test.ts
  tests/organization-apply-service.test.ts`: 4 files, 300 tests passed.
- `npm exec --cache=/private/tmp/jevault-111-npm-cache --yes
  --package=node@22.13.0 -- npm run verify`: 46 files, 1,368 tests passed; lint, typecheck, production
  bundle, full SDK license notice, working and staged whitespace checks passed.
  Existing #101/#103/#105/#107 and Manual Move/Tag regressions are included.
  Superseded tests asserting Apply could not be imported/reached were updated;
  no mutation/authority regression assertions were removed.

New UI tests exercise the actual Modal handlers with a synthetic Obsidian boundary
and production Apply service: zero I/O before final confirmation, exact ownership
transfer, stale handlers, repeated keyboard/click confirmation, Keep/same-folder,
Tag-only/Move-only/Tag+Move, unchanged frontmatter Tags, safe stale/replaced-source,
collision/ineligibility/missing destination/busy/Tag failure/Move failure, partial
and completed-with-failure summaries, invalid/revoked confirmation, Stop during
Tag and Move, lease retention/release, close/Esc/onClose/unload through settlement,
render failure and late DOM suppression. These are fake-runtime unit tests, not
proof of real Obsidian UI execution.

## Dedicated synthetic runtime setup and initial safety stop

`node scripts/prepare-organization-apply-ui-runtime.mjs` creates a fresh disposable
Vault and bundles only `tests/helpers/organization-apply-ui-runtime-plugin.ts`.
The production plugin imports none of this harness. The harness refuses to load
unless the Vault name starts `Jevault-111-Synthetic-` and its synthetic marker
exists. It has no TypeSafe adapter, key lookup or body-read path. Fake analysis
is injected only into this separate plugin; Review and Apply are production code.

Prepared Vault (fixture/bundle prepared before the final SameFolder driver correction):
`/var/folders/kw/ndzcbg492qj_06ct5kw_y1w00000gn/T/Jevault-111-Synthetic-UhVqTh`.
A second unused fresh fixture was also generated with suffix `bbjdVN`. The final
corrected harness was bundle-checked at `/private/tmp/jevault-111-harness-review/main.js`;
this is a compile check, not native runtime evidence.

Explorer Inbox right-click is available for a manual visible walkthrough. The
explicit command **Run isolated #111 DOM UI verification** activates the actual
production entry and Modal DOM controls from Preview through final confirmation.
Its bounded driver covers 15 scenarios: Tag-only, Move-only, both, same-folder,
Keep, injected Move rejection after real Tag application, Stop/close/entry-dispose
while Tag or Move settlement is gated, and Cancel/Esc/X before Confirm. It checks
zero pre-confirmation calls, one Apply call, original owner identity through
settlement, shared lease retention/release, actual service results and terminal
UI text. Synthetic gates are released on failure. Intended evidence destination:
`evidence-111.json` inside that disposable Vault. The harness is verification
support, not a runtime pass by itself.

**Historical STOPPED / NOT VERIFIED state:** Initial implementation-agent CUA attempts
`cua.getApp("md.obsidian")`, `cua.getApp("Obsidian")` and
`cua.getApp("Finder")` returned `cgWindowNotFound`. The coordinator later connected
native CUA. During its Vault-picker operation, **Downloads unexpectedly opened
instead of Synthetic111**. According to the coordinator, no Note actions or Apply
were performed and the window was immediately closed. Native verification was
stopped under the Issue safety condition. Native attempts remained prohibited
until the human explicitly resumed isolated synthetic validation, recorded below.

The coordinator reported that `.obsidian` exists in that unexpectedly opened
location, but OS permission prevented inspecting its contents or creation. **We
cannot claim that no metadata changes occurred**, nor determine whether it was
pre-existing. No inspection, cleanup, Note mutation or further navigation of that
location was attempted by the implementation agent. This is a bounded safety
incident with an unresolved metadata observation, not successful runtime evidence.

At that stop, the synthetic runtime suite and complete graphical walkthrough were
**NOT VERIFIED**; no passing runtime evidence JSON or screenshots were claimed. Static
coordinator review also found that the SameFolder driver had selected the current
folder through the alternate-folder dropdown, which deliberately excludes it.
The harness now injects that current existing folder as its fake suggestion and
selects the corresponding radio. Production selection rules are unchanged; the
fixed harness had not yet been executed in Obsidian.

Also NOT VERIFIED: real provider analysis (deliberately excluded), actual Plugin
disable event dispatch (the suite targets the same entry.dispose boundary),
mobile/other Obsidian versions, editor/other-plugin/OS/sync races or general
transaction isolation. GitHub CI and current-HEAD independent Codex review are reserved for the
coordinator; no additional agents were launched. Their status is not inferred from local checks. No merge recommendation is made before coordinator CI/current-HEAD review.

## Scope review

New production code performs no direct Vault mutation, body read/hash, Secret
lookup, provider/network request, target recollection, telemetry or persistence.
It delegates only the original opaque token and dedicated signal to the unchanged
service. The harness's real frontmatter/rename calls and evidence write are
restricted to disposable synthetic fixtures. No dependency, package-lock,
manifest/version, release/workflow/#42, Manual mutation implementation, shared
lease or authorization foundation changes are included. No secrets or user
contents are present in new fixtures/evidence. Full/staged diff, secret-pattern checks and whitespace
review were performed before commit; exact resulting HEAD and CI belong to
the PR/completion report.

## Repair round 1 — retained Review data

Current-HEAD review of `e8069a9a07577baaa0a6ac835041a113737e7362` identified
[retained Review/confirmation references](https://github.com/taichocop/jevault/pull/112#discussion_r4229978937).
The flow now drops the disposed confirmation and original owner after service
settlement. Review/result remain only for the visible terminal summary; cancel
before Confirm, detached settlement and later terminal Close clear them and reset
progress without a retained currentPath, even when authority cleanup already ran.
Detached or post-settlement progress callbacks cannot restore retained data.
In-flight detach still preserves the exact original authority until API settlement.

The Review modal's completed Apply handler reads an exact result from a clearable
field instead of retaining it in its closure. Handoff/disposal drops that field
and the modal's session reference. Next navigation captures only scalar noteCount,
not the analysis results array. Selection, final confirmation, service authority
and shared mutation lease implementations are unchanged.

Executed on actual Node 22.13.0: focused UI/Review/entry/service suite **304 passed**;
`npm exec --cache=/private/tmp/jevault-111-npm-cache --yes --package=node@22.13.0 -- npm run verify`
**46 files / 1,372 tests passed**, plus lint, typecheck, production bundle/licenses
and working/staged whitespace checks. Regressions assert released fields through
retained stale Modal/DOM references, visible terminal-summary preservation, cancel,
held Tag/Move unload with authority/lease validity until settlement, stale progress
rejection and idempotent later Close. Full repair diff and secret/protected-scope
checks were reviewed before commit. At repair commit
`0ae1e0c612c69f5c013bd77562523420bfc42570`, no further native UI attempts had been
made; runtime was still **STOPPED / NOT VERIFIED**. The subsequent explicit resume
does not resolve the Downloads incident or its unknown metadata state. PR #112
stays draft; coordinator owns new-HEAD CI and Codex review.

## Explicitly resumed native synthetic validation — Retry2 PASS

The human explicitly resumed native verification and granted Orca MAIN
Accessibility. The coordinator operated the official Orca computer CLI; the
implementation agent did not operate native UI. Window visibility/focus was
resolved using the native Window menu and titlebar. All resumed Note/Apply work
was confined to the separately prepared disposable Vault:
`/var/folders/kw/ndzcbg492qj_06ct5kw_y1w00000gn/T/Jevault-111-Synthetic-RXo2fL`.
The earlier Downloads incident and uninspected `.obsidian` metadata remain an
unresolved historical observation, not a claim of no metadata changes.

Actual Obsidian **1.14.4** initially passed the first eight cases, then failed at
CloseTag. Retry1 on fresh `Cases/Retry1` / `Dest/Retry1` repeated those eight passes
and located the failure at `abort-action`: one held Tag call, no Move, the owner
still active, and no abort observed before cleanup. That stage included locating
the native X before clicking it; these facts alone did not establish a production
abort defect. Both failed evidence files were preserved without resetting their
already mutated fixtures.

The coordinator inspected the installed official 1.14.4 Modal constructor:
its native X is `.modal-header-button.mod-raised.clickable-icon`, with an X SVG
and a `click` handler bound to Modal.close. The harness had looked for the absent
legacy `.modal-close-button`. This was a **test-harness selector bug**; no
production fix was made. Retry2's pre-confirm X action requires exactly one
native dismiss candidate outside the content in the same modal container and
dispatches its document's click event. CloseTag/CloseMove instead exercise the
visible production **Close** button; neither action falls back to direct Modal.close.
Finite selector diagnostics recorded zero legacy nodes and one native header X.
Existing confirmation, mutation-count, ownership, settlement and lease assertions
were retained; the abort-at-action assertion was made explicit.

The separate harness now reports only finite startup/case/stage/count/boolean
diagnostics, never raw exceptions, bodies or credentials. On reopen, native
startup reported `marker-unavailable` before the Vault index was ready, and
registered no commands. The coordinator toggled only the verification plugin
OFF then ON after indexing; startup reported `ready`, then the coordinator
selected **Run isolated #111 Retry2 diagnostic UI verification** and pressed
Return. The name/marker guard was not weakened, and no automatic delayed startup
or Apply was added. Startup tests also verify the CJS default-export footer,
finite failure stages and fail-closed marker behavior.

The installed separate bundle SHA256 was
`fa30fb13d097c28aebe453109aa6f62a603133b0c7e21eb08a6e369d8f847cb2`.
The coordinator's actual native run passed **all 15 cases** using fresh,
untouched `Cases/Retry2` Notes and `Dest/Retry2`: TagOnly, MoveOnly, Both,
SameFolder, Keep, Partial, StopTag, StopMove, CloseTag, CloseMove, UnloadTag,
UnloadMove, Cancel, Esc and X. Production code was at
`0ae1e0c612c69f5c013bd77562523420bfc42570`; only the separate diagnostic harness
changed. The implementation agent read the complete resulting evidence, checked
15 cases with no `failed` flag, and preserved an identical
`evidence-111-retry2-pass.json` beside `evidence-111.json`. No installed bundle or
fixtures were changed while the Vault was open after this run.

Evidence confirms one Apply call per confirmed case, exact owner identity through
settlement, held owner/lease during blocked Tag/Move, and lease release afterward.
Partial records applied Tags plus failed Moves; StopTag/CloseTag/UnloadTag record
cancelled-after-partial without starting Move or another Note. StopMove/CloseMove/
UnloadMove record the already-started Move completing, cancelled operation status
and no next Note. Visible Stop summaries preserve unattempted count; Close/unload
detach the UI. Cancel/Esc/X record zero mutations, owner invalidation and stale
Confirm rejection. Unload cases invoke the actual entry.dispose boundary, **not
native Plugin disable dispatch**.

Preserved local evidence (synthetic paths/results only; no bodies or secrets):

| File | SHA256 |
| --- | --- |
| RXo2fL/evidence-111-initial-failed.json | `bb4bc366c61cce658d3c000d84bc90569a4bd2c2b76fdc44e31633c46623c48b` |
| RXo2fL/evidence-111-retry1-failed.json | `b795dd63820d20acb2d31199ad0472cf1ef3c1e8a78fd583b6219e852f48ed52` |
| RXo2fL/evidence-111-retry2-pass.json | `212d24c318cd313bd048d2937434f3bf2355d20e8a4d6de85bda7380de9fd4b7` |
| /private/tmp/jevault-111-native-manual-x-evidence.json | `f7dab1132ed8b5fa52e8d865f9b1bfcc91b25c79546d7c2a6cd0a82aa23ad799` |

The coordinator also performed a manual native Explorer Inbox right-click ->
Preview -> fake Analyze -> Review Keep current/no Tags -> Finish -> Apply
navigation walkthrough. Final confirmation showed the exact
`Inbox/Interactive.md`, reviewed 1/unavailable 0, planned moves 0/selected Tags 0
and the non-atomic warning. Native visible X dismissal removed the modal without
clicking final Confirm. The fixture SHA256 before and after was identical:
`1b1e9a294d9fb62547746fdbbf49601cf301b3e11ef18821e38e45e179526db4`.
This manual observation has no mutation-call counter; the separate suite verifies
that boundary and stale-handler lifetime.

**NOT VERIFIED:** actual Plugin disable dispatch (entry.dispose was tested), real
provider analysis (deliberately excluded), mobile/other Obsidian versions, other
plugins, editor/OS/sync races and general transaction isolation. No real provider,
Secret/key, explicit body read, telemetry, rollback or new external destination
was used by the harness. CI and current-new-HEAD Codex review remain the
coordinator's responsibility; native PASS does not stand in for those checks.

Final local verification after the harness diagnosis used the existing direct
Node **22.13.0** binary, without npm package provisioning:

```sh
env PATH=/private/tmp/jevault-111-npm-cache/_npx/1bd81ab945294a66/node_modules/node/bin:$PATH npm run verify
```

**47 files / 1,382 tests passed**, including the lifecycle/race/cancel and
#101/#103/#105/#107/Manual regressions plus ten finite harness-startup checks.
Lint, typecheck, production build, SDK license notice and working/staged whitespace
checks passed. Full Issue diff and current uncommitted harness/startup-test/history
diff were reviewed; no production change followed the native diagnosis. Protected
foundation, Manual service, dependency/lockfile, manifest/version and workflow
diffs remain empty. Secret-pattern and direct mutation/body-read/network checks
found no added production path; the production bundle contains no verification
harness. The existing startup tests assert command IDs, so the Retry2 command name
required no test expectation change. These final evidence updates are prepared
for coordinator review before commit/push; PR #112 remains draft.
