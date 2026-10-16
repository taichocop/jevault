---
name: code-review
description: Perform read-only Jevault safety, privacy, scope, and diff reviews in Codex or Antigravity without confusing local review with formal GitHub PR review.
---

# Code Review Workflow

Apply the **Code Review Rules** and **Safety and architecture** sections in `AGENTS.md`. Do not modify files during a review task.

## 1. Review Scope & Exact SHA Binding

1. Record the exact target `HEAD` SHA (`git rev-parse HEAD`) and base SHA (`git merge-base HEAD origin/main`).
2. Inspect tracked status, unstaged/staged diffs, and public boundary compliance:
   ```bash
   git status --short
   git diff origin/main...HEAD --stat
   git diff origin/main...HEAD
   git diff --check
   npm run verify-public-boundary
   ```

## 2. Mandatory Jevault Audit Checks

Flag any violation of `AGENTS.md` as a blocking finding:

- **Vault Mutation Boundary**: Every note move or frontmatter tag addition must require explicit selection plus separate final confirmation (`Confirm Apply` / single-use capability bound to original `NoteSource` and `NoteSnapshot`), use public Obsidian APIs under the shared mutation lease, and never overwrite, auto-create folders, or fall back to the active note.
- **Privacy & Secret Safety**: Zero hard-coded, logged, or persisted secrets, `SecretStorage` dumps, note bodies, raw provider responses, or environment dumps.
- **Adapter & Entry Point Separation**: All TypeSafe SDK calls stay strictly inside `TypeSafeAdapter`; `main.ts` stays limited to lifecycle, wiring, commands, and settings.
- **Issue Scope & Public Boundary**: No unapproved roadmap features, background tasks, telemetry, or tracked `docs/` or `agent/` entries.

## 3. Local Review vs. GitHub Codex Review

- **Local Review** (executed by an Orca worker or local agent) is a pre-PR or pre-merge check only.
- **Formal Review Gate**: A PR cannot enter `READY_TO_MERGE` until the GitHub PR review (GitHub Codex Review) has been completed on the **exact current `HEAD` SHA** of the PR. If any commit is added after review, the previous review SHA is stale and must be re-run.
