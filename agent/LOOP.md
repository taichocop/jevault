# Approved Issue execution loop

[AGENTS.md](../AGENTS.md) remains authoritative. This contract makes its
Issue → human approval → branch → implementation → tests → diff review → commit → PR
workflow finite and repeatable. It is an on-demand development procedure, not a
background agent, daemon, external service, or autonomous Issue selector.

## Entry and baseline

Begin implementation only when a GitHub Issue exists, explicit human approval
for that Issue is recorded, and its scope and Acceptance Criteria are readable.
Issue existence, assignment, or a roadmap entry alone is not approval. Read the
full active Issue, AGENTS.md, and relevant local documentation first. Material
conflicts require [STOP](STOP_CONDITIONS.md), not an inferred compromise.

Record the active Issue, approval evidence, approved scope summary, and baseline:

```bash
git status --short
git rev-parse HEAD
git fetch origin
git rev-parse origin/main
```

Record existing user changes before branching. Do not delete, overwrite, reset,
stash, or hide them. If they interfere with the Issue, stop and report them.
Use the actual latest main as the baseline for a dedicated `codex/` branch;
inspect an existing branch before reusing it. Never use `git reset --hard`,
`git clean -fd`, or force push. Record the branch name and actual baseline SHA.
Run relevant baseline tests before editing; unrelated pre-existing failures
require STOP rather than opportunistic repairs.

## Plan, implement, validate, observe

Split the Acceptance Criteria into the smallest coherent milestones. The active
Issue is the hard scope boundary: no speculative roadmap features or unrelated
refactors. For each milestone:

1. Make a small coherent change.
2. Run the smallest relevant unit/regression tests or tooling/document checks.
3. Inspect output and the milestone diff; record the evidence and result.
4. Continue only when focused validation is green. Repair failures within the
   [finite limits](STOP_CONDITIONS.md#repair-limits), then repeat validation.

For documentation, check referenced paths, links, cross-document consistency,
and AGENTS.md invariants. For verification tooling, exercise real success and
disposable child-stage failures, including stage labeling and non-zero exit
propagation. Never commit broken product code just to prove a failure path.

## Execution state

Keep a compact state summary in Codex plan/task state, updating it after each
milestone, validation, review, repair, or STOP. Preserve it in task handoffs so
work resumes from the recorded state rather than restarting.

```text
active Issue / explicit approval evidence
baseline commit / branch / existing user changes
approved scope summary
current milestone / completed milestones
focused validation: command, result, applicable revision
full verification: command, result, applicable revision
open review findings
repair counts: focused / full verification / review
post-PR: PR number/URL, current HEAD, reviewed SHA, trigger/status, CI
threads/findings, post-PR repair count, per-HEAD manual requests, wait deadline
failure signatures and occurrence counts
stop reason (if stopped)
```

Do not create a permanent tracked execution-state file. No scratch file is
needed by default. If a task has a concrete need for one, use a unique gitignored
file without overwriting user files; keep it safely removable. Never store
credentials, SecretStorage values, environment dumps, note bodies, note paths,
or tag collections in execution state or scratch files. Record validation
summaries rather than sensitive raw output.

## Full verification

Use a Node/npm version supported by package.json and the committed lockfile.
Before final review, run `npm ci`, then:

```bash
npm run verify
```

The canonical command is `node scripts/verify.mjs`, invoked through npm. It runs
these stages sequentially and stops with a labeled non-zero failure:

| Stage | Command | Evidence |
| --- | --- | --- |
| Unit/regression tests | `npm test` | Vitest excludes `tests/integration/**` |
| Lint | `npm run lint` | No auto-fix |
| Production build | `npm run build` | Typecheck → production esbuild → `verify:licenses` |
| Working diff whitespace | `git diff --check` | Unstaged tracked changes |
| Staged diff whitespace | `git diff --cached --check` | Staged changes, including newly added files |

Typecheck and license verification are intentionally delegated to the existing
build command to avoid duplicate work. Its npm output identifies the nested
step; the runner labels the enclosing build stage. Verification writes the
ignored build artifact `main.js`, but does not auto-fix source, update
dependencies, or install into a Vault. `npm ci` is a separate prerequisite and
may contact the existing package registry; it is not part of `verify`.

Normal verification must not run `spike:typesafe`, use a real API key or
SecretStorage value, call TypeSafe, or access a real user Vault. Unit tests use
fakes/fixtures. Whitespace checks do not inspect untracked files until staged;
inspect those files explicitly before staging. Never report an unchecked stage
as passing, or treat successful verification as proof of Issue completeness.

## Diff review and Jevault Safety Gate

With focused and full verification green, enter the distinct read-only phase in
[REVIEW.md](REVIEW.md). Inspect `git status`, changed files, `git diff`,
`git diff --cached`, `git diff --check`, and the complete baseline-to-candidate
diff, including new files. Audit documentation impact and these gates:

| Gate | Required evidence before PR-ready |
| --- | --- |
| Scope | Every change serves the active Issue; no unrelated refactor or roadmap feature |
| Vault | Unless explicitly required by the Issue: no new move, rename, delete, note modification, folder creation, frontmatter or tag mutation. Manual moves retain selection → explicit confirmation → exact classified-note identity; never overwrite or fall back to the active note |
| Privacy | No unapproved external data flow, including new note body/path/tag transmission; no telemetry or background upload |
| Secrets | No hard-coded key, persisted plaintext Secret, SecretStorage logging, environment dump, or real Secret fixture |
| TypeSafe / architecture | SDK remains inside TypeSafeAdapter; endpoint pinning and cancellation/retry safety remain intact; main.ts stays lifecycle/composition/commands/settings |
| Dependencies | No unauthorized additions or unrelated updates; inspect package.json and package-lock.json explicitly |

If a safety invariant cannot be established from code/tests, STOP. Record gate
results and their evidence separately from test results.

## Review, repair, commit, PR

Reviewer reports findings only. The implementer repairs BLOCKER/REQUIRED
findings minimally, runs focused validation and `npm run verify`, then requests
read-only re-review. Invalidate prior green results after relevant changes.
Use at most three review → repair → re-review iterations by default, with the
same-failure and validation limits in [STOP_CONDITIONS.md](STOP_CONDITIONS.md).
OPTIONAL/style preferences do not keep the loop running.

Commit only after green validation, resolved actionable findings, a green
Safety Gate, and final diff review. Stage only Issue files; inspect
`git diff --cached` and `git diff --cached --check` before committing. Push the
Issue branch and create a PR describing the final behavior, actual validation,
risks/NOT VERIFIED items, and the active Issue. PR creation is a checkpoint,
not successful completion. Continue through [PR_REVIEW_LOOP.md](PR_REVIEW_LOOP.md):
observe existing automatic Codex Review and CI for the exact current HEAD,
classify findings, repair within finite limits, and stop at HUMAN MERGE READY
for human merge.

Do not merge, enable auto-merge, force push main, tag, release, change the Community Directory, or
deploy. Version bumps need explicit active-Issue scope. Merge/release remain
human gates; this harness grants no approval for them.

If GitHub authentication/permission is unavailable, stop only the unavailable
GitHub action. Continue safe local work through verification, review, commit,
and PR title/body preparation where authoritative inputs are already readable.
Then report `PR CREATION BLOCKED — GitHub authentication/permission required`.
Never request, print, save, or bypass credentials. Missing authoritative inputs
still prevent implementation; see [STOP_CONDITIONS.md](STOP_CONDITIONS.md).
