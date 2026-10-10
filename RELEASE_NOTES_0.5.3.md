# Jevault 0.5.3

This version follows published Jevault 0.1.0. Versions 0.5.0, 0.5.1 and 0.5.2 have Git tags only; none has a published GitHub Release. Version 0.5.3 is prepared for the normal tag-push workflow with the simplified GitHub Actions authentication checks. The workflow builds, attests and publishes the same three assets in one run. Actual publication and provenance verification remain pending.

## Folder Organizer and Folder/Tag suggestions

- Open Folder Organizer from a folder in Explorer. Preview that folder or include subfolders, then explicitly Analyze the captured Markdown notes.
- Enable Folder and Tag suggestions independently. Review existing destination folders and existing Vault tags for each note. Keep current folder and zero tags are valid choices.
- Finish review makes no Vault changes. Apply selected changes opens a separate final confirmation for the original notes and selected intentions.
- Only Confirm Apply starts the selected local tag additions and moves. Progress, Stop and per-note results show successful, skipped, failed and partial outcomes.
- Classify current note and Suggest tags for current note retain their separate selection and confirmation flows.

## Safety and limitations

Jevault performs no automatic organization or background analysis. It keeps the original note identity, revalidates the selected source and destination, and refuses overwrites, silent retargeting and folder creation. Tag additions preserve supported existing frontmatter and unrelated fields; tags are not removed or renamed. Frontmatter duplicate prevention is strict; inline-tag detection and Already on note annotations are advisory.

Tag + Move is not atomic. If Tag succeeds and Move fails or is canceled, Tag remains applied and the result reports partial success. There is no automatic retry or rollback for Apply. Stop prevents later work, while already-started Obsidian operations may finish. Obsidian can update links according to your settings. Other plugins, sync tools, filesystem writes and editors are outside Jevault's local mutation coordination; transaction isolation is not guaranteed.

## Requirements and privacy

Obsidian Desktop 1.11.4 or later is required. Mobile is unsupported. Folder/Tag analysis requires a TypeSafe account, network access and your own API key (BYOK), managed through Obsidian SecretStorage. Jevault settings retain only the selected secret reference. Requests reaching TypeSafe consume TypeSafe-managed credits and may incur charges; Jevault does not promise a fixed price or free credits.

Explicit analysis may send note titles, Vault-relative paths and full Markdown bodies, plus enabled folder candidate paths or existing tag candidate names and optional descriptions, to TypeSafe. See [README](README.md) and [PRIVACY](PRIVACY.md) for details.

Preview, Review and Apply are local. Apply sends no additional provider request or Secret lookup. Jevault provides no telemetry or hosted backend.

## Verification coverage

macOS Obsidian 1.14.4 verification covers the exact 0.5.3 preparation package: clean installation, enable, Settings, safe missing-key Classify/Tag errors and Organizer startup/Preview. Replacing published 0.1.0 assets preserves synthetic settings, an absent synthetic Secret reference and Markdown notes.

The 23 representative 0.5.2 cases and minimum 1.11.4 compatibility evidence are reused with their original limits because product code, dependencies, build inputs and executable bundle bytes are identical. These are bounded host/API checks with synthetic provider interfaces, not exhaustive native UI or new real-provider verification.

Windows/Linux, migration of real stored credentials, external-write races and Community Plugin updater behavior remain unverified. Real Release creation, distributed asset hashes, Artifact Attestation verification and Immutable status remain post-publication checks. Isolated GitHub CLI 2.102.0 mock success does not guarantee real publication.
