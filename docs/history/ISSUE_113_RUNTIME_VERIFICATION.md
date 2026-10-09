# Issue #113 — resumed desktop and provider verification

Date: 2026-10-10 JST. This supplements the initial safety stop in
[the readiness audit](ISSUE_113_RELEASE_READINESS.md); it does not erase that incident.
Finite observations are in [runtime evidence](ISSUE_113_RUNTIME_EVIDENCE.json).
No key, SecretStorage value, note body or raw provider response is included.

## Authorization, isolation and identity

After the initial stop, the human explicitly requested actual desktop verification,
approved four TypeSafe requests, manually registered the credential in the dedicated
Synthetic Vault's SecretStorage, then raised the ceiling to 100 requests. Only four
were needed and sent. No retry or additional provider request was performed.
This authorization does not permit Release execution or risk acceptance.

Only these disposable Vaults and separate profiles under `/private/tmp` were used:

- `Jevault-113-Synthetic-Stable-j5aj69fv` — actual 1.14.4 runtime.
- `Jevault-113-Synthetic-Min-cf1yc3sg` — actual 1.11.4 runtime.
- `Jevault-113-Synthetic-Upgrade-v113` — actual 1.14.4 runtime.

PID-specific Orca snapshots checked the exact window title/Vault before input;
commands checked the exact Vault name and `SYNTHETIC-113.marker.md` before testing.
Generic app selectors and Vault pickers were not reused. No OS accessibility or
security setting was changed. The dedicated minimum/upgrade processes were stopped
after verification and all temporary diagnostic plugins were disabled in these
Vaults. The human's credential and profile were not copied, exported or inspected.

The product code is base `46f7a724bd8840c5dceeb905fd11739c9d418c39`;
audit HEAD during these tests was `581ac1dfc3a6f868d018ef59b4844e1216caf740`.
All three production assets matched the readiness audit's SHA-256 table in every
Vault after testing. The later audit commit changes documentation/evidence only.

## Method and limits

Temporary diagnostic plugins ran inside actual Obsidian, alongside the unchanged
production bundle. They invoked actual product commands, controllers, modal DOM
buttons and services. Local regressions injected synthetic provider interfaces;
they did not replace Obsidian's Vault or FileManager with unit fakes. Product
mutations used public `processFrontMatter` and `renameFile` through production code.
Actual host plugin-manager Disable dispatched the production `onunload`, with
unregistration, owner abort and UI closure independently observed.

Host-manager control and DOM inspection are diagnostic implementation details,
not newly shipped plugin behavior. Minimum and upgrade checks used explicit,
one-time, fixture-guarded startup triggers after Orca focus validation rejected
keyboard/coordinate input. Startup triggers did not run real provider or mutation work.
Most flow inputs were DOM-driven; native pointer/keyboard interaction and visual
layout across every control/platform are not exhaustively verified. The minimum
Explorer check dispatched the host `file-menu` event with an actual Menu/TFolder;
it did not simulate a successful physical right-click. Fake analysis cannot prove
provider correctness; the separate real smoke below supplies bounded evidence.

The first local run stopped after a diagnostic controller was disposed and reused.
The driver was corrected to re-enable a fresh host instance, and fresh `Retry1`
fixtures were used for the complete rerun. Initial modified fixtures were not
overwritten. An early upgrade Settings assertion queried the main document while
1.14.4 displayed Settings in a separate window; querying the registered Settings
tab's own container corrected the diagnostic. These were harness failures, not
demonstrated product defects. Temporary driver hashes identify the final local
sources; these local helpers are not distributed or part of normal tests.

## Actual minimum 1.11.4

The official 1.11.4 installer initially loaded a cached 1.14.4 update. That attempt
was not counted as minimum compatibility. The disposable profile's auto-update was
disabled and the cached update moved aside; Orca then observed
`New tab - Jevault-113-Synthetic-Min-cf1yc3sg - Obsidian v1.11.4`, and the driver
asserted the running public `apiVersion === "1.11.4"` before any checks.

Production enable, Settings, both command registrations, Classify suggestions UI,
Tag Suggest UI, host Explorer event/title, direct Preview (one note), recursive
Preview (two notes), both analysis options, and disabled Analyze when both options
were off all passed. No startup failure was observed in these operations.
Classify/Tag UI checks used fake provider interfaces and bypassed real Secret
lookup; diagnostic provider transport calls: zero. No mutation was requested.

## Actual stable 1.14.4 — clean install and 23 local cases

The stable Vault started with fresh profile/assets and no saved plugin settings.
The production plugin was enabled in the actual host. The real smoke and complete
local suite passed; local provider transport attempts and real Secret lookups were
zero. Every case navigated the production UI and used separate final confirmation
where Apply was expected. Repeated stale Confirm clicks did not replay Apply.

| Cases | Observed result |
| --- | --- |
| TagOnly, MoveOnly, Both | Two eligible notes changed as selected; unavailable third note unchanged. |
| SameFolder, Keep | Same-folder rename calls zero; Keep/zero Tags made no mutation. |
| Partial | Real Tag update succeeded, injected Move rejection produced explicit partial results; no rollback. |
| StopTag, StopMove | Started host operation settled; second note unattempted; result retained actual completed work. |
| CloseTag, CloseMove | Same settlement behavior after UI closure; original UI did not reopen. |
| DisableIdle, DisableAnalysis, DisableReview, DisableConfirm | Actual host Disable/unregistration/onunload once; Analysis aborted; no mutations or late UI. |
| DisableTag, DisableMove | Actual host Disable while started host API promise was held; settlement, shared lease and result truth passed. |
| Cancel, Esc, X | Owner/confirmation cleared; stale Confirm ignored; no Apply or mutation. Esc/X dispatched DOM events rather than OS keyboard/pointer input. |
| ManualMove, ManualCollision | Confirmed original source moved despite active-note switch; existing target refused without rename. |
| ManualTagApply, ManualTagDuplicate | Confirmed original source, additive Tags and unrelated frontmatter preservation; duplicate produced no additional semantic Tag. |

Tag/Move gates pause after the real FileManager operation completes and before
its returned promise settles. This exercises the product's pending-operation
boundary; it does not reproduce every possible host I/O timing. DisableTag returned
one processed of two eligible notes, Tag applied and Move not-started-cancelled.
DisableMove returned Tag and Move applied to that first note, with the second
unattempted. Both remained canceled overall and never revived the original UI.

During DisableTag/DisableMove, a separate controller built from the production
constructors attempted an independently confirmed Keep/zero-Tag Apply on the same
TFile. It received `busy` before settlement, then could proceed after settlement.
Thus disposal did not prematurely release the same-Vault production lease.
The diagnostic probe UI is not counted as revival of the disposed original UI.

Twenty-four post-run fixture checks passed: all 18 unavailable-note hashes and six
unattempted second-note hashes stayed equal to their known synthetic baseline.
The production assets also remained unchanged.

## Real TypeSafe smoke — four requests

| Entry point | Requests | Observed parsed UI |
| --- | ---: | --- |
| Classify current note | 1 | Valid suggestions UI, one candidate. |
| Suggest tags for current note | 1 | Valid suggestions UI, zero suggestions; a valid empty result. |
| Organizer Analyze, both options | 2 | One previewed note; Folder then Tag completed; Review available. |

The counter inspected only the fixed provider hostname at the HTTPS transport
boundary, never credential headers or payloads. SDK retry remained zero. The
production credential lookup/adapter/transport were used without provider fakes.
After Review, Keep-current/zero Tags → Finish review → Apply selected changes →
Confirm Apply completed as a no-op. Neither Finish nor navigation mutated notes;
Tag and Move API call counters stayed zero. Original synthetic-note hashes stayed
unchanged. Only finite counts, flags and statuses were saved; responses stayed in
memory. These four successes do not establish provider reliability under every
failure mode or guarantee that useful Tag suggestions will always be returned.

## Published 0.1.0 → candidate upgrade

Public release assets from tag `0.1.0` were installed first in the fresh upgrade
Vault. Old main.js SHA-256:
`76c83a97dd4f56624f8df8c63e09c8a5f59b9e8f35a9ab7d79fd91897ccf175d`.
The actual old host plugin enabled and loaded synthetic non-default settings:
Inbox, suggestion count seven, two ignored folders and a synthetic Secret name
with no corresponding Secret value. Its Settings UI and Classify registration
were observed; Tag/Organizer were absent as expected.

With that process stopped, only main.js/manifest.json/styles.css were replaced
with the exact candidate assets. On restart, the actual candidate enabled,
displayed Settings, retained every typed setting and synthetic Secret reference,
and registered Classify, Tag Suggest and Organizer. The saved data.json hash and
both synthetic Markdown hashes stayed unchanged. The driver invoked no provider
or mutation work. No real Secret was provisioned or transferred for this check.

This is a real host code/assets replacement from the published release, with
candidate metadata still 0.1.0. It does not verify Community updater behavior,
actual 0.5.0 package metadata or transfer/decryption of a real stored credential;
those remain later #114 checks after explicit authorization.

## Readiness consequence

Minimum/current desktop, representative regressions, six actual Disable
boundaries, real provider smoke and bounded upgrade are now VERIFIED within the
limits above. The initial safety stop was resumed by the human and safe targeting
was established; its unintended read remains disclosed in the original audit.
**V0.5.0 RELEASE READINESS: NO-GO** remains because no tag ruleset is present,
future Release immutability/trusted editor/creator prerequisites are unverified,
and remaining platform/external-race/non-atomic/development risks have no human
acceptance. No version, tag, Release, deployment, merge or settings change occurred.
