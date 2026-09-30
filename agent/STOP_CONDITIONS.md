# Mandatory stops and finite repairs

[AGENTS.md](../AGENTS.md) remains authoritative. Apply these rules throughout
[LOOP.md](LOOP.md), including the [read-only review](REVIEW.md). Stop affected
work promptly; do not improvise around approval or safety boundaries.

## Mandatory STOP conditions

- The active Issue and AGENTS.md materially conflict.
- Implementation needs behavior outside the approved Issue.
- A new dependency is required but not authorized or clearly implied.
- A new external network destination is required.
- The SecretStorage/credential contract must materially change.
- Vault mutation scope must broaden beyond the Issue.
- A destructive migration would be required.
- Baseline tests fail for an unrelated pre-existing reason.
- The same failure signature occurs three times (see below).
- A required safety invariant cannot be established from code/tests.
- Official API behavior needed for correctness cannot be verified.
- A required GitHub operation lacks authentication/permission.

Explicit active-Issue approval is the only basis for otherwise permitted
dependency/Vault changes; a roadmap or convenient workaround does
not grant it. Do not add new destinations or destructive migrations on your
own. Report the requirement for a human decision first.

## Repair limits

Keep simple counters in task state; no counter framework or daemon is needed.
By default, each of these loops permits at most three repair iterations:

- Focused validation: failure → minimum repair → focused re-validation.
- Full verification: failure → minimum repair → focused validation → full
  re-verification.
- Local review: findings → minimum repair → focused/full validation → read-only
  re-review.
- Post-PR actionable review: classified findings → minimum repair → focused/full
  validation → Safety Gate/local review → commit/push → new-HEAD GitHub review.

Count an iteration when beginning the repair, not when it succeeds. The initial
validation/review is not a repair iteration. After the third iteration, STOP
if actionable failures remain; do not start a fourth. In nested loops increment
each applicable counter, and never reset counters by switching phase, moving
code, rewording an error, or starting another context. Expanding these default
budgets requires an explicit human decision; do not expand them yourself.

Independently, count each observation of a failure by its semantic signature:
the violated check/invariant and underlying root cause, not exact error text.
The initial failure counts as occurrence one. STOP on the third occurrence of
the same signature across validation/review phases, even if an iteration budget
remains. A genuinely different cause has its own occurrence count; it does not
reset the overall repair budgets.

Examples of the same signature:

- The same test still fails for the same root cause after attempted fixes.
- A TypeScript error moves to another file instead of being resolved.
- The same required safety invariant remains unprovable across attempts.

Mandatory safety/scope stops take precedence over repair budgets: an available
iteration never authorizes a forbidden workaround. OPTIONAL/style findings do
not require repair and do not extend loops. Relevant edits invalidate prior
green validation/review evidence; re-validate the resulting candidate.

## Post-PR waiting and infrastructure

Apply [PR_REVIEW_LOOP.md](PR_REVIEW_LOOP.md#automatic-review-first-finite-observation)
through PR creation and every repair push: maximum 16 snapshots over 15 minutes
per candidate, at 60-second intervals; at most one manual request per HEAD and
one infrastructure retry within that same allowance/deadline. Do not reset
repair or semantic-failure counters on a new HEAD/comment/thread/context.
Repeated observations of the same still-pending job are waiting, not new failure
occurrences; repeated failed attempts at the same root cause do count.

Timeout, unverified reviewed SHA/surfaces, red or missing current-HEAD CI, or
provider/container failure prevents HUMAN MERGE READY. Stop with the exact
state and NOT VERIFIED evidence. No speculative product repair for provider
failures, infinite polling, or automatic Security Review. Human resume may
renew a recorded observation window, but cannot silently reset manual requests,
repair budgets, or failure history.

## GitHub authentication fallback

Stop unavailable GitHub actions; never request, output, store, or bypass
credentials. If the authoritative Issue and scope are already readable,
continue safely completable local implementation, verification, review, commit,
and PR title/body preparation. Missing readable authoritative inputs still
block dependent implementation. Do not call completed local work failed solely
because a GitHub action is unavailable.

When PR creation is blocked, report exactly:

```text
PR CREATION BLOCKED — GitHub authentication/permission required
```

For unavailable post-PR actions, report STOP with the blocked operation,
PR number/URL, current/last-known HEAD, review/CI/thread state and NOT VERIFIED
items. Do not claim HUMAN MERGE READY without all current-HEAD gates.

## STOP report and resume

Report what was completed, what failed, concrete evidence (command/result,
revision, finding/signature and counters where applicable), and the human
decision or permission needed. Include remaining NOT VERIFIED items. Redact
sensitive data; never include a credential, note body, or environment dump.
Preserve the compact execution state and user changes; do not reset, clean,
stash, force push, or broaden scope to hide the stop.

Resume only after the blocking condition is resolved and any required explicit
approval is recorded. Reconfirm scope/baseline and re-run invalidated checks.
Record the human decision for any repair-budget reset instead of silently
discarding failure history. Successful completion ends at HUMAN MERGE READY only after the
[current-HEAD gates](PR_REVIEW_LOOP.md#terminal-gate-and-report); merge, auto-merge,
tags, releases, Community Directory changes, and deployment remain outside
the harness's authority.
