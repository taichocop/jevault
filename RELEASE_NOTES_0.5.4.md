# Jevault 0.5.4

This candidate follows published Jevault 0.5.3 and includes the Folder Organizer Review keyboard shortcuts from [#139](https://github.com/taichocop/jevault/issues/139). The existing 0.5.3 tag, Release and distributed assets remain unchanged.

## Folder Organizer Review keyboard shortcuts

- Use **Tab** or **Shift+Tab** to focus the **Folder** or **Tags** section itself, shown with a focus outline, then press **1–9** for a displayed `[number]` choice.
- In **Folder**, a number selects one folder intent, replacing the previous choice. `[1]` is **Keep current folder**; subsequent numbers follow the AI folder suggestion order.
- In **Tags**, each number toggles one suggested existing tag on or off while preserving other selections. Multiple tags can be selected, and pressing the same number again deselects that tag. Focus stays in the section so several tags can be toggled in sequence.
- Keyboard and mouse controls update the same Review draft. Unavailable entries retain their displayed positions and cannot be selected. Choices beyond the first nine and the existing-folder/tag dropdowns remain available through the usual controls.
- Numbers do nothing outside a focused section, while editing a control, with modifiers, during IME composition, or on key repeat. A shortcut only changes the Review draft; it does not finish Review, confirm Apply, or modify a note.

The [#138 Dev Container](https://github.com/taichocop/jevault/pull/138) changes support development and testing. They add no intended plugin runtime feature or Release Workflow change.

TypeSafe model selection remains provider-managed: Jevault does not pin a model version. This candidate includes no explicit Jev 1.14 model migration from [#140](https://github.com/taichocop/jevault/issues/140). Image analysis and image uploads from [#141](https://github.com/taichocop/jevault/issues/141) are not implemented.

## Safety and limitations

Folder Organizer retains the **Preview → Analyze → Review → Finish review → Apply selected changes → Confirm Apply** flow. Opening Review, navigating notes, selecting folders or tags, and finishing Review make no Vault changes. Only the separate final **Confirm Apply** starts one local attempt for the original reviewed notes and exact selected intentions. Cancel, Esc, closing, or plugin unload before that confirmation changes nothing.

Jevault performs no automatic organization or background analysis. It keeps the original note identity, revalidates sources and eligible destinations, and refuses overwrites, silent retargeting and folder creation. Switching active notes does not change the mutation target. Repeated confirmation cannot start another attempt. Tag additions preserve supported existing frontmatter and unrelated fields; tags are not removed or renamed. Frontmatter duplicate prevention is strict; inline-tag detection and **Already on note** annotations are advisory.

**Tag + Move is not atomic.** If Tag succeeds and Move fails or is canceled, Tag remains applied and the result reports partial success. There is no automatic retry or rollback for Apply. **Stop** requests cancellation and keeps the UI open until already-started Obsidian operations settle; no subsequent mutation starts after cancellation is observed. Close, Esc, the close button or plugin unload detaches the UI and suppresses late feedback, while already-started operations may still finish. Completed results can include failed, stale or skipped notes.

Obsidian can update links according to your settings. Other plugins, sync tools, filesystem writes and editors are outside Jevault's local mutation coordination; transaction isolation is not guaranteed.

## Requirements, costs and privacy

Obsidian **Desktop 1.11.4 or later** is required. Mobile is unsupported. Folder/Tag analysis requires a TypeSafe account, network access and your own API key (**BYOK**), managed through Obsidian SecretStorage. Jevault settings retain only the selected secret reference, not the key value.

Explicit classification, Tag Suggest, Folder Organizer **Analyze notes**, or **Retry** may send the analyzed note's title, Vault-relative path and full Markdown body to TypeSafe. Folder analysis may also send candidate folder paths; Tag analysis may send existing Vault tag candidate names and optional descriptions. Disabled Organizer analysis phases send none of their corresponding candidate data through that phase. See [README](README.md) and [PRIVACY](PRIVACY.md) for details.

Requests reaching TypeSafe consume TypeSafe-managed credits and may incur charges. With both Organizer analysis phases enabled, each fully analyzed note can make up to two requests: one Folder request and one Tag request. A single enabled phase can make up to one request per fully analyzed note; failures or cancellation may produce fewer. Jevault does not promise a fixed monetary cost, credit amount or free credits. TypeSafe controls its pricing and promotional terms.

Preview, Review and Apply are local. Review-to-Apply performs no additional provider request, Secret lookup, note body read/hash, re-analysis or target recollection. Jevault provides no telemetry or hosted backend, and does not send note data when loading the plugin, showing Settings or displaying suggestion UI.

## Verification coverage

Local 0.5.4 preparation passed a fresh `npm ci` and `npm run verify` with Node.js 24.19.0 and npm 10.9.2: 54 test files and 1,679 tests, seven Public Boundary regression cases, ESLint, TypeScript typecheck, production build, TypeSafe SDK license verification and diff checks. The exact three production assets were staged and their fresh SHA-256 digests and version metadata were checked. These are local preparation results, not formal Release GO. PR #144's initially committed HEAD also passed GitHub Validate and Public Boundary CI, with the non-tag release job skipped as intended. The latest PR HEAD and final merged exact SHA require their own applicable checks before Tag Push; native Obsidian acceptance for this 0.5.4 candidate remains NOT VERIFIED. Published 0.5.3 hashes or PASS results were not used as this candidate's results.

GitHub CLI 2.102.0 validation passed 30 negative cases and 16 lifecycle cases against isolated, non-forwarding loopback fixtures. It preserved the annotation bytes and made zero real GitHub writes. This does not verify publishing credentials or generate an Artifact Attestation.

The unchanged dependency graph has three npm audit findings (two moderate and one high), all in development dependencies. The affected packages are not included in the distributed plugin bundle; no dependency update or acceptance of residual risk is implied by this preparation.

Earlier macOS Obsidian 1.14.4 acceptance covers the #139 keyboard/mouse changes at the tested revision. Native Obsidian clean-install, upgrade and keyboard acceptance of this 0.5.4 candidate are **NOT VERIFIED**. Minimum 1.11.4 compatibility, current stable Desktop checks, upgrade from published 0.5.3, and the Review/final-confirmation safety boundary still require candidate-specific host verification. Unit tests with fakes and synthetic fixtures, or file-copy integrity checks, do not establish native Obsidian installation, upgrade or updater behavior.

File-level checks in fresh synthetic fixtures confirmed exact candidate asset copies and replacement of downloaded 0.5.3 assets, with synthetic settings, an absent synthetic Secret reference and Markdown files preserved. Obsidian was not launched for these checks; they do not claim plugin enablement or a native upgrade test.

Windows/Linux, native IME and keyboard-layout behavior, theme-specific focus/layout behavior, real stored-credential migration, external-write races and Community Plugin updater behavior remain unverified for this candidate. No new real TypeSafe provider smoke is claimed. Automated tests with synthetic provider interfaces do not establish real provider behavior or charges.

After publication, independently verify the exact three distributed attachments, **main.js**, **manifest.json** and **styles.css**, their SHA-256 digests, Artifact Attestations, signer workflow and exact approved source commit/tag, the required TypeSafe SDK license notice, and GitHub Release **Immutable** status. A successful publishing workflow or isolated GitHub CLI mock alone does not replace these checks or the clean-install checks using the downloaded assets.
