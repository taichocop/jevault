# Release checklist

This checklist applies to future releases. The existing 0.1.0 release was published before this workflow and has no retroactive attestation. Use only a dedicated, isolated test Vault for manual verification.

Readiness and release execution are separate gates. Issue #113 audits the v0.5.0 candidate without changing versions, tags, Releases, or deploying. Repository settings require separate explicit human authorization; permission to change them does not authorize release execution or accept residual risks. Issue #114 requires readiness GO on the exact candidate and fresh explicit human authorization. Never mark an unexecuted host/provider check as passed because unit tests pass; record NOT VERIFIED and its effect on GO / NO-GO.

## Automated verification

- [ ] Decide the release version and obtain human approval before creating or pushing its exact version tag. Never rerun the release path for 0.1.0.
- [ ] Run `npm ci` from the committed lockfile.
- [ ] Run `npm run verify` on the exact candidate and record its SHA, supported Node/npm versions, test totals, and results. It covers tests, lint, production build (including typecheck and licenses), and working/staged `git diff --check`; equivalent checks need not be repeated without a reason.
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] Confirm the production `main.js` passes the full third-party license notice verification (`npm run verify:licenses`); repeat the bundled-dependency license audit after dependency updates.
- [ ] Classify dependency advisories as shipped/runtime or development-only using the actual bundle boundary; record impact and unresolved risks without unrelated dependency updates.

## Metadata and documentation

- [ ] `manifest.json` and `package.json` use the same version. The release tag must equal it exactly, without a `v` prefix.
- [ ] If `minAppVersion` changed, update `versions.json` with the new version and its minimum Obsidian version. Obsidian does not require an entry for every release.
- [ ] The manifest description is 250 characters or fewer, uses correct capitalization, and ends with a period.
- [ ] `README.md` has been reviewed as end-user documentation.
- [ ] `LICENSE` exists and contains the project-owner-selected MIT License.
- [ ] `PRIVACY.md` has been reviewed.
- [ ] `SECURITY.md` has been reviewed.
- [ ] The owner confirms GitHub Private Vulnerability Reporting remains enabled for this public repository before Community Plugin submission.
- [ ] The repository's **Security → Report a vulnerability** flow is visible after Private Vulnerability Reporting is enabled.
- [ ] The TypeSafe data disclosure lists the note title, Vault-relative note path, full Markdown note body, candidate folder paths for Folder Suggest, and existing Vault Tag candidate names and optional Tag candidate descriptions for Tag Suggest, consistent with `README.md` and `PRIVACY.md`.
- [ ] `README.md` clearly discloses TypeSafe account, bring-your-own API key, network use, and payment/credit requirements.

## Safety and submission compliance

- [ ] The plugin implements no telemetry, analytics, tracking, or crash reporting.
- [ ] No secret values, tracked plaintext `.env` files, SecretStorage dumps, note-body logs, or full environment dumps are present.
- [ ] Intentional Vault mutations are limited to explicitly confirmed Manual Move, Manual Tag Apply, and Folder Organizer Apply through public Obsidian APIs. Manual Tag Apply requires exact suggested existing Tags, explicit confirmation, original `NoteSource`, and a single-use `ConfirmedTagApplyIntent`; only missing selected frontmatter Tags are added, preserving existing supported Tags and unrelated fields.
- [ ] Organizer Review/Finish review grants no mutation authority. Only the separate final **Confirm Apply** issues one single-use capability bound to the actual Vault, exact original Review session/result, selected intent, `NoteSource`, and `NoteSnapshot`; copies, stale handlers and replay fail closed.
- [ ] Manual Move, Manual Tag Apply and Organizer Apply share the Jevault-local mutation coordinator. Source/target paths and exact TFile remain leased through actual API settlement, including cancellation. Editor/other-plugin/filesystem/sync writes are not locked; no transaction isolation is promised.
- [ ] Current frontmatter semantic duplicates are strictly prevented; inline duplicates and **Already on note** are best effort/advisory. No automatic move, automatic Tag Apply, free-form/new Tag generation, or custom whole-note/body/link rewrite exists.
- [ ] Manual Tag Apply and Organizer Apply make no additional TypeSafe request or Secret lookup. Organizer Review-to-Apply performs no body read/hash, target recollection, or re-analysis.
- [ ] Command IDs do not repeat the plugin ID; they are `classify-current-note` and `suggest-tags-for-current-note`.
- [ ] The repository contains no sample code, ads, self-update behavior, dynamic remote code, or dependency auto-install behavior.
- [ ] Desktop-only metadata remains correct.

## Clean-install manual verification

- [ ] Install the production build into a dedicated test Vault.
- [ ] Enable the plugin without a runtime error.
- [ ] Open Jevault Settings and confirm the secret selector is present.
- [ ] Confirm the Command Palette contains **Jevault: Classify current note**.
- [ ] Confirm the Command Palette contains **Jevault: Suggest tags for current note**.
- [ ] Confirm a missing API key produces safe error UI without a network request.
- [ ] Disable and re-enable the plugin without a runtime error.
- [ ] Right-click a folder in Explorer and open Organizer; check This folder only / Include subfolders, exact Preview count and local-only Preview.
- [ ] Complete the Organizer checks below, including explicit final confirmation and truthful partial results.
- [ ] Compare the fixture Vault before and after testing: only explicitly confirmed Manual Move, Manual Tag Apply and Organizer Apply additions/moves, plus Obsidian-managed link updates, are expected note mutations.

## Desktop compatibility, upgrade, and provider gates

- [ ] Record exact Obsidian versions and test the production plugin on the claimed minimum (currently 1.11.4) and the current available stable Desktop. On minimum: enable, Settings/secret selector, both commands, Explorer entry, Preview, no startup/runtime API error. If incompatible, stop and propose later minAppVersion/versions mapping changes; do not silently change metadata during readiness.
- [ ] On current stable, complete a clean install and the Manual Move, Tag Apply and Organizer regressions in fresh synthetic fixtures. Classify untested Windows/Linux and external plugin/editor/sync races explicitly.
- [ ] In a dedicated synthetic Vault, enable published 0.1.0-compatible settings, replace its assets with the exact candidate, then verify settings and the selected Secret reference persist, existing commands and new Explorer entry remain available, and load/upgrade causes no automatic note mutation. Use no real credential. Record that candidate metadata is still 0.1.0 and this is not an actual 0.5.0 package upgrade.
- [ ] Obtain explicit human authorization for a bounded real TypeSafe smoke and the selected SecretStorage credential before any chargeable request. Use only synthetic notes: Classify, Tag Suggest, and Organizer Analyze with both phases (one note means up to four requests total across these actions). Do not save key values, response bodies, or note bodies in evidence. Without authorization/credential, record NOT VERIFIED and block full GO pending completion or explicit owner disposition.
- [ ] Verify actual host Plugin Disable while idle, during analysis, during Review/final confirmation before mutation, and during in-flight Tag and Move APIs. Confirm abort/disposal prevents new work, started APIs settle truthfully, leases release only after settlement, and late UI/notices remain suppressed. Calling only entry.dispose in a harness is not actual Plugin Disable evidence.

## Folder Organizer verification (isolated synthetic Vault only)

Required user flow: **Preview → Analyze → Review → Finish review → Apply selected changes → Confirm Apply → Progress / Stop → Result**.

- [ ] Explorer scope/Preview captures exact original ordered targets; no body read, Secret lookup, network or mutation occurs. Later-added targets are not included and there is no active-note fallback.
- [ ] Folder/Tag Analysis Options toggle independently, both enabled by default, and both disabled prevents work. Explicit Analyze alone reads exact target bodies and invokes only enabled provider phases with accurate data/credit disclosure.
- [ ] Analysis progress/Stop, failure and cancellation are truthful. Review is entered explicitly only from completed analysis; opening/navigating/selecting/Finish review is local and changes no notes.
- [ ] Review distinguishes current Tags, AI suggestions, and user choices. Require an explicit Folder intent per reviewable Note; 0..N existing Tags and untouched zero-Tag selections are confirmed only by Finish. Unavailable Notes are excluded.
- [ ] Apply selected changes opens a separate final confirmation with exact original paths, Folder intent, Tags/counts, unavailable count and non-atomic/partial-success warning. Cancel/Esc/X or unload before Confirm Apply causes mutation 0.
- [ ] Only final Confirm Apply starts one attempt. Repeated click/Enter and detached handlers cannot reuse confirmation; source identity/path/Markdown/mtime/size, eligible existing destination and collisions are revalidated under the shared lease.
- [ ] Exercise Tag-only, Move-only and Tag+Move; preserve supported current frontmatter and unrelated fields, add only missing selected Tags, and never overwrite, auto-suffix, create folders, remove/rename Tags or retarget notes.
- [ ] Keep-current/same-folder causes no rename; zero Tags causes no frontmatter call. A semantic duplicate is unchanged, with a post-Tag baseline still validated before Move.
- [ ] Stale/deleted/renamed/replaced sources, missing/ineligible destinations and collisions fail safely. Tag failure prevents Move. Tag success followed by Move failure/cancellation is explicit partial success, with no rollback, retry or automatic Apply.
- [ ] Stop during Tag/Move prevents subsequent mutations after cancellation is observed, while already-started APIs settle honestly under the same lease. Stop retains UI through settlement; Close/Esc/X/unload detaches immediately and suppresses late feedback without abandoning the owner early.
- [ ] Result distinguishes completed/cancelled/stopped and per-Note Tag/Move outcomes in original Review order. Completed may contain failures. Unavailable/unattempted Notes receive no fabricated mutation results.
- [ ] Apply has zero external requests, Secret lookups, body reads/hashes, re-analysis and recollection. Compare fixture changes with only final-confirmed intent and host-managed links; capture evidence without note bodies, credentials or raw provider errors.
- [ ] Record remaining VERIFIED / KNOWN LIMITATION (owner acceptance separately documented) / BLOCKER / NOT VERIFIED risks and explicit **V0.5.0 RELEASE READINESS: GO** or **NO-GO**, plus a release-notes draft. Do not label unapproved risk ACCEPTED.

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

## Manual Tag Apply verification (isolated synthetic Vault only)

- [ ] Suggestions display exact existing Tag names, match probabilities, and **Already on note** annotations when known. All suggestions start unchecked, including annotated Tags.
- [ ] Selection alone causes zero mutations. No free-form/new Tag generation or automatic Tag Apply is available.
- [ ] **Apply selected tags** opens confirmation showing the original Vault-relative note path and exact selected Tags; opening confirmation causes zero mutations.
- [ ] Cancel / Esc / Close, or plugin unload, before Apply starts causes zero mutations and discards the result.
- [ ] Explicit **Add tags** adds only missing selected suggested Tags using a core-issued, single-use confirmation for the original `NoteSource`.
- [ ] Existing supported frontmatter Tags and unrelated fields are preserved; Tag removal, rename, and arbitrary frontmatter changes are unavailable.
- [ ] A selected Tag already present in current frontmatter with equivalent ASCII case is not duplicated; when no additions remain, **No tags needed to be added** is a normal result. Inline duplicates remain best effort/advisory.
- [ ] Switching the active note keeps the original note as the mutation target; the newly active note is unchanged.
- [ ] Changed freshness displays a warning and still allows confirmation when the source and selection remain valid.
- [ ] Unknown freshness displays a warning and still allows confirmation when the source and selection remain valid.
- [ ] A moved, deleted, or replaced original source blocks Apply without retargeting or active-note fallback.
- [ ] Repeated activation while pending starts only one attempt and produces no duplicate result; a consumed confirmation cannot be replayed.
- [ ] Apply makes no additional TypeSafe request and no additional Secret lookup.
- [ ] UI feedback and logs expose no raw note body, Secret, provider response, or exception.
- [ ] Close/unload after the frontmatter API starts allows its actual result to settle without custom rollback, automatic retry, late notification, or stale UI revival.

## Release assets and publishing

- [ ] Review the read-only **Validate and release** workflow result for the PR or a manually dispatched validation run. It checks tests, typecheck, lint, production build, license notice, version metadata, the exact asset set, and SHA-256 hashes without publishing.
- [ ] Confirm the shared `scripts/require-protected-release-tags.mjs` check passes in validation and release. It uses read-only `gh api --method GET --paginate --slurp` without `--jq`, validates every page and discovered ruleset, and fails closed on missing protection, malformed responses or API errors. Ordinary `npm run verify` uses synthetic responses without network access.
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

## Existing 0.5.0 tooling failure

Issue #122 fixes the unsupported `gh api --slurp --jq` combination that stopped [the first 0.5.0 run](https://github.com/taichocop/jevault/actions/runs/38023689299). Do not rerun it or change the existing annotated tag.

**0.5.0 RECOVERY PROVENANCE: NOT ACCEPTABLE** for a new workflow-dispatch publisher using the current default build-provenance action. Dispatch records the selected workflow ref/commit; checking out the older tag does not change that identity. The [pinned action implementation](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/dist/index.js) derives `resolvedDependencies.gitCommit` from OIDC `claims.sha`, without inspecting checkout HEAD. Verifying the signer and subject hashes alone would not independently establish the exact 0.5.0 checkout as the attested source. Actual recovery attestation generation and verification are **NOT VERIFIED**; validation creates no attestation.

Recommend Option B: preserve the unpublished 0.5.0 tag and prepare a later version through the normal tag-triggered workflow after separate owner approval. This workflow has no dispatch publication mode. The final provenance decision and version/release strategy require human acceptance under #122/#114. For each future downloaded asset, use `gh attestation verify FILE --repo taichocop/jevault --signer-workflow taichocop/jevault/.github/workflows/release.yml --source-digest APPROVED_COMMIT --source-ref refs/tags/APPROVED_TAG` and compare the verified subject digest with the staged SHA-256. See [dispatch identity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch) and [GitHub CLI verification policy](https://cli.github.com/manual/gh_attestation_verify).
