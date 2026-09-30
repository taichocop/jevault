# Release checklist

This checklist applies to future releases. The existing 0.1.0 release was published before this workflow and has no retroactive attestation. Use only a dedicated, isolated test Vault for manual verification.

## Automated verification

- [ ] Decide the release version and obtain human approval before creating or pushing its exact version tag. Never rerun the release path for 0.1.0.
- [ ] Run `npm ci` from the committed lockfile.
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] Confirm the production `main.js` passes the full third-party license notice verification (`npm run verify:licenses`); repeat the bundled-dependency license audit after dependency updates.

## Metadata and documentation

- [ ] `manifest.json` and `package.json` use the same version. The release tag must equal it exactly, without a `v` prefix.
- [ ] If `minAppVersion` changed, update `versions.json` with the new version and its minimum Obsidian version. Obsidian does not require an entry for every release.
- [ ] The manifest description is 250 characters or fewer, uses correct capitalization, and ends with a period.
- [ ] `README.md` has been reviewed as end-user documentation.
- [ ] `LICENSE` exists and contains the project-owner-selected MIT License.
- [ ] `PRIVACY.md` has been reviewed.
- [ ] `SECURITY.md` has been reviewed.
- [ ] GitHub Private Vulnerability Reporting is enabled after the repository becomes public and before Community Plugin submission.
- [ ] The repository's **Security → Report a vulnerability** flow is visible after Private Vulnerability Reporting is enabled.
- [ ] The TypeSafe data disclosure lists the note title, Vault-relative note path, full Markdown note body, and candidate folder paths.
- [ ] `README.md` clearly discloses TypeSafe account, bring-your-own API key, network use, and payment/credit requirements.

## Safety and submission compliance

- [ ] The plugin implements no telemetry, analytics, tracking, or crash reporting.
- [ ] No secret values, tracked plaintext `.env` files, SecretStorage dumps, note-body logs, or full environment dumps are present.
- [ ] The only intentional Vault mutation is an explicitly confirmed manual move through Obsidian; no automatic move or custom content rewrite exists.
- [ ] Command IDs do not repeat the plugin ID; the classification command ID is `classify-current-note`.
- [ ] The repository contains no sample code, ads, self-update behavior, dynamic remote code, or dependency auto-install behavior.
- [ ] Desktop-only metadata remains correct.

## Clean-install manual verification

- [ ] Install the production build into a dedicated test Vault.
- [ ] Enable the plugin without a runtime error.
- [ ] Open Jevault Settings and confirm the secret selector is present.
- [ ] Confirm the Command Palette contains **Jevault: Classify current note**.
- [ ] Confirm a missing API key produces safe error UI without a network request.
- [ ] Disable and re-enable the plugin without a runtime error.
- [ ] Compare the fixture Vault before and after testing: only explicitly confirmed moves and Obsidian-managed link updates are allowed.

## Manual move verification (isolated synthetic Vault only)

- [ ] Clicking a numbered candidate and pressing its number select the same candidate and show source, destination folder, and target path; selection alone does not move.
- [ ] Invalid numbers, modifier shortcuts, key repeat, and editable focus do not trigger selection.
- [ ] Enter before selection does not move; Enter after selection explicitly confirms.
- [ ] Cancel / Esc / Close before confirmation do not move.
- [ ] Explicit confirmation moves the exact classified note, even after switching the active note.
- [ ] Filename, extension, and content hash are preserved for a fixture without links requiring Obsidian updates.
- [ ] Collision (including case-equivalent names) does not overwrite or auto-rename either note.
- [ ] Source deletion, rename, move, or replacement at the same path fails safely.
- [ ] Destination disappearance or replacement by a file fails safely without folder creation.
- [ ] Already-in-folder produces feedback and zero move calls.
- [ ] Repeated Move / Enter while pending executes once; completed suggestions cannot be reused.
- [ ] Unload before move prevents mutation; Close/unload after API start causes no rollback or stale UI.
- [ ] Manual selection/confirmation/move makes no new TypeSafe request.
- [ ] Compare click and number-key flows; retain both for project-owner UX review.
- [ ] Verify supported Obsidian collision behavior for on-disk conflicts and external changes around the API call.

## Release assets and publishing

- [ ] Review the read-only **Validate and release** workflow result for the PR or a manually dispatched validation run. It checks tests, typecheck, lint, production build, license notice, version metadata, the exact asset set, and SHA-256 hashes without publishing.
- [ ] Before pushing the approved release tag, the repository owner opens **Settings → Rules → Rulesets** and confirms the applicable tag ruleset is active, covers all tags (`~ALL`), has no ref exclusions, restricts tag updates and deletions, and has an empty bypass list. Only then push the tag. The release job checks the machine-readable target, enforcement, coverage, exclusions, and restrictions; the empty bypass list is an owner-controlled release prerequisite, not an automated check. Repository administrators and ruleset editors are trusted release-configuration operators. See [GitHub tag rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).
- [ ] Before pushing the approved release tag, the owner audits every actor and credential able to create tags, including collaborators with write access, GitHub Apps, automation tokens, and write-enabled deploy keys. Only trusted release operators or approved automation may retain tag-creation access. The tag ruleset above restricts updates and deletions, not initial creation; any tag creator can trigger the release job. See [GitHub deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys).
- [ ] Before pushing the approved release tag, the owner enables **Settings → Releases → Enable release immutability** and confirms that only trusted release operators and apps can edit Releases during draft creation and asset upload. Immutability protects assets only after publication; the protected tag covers tag updates during the draft window. This setting applies to future releases, not the existing 0.1.0 release. See [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).
- [ ] Confirm `styles.css` is still required for suggestion spacing and button layout; verify candidate spacing and long-path wrapping in the test Vault.
- [ ] Perform final diff, dependency, secret, Vault-mutation, and scope reviews before publishing. Obtain explicit human approval for the new tag push.
- [ ] Push the approved plain version tag pointing to a commit on `main`. The tag-triggered workflow rebuilds with `npm ci`, validates `main.js`, `manifest.json`, and `styles.css`, attests those exact files, and creates the GitHub Release with the same staged bytes. Do not upload assets manually.
- [ ] Confirm the GitHub Release has exactly these three binary attachments and compare their SHA-256 digests with the workflow's recorded hashes.
- [ ] Confirm the published Release shows **Immutable** before treating its attachments as protected from later replacement.
- [ ] Download each asset and verify provenance with `gh attestation verify FILE --repo taichocop/jevault --signer-workflow taichocop/jevault/.github/workflows/release.yml`.
- [ ] Confirm the released `main.js` retains the required TypeSafe SDK license notice.
- [ ] Install the Release attachments in an isolated Obsidian Vault and complete the clean-install checks above.
