# Jevault

Jevault is an Obsidian desktop plugin that suggests destination folders for Markdown notes from the folders that already exist in your vault. It also suggests existing Vault tags and lets you explicitly confirm adding selected tags to the original note's frontmatter.

```text
Active Markdown note
        ↓
Existing Vault folders
        ↓
TypeSafe Jev
        ↓
Ranked destination folder suggestions
```

Jevault suggests existing destination folders. You can explicitly select a suggestion and confirm a manual move of the classified note. Jevault never moves notes automatically.

## Requirements

- Obsidian Desktop 1.11.4 or later
- A TypeSafe account for Folder/Tag suggestions
- A TypeSafe API key that you provide for Folder/Tag suggestions (bring your own key, or BYOK)

Jevault uses the TypeSafe API for classification, so it does not provide an offline classification mode.

Each classification, Tag Suggest, Folder Organizer **Analyze notes**, or explicit **Retry** request that reaches TypeSafe consumes TypeSafe-managed credits from your account. Depending on your credit balance, you may need to purchase credits from TypeSafe and incur TypeSafe charges. TypeSafe may offer promotional credits, but it controls their availability and terms; Jevault does not guarantee them. See [TypeSafe's current terms](https://typesafe.ai/legal/mca) and [pricing information](https://typesafe.ai/) for details.

## Setup

Open **Settings → Community plugins → Jevault**, then configure:

- **TypeSafe API key**: Select or create an Obsidian secret containing your TypeSafe API key. Jevault stores only the secret name in its plugin settings; do not paste an API key into ordinary plugin settings or repository files.
- **Inbox folder**: Set the Vault-relative folder path to exclude that folder and its descendants from destination suggestions.
- **Number of suggestions**: Set how many ranked folder suggestions to display.
- **Ignored folders**: Enter Vault-relative folder paths to exclude, one per line.

Jevault always excludes the Vault's current Obsidian configuration directory and its subfolders from destination suggestions. This system exclusion does not appear in **Ignored folders** for new installs. Existing saved ignored-folder entries remain intact.

## Usage

1. Open a Markdown note.
2. Open the Command Palette.
3. Run **Jevault: Classify current note**.
4. Wait for classification to finish.
5. Review the ranked folder suggestions.
6. Click a candidate or press its displayed number (`1`–`9`) to select it. Selection alone does not move the note. Candidates beyond the first nine remain clickable.
7. Review the source note path, destination folder, and resulting target path.
8. Select **Move** or press **Enter** to confirm. **Cancel**, **Esc**, or closing the modal leaves the note in place before a move starts.

If a retryable error is shown, selecting **Retry** explicitly starts another classification request. A move uses the exact classified note, even if you switch active notes. A missing, renamed, moved, or replaced source, a missing destination, or an existing target blocks the move. Filename and extension are preserved; Jevault never overwrites or adds a suffix. A note already in the selected folder is reported without moving it.

Manual move is local and sends no additional TypeSafe request. Once the Obsidian move API starts, closing the modal cannot abort it; Jevault reports its result and performs no automatic rollback. Obsidian may update links according to your settings. Jevault does not rewrite note content or frontmatter itself.

### Tag Suggest and Manual Tag Apply

1. Open a Markdown note.
2. Open the Command Palette.
3. Run **Jevault: Suggest tags for current note**.
4. Wait for evaluation to finish.
5. Review suggested existing tags, match probabilities, and **Already on note** annotations.
6. Select the tags to add. All suggestions start unchecked, including tags marked **Already on note**. Selection alone changes nothing.
7. Select **Apply selected tags**, then review the original Vault-relative note path and exact selected tags. Opening this confirmation changes nothing.
8. Select **Add tags** to confirm, or **Cancel** to close and discard this result. You can also press **Esc** or close the modal to stop before Apply starts. To confirm with the keyboard, use **Tab** to focus **Add tags**, then press **Enter**.

Already-on-note tags remain in the suggestions. No matching suggestions is a normal empty result; no existing Vault tag candidates is a separate error. If the evaluated note's metadata is unavailable or its file identity has changed, existing-tag state is shown as unknown. Switching active notes does not change the note used for the annotation. A retryable error offers **Retry**, which starts a new request only when clicked. Closing the error modal cancels a pending Retry.

Freshness warnings explain when suggestions may be based on changed or unknown note content; they still allow confirmation. If the original note or suggestions are no longer available, Apply is blocked. **Already on note** is advisory, including inline tags. Apply prevents equivalent tags already in the current frontmatter from being added again; **No tags needed to be added** is a normal result.

Manual Tag Apply is local and makes no provider request or Secret lookup. It adds only selected suggested tags through Obsidian's frontmatter API, preserving existing supported tags and unrelated fields. Once that API starts, closing or unloading the modal cannot undo the operation; it completes without automatic retry or rollback, and closed UI receives no late notification. There is no automatic Tag mutation, free-form/new Tag generation, or **Analyze again** action. Opening, selecting, and reviewing confirmation alone change no note.

### Folder Organizer Preview, Analyze, Review, and Apply

Right-click a folder in Explorer and select **Jevault: Organize notes in this folder**. Choose **This folder only** or **Include subfolders**, then select **Preview notes** to see the Markdown target count. Each preview is read-only and runs once; **Cancel**, **Esc**, or closing before Preview starts no collection. Ignored folders and the current Obsidian configuration directory are excluded; Inbox remains eligible as a source.

**Preview notes** is entirely local: no note body reads, provider requests, Secret lookups, or Vault changes. A successful non-empty Preview retains the exact target objects and order for this operation. Notes added after Preview are not included; changed, deleted, moved, or replaced targets fail safely without recollection or active-note fallback.

After Preview, **Folder suggestions** and **Tag suggestions** are both enabled by default and can be toggled independently. At least one must be enabled; otherwise **Analyze notes** is disabled with guidance to select an analysis option. Toggling options updates the disclosure locally, with no body reads, provider requests, Secret lookups, target recollection, or Vault changes. These controls configure analysis, not Review selection.

Review the selected folder, scope, count, options, and external-data disclosure, then explicitly select **Analyze notes**. One immutable options snapshot applies to the exact Preview targets for the entire sequential run. Each attempted note is read at most once. Both enabled runs Folder then Tag; Folder-only makes no Tag service/provider/Secret/candidate call, and Tag-only makes no Folder service/provider/Secret/candidate call. Disabled phases are recorded explicitly as `not-run(disabled)`, without making a successful note partial or failed.

Note titles, Vault-relative paths, and Markdown bodies may be sent to TypeSafe for enabled analysis. Folder analysis may send candidate folder paths; Tag analysis may send existing Vault Tag candidate names and optional descriptions. A disabled phase sends none of its candidate category through that phase. TypeSafe-managed credits may be used: both enabled can make up to 2 requests per fully analyzed note (1 Folder + 1 Tag), Folder-only up to 1 Folder request, and Tag-only up to 1 Tag request. Failures or cancellation may produce fewer requests; no fixed cost or credit amount is promised.

Progress shows processed/total, failed count, and current path. **Stop** requests cancellation and keeps the Modal open while in-flight work settles, then shows the cancelled summary. **Close**, **Esc**, the close button, or plugin unload cancels and disposes the UI without late results. Completed, stopped, and cancelled summaries retain truthful counts; completed does not mean every note succeeded. Analysis and results remain read-only, are kept only in operation memory, and make no Vault changes. Reopen Folder Organizer for a fresh explicit analysis; there is no automatic analysis or retry.

After a **completed** analysis, explicitly select **Review results**. Review never opens automatically; stopped/cancelled runs cannot enter Review. The exact analysis results transfer to Review before the Analyze UI closes, without recollection or re-analysis. Target-local failed notes remain visible as unavailable and have no selection controls.

Review is entirely local: no TypeSafe request, Secret lookup, note body re-read, or Vault mutation. It captures eligible existing folders, existing Vault tags, and current tags from each exact note's metadata once at entry. Missing metadata is shown as unknown. AI suggestions retain their analysis order and probabilities; stale suggestions remain visible but cannot be selected unless their exact path/name is still in the captured universe.

Use **Previous**/**Next** to review each note. Folder choices start unreviewed: explicitly select **Keep current folder**, an available AI suggestion, or **Choose another existing folder**. Keep current is always available, including Inbox, excluded folders, and Vault root. Tags also start unreviewed with all suggestions unchecked. Select suggested existing tags or use **Add existing tag**; 0..N tags are supported, with semantic duplicates prevented while preserving the selected existing spelling. Current tags are advisory; they are never automatically selected or removed. Disabled AI phases still permit manual choices. Draft choices persist across navigation.

**Finish review** requires an explicit Folder intent for every reviewable note. Failed notes do not block completion; zero reviewable notes cannot finish. Finish preserves selected tags and explicitly confirms zero tags for untouched Tag controls. It creates an immutable result in operation memory, retaining the original note source, snapshot, and separate analysis. The terminal message is **Review complete. No changes were made to your Vault.** Close/Esc/X before Finish discards the draft; closing or plugin unload clears operation memory and invalidates old handlers.

After Finish, **Apply selected changes** opens a separate read-only final confirmation. Review selection and completion grant no mutation authority. Check the exact original Vault-relative Note paths, Folder intents, selected Tags, reviewed/unavailable counts, planned moves and Tag selections. Unavailable Notes are informational and excluded from Apply. Source freshness, folder eligibility and collisions are checked again at Apply time; these reviewed intentions are not guarantees. **Cancel**, **Esc**, or X before final confirmation changes nothing.

Only **Confirm Apply** starts one local attempt through the existing Organizer Apply service. Use **Tab** to focus that button and **Enter** to confirm; repeated confirmation cannot start another attempt. The original Review session and immutable result survive navigation and remain valid until in-flight APIs settle. No TypeSafe request, Secret lookup, note body read, hash, re-analysis or target recollection occurs from Review to Apply.

Apply progress shows reviewed total, processed terminal results, failed/stale counts and the current original path. **Stop** requests cancellation once and keeps the UI open until already-started Obsidian APIs settle. **Close**, **Esc**, X or plugin unload aborts and detaches UI immediately, suppressing late feedback; ownership is cleaned up after settlement. No next mutation starts after cancellation is observed, but an already-started Tag or Move can finish.

**Tag + Move is not atomic, and partial success cannot be rolled back automatically.** The summary distinguishes completed, cancelled and stopped; completed can include failures or stale/skipped Notes. Per-Note Tag/Move phases and outcomes retain the original reviewed order and paths, including Tag success followed by Move failure or cancellation. Unavailable Notes and Notes with no terminal result receive no fabricated mutation outcome. Keep current/same-folder make no rename call, and zero selected Tags make no frontmatter call. There is no automatic Apply, retry, rollback, overwrite, auto-suffix, folder creation or Tag removal/rename.

## Privacy and external services

Jevault uses TypeSafe, a third-party service, to classify notes. When you explicitly run **Jevault: Classify current note**, **Jevault: Suggest tags for current note**, select **Retry**, or select Folder Organizer **Analyze notes**, Jevault may send the following data to the TypeSafe API:

- The analyzed note title (the active note for single-note commands, or an exact Preview target for Folder Organizer)
- The Vault-relative note path
- The full Markdown note body
- Candidate folder paths for folder classification
- Existing Vault Tag candidate names and optional Tag candidate descriptions, when present, for Tag Suggest

Plugin load, Settings display, and Suggestion UI display do not send note data. Jevault has no backend of its own and implements no telemetry, analytics, tracking, background classification, or background upload.

See [PRIVACY.md](PRIVACY.md) for details and the [TypeSafe privacy policy](https://typesafe.ai/legal/privacy-policy) for information about the separate third-party service.

## Limitations

- Desktop only
- Manual moves and Folder Organizer Apply require selection and explicit final confirmation; no automatic moves
- No filename changes, folder creation, deletion, tag removal/rename, or custom whole-note/link rewriting
- Obsidian manages standard link updates according to your preferences
- Can only suggest existing, non-excluded Vault folders
- Tag Suggest uses existing Vault tags only; Manual Tag Apply requires selection and explicit confirmation, with no automatic Tag mutation or free-form/new Tag generation
- Depends on TypeSafe API availability

## Manual installation

Build the plugin, then copy `manifest.json`, `main.js`, and `styles.css` into `<current Obsidian config directory>/plugins/jevault/` in a dedicated test vault. The default location is `.obsidian/plugins/jevault/`. Reload Obsidian and enable **Jevault** under Community plugins.

## Development

Requirements: Node.js 20.19+, 22.13+, or 24+ and npm.

```bash
npm install
npm run build
npm test
npm run typecheck
npm run lint
```

For local development, run `npm run dev` to rebuild `main.js` when source files change.

### TypeSafe integration spike

Create a local `.env.1password` containing only a 1Password Secret Reference, never a plaintext credential. The file is ignored by Git.

```dotenv
TYPESAFE_API_KEY=op://YOUR_VAULT/YOUR_ITEM/YOUR_FIELD
```

Run the explicit network integration test through 1Password CLI:

```bash
op run --env-file=.env.1password -- npm run spike:typesafe
```
