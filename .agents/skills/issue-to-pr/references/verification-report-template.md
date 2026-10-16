# Unified Verification Report Template

Use this exact structure when reporting verification results from either `codex` or `antigravity`.

```markdown
# Jevault Verification Report — Issue #<ISSUE_NUMBER>

- **Issue**: #<ISSUE_NUMBER> (<ISSUE_URL>)
- **Assigned Agent**: `<codex | antigravity>`
- **Worktree**: `<absolute-worktree-path>` (branch: `<branch-name>`)
- **Exact HEAD SHA**: `<40-char-sha>` (Tree: `<40-char-tree-sha>`)
- **PR URL**: `<PR_URL | N/A (pre-PR)>`
- **Merge Gate Status**: `<READY_TO_MERGE | BLOCKED | IN_PROGRESS>`

## 1. Local Automated Verification

| Check | Command | Result | Details / Counts |
| :--- | :--- | :--- | :--- |
| Clean install | `npm ci` | `<PASS \| FAIL \| NOT VERIFIED>` | Node `<vX.Y.Z>`, npm `<X.Y.Z>` |
| Full verify | `npm run verify` | `<PASS \| FAIL \| NOT VERIFIED>` | `<files>` files, `<tests>` tests, lint, typecheck, build, licenses, diff check |
| Public boundary | `npm run verify-public-boundary` & `node --test scripts/test-public-boundary.mjs` | `<PASS \| FAIL \| NOT VERIFIED>` | `<N>` boundary tests |
| Synthetic Vault regression | `npx vitest run` | `<PASS \| FAIL \| NOT VERIFIED>` | Unit + synthetic fixture suites |
| Release asset stage | `node scripts/prepare-release.mjs <version>` | `<PASS \| FAIL \| NOT VERIFIED \| N/A>` | `main.js` / `manifest.json` / `styles.css` SHA-256 |

## 2. Native Obsidian Acceptance

- **Executed**: `<YES | NO (NOT VERIFIED)>`
- **Isolation Method**: `<Dedicated macOS user / VM / N/A>`
- **Obsidian Version**: `<e.g., Desktop 1.14.4 / Minimum 1.11.4 / NOT VERIFIED>`
- **Summary**:
  - Clean Install / Enable / Disable / Re-enable: `<PASS | FAIL | NOT VERIFIED>`
  - Issue-specific UI / Keyboard / Confirm Apply Boundary: `<PASS | FAIL | NOT VERIFIED>`

## 3. CI & Review Alignment (Exact SHA Gate)

- **PR HEAD SHA**: `<40-char-sha | N/A>`
- **GitHub Validate CI**: `<PASS | FAIL | PENDING | N/A>` (SHA: `<sha>`)
- **GitHub Public Boundary CI**: `<PASS | FAIL | PENDING | N/A>` (SHA: `<sha>`)
- **Local Pre-Review (Orca / Agent)**: `<PASS | FAIL | N/A>` (SHA: `<sha>`, non-authoritative)
- **GitHub Codex Review**: `<PASS | CHANGES_REQUESTED | PENDING | N/A>`
  - **Reviewed Commit SHA**: `<40-char-sha | N/A>`
  - **Matches Current HEAD SHA**: `<YES | NO>` (Must be `YES` for `READY_TO_MERGE`)

## 4. Residual Risks & Unverified Items

- **VERIFIED**: `<items>`
- **NOT VERIFIED**: `<items and impact on GO/NO-GO>`
- **KNOWN LIMITATION** (only if separately accepted by owner): `<items>`
- **BLOCKER**: `<none | items>`
```
