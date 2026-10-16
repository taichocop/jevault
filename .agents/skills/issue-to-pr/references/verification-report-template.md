# Unified Verification Report Template

Use this exact structure when reporting verification results from either `codex` or `antigravity`. When posting to public GitHub Issues or PRs, omit private absolute filesystem paths and internal runtime secrets per `AGENTS.md`.

```markdown
# Jevault Verification Report — Issue #<ISSUE_NUMBER>

- **Issue**: #<ISSUE_NUMBER> (<ISSUE_URL>)
- **Implementation Agent**: `<codex | antigravity>`
- **Worktree Identifier**: `<worktree-name>` (branch: `<branch-name>`)
- **Exact HEAD SHA**: `<40-char-sha>` (Tree: `<40-char-tree-sha>`)
- **PR URL**: `<PR_URL | N/A (pre-PR)>`
- **Merge Gate Status**: `<READY_TO_MERGE | BLOCKED | IN_PROGRESS>` (Requires separate explicit human approval to merge)

## 1. Local Automated Verification

| Check | Command | Result | Details / Counts |
| :--- | :--- | :--- | :--- |
| Clean install | `npm ci` | `<PASS \| FAIL \| NOT VERIFIED>` | Node `<vX.Y.Z>`, npm `<X.Y.Z>` |
| Full verify | `npm run verify` | `<PASS \| FAIL \| NOT VERIFIED>` | `<files>` files, `<tests>` tests, lint, typecheck, build, licenses, diff check |
| Public boundary | `node scripts/verify-public-boundary.mjs` & `node --test scripts/test-public-boundary.mjs` | `<PASS \| FAIL \| NOT VERIFIED>` | `<N>` boundary tests |
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

- **Current PR HEAD SHA**: `<40-char-sha | N/A>`
- **GitHub Validate CI**: `<PASS | FAIL | PENDING | N/A>` (SHA: `<40-char-sha>`)
- **GitHub Public Boundary CI**: `<PASS | FAIL | PENDING | N/A>` (SHA: `<40-char-sha>`)
- **Review Record**:
  - **Review Provider**: `<Codex | Antigravity | Other>`
  - **Review Mode**: `<GitHub | Independent Agent>`
  - **Reviewer Session / Execution Record**: `<GitHub review URL or independent Orca worker / CLI session identifier, distinct from implementer session>`
  - **Fallback Reason (if Independent Agent used instead of GitHub Codex Review)**: `<N/A (GitHub Codex Review used) | GitHub Codex Review quota/usage limit | GitHub Codex Review service outage>`
  - **Reviewed Commit SHA**: `<40-char-sha | N/A>`
  - **Current PR HEAD SHA**: `<40-char-sha | N/A>`
  - **SHA Match (`Reviewed Commit SHA === Current PR HEAD SHA`)**: `<YES | NO>` (Must be `YES` for `READY_TO_MERGE`)
  - **Findings & Resolution Status**: `<None | Severity-tagged findings and fix commit SHAs>`
  - **Review Result**: `<PASS | FINDINGS | NOT VERIFIED>`

## 4. Merge Gate Checklist (`READY_TO_MERGE`)

- [ ] Implementation satisfies Issue Acceptance Criteria
- [ ] Local verification is `PASS` on current `HEAD` SHA
- [ ] GitHub Actions CI (`validate`, `public-boundary`) is `PASS` on current PR `HEAD` SHA
- [ ] GitHub Codex Review or Independent Agent Review (in a separate reviewer session) is `PASS` on current PR `HEAD` SHA
- [ ] Zero unresolved blocking/material findings
- [ ] Secret, Privacy, Vault Mutation, and Public Boundary audits completed

## 5. Residual Risks & Unverified Items

- **VERIFIED**: `<items>`
- **NOT VERIFIED**: `<items and impact on GO/NO-GO>`
- **KNOWN LIMITATION** (only if separately accepted by owner): `<items>`
- **BLOCKER**: `<none | items>`
```
