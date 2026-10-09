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

User-reachable Vault mutations are limited to explicitly confirmed **Manual Move**, **Manual Tag Apply**, and **Folder Organizer Apply**. Selection, suggestion completion, plugin load, and settings changes never authorize mutation.

### Folder Organizer analysis

Preview is local and reads no note bodies, looks up no Secrets, makes no TypeSafe requests, and performs no Vault mutations. Folder suggestions and Tag suggestions are both enabled by default after Preview and independently toggleable. At least one is required; both disabled prevents UI activation and returns `stopped(invalid-options)` defensively before any target work. Option toggles only update local state/disclosure, with zero body/provider/Secret/recollection/mutation work.

Only explicit **Analyze notes** after a non-empty Preview authorizes analysis of the exact captured target set/order with one immutable run-level options snapshot. No recollection, active-note fallback, or path-only rebinding is permitted. Each attempted note is read at most once. Both enabled runs Folder then Tag; Folder-only performs no Tag service/candidate/provider/Secret work, and Tag-only performs no Folder service/candidate/provider/Secret work. Disabled phases remain `not-run(disabled)`, including on read failure or cancellation, and do not count as failures. Completed enabled work retains its success even when cancellation prevents the next target.

Disclosure identifies enabled payloads: title, Vault-relative path, and body plus Folder candidates for Folder analysis or existing Tag candidates/optional descriptions for Tag analysis. Disabled candidate categories are not sent through that phase. Maximum requests per fully analyzed note are up to 2 for both (1 Folder + 1 Tag), up to 1 Folder request for Folder-only, or up to 1 Tag request for Tag-only. TypeSafe-managed credits may be used, with no fixed monetary or credit amount. Analysis is read-only; options, suggestions and completion confer no Review selection, confirmation, or mutation authority. Completed analysis can enter explicit local Review; Review completion alone cannot authorize Apply.

Stop aborts a dedicated analysis signal while keeping the Modal alive until the service settles. Close/Esc/X and unload abort analysis and dispose UI, suppressing late progress/results. Results stay in operation memory, without persistence, raw error/body/Secret/provider display, background analysis, or automatic retry. Organizer mutation requires the separate final **Confirm Apply** action.

### Folder Organizer Review

Only completed analysis offers **Review results**; stopped/cancelled runs cannot enter Review. The exact immutable result transfers before Analyze cleanup, and old Analyze handlers cannot affect Review. Review captures destination eligibility through the existing VaultService rule, existing Tags through TagDiscoveryService, and current exact-source metadata through ExistingTagSnapshotService once. Missing metadata is unknown, with no body fallback or active-note lookup.

Folder and Tag drafts initially remain explicitly unreviewed, separate from analysis facts. Neither Keep current nor high-confidence suggestions are preselected. Keep current is always available; all other Folder intents require captured eligible existing paths. Tags require an exact captured existing representation, with isSameTagIdentity used only for selection de-duplication. No free-form/new Folder or Tag, Tag removal/rename, or silent stale-candidate rebinding is allowed. Failed Notes stay visible with no selection controls or intent.

Finish requires explicit Folder intent for every reviewable Note; failed Notes are excluded and zero reviewable Notes cannot finish. Only explicit **Finish review** converts untouched Tags into an explicit zero-Tag choice. It returns immutable intent preserving the exact NoteSource/NoteSnapshot and separate analysis. Review selection and completion are not Apply confirmation, stale-safety proof, or mutation authority. No Apply capability or confirmation token is created.

All Review actions perform zero TypeSafe/Secret/body/recollection/re-analysis/mutation work. Draft/result ownership stays in operation memory with no persistence, polling, timers, or background work. Close/Esc/X discards unfinished drafts; before Apply handoff, close/unload clears session references and invalidates late handlers. Review-complete copy explicitly states no Vault changes. Organizer mutation requires the separate final **Confirm Apply** action.

### Folder Organizer Apply confirmation and lifecycle

**Apply selected changes** appears only after successful explicit Finish review and opens a separate final confirmation. It displays exact original source paths, Folder intents, selected Tags and counts, plus the non-atomic Tag + Move / partial-success warning. Opening or cancelling this screen performs no mutation. Only its explicit **Confirm Apply** action calls `OrganizationApplyConfirmationSession.confirm()` and immediately passes the single-use token to `OrganizationApplyService.apply()` once. An `OrganizationReviewResult` alone grants no mutation authority. A separate memory-only `OrganizationApplyConfirmationSession` issues an opaque capability bound to the actual Vault, exact Review result/selection and owning Review/confirmation lifetime. Copies, recreated tokens, replacement, disposal and replay fail closed. Each accepted attempt consumes the capability even on busy, stale, failure or later cancellation; an already-aborted call does not consume it.

Review navigation transfers the same original session/result to one Apply flow owner before closing Review. No copies, serialization or active-note rebinding are used. Confirm is disabled synchronously before async work; detached handlers and repeated Enter/clicks cannot confirm again. Stop aborts once and retains the UI and authority until service settlement. Close/Esc/X and plugin unload abort and detach UI immediately, suppressing all late DOM writes/notices while the service holds its original owner and shared lease until settlement. Teardown is idempotent; no replacement Apply or automatic retry is started.

Only reviewed Notes are processed, sequentially in Review order; unavailable Notes are excluded. Each Note holds one shared source/selected-target/TFile lease across strict original identity/path/Markdown/mtime/size validation, pre-Tag destination validation, additive Tag processing, post-Tag baseline and Move settlement. Selected destinations must still be existing eligible folders under current settings with the exact safe target and no collision. Keep-current and the same current folder make no rename call; zero selected Tags make no frontmatter call.

Current frontmatter inside `FileManager.processFrontMatter` is the strict Tag duplicate/preservation authority. Supported existing Tags, order/duplicates and unrelated fields are retained; unsupported values fail safely. Callback validation checks original source/snapshot and lifetime before assignment. After an applied **or unchanged** Tag call settles, the exact source is re-resolved for an immutable post-Tag snapshot. No Tag call means Move retains the original Review snapshot. Move revalidates source, baseline, destination, lifetime and cancellation immediately before `FileManager.renameFile`.

Tag failure prevents Move. Tag success plus Move failure is explicit partial success with no rollback or automatic retry. Cancellation/revocation prevent new mutations while already-started APIs retain their lease until actual settlement; earlier terminal results remain. The UI displays terminal status, exact original paths in Review order, phase statuses and safe reasons. Completed does not mean all-success; applied Tags remain visible if Move fails or is cancelled. Unavailable and unattempted Notes receive no fabricated results. Local failures continue to later Notes, while invalid authority, internal invariants or throwing progress observers stop the operation. Results/progress are immutable and return finite safe reasons, with no raw errors, frontmatter, body, provider response or absolute filesystem paths. Apply performs no body read/hash, Secret lookup, TypeSafe request, network call, re-analysis or target recollection. Runtime verification uses a separate disposable synthetic Vault and isolated verification plugin, never the normal plugin or a real user Vault.

### Manual Move

Jevault supports a manual move only after the user selects a displayed candidate and explicitly confirms **Move**.

- Validate the original classified Markdown file by its captured path and in-memory identity; never fall back to the active note.
- Revalidate the existing destination folder immediately before moving.
- Preserve the filename and extension. Refuse an existing target, including case/Unicode-equivalent names; never overwrite, delete, or automatically rename.
- Block repeated confirmations and concurrent moves involving the same source or target.
- Cancel before the move API starts on Close or plugin unload. Once the API starts, handle its actual result without custom rollback.
- Use `FileManager.renameFile`; Obsidian controls standard link updates according to user preferences. Do not implement custom whole-note, note-body, or link rewriting. Only explicitly confirmed Manual Tag Apply and Folder Organizer Apply may add selected existing Tags through Obsidian's frontmatter API; neither permits Tag removal/rename or arbitrary frontmatter mutation.
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

### Shared mutation coordination

Manual Move, Manual Tag Apply and Organizer Apply use one memory-only Jevault mutation domain keyed by the actual Vault object, including across distinct service instances. Source and target paths share one NFC-normalized, conservative lowercase comparison namespace; exact source TFile identity also remains leased across a rename. Same-source, same-target, and source-target crossing conflicts fail immediately as busy, with no wait queue. Unrelated notes and targets can proceed concurrently; this is not a global Vault mutex.

Coordination follows each feature's existing authorization boundary and grants no mutation authority. Accepted Tag confirmations remain single-use even when busy. Leases are acquired synchronously without partial reservations, released idempotently in finally, and held until the actual processFrontMatter or renameFile Promise settles, including after cancellation. No lock state is persisted.

This excludes Jevault-vs-Jevault overlap only. It does not lock editor, other-plugin, filesystem, OS, or sync-provider writes. Existing source, destination, collision, lifetime, and current-frontmatter validation remains mandatory. It provides no transaction isolation or rollback guarantee and grants no Organizer Apply authority on its own.

## Network safety

Jevault communicates with TypeSafe only after the user explicitly runs **Jevault: Classify current note**, **Jevault: Suggest tags for current note**, selects **Retry**, or selects Folder Organizer **Analyze notes**. Manual Move, Manual Tag Apply and Organizer Apply make no additional TypeSafe request; Tag/Organizer Apply also make no additional Secret lookup. It does not implement background classification, background Tag Suggest, background Folder Organizer analysis, background retry, automatic re-analysis, automatic Apply, automatic upload, telemetry, or analytics.

These explicit TypeSafe requests may include the note title, Vault-relative note path, full Markdown note body, candidate folder paths for Folder Suggest, and existing Vault Tag candidate names and optional Tag candidate descriptions for Tag Suggest. See [PRIVACY.md](PRIVACY.md) for the current disclosure.

TypeSafe SDK usage must remain inside `TypeSafeAdapter`, behind the classifier interface. Error handling must not expose provider responses, credentials, or note bodies.

## Testing

Unit tests must use fakes and make no network calls. Vault-related tests must use isolated fixtures or fake Vaults, never a real user Vault. A real TypeSafe integration test may run only when explicitly invoked with a safely supplied secret; it is not part of the ordinary unit test suite.
