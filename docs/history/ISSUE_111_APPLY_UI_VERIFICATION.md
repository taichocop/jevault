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

## Dedicated synthetic runtime setup and current blocker

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

**STOPPED / NOT VERIFIED:** Initial implementation-agent CUA attempts
`cua.getApp("md.obsidian")`, `cua.getApp("Obsidian")` and
`cua.getApp("Finder")` returned `cgWindowNotFound`. The coordinator later connected
native CUA. During its Vault-picker operation, **Downloads unexpectedly opened
instead of Synthetic111**. According to the coordinator, no Note actions or Apply
were performed and the window was immediately closed. Native verification was
stopped under the Issue safety condition; no further native UI attempts are
permitted in this task.

The coordinator reported that `.obsidian` exists in that unexpectedly opened
location, but OS permission prevented inspecting its contents or creation. **We
cannot claim that no metadata changes occurred**, nor determine whether it was
pre-existing. No inspection, cleanup, Note mutation or further navigation of that
location was attempted by the implementation agent. This is a bounded safety
incident with an unresolved metadata observation, not successful runtime evidence.

The synthetic runtime suite and complete graphical walkthrough remain **NOT
VERIFIED**; no passing runtime evidence JSON or screenshots are claimed. Static
coordinator review also found that the SameFolder driver had selected the current
folder through the alternate-folder dropdown, which deliberately excludes it.
The harness now injects that current existing folder as its fake suggestion and
selects the corresponding radio. Production selection rules are unchanged; the
fixed harness has not been executed in Obsidian.

Also NOT VERIFIED: real provider analysis (deliberately excluded), actual Plugin
disable event dispatch (the suite targets the same entry.dispose boundary),
mobile/other Obsidian versions, editor/other-plugin/OS/sync races or general
transaction isolation. GitHub CI and current-HEAD independent Codex review are reserved for the
coordinator; no additional agents were launched. Their status is not inferred from local checks. No merge recommendation is made while runtime/review remain open.

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
