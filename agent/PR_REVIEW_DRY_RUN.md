# Issue #52 review-loop dry run

Read-only historical inspection on 2026-09-30 against
[PR_REVIEW_LOOP.md](PR_REVIEW_LOOP.md). These are contract walkthroughs, not
live trigger experiments or certification of historical PRs. No historical PR
was modified. Public REST comments/reviews/commits were read; authenticated
GraphQL thread resolution and live settings were unavailable (local `gh`
returned HTTP 401). Do not infer their state from REST comments.

## A. PR-open automatic review

[PR #49 summary](https://github.com/taichocop/jevault/pull/49#issuecomment-5904626243)
records Code Review completed, trigger `PR opened`, reviewed `76317fc`.
The PR commits resolve this uniquely to
`76317fc4b9337c6586f27a74c4fdbeb2613757c2`.
[PR #51 summary](https://github.com/taichocop/jevault/pull/51#issuecomment-5907467163)
likewise records `PR opened` and completed review of
`a6102e0f1f59efa4ece8b75d58fbcd765a30ed06` (displayed `a6102e0`).
Neither comment history contains a manual Code Review request at inspection.

Walkthrough result: recognize completed automatic review for the identified
SHA, send zero manual requests, then inspect remaining surfaces/CI. These
snapshots establish the completed trigger, not an independently observed
pending-to-completed transition or current settings.

## B. Post-commit trigger alternatives

[PR #47 manual request](https://github.com/taichocop/jevault/pull/47#issuecomment-5867645213)
identifies new HEAD `148be8741f46a2260dd31a24042ed4cad898961d`.
[Its clean result](https://github.com/taichocop/jevault/pull/47#issuecomment-5867696688)
identifies reviewed commit `148be8741f`. This proves historical manual usage;
it does not prove automatic review was absent or that the new waiting policy
was followed in 2026-09-28 history.

The following synthetic inputs exercise both contract branches using that SHA:

| Input at observation | Contract decision / result |
| --- | --- |
| New HEAD has automatic pending/running review | Wait; manual count stays 0; consume completion only if SHA matches |
| New HEAD already has completed automatic review | Consume it; manual count stays 0 |
| No review through minute 5; authoritative HEAD-bound Codex integration record explicitly reports terminal failure/not queued, with no outstanding successor; manual count 0 | Refresh HEAD/surfaces and that record, send one SHA-bound fallback; record count 1; consume matching result |
| Empty comments/reviews/checks through minute 5, but no authoritative integration queue/terminal record | Trigger UNKNOWN; no fallback; STOP / NOT VERIFIED at deadline, even if all reads succeed |
| Still absent/pending at minute 15 after fallback | STOP / NOT VERIFIED; no second request |
| Missing surface, ambiguous identity, or a prior unbound manual request | NOT VERIFIED; do not infer absence and post |

Walkthrough result: both trigger modes are supported without a global
assumption. Automatic re-review and fallback timing were simulated, not
observed live; the historical request/result supplies realistic evidence shape.
No historical request is proof that the current contract's positive trigger
evidence requirement was met. An unobservable queued PR-open review is covered
by the UNKNOWN row, preventing duplicate requests during publication delay.

## C. Stale clean review

Use clean review A at `148be8741f46a2260dd31a24042ed4cad898961d`, followed by
[request for B](https://github.com/taichocop/jevault/pull/47#issuecomment-5867818677)
at `45143b0bdad970f5d83af2c3cb00f1cde1e98c31`.
Walkthrough result: A cannot certify B. B needs its own completed Code Review,
local verification, CI and Safety Gate. No positive old comment bypasses this.

## D. Classified repair and finite progression

[Initial finding](https://github.com/taichocop/jevault/pull/47#discussion_r4120369633)
was attached to `d36ad6cd184f577324124af917bce762c108e526`: missing compatibility
change-point validation. Under the historical release Issue, it is REQUIRED.
[Repair evidence](https://github.com/taichocop/jevault/pull/47#discussion_r4120821531)
reports a fix and regression tests at `148be87`; the next clean Code Review
identifies A above. Those validation claims are historical reports, not checks
rerun by Issue #52. Under active Issue #52 this product repair would be out of
scope: STOP, not a new product edit.

[A later finding](https://github.com/taichocop/jevault/pull/47#discussion_r4120895026)
on A concerns tag-to-commit binding; its
[repair reply](https://github.com/taichocop/jevault/pull/47#discussion_r4120917074)
identifies B. [The next review](https://github.com/taichocop/jevault/pull/47#pullrequestreview-5337067652)
and [inline finding](https://github.com/taichocop/jevault/pull/47#discussion_r4120942044)
identify B and a publication-window race.

Walkthrough result: classify before editing, increment at repair start, verify
before push, invalidate A and consume B evidence. Historical progression is
not permission to exceed today's budgets: stop before a fourth actionable
repair, or on a third observation of the same semantic root cause. Changing
the SHA/error wording does not make a continuing invariant violation new.

## E. Infrastructure failure and terminal gates

[PR #47 failure](https://github.com/taichocop/jevault/pull/47#issuecomment-5904247460)
reports container setup failure; the edited summary now reports failed manual
review for `1874a61`. Walkthrough result: no speculative code edit or repeated
manual request; STOP when that HEAD's manual allowance is used. A historical
clean comment cannot silently override a later failed review attempt; record
both and require an unambiguous completed current-HEAD result before readiness.

Synthetic gate checks: red CI, missing thread state, mismatched SHA, pending
review at deadline, or an unresolved actionable thread all prevent HUMAN MERGE
READY. A permitted repaired thread can be resolved only after focused/full
validation and current applicability evidence. All green gates plus an open
PR yield HUMAN MERGE READY and stop without merge. These gate decisions passed
the contract walkthrough; live Issue #52 PR review/CI remain separate evidence.
