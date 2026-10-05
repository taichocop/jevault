# Issue #33 verification

Date: 2026-09-23. Base: `0a8a8bd47ba88c318323ba3651aa453741134d9f`.

The original evidence below predates the final audit. Its fake Scope coverage missed F01 (modified native button activation). The **F01 follow-up** at the end supersedes the original production-E2E limitation and test counts; historical PASS rows must not be interpreted as native keyboard coverage before that fix.

## Architecture and API decision

`NoteService` captures `NoteSource` before awaiting `Vault.read`. The source contains the original Vault-relative path and a private in-memory reference to the original `TFile`. The classification result carries that identity without the note body or credentials. The classifier receives the existing `NoteState`, without the identity object.

`SuggestionModal` renders and handles input. `SuggestionSession` owns the common selection/confirmation state. `NoteMoveService` validates the displayed destination, source identity, folder type, path, same-folder case, and collisions, then invokes the sole mutation API. `main.ts` only wires these dependencies. The session can submit once; the shared service also locks involved source/target paths while pending.

Installed `obsidian@1.13.1` typings and the current [official API declaration](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) identify `FileManager.renameFile` as the supported move/rename API that updates links according to user preferences. `Vault.rename` explicitly points to it for link updates. The [official plugin checklist](https://docs.obsidian.md/oo/plugin) recommends `normalizePath`, type checks, and Vault APIs over Adapter APIs. No direct filesystem/Adapter mutation or custom link rewriting is added.

Path construction is centralized. Unsafe or noncanonical paths are rejected rather than interpreted as a different destination; root, nested, and Japanese paths are covered. Runtime suggestions exclude the Vault root as before. If the root is explicitly provided as a candidate, the move boundary handles it.

## Acceptance criteria

Every row below maps to one Issue #33 acceptance criterion. “Automated” means network-free tests and/or direct source/diff inspection; Desktop evidence is identified separately below.

| Criterion | Result / evidence |
| --- | --- |
| Click candidate selection | PASS — automated and Desktop |
| Number-key selection | PASS — automated and Desktop |
| Candidate numbers visible | PASS — automated and Desktop |
| Click/number share selection flow | PASS — both call `selectCandidate`; same confirmation verified |
| Undisplayed numbers ignored | PASS — automated; Desktop invalid `4` caused no move |
| Editable focus ignored | PASS — automated |
| Selection alone cannot mutate | PASS — automated and Desktop, all fixture hashes checked before confirmation |
| Explicit confirmation before move | PASS — automated and Desktop |
| Cancel/Close cannot start move | PASS — automated; Desktop Cancel and Esc |
| Only confirmation starts move | PASS — automated and Desktop |
| Clear success feedback | PASS — Desktop `Moved to Projects` |
| Retain classified source identity | PASS — capture before read; path + object identity |
| Active-note switch cannot move wrong note | PASS — automated and Desktop A/B fixture |
| Renamed/moved/deleted source fails | PASS — automated |
| No active-file fallback | PASS — move boundary has no workspace dependency |
| Only displayed candidates accepted | PASS — automated |
| Recheck destination existence | PASS — automated |
| Require TFolder | PASS — automated |
| Do not create folders | PASS — boundary exposes no folder creation API |
| Preserve filename/extension | PASS — automated uppercase/Japanese fixture; Desktop |
| Already-in-folder is no-op | PASS — automated, dedicated feedback, zero API calls |
| No overwrite when target exists | PASS — automated file/folder/case conflicts; Desktop collision hashes unchanged |
| Never delete existing target | PASS — no delete API; Desktop target unchanged |
| No automatic rename/suffix | PASS — target uses captured filename only |
| Safe conflict message | PASS — automated and Desktop |
| No direct fs mutation | PASS — production source inspection |
| No direct Adapter mutation | PASS — production source inspection |
| Supported Obsidian API | PASS — installed and official declarations; Desktop 1.13.7 |
| Follow path normalization guidance | PASS — centralized `normalizePath` with strict validation |
| Modal does not operate Vault API | PASS — source inspection |
| TypeSafeAdapter has no move responsibility | PASS — unchanged |
| ClassificationService has no mutation detail | PASS — only adds source identity to result |
| Dedicated move application boundary | PASS — `NoteMoveService` |
| Repeated confirm does not duplicate | PASS — automated pending click/Enter and cross-session locks |
| Cancel/unload before start prevents mutation | PASS — automated, including final pre-API cancellation check |
| Completed suggestion cannot be reused | PASS — automated stale callbacks and reopen |
| No unhandled move rejection | PASS — automated boundary failure and late resolve/reject after close/unload |
| No extra TypeSafe request for move | PASS — integrated fake-classifier call count remains one; boundary has no classifier dependency |
| No API key in move state | PASS — source inspection and integrated privacy assertion |
| No note body in move UI/log | PASS — source inspection and integrated privacy assertion |
| No telemetry | PASS — source/dependency inspection |
| README matches manual move behavior | PASS — updated |
| Remove obsolete read-only/no-manual-move contract | PASS — tracked product/security/review documentation updated |
| Explicitly document no automatic move | PASS — README/SECURITY/AGENTS |
| Document required confirmation | PASS — README/SECURITY |
| Synchronize security/release docs | PASS — SECURITY/PRIVACY/RELEASE_CHECKLIST/AGENTS |
| Existing tests pass | PASS — full ordinary suite |
| New move regression tests pass | PASS — 66 new cases |
| Typecheck | PASS |
| Lint | PASS |
| Build | PASS |

## Desktop manual verification

Obsidian Desktop 1.13.7, separate synthetic Vault, no real user notes. A temporary fixture plugin bundles the production `NoteService`, `ClassificationService`, `ClassificationCommand`, `SuggestionSession`, `SuggestionModal`, and `NoteMoveService`. The classifier/credential providers are synthetic and perform no network requests. The active-note-switch fixture opens B after classifying A and before displaying A's suggestions. This is not a real TypeSafe end-to-end test or a production-plugin installation test.

- Clicked candidate #1, inspected source/destination/target, verified no file/hash changed, then Cancel.
- Classified again, pressed `1`, verified the same confirmation as click, then Esc. Original remained unchanged.
- Enter before selection and an invalid number did not move.
- Classified `Inbox/keyboard-move.md`, pressed `2`, inspected confirmation, pressed Enter. Only `Projects/keyboard-move.md` appeared; original path disappeared; SHA-256, filename, extension, and frontmatter were preserved.
- Classified `Inbox/switch-source.md`, switched the workspace to `Inbox/switch-other.md` through the fixture hook, selected Projects and clicked Move. Only the original source moved; active B remained at its path with its original hash.
- Attempted `Inbox/collision.md` → `Projects/collision.md`. A safe conflict notice appeared. Both source and pre-existing target remained at their original paths with unchanged SHA-256 hashes.
- Reloaded the fixture with the final scoped stylesheet and inspected the actual suggestion screen: separate full-width buttons, clear vertical gaps, visible shortcuts, and native focus indication.

At this initial fixture run: NOT VERIFIED — real TypeSafe classification plus manual move in the final production plugin. Superseded by the production audit and F01 follow-up below.

NOT VERIFIED — Desktop source/destination disappearance, repeated pending confirmations, editable focus, close/unload races, and standard link updates. These lifecycle/failure cases are covered by deterministic unit tests where listed above; no Desktop coverage is claimed for them. Desktop long-path wrapping across themes is not verified.

NOT VERIFIED — atomic behavior against external filesystem/sync changes after calling Obsidian's API. Jevault performs synchronous final validation and no overwrite fallback; the API exposes no abort, compare-and-move, or exclusive-create parameter. Once called, completion and standard link updates are owned by Obsidian. No custom rollback is attempted.

## Click versus number-key assessment

Both were exercised against the same first candidate and reached the same confirmation. Click provides direct spatial selection; numbered keys reduce pointer movement and make `2` then Enter quick. Both retain a visible review step with the three paths. Candidate spacing was widened following owner feedback; neither input method was removed.

## Validation and scope

- `npm test`: PASS, 17 files / 199 tests (including 66 new move cases), no real API/network.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `npm run verify:licenses`: PASS, full TypeSafe notice retained.
- `git diff --check`: PASS.
- No dependency or lockfile changes; no background/automatic behavior, folder creation, filename generation, deletion, telemetry, or new external data flow.
- Production mutation is limited to `FileManager.renameFile` in `NoteMoveService`.
- No release, tag, public-repository change, or Obsidian submission performed.

## F01 follow-up — modified native activation

Date: 2026-09-23. Defective HEAD: `20d3c2808ebeaeedc49a3b73d489a50bf011696d`. Code-fix commit: `4465e0212852b477d5f297273500824e4c1927fd` (subsequent documentation-only commits use the same production assets).

### Finding, fix, and regression

F01 (P2) was reproduced in production Obsidian 1.13.7: select a candidate, leave Move focused, press Ctrl+Enter, and the note moves. A modifier-specific native button click bypassed the unmodified Enter Scope handler. The click handler checked click count but not modifier flags. The old fake Scope invoked handlers directly and did not model native activation.

The minimal fix reuses `hasModifier` at the Move click boundary. Its parameter accepts the four modifier fields shared by KeyboardEvent and MouseEvent/PointerEvent, including keyboard-generated clicks. Modified activation returns before `confirmMove`; existing ordinary Enter, ordinary click, double-click, session phase, and shared lock behavior are unchanged. No changes to move/identity/classification/provider/Secret services or dependencies.

The fake DOM now forwards optional modifier flags to the real button listener. Four new cases (Ctrl/Alt/Meta/Shift) focus Move with an existing confirmation, invoke native keyboard-equivalent `detail=0` and pointer `detail=1` clicks, assert zero rename calls, no notification, and an open/nonpending confirmation, then verify an ordinary click still moves exactly once. **All four cases failed against the old production source and passed after the fix.** Existing ordinary Enter, number shortcuts, editable/repeat/composition guards, double-click, pending click+Enter, stale session, and shared-lock tests remain passing.

### Production Desktop regression

Only the existing isolated synthetic Vault `jevault-issue29-sxt873et` was used. Latest production `main.js`, `manifest.json`, and `styles.css` were byte-compared with the checkout build, then Jevault was disabled/enabled in the real host before testing. No fake classifier was used. Real TypeSafe credentials were resolved only by the production SecretService through Obsidian SecretStorage. No credential values, request bodies, or provider responses were captured.

Production main.js SHA-256: `76c83a97dd4f56624f8df8c63e09c8a5f59b9e8f35a9ab7d79fd91897ccf175d`.

| Scenario | Observed result |
| --- | --- |
| Real TypeSafe classification → `1` → confirmation | PASS; exact source/destination/target shown, Move focused |
| Ctrl+Enter | PASS; confirmation remains, zero rename calls |
| Alt+Enter | PASS; confirmation remains, zero rename calls |
| Meta+Enter | PASS; confirmation remains, zero rename calls |
| Shift+Enter | PASS; confirmation remains, zero rename calls |
| Ctrl+Space | PASS; no move observed (OS shortcut handling is not redefined) |
| Integrity after all modified inputs | PASS; all 10 Markdown paths/hashes unchanged, target absent |
| Plain Enter after modified inputs | PASS; `Inbox/f01-enter.md` → `Projects/f01-enter.md` exactly once |
| Active A → B switch | PASS; after classifying A, opened B through the host workspace API; ordinary Enter moved A only, B unchanged |
| Candidate click → Cancel | PASS; source hash/path unchanged, target absent |
| Reclassify → candidate click → ordinary Move click | PASS; `Inbox/f01-click.md` → `Projects/f01-click.md` exactly once |
| Final Vault integrity | PASS; only those two paths moved, filename/extension unchanged, no note-content changes |
| Additional network for moving | PASS; after first classification and all modifiers: classify/Secret/HTTP=1 each, rename=0; after plain Enter: counts still 1 each, rename=1; final totals classify/Secret/HTTP=3 each, rename=2 |

Both moved synthetic notes had the same before/after SHA-256: `5d8b56e83d2100e8b7d44c1fc3fafc69b0d0dc92b27c63c7cd0312092a344dcf`. Counters transparently delegated to production methods, retained only counts and synthetic relative paths, and were removed after testing.

### Evidence reusable by Issue #29

The pre-fix final production audit at `20d3c2808e` also verified real TypeSafe → Cancel, ordinary Enter move with unchanged SHA-256, A→B exact-note identity, existing-target rejection with both hashes unchanged, no additional Secret/classifier/adapter/HTTP calls, and Obsidian standard link updates. With `alwaysUpdateLinks=false`, the standard prompt's update-once action updated one synthetic backlink; the setting stayed false. Scoped suggestion spacing was observed at 12px.

This follow-up reruns the UI paths affected by F01, including wrong-note prevention and complete note-hash comparison. Collision and link-update production evidence remains attributed to the earlier HEAD; those unchanged services were not redundantly retested in Desktop. Full automated collision/lifecycle regressions pass. Desktop pending unload/races, every theme, and external filesystem atomicity remain unverified as stated above.

Issue #29 should incorporate both dated evidence sets and the reviewed final commit. Its old suggestion-only immutability criterion becomes: classification/cancel/modified input changes nothing; only explicit confirmation may move the exact note and allow Obsidian-owned link updates. Preserve its other release/lifecycle gates. Neither Issue #29 nor Issue #33 was closed by this verification.

### Updated validation

- `npm test`: PASS, **17 files / 203 tests**, including **70 manual-move cases**, network-free.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:licenses`, `git diff --check`: PASS.
- No dependency/lockfile change, new mutation path, new external data flow, rollback, retry, or automatic behavior.
- PR #34 remains Draft. Fresh Code Review and Security Review are requested on the final pushed HEAD; their live status is recorded in the PR conversation, not assumed from the earlier review.
