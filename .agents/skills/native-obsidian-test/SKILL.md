---
name: native-obsidian-test
description: Run isolated Native Obsidian Desktop acceptance tests for Jevault without touching personal Obsidian profiles, Vaults, or credentials.
---

# Native Obsidian Acceptance Testing

Follow `RELEASE_CHECKLIST.md` (**Clean-install manual verification**, **Desktop compatibility, upgrade, and provider gates**, and **Folder Organizer / Manual move / Manual Tag Apply verification**). Never mark a check as `PASS` based on unit tests or file copies alone; unexecuted host checks must be reported as `NOT VERIFIED`.

## 1. Zero-Interference Isolation Requirement

Obsidian Desktop on macOS (`1.14.x`) ignores `--user-data-dir` and reads `~/Library/Application Support/obsidian/obsidian.json`, reopening personal Vaults marked `open: true`.

- **Never** launch Obsidian under the owner's personal macOS session while personal Vaults are registered, and **never** move, edit, or back up the owner's personal `~/Library/Application Support/obsidian` profile.
- Execute Native Obsidian acceptance only inside one of the following isolated environments after owner approval:
  1. **Dedicated macOS Test User** (e.g., `jevault-test`) with its own `$HOME`, isolated `~/Library/Application Support/obsidian`, and synthetic fixture Vaults only.
  2. **Dedicated macOS VM** (e.g., Tart / UTM) containing no personal Vaults or credentials.

## 2. Candidate Staging & Synthetic Fixture Setup

1. Build and stage release assets from the exact target SHA:
   ```bash
   npm ci
   npm run verify
   node scripts/prepare-release.mjs <version>
   ```
2. Verify `release-assets.sha256` digests (`main.js`, `manifest.json`, `styles.css`).
3. Create a fresh synthetic Vault in the isolated test environment and copy only `release-assets/{main.js,manifest.json,styles.css}` into `<synthetic-vault>/.obsidian/plugins/jevault/`.
4. Use synthetic Markdown notes and absent/synthetic Secret references by default. Never make real TypeSafe network requests unless separately authorized with a bounded test budget (`RELEASE_CHECKLIST.md` provider gate).

## 3. Execution & Post-Test Audit

1. Execute the target acceptance items from `RELEASE_CHECKLIST.md` (clean install, enable/disable/re-enable, settings secret selector, commands, Explorer Organizer Preview/Review/Confirm Apply boundary, keyboard shortcuts `#139`, light/dark theme focus, upgrade from prior release).
2. Compare the synthetic Vault before and after testing (`find` / `shasum -a 256` / `git status` in fixture):
   - Preview, Review navigation, keyboard `1–9` selection, `Finish review`, and cancelled confirmation must produce **0 Vault mutations**.
   - Only explicitly confirmed `Confirm Apply` / Manual Move / Manual Tag Apply actions may mutate target synthetic notes.
3. Terminate the isolated Obsidian process and clean up temporary synthetic fixtures.
