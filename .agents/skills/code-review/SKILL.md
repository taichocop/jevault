---
name: code-review
description: Perform read-only Jevault safety, privacy, scope, and diff reviews in Codex or Antigravity as a pre-check or as an official Independent Agent Review fallback when GitHub Codex Review is unavailable.
---

# Code Review Workflow

Apply the **Safety and architecture**, **Verification**, and **Documentation and rationale** sections in `AGENTS.md`. Do not modify files during a review task; return any findings to the implementer session.

## 1. Review Scope & Exact SHA Binding

1. Record the exact target `HEAD` SHA (`git rev-parse HEAD`), current PR `headRefOid` (`gh pr view <num> --json headRefOid`), and base SHA (`git merge-base HEAD origin/main`).
2. Inspect tracked status, unstaged/staged diffs, and public boundary compliance in a dedicated read-only worktree:
   ```bash
   git status --short
   git diff origin/main...HEAD --stat
   git diff origin/main...HEAD
   git diff --check
   node scripts/verify-public-boundary.mjs
   ```

## 2. Mandatory Jevault Audit Checks

Report findings with explicit severity (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`). Flag any violation of `AGENTS.md` as a blocking finding:

- **Vault Mutation Boundary**: Every note move or frontmatter tag addition must require explicit selection plus separate final confirmation (`Confirm Apply` / single-use capability bound to original `NoteSource` and `NoteSnapshot`), use public Obsidian APIs under the shared mutation lease, and never overwrite, auto-create folders, or fall back to the active note.
- **Privacy & Secret Safety**: Zero hard-coded, logged, or persisted secrets, `SecretStorage` dumps, note bodies, raw provider responses, private absolute paths, or environment dumps.
- **Adapter & Entry Point Separation**: All TypeSafe SDK calls stay strictly inside `TypeSafeAdapter`; `main.ts` stays limited to lifecycle, wiring, commands, and settings.
- **Issue Scope & Public Boundary**: No unapproved roadmap features, background tasks, telemetry, permission-bypass flags (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`), or tracked `docs/` or `agent/` entries.

## 3. Review Gate Hierarchy & Independent Agent Review Rules

1. **Priority 1 — GitHub Codex Review**: Prefer GitHub Codex Review on the PR whenever available.
2. **Priority 2 — Independent Agent Review (Fallback)**: When GitHub Codex Review is unavailable due to usage/quota limits or service outage, an Independent Agent Review may satisfy the review gate **only** if all of the following hold:
   - **Role & Session Separation**: Executed in a separate, independent reviewer session/context (preferably in a dedicated Orca reviewer worktree) distinct from the session that implemented the changes, even when using the same agent product (`codex` or `antigravity`). Self-review in the implementing session is strictly prohibited.
   - **Exact SHA Match**: `Reviewed Commit SHA` must equal the current PR `headRefOid`. Any subsequent fix commit invalidates the prior review and requires re-running both GitHub Actions CI and the review on the new `HEAD` SHA.
   - **Complete Record**: Record `Review Provider`, `Review Mode`, `Reviewer Session / Execution Record`, `Reviewed Commit SHA`, `Current PR HEAD SHA`, `SHA Match`, `Findings & Resolution Status`, `Review Result` (`PASS` / `FINDINGS` / `NOT VERIFIED`), and the fallback reason in the [Verification Report](../issue-to-pr/references/verification-report-template.md).
3. Never record an unexecuted review as `PASS`, never treat CI passing alone as review completion, and never ignore material findings due to quota limits.
