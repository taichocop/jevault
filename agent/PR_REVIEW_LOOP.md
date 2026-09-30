# Current-HEAD GitHub review loop

Continue [LOOP.md](LOOP.md) after PR creation and every repair push.
[AGENTS.md](../AGENTS.md), the approved Issue, [REVIEW.md](REVIEW.md), and
[STOP_CONDITIONS.md](STOP_CONDITIONS.md) remain authoritative. This is an
on-demand procedure using existing GitHub/Codex and `gh` capabilities, with no
helper service, credential storage, permanent worker, or automatic merge.

## Evidence and identity

For every decision, keep the following in compact task/handoff state, not a
tracked execution log:

```text
active Issue / baseline / branch / candidate local verify and Safety Gate
PR number + URL / current full HEAD SHA / observation timestamp
Codex Code Review: pending/running/completed/failed/absent/unknown
reviewed full SHA / evidence URL or ID / trigger when available
current-HEAD CI runs/checks: identity, status, conclusion
threads: ID, original/current commit, resolved/outdated, finding/class/evidence
post-PR repair iteration / semantic failure signatures and occurrence counts
manual requests per HEAD: count, comment ID/URL (including prior contexts)
observation attempts / deadline / infrastructure retry count / NOT VERIFIED
```

Read the PR API's current head, not merely local HEAD. Resolve a shortened
reviewed SHA to a unique full PR commit (using the PR commits/API or Git);
ambiguous, missing, or conflicting identity is NOT VERIFIED. A timestamp,
positive comment, reaction, or submitted review state alone cannot prove which
HEAD was reviewed. Authenticate the Codex bot author and distinguish Code
Review from Security Review. A summary can be edited in place: collect its
current status/SHA/trigger and the underlying comments/reviews together.

Collect all pages of top-level comments, submitted PR reviews, inline comments
and review threads, including resolved/outdated state where available. Inspect
both actionable and positive evidence; a positive summary does not cancel an
inline defect. Prefer explicit reviewed SHA and submitted review `commit_id`;
retain original commit identity for outdated findings. If a required surface
or identity is inaccessible, report NOT VERIFIED rather than infer it is clean.

Existing authenticated tools may be used, for example:

```bash
gh pr view <PR> --repo taichocop/Jevault --json number,url,headRefOid,state
gh api --paginate repos/taichocop/Jevault/issues/<PR>/comments
gh api --paginate repos/taichocop/Jevault/pulls/<PR>/reviews
gh api --paginate repos/taichocop/Jevault/pulls/<PR>/comments
gh api --paginate repos/taichocop/Jevault/pulls/<PR>/commits
gh pr checks <PR> --repo taichocop/Jevault
```

Use GitHub GraphQL `reviewThreads` with pagination to inspect `isResolved`,
`isOutdated` and nested comments/commit identities; REST inline comments alone
are not proof that unresolved threads are zero. Retrieve Actions runs/check
runs and commit statuses to establish CI commit identity. PR workflows can run
on GitHub's synthetic merge commit: verify that its parents include the exact
PR HEAD and current base, and that the run belongs to this PR; do not require a
literal head SHA match for such a run or accept a stale merge/base result.
Require all applicable validation/required checks to pass. Missing, pending,
red, cancelled, or unexpectedly skipped validation is NOT VERIFIED. Expected
skips (such as the tag-only release job on a PR) are recorded separately.

Re-read PR HEAD after collecting evidence and immediately before a manual
request or final readiness. If it changed, invalidate the snapshot and observe
the new candidate within the remaining bounds. A clean review for SHA A is
historical evidence after SHA B is pushed. SHA B needs local verification,
Safety Gate, CI and its own completed Code Review evidence. If someone else
changes the branch, reconcile/re-validate the candidate before proceeding;
never overwrite their work.

## Automatic review first; finite observation

Observe after PR creation and every push. For the exact HEAD:

1. Completed Code Review: consume the result and inspect all findings/CI.
2. Pending/running review or an automatic trigger already recorded: wait;
   do not send a duplicate manual request.
3. No visible current-HEAD review: give automation the bounded opportunity
   below, but treat trigger state as unknown until positively established.
   Never assume every later push auto-reviews or always needs a comment.
4. Unknown state, failed reads, or ambiguous SHA: NOT VERIFIED; no blind trigger.

Successful empty reads do not prove that an automatic trigger is absent: an
integration may have queued work without publishing a summary/comment/check.
Use an authenticated Codex integration status artifact bound to the exact HEAD:
a Codex-authored summary explicitly reporting a terminal failed Code Review,
or an integration job/event record explicitly reporting not queued or cancelled
with no queued/running successor. Record the artifact URL/ID, full SHA and status;
pending/running records prohibit fallback. GitHub Actions CI is not evidence of
the separate Codex queue. If the integration exposes no such authoritative
record, or it cannot be read completely, the outstanding-trigger predicate is
UNKNOWN: stop at the bounded deadline without a manual request. Neither elapsed
time nor empty comments/reviews/checks nor a generic setup message lacking a
reviewed SHA can establish this predicate.

Default per candidate: inspect immediately, then at most once every 60 seconds
for 5 minutes (at most 6 snapshots including the initial one). At the end,
refresh HEAD and all trigger surfaces. A manual fallback is allowed only if:

- HEAD is known and unchanged;
- no completed or pending/running current-HEAD Code Review exists;
- automation had the full 5-minute opportunity;
- no automatic trigger remains outstanding, positively established by the
  HEAD-bound integration record above (not inferred from empty reads);
- no manual Code Review request was already sent for that HEAD, including
  PR history and preserved state from earlier contexts.

Only then post at most one `@codex review` comment, identifying the full HEAD.
Immediately record its ID/URL and count. If posting times out or the response is
ambiguous, inspect comment history before any further action; do not retry a
possibly successful post. Requests lacking a SHA must be correlated to branch
history or treated as unknown, not assumed absent. A new automatic review
appearing during observation does not authorize another manual request.

After the automatic window, allow at most 10 further snapshots, 60 seconds
apart, up to minute 15 from the first observation. This is a maximum of 16
snapshots and 15 minutes total per candidate, including any fallback or retry.
Bound each network request by the remaining deadline; slow calls do not extend
it. Pending review/CI at timeout means STOP / NOT VERIFIED with the last state,
not success. No timer or worker survives the active task. Wait in chunks of at
most 60 seconds and keep the user informed during active work.

For an explicit infrastructure failure (for example container setup failure),
never change product code. At most one infrastructure retry is allowed within
the same deadline: re-read state, then use the one manual fallback only if no
successful completed review exists, no review/trigger remains pending, the
automatic opportunity elapsed, and that HEAD's manual count is zero. A failed
automatic attempt is no longer an outstanding trigger. If a manual attempt
already failed, STOP; another request needs a human decision. Failed API reads
may be retried at the next scheduled snapshot within the same bound; they
never prove review absence. Rate limits/permission failure stop affected reads.

A human may resume later. Preserve HEAD evidence, counters, requests, and
failure history; refresh all surfaces. Record a human-authorized new observation
window, not a silent timeout reset. No new manual allowance or repair budget is
created by resuming. Continuous unrelated HEAD changes cannot renew deadlines
indefinitely: stop for human coordination when the candidate cannot stabilize.

## Classify, repair, and resolve

Enter the [read-only review phase](REVIEW.md#github-review-evidence) to classify
GitHub evidence against the active Issue Acceptance Criteria, AGENTS, LOOP,
REVIEW, STOP_CONDITIONS and the full current diff. BLOCKER/REQUIRED findings
need concrete safety/privacy/correctness or in-scope regression evidence.
OPTIONAL preferences do not prolong the loop. Scope expansion requires STOP;
GitHub comments grant no approval. Document concrete evidence for incorrect,
resolved or outdated findings; age/outdated state alone does not invalidate a
still-applicable defect. Do not change correct code merely to silence Codex.

For permitted actionable repair:

1. Leave review mode; increment the post-PR repair count before editing.
2. Make the minimum in-scope repair on the same Issue branch.
3. Run focused validation, then `npm run verify` for the resulting candidate.
4. Recheck Jevault Safety Gate and the complete diff in local read-only review.
5. Stage only Issue files; inspect staged diff and whitespace; commit and push
   only after actionable local findings are resolved and every gate is green.
6. Prefer normal follow-up commits; never amend/force-push to hide history.
7. Record new PR HEAD; invalidate old readiness evidence and repeat observation.

Do not push repairs merely to see what the reviewer says. Apply the maximum
three post-PR actionable repair iterations and semantic failure limits from
STOP_CONDITIONS; increment nested validation/local-review counters as applicable.
Commit, comment, thread, wording, or context changes never reset counts.

Resolve an actionable thread only after its fix, focused validation, full
verification and evidence that it no longer applies to current HEAD. For an
incorrect/outdated finding, record concrete evidence and resolve only when
appropriate. Perform resolution outside read-only reviewer mode. Do not resolve
threads for appearances; readiness requires zero unresolved actionable findings
across summaries, comments, reviews and threads, not zero historical threads.

Security Review is separate and never the normal automatic loop. Consider it
only if the approved Issue/Safety Gate/human instruction calls for review of
Secrets, authentication, external data flow, Vault boundaries, supply-chain or
privileged workflows. A Security Review result does not replace Code Review.

## Terminal gate and report

Report HUMAN MERGE READY only when the PR is open and all of these are proven
for its exact, freshly re-read current HEAD:

- Local `npm run verify` passed for that candidate.
- Applicable GitHub Actions/CI passed for that HEAD (or verified merge test).
- Codex Code Review completed for that HEAD; all review surfaces were inspected.
- No unresolved actionable findings/threads remain.
- Jevault Safety Gate is green, with no exceeded repair budget or mandatory STOP.

Report baseline/branch, PR URL/number, initial and latest HEAD, latest reviewed
SHA/result/trigger, automatic detection, manual request counts per HEAD, CI,
local verification/review, repair and failure counts, Safety Gate, changed files,
dependency/runtime/privacy impact and remaining NOT VERIFIED items. Then stop:
merge, auto-merge, main updates, tags, releases, deployment and Community
Directory changes still require a new explicit human action.

If GitHub auth/permission blocks creation or post-PR inspection, follow
[STOP_CONDITIONS.md](STOP_CONDITIONS.md#github-authentication-fallback). Complete
safe local work where inputs are readable; never request/store/bypass credentials
or describe unobserved CI/review as passing. Report STOP and the specific blocked
operation, evidence, completed work and required human action.
