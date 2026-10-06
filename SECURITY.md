# Security

## Reporting a vulnerability

Jevault uses **GitHub Private Vulnerability Reporting** as its security-reporting channel.

This repository is public and Private Vulnerability Reporting is enabled. Report vulnerabilities through the repository's **Security → Report a vulnerability** form. The project owner must confirm that this flow remains available before Community Plugin submission, as recorded in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

If that private reporting flow is unavailable, do not include sensitive vulnerability details in a public issue. Never include API keys, note contents, or other secrets in public issues.

## Secrets

- Do not hard-code or commit API keys.
- Do not log API keys or SecretStorage values.
- Do not dump SecretStorage or a full process environment.
- Do not put real secrets in fixtures, snapshots, `.env` files, or documentation.
- Keep API keys in Obsidian SecretStorage. Plugin settings may retain only the selected secret reference/name.

## Vault safety

Intentional Vault mutations are limited to explicitly confirmed **Manual Move** and **Manual Tag Apply**. Selection, suggestion completion, plugin load, and settings changes never authorize mutation.

### Folder Organizer analysis

Preview is local and reads no note bodies, looks up no Secrets, makes no TypeSafe requests, and performs no Vault mutations. Folder suggestions and Tag suggestions are both enabled by default after Preview and independently toggleable. At least one is required; both disabled prevents UI activation and returns `stopped(invalid-options)` defensively before any target work. Option toggles only update local state/disclosure, with zero body/provider/Secret/recollection/mutation work.

Only explicit **Analyze notes** after a non-empty Preview authorizes analysis of the exact captured target set/order with one immutable run-level options snapshot. No recollection, active-note fallback, or path-only rebinding is permitted. Each attempted note is read at most once. Both enabled runs Folder then Tag; Folder-only performs no Tag service/candidate/provider/Secret work, and Tag-only performs no Folder service/candidate/provider/Secret work. Disabled phases remain `not-run(disabled)`, including on read failure or cancellation, and do not count as failures. Completed enabled work retains its success even when cancellation prevents the next target.

Disclosure identifies enabled payloads: title, Vault-relative path, and body plus Folder candidates for Folder analysis or existing Tag candidates/optional descriptions for Tag analysis. Disabled candidate categories are not sent through that phase. Maximum requests per fully analyzed note are up to 2 for both (1 Folder + 1 Tag), up to 1 Folder request for Folder-only, or up to 1 Tag request for Tag-only. TypeSafe-managed credits may be used, with no fixed monetary or credit amount. Analysis is read-only; options, suggestions and completion confer no Review selection, confirmation, or mutation authority. Review/Apply remain unavailable in this flow.

Stop aborts a dedicated analysis signal while keeping the Modal alive until the service settles. Close/Esc/X and unload abort analysis and dispose UI, suppressing late progress/results. Results stay in operation memory, without persistence, raw error/body/Secret/provider display, background analysis, or automatic retry. Existing Manual Move and Manual Tag Apply remain the only mutation paths.

### Manual Move

Jevault supports a manual move only after the user selects a displayed candidate and explicitly confirms **Move**.

- Validate the original classified Markdown file by its captured path and in-memory identity; never fall back to the active note.
- Revalidate the existing destination folder immediately before moving.
- Preserve the filename and extension. Refuse an existing target, including case/Unicode-equivalent names; never overwrite, delete, or automatically rename.
- Block repeated confirmations and concurrent moves involving the same source or target.
- Cancel before the move API starts on Close or plugin unload. Once the API starts, handle its actual result without custom rollback.
- Use `FileManager.renameFile`; Obsidian controls standard link updates according to user preferences. Do not implement custom whole-note, note-body, or link rewriting. Only the approved Manual Tag Apply path below may add selected Tags through Obsidian's frontmatter API; it does not permit Tag removal/rename or arbitrary frontmatter mutation.
- Do not create folders, delete notes, or add automatic/background moves.

### Manual Tag Apply

- Require user selection of exact suggested existing Tag names and explicit **Add tags** confirmation. All suggestions start unchecked; selection and opening confirmation cause no mutation. No automatic/background Apply or free-form/new Tag generation is permitted.
- Bind the exact selected suggestions to the original `NoteSource` through a core-issued, single-use `ConfirmedTagApplyIntent`. Validate the captured path and in-memory file identity; a moved, deleted, or replaced source blocks Apply. Never fall back to the active note.
- Consume each accepted confirmation for one attempt, including failure or busy results; block concurrent Apply attempts for the same source.
- Use `FileManager.processFrontMatter` for additive-only frontmatter Tag changes. Preserve existing supported Tags and unrelated fields; reject unsupported `tags` values rather than rewriting them. Do not remove/rename Tags or mutate arbitrary frontmatter.
- Strictly prevent semantic duplicates against current frontmatter inside the mutation callback, including ASCII case-equivalent Tags. Inline duplicate detection and **Already on note** annotations are best effort/advisory, not strict mutation authority.
- Treat changed or unknown suggestion freshness as a warning that still permits confirmation when source and selection remain valid.
- Cancel on Close, Esc, Cancel, or plugin unload before the mutation API starts. Once it starts, handle its actual result without custom rollback or automatic retry; closing/unloading suppresses late feedback and stale UI revival.

Vault access must use Obsidian APIs. Tests must never operate on a real user Vault.

## Network safety

Jevault communicates with TypeSafe only after the user explicitly runs **Jevault: Classify current note**, **Jevault: Suggest tags for current note**, selects **Retry**, or selects Folder Organizer **Analyze notes**. Manual Move and Manual Tag Apply make no additional TypeSafe request; Manual Tag Apply also makes no additional Secret lookup. It does not implement background classification, background Tag Suggest, background Folder Organizer analysis, background retry, automatic re-analysis, automatic Apply, automatic upload, telemetry, or analytics.

These explicit TypeSafe requests may include the note title, Vault-relative note path, full Markdown note body, candidate folder paths for Folder Suggest, and existing Vault Tag candidate names and optional Tag candidate descriptions for Tag Suggest. See [PRIVACY.md](PRIVACY.md) for the current disclosure.

TypeSafe SDK usage must remain inside `TypeSafeAdapter`, behind the classifier interface. Error handling must not expose provider responses, credentials, or note bodies.

## Testing

Unit tests must use fakes and make no network calls. Vault-related tests must use isolated fixtures or fake Vaults, never a real user Vault. A real TypeSafe integration test may run only when explicitly invoked with a safely supplied secret; it is not part of the ordinary unit test suite.
