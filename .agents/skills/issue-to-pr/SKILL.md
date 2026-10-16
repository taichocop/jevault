---
name: issue-to-pr
description: Execute the unified Jevault Issue-to-PR workflow across Codex CLI and Google Antigravity using isolated worktrees, local verification, and GitHub Codex or Independent Agent review gates.
---

# Issue to PR Workflow

Follow `AGENTS.md` for all safety, privacy, architecture, and scope rules. Do not duplicate or override `AGENTS.md`.

## 1. Issue & Plan Gate

1. Read the target GitHub Issue (`gh issue view <num>`) and relevant local docs (`AGENTS.md`, `README.md`, `PRIVACY.md`, `RELEASE_CHECKLIST.md` when applicable).
2. Report any material conflict instead of guessing.
3. Stop for human approval of the Issue scope and implementation plan before creating commits, branches, or PRs when required by owner workflow.

## 2. Isolated Worktree Assignment

Never share a worktree between concurrent Codex and Antigravity workers or across different Issues.

- **Via StablyAI Orca (preferred orchestrator)**:
  ```bash
  # Create an isolated worktree (with or without immediate agent launch):
  orca worktree create --repo name:Jevault --name <agent>-issue-<num>-<slug> --base-branch origin/main --issue <num> --no-parent --json

  # Or launch a supervised worker in an orchestration Run:
  orca orchestration worker-start --worktree new-top-level --repo name:Jevault --name <agent>-issue-<num>-<slug> --base-branch origin/main --agent <codex|antigravity> --task-title "Issue #<num>" --spec "<task-spec>" --json
  ```
- **Via Git worktree / isolated clone fallback**:
  Create a dedicated worktree or clone on branch `<agent>/issue-<num>-<slug>` based on the approved `origin/main` SHA.

Verify `git status --short` and `git rev-parse HEAD` before editing.

## 3. Implementation & Local Verification

1. Implement only the active Issue scope.
2. Run the unified verification suite from the isolated worktree using Node 24 (`^20.19.0 || ^22.13.0 || >=24.0.0`):
   ```bash
   npm ci
   npm run verify
   node --test scripts/test-public-boundary.mjs
   ```
   If release assets or packaging are in scope, also run:
   ```bash
   node scripts/prepare-release.mjs <version>
   ```
3. Inspect diffs and boundary safety before committing:
   ```bash
   git status --short
   git diff --check
   git diff --staged --check
   node scripts/verify-public-boundary.mjs
   ```

## 4. Commit, PR, and Review Gate (`READY_TO_MERGE`)

Obtain explicit owner approval before `git commit`, `git push`, `gh pr create`, or merge when operating under gated tasks.

1. Push the worker branch and open/update the PR targeting `main`.
2. **Review Gate (Priority & Fallback)**:
   - **Priority 1 — GitHub Codex Review**: Prefer GitHub Codex Review on the exact PR `headRefOid`.
   - **Priority 2 — Independent Agent Review (Official Fallback)**: When GitHub Codex Review is unavailable due to usage/quota limits or service outage, execute a read-only review using `code-review` in a **separate, independent reviewer session and isolated worktree** (e.g., via an Orca Reviewer Worker or a separate CLI session).
   - **Strict Separation**: Never review your own implementation within the same session. Even when using the same agent product (`codex` or `antigravity`), the reviewer must run in a distinct session/context and must not edit files during review.
3. If any commit is added to address findings, re-run local verification, confirm GitHub Actions CI passes on the **new** `headRefOid`, and re-run review on the **new** `headRefOid`.
4. Mark `READY_TO_MERGE` in the [Verification Report](references/verification-report-template.md) **only** when all 6 conditions hold:
   - Implementation satisfies the Issue Acceptance Criteria,
   - Local verification passes (`PASS`) on the exact `HEAD` SHA,
   - GitHub Actions CI (`Validate and release`, `Public repository boundary`) passes on the exact current PR `HEAD` SHA (local tests never substitute for GitHub CI),
   - Either GitHub Codex Review or Independent Agent Review is `PASS` on the **exact current PR `HEAD` SHA** (`Reviewed Commit SHA === Current PR HEAD SHA`; CI alone or unexecuted review never counts as `PASS`),
   - Zero unresolved blocking/material findings remain (quota limits never excuse ignoring findings), and
   - Secret, Privacy, Vault Mutation, and Public Boundary checks are completed.
5. `READY_TO_MERGE` is **not** permission to auto-merge. Stop and hand off to the human owner for explicit merge approval (`Human Merge`). Tag push and Release publish require separate explicit approvals (`release-readiness` skill).

## 5. Antigravity & Orca Permission Rules (Separated from Common Rules)

- Prepend the user-scoped Node 24 runtime (`export PATH="$HOME/.local/share/mise/installs/node/24.19.0/bin:$PATH"`) when the default shell `node` does not match Jevault's `engines.node` range, and install dependencies independently per worktree (`npm ci`) without symlinking `node_modules`.
- Never use `--dangerously-skip-permissions` or `--dangerously-bypass-approvals-and-sandbox`. Keep Orca Agent Permissions set to **Manual** (`agentDefaultArgs` empty strings `""` and `nativeChatPermissionMode: "ask"`).
