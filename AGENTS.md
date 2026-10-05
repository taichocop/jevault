# AGENTS.md

## Goal and priorities

Jevault is an Obsidian plugin that suggests destination folders for Markdown notes. v0.1 supports suggestions and explicitly confirmed manual moves (Issue #33); no automatic moves.

Prioritize: user data safety, privacy, correctness, simplicity, testability, then performance.

## Source and workflow

- Follow the approved GitHub Issue and relevant local `docs/` sections. Report material conflicts instead of guessing.
- Work in this order: Issue → human approval → branch → implementation → tests → diff review → commit → PR.
- Continue after PR through [current-HEAD review and bounded repair](agent/PR_REVIEW_LOOP.md) to HUMAN MERGE READY; merge remains a human gate.
- Implement only the active Issue; do not add roadmap features.
- Approved Issue execution follows [agent/LOOP.md](agent/LOOP.md), read-only review follows [agent/REVIEW.md](agent/REVIEW.md), and mandatory stops follow [agent/STOP_CONDITIONS.md](agent/STOP_CONDITIONS.md).

## Issue-specific documentation

- Ordinary feature Issues use the GitHub Issue and PR as the authoritative record; do not create root-level `ISSUE_*.md` by default.
- Put long-lived architecture decisions in `docs/architecture/` and historical research, safety spikes, or durable verification evidence in `docs/history/`.
- Keep transient implementation and verification notes in the GitHub Issue or PR body by default. When a dedicated Markdown record is needed, choose its location explicitly rather than adding it to the repository root.

## Safety and architecture

- Unless explicitly required by the Issue, never move, rename, modify, or delete notes; create folders; edit frontmatter; add tags/links; run background work; or add telemetry.
- Never hard-code, commit, persist, or log API keys, SecretStorage values, note bodies, or environment collections. Do not put real Secrets in fixtures or `.env`.
- Use Obsidian APIs for Vault operations. Tests must use fixtures, never a real Vault.
- Keep TypeSafe SDK usage inside `TypeSafeAdapter` and replaceable through an interface.
- Keep `main.ts` limited to lifecycle, dependency wiring, commands, and settings.

## Readability and verification

- Add concise Japanese rationale comments only for non-obvious safety, privacy, Obsidian, adapter, validation, or error-handling decisions.
- Unit tests must use fakes and require no real API key or network call.
- Before completion, run test, typecheck, lint, and build scripts; then inspect status, diff, staged diff, Secrets, scope, Vault mutations, and dependencies.
- Never report an unchecked item as passing.

## Token efficiency

- Start with the active Issue and search only relevant headings/files; avoid rereading or pasting large unchanged content.
- Prefer focused commands and concise summaries. Reuse existing decisions and stop when approval is required.
- Never skip safety checks or tests to save tokens.

## Code Review Rules

- Flag any unapproved Vault mutation or background behavior; manual moves must follow selection plus explicit confirmation and must never overwrite or fall back to the active note.
- Flag Secret exposure, persistence, logging, or unapproved external data flow.
- Flag Issue-scope violations, TypeSafe SDK use outside `TypeSafeAdapter`, or business logic in `main.ts`.
