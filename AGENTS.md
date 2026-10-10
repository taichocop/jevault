# AGENTS.md

## Priorities and scope

Jevault is an Obsidian plugin that suggests destination folders for Markdown notes.

- Prioritize user data safety > privacy > correctness > simplicity > testability > performance.
- Follow only the approved active GitHub Issue and relevant specs; do not implicitly add roadmap features.
- Stop and report material Issue/spec/safety conflicts rather than guess.

## Safety and architecture

- No note move/rename/modification/deletion, folder creation, frontmatter/tag/link mutation, or background work unless explicitly authorized by the active Issue.
- Mutations require exact original `NoteSource`, the approved target, user selection and explicit confirmation; never overwrite, silently retarget, or fall back to the active note. AI suggestion is not mutation authority.
- Use only public Obsidian APIs for Vault operations.
- Never hard-code, commit, persist, or log API keys, SecretStorage values, note bodies, or environment collections; no real Secrets in fixtures or `.env`.
- No telemetry or new external destinations/data flow without explicit active-Issue scope.
- Keep TypeSafe SDK usage only inside `TypeSafeAdapter`, replaceable through an interface.
- Keep `main.ts` limited to lifecycle, dependency wiring/composition, commands and settings; business rules belong elsewhere.

## Verification

- Normal tests use fakes/synthetic fixtures: no real user Vault, API key, TypeSafe request or network call.
- Run `npm run verify` before PR-ready work; inspect status, full/staged diff, Secrets, scope, Vault mutations and dependencies.
- Never claim unchecked validation passed or skip safety checks/tests to save tokens.

## Documentation and rationale

- Keep product code, tests, public user/security/privacy/release documentation and root AGENTS.md Git-managed in this public repository.
- Store internal architecture/design, safety/runtime evidence and agent operational/review records only in an owner-approved Private location. Request authorized access when needed; do not recreate public `docs/` or `agent/` for internal records.
- Public Issues/PRs should contain only the information needed for scope, review and public engineering coordination. Never include Secrets, note bodies, environment dumps, private absolute paths, Private storage URLs or unnecessary agent/runtime identifiers; keep detailed internal evidence Private.
- Avoid root-level `ISSUE_*.md`. Run `node scripts/verify-public-boundary.mjs` (also included in `npm run verify`) to reject tracked root `docs/` or `agent/` entries, including force-added files.
- Add concise Japanese rationale comments only for non-obvious safety, privacy, Obsidian, adapter, validation or error-handling decisions.

## Human authorization

- Merge, auto-merge, version changes, tags, releases and deployment require explicit human authorization.
