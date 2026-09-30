# Read-only reviewer contract

Use this phase after focused validation and `npm run verify` are green, following
[LOOP.md](LOOP.md). [AGENTS.md](../AGENTS.md) and the active Issue remain
authoritative. Review actively for concrete failures; do not assume no issues.

## Phase boundary and inputs

Use a separate read-only reviewer context/subagent when available and useful;
no new multi-agent infrastructure or external service is required. Otherwise
explicitly announce entry into read-only reviewer mode in the current task.
In either case, the reviewer makes no edits, auto-fixes, commits, GitHub state
changes, Vault operations, or network integration calls. It returns findings
and a repair decision to the implementer. Review evidence must not expose
Secrets or note content.

Provide the reviewer:

- The full active Issue, explicit approval scope, and Acceptance Criteria.
- AGENTS.md and the baseline and candidate SHAs/status (or exact uncommitted
  candidate state), including existing user changes.
- Changed-file list and complete baseline-to-candidate diff: committed,
  staged, unstaged, and new files. Identify unrelated user changes separately.
- Focused/full validation results for this candidate, open findings, repair
  counts, and any NOT VERIFIED items.

Read-only inspection includes `git status --short`,
`git diff <baseline> HEAD`, `git diff`, `git diff --cached`, and the full contents
of new files. An empty unstaged diff is not proof that nothing changed.

## Checklist / reviewer prompt

Inspect the complete diff against every Acceptance Criterion. For each point,
seek concrete code/test evidence and identify any missing evidence:

1. Does the diff satisfy the Issue? Is any feature/refactor outside approved scope?
2. Could it move/rename/delete/modify the wrong Vault data, create folders, or
   mutate tags/frontmatter without approval? For manual moves, preserve
   selection, explicit confirmation, and exact classified-note identity;
   never overwrite or fall back to the active note.
3. Did external data flow, network destinations, telemetry, or background
   behavior change? Was new note body/path/tag transmission explicitly approved?
4. Could a key/SecretStorage value be persisted or logged? Check fixtures,
   settings, errors, execution state, and environment dumping.
5. Did TypeSafe SDK use escape TypeSafeAdapter? Were endpoint pinning,
   cancellation, or retry safeguards weakened?
6. Did business logic leak into main.ts, UI, or provider boundaries?
7. Are regression tests production-relevant, using fakes and fixtures without
   real API keys, network calls, or a real user Vault? Do they prove the affected
   invariant rather than just mirror implementation?
8. Did dependencies, package-lock.json, manifest/version, or release behavior
   change? Are all such changes necessary and authorized?
9. Do changed behavior/process docs, links, and validation claims agree with the
   final implementation, AGENTS.md, and the loop/stop contracts?
10. Is the [Jevault Safety Gate](LOOP.md#diff-review-and-jevault-safety-gate)
    supported by evidence? Are unresolved correctness/API assumptions or failed
    checks being described as passing?

## Findings and handoff

| Class | Meaning | Decision |
| --- | --- | --- |
| BLOCKER | Safety/privacy breach, approval conflict, or an unprovable required invariant | PR blocked; apply mandatory STOP conditions before attempting repair |
| REQUIRED | Concrete in-scope correctness, Acceptance Criteria, or regression defect | PR blocked; minimum repair within approved scope |
| OPTIONAL | Nonessential improvement or style preference | Record only; does not extend the repair loop |

For each actionable finding report file/path (line where useful), the concrete
problem, trigger, impact, violated Issue/AGENTS requirement, and minimal repair.
Distinguish observed failures from unverified assumptions. Do not invent
findings to fill a quota. If none are actionable, explicitly say so.

The reviewer never repairs its own findings during review. The implementer
leaves reviewer mode to repair BLOCKER/REQUIRED findings only when permitted by
[STOP_CONDITIONS.md](STOP_CONDITIONS.md), then performs focused validation,
`npm run verify`, and read-only re-review. Maximum three repair iterations by
default; the same root-cause failure observed three times requires STOP.
Re-review the resulting complete diff, not just the last fix. A green review
does not authorize merge, release, or scope expansion.

## GitHub review evidence

After PR creation/push, the implementer collects the paginated, current-HEAD
GitHub evidence defined in [PR_REVIEW_LOOP.md](PR_REVIEW_LOOP.md). Give the
read-only reviewer the PR number/URL, current and reviewed SHAs, Code Review
status/trigger, summaries, top-level comments, submitted reviews, inline threads
with resolved/outdated state, current-HEAD CI, complete diff, and repair counts.
The reviewer classifies external findings using the same BLOCKER/REQUIRED/
OPTIONAL table and authoritative contracts, including the active product Issue
when this harness is used for product work. A positive summary cannot dismiss
an unresolved actionable thread; an old/outdated finding needs an applicability
check, not an automatic repair. Explain incorrect findings with concrete evidence.

The reviewer performs no GitHub mutations or repairs. Return classifications,
evidence gaps and the minimum permitted repair to the implementer. Required
unavailable surfaces or unbound reviewed SHAs are NOT VERIFIED. Leave review
mode before repair or thread resolution. After repair, run focused validation,
full verification, Safety Gate and local read-only review before push; collect
new-HEAD evidence for GitHub re-review. Local review cannot substitute for the
current-HEAD Codex Code Review or CI required for HUMAN MERGE READY.
