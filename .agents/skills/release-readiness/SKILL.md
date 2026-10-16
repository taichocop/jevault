---
name: release-readiness
description: Evaluate Jevault Release Readiness (GO / NO-GO) and enforce separate human approval gates for preparation, merge, tag push, and release publication.
---

# Release Readiness & Publication Gate

Follow `RELEASE_CHECKLIST.md` as the single source of truth for release criteria.

## 1. Strict Separation of Authorization Gates

Each gate requires separate, explicit owner authorization. Earlier approval never implies later approval:

1. **Release Preparation Gate**: Version bump (`manifest.json`, `package.json`, `versions.json` if needed), release notes, and local verification.
2. **PR & Merge Gate (`READY_TO_MERGE` → Human Merge)**: CI (`Validate and release`, `Public Repository Boundary`) and GitHub Codex Review must pass on the exact PR `HEAD` SHA.
3. **Readiness Evaluation Gate (`RELEASE READINESS: GO` vs `NO-GO`)**:
   - Audited on the exact merged `main` commit SHA.
   - Verify staged asset hashes (`node scripts/prepare-release.mjs <version>`), third-party licenses (`npm run verify:licenses`), public boundary (`npm run verify-public-boundary`), and GitHub CLI mock release lifecycle (`npm run test:release-workflow`).
   - Explicitly classify every item in `RELEASE_CHECKLIST.md` as `VERIFIED`, `NOT VERIFIED`, `KNOWN LIMITATION` (only if separately accepted by the owner), or `BLOCKER`.
   - Any unexecuted native Obsidian check or unaccepted residual risk keeps formal status at **NO-GO** (or blocked pending owner disposition).
4. **Tag Push & Release Publication Gate**:
   - Never create or push a version tag, and never trigger release publication, without both **RELEASE READINESS: GO** on the exact `main` SHA and **fresh explicit human approval**.
   - Confirm tag protection rulesets (`scripts/require-protected-release-tags.mjs`) and release immutability prerequisites in `RELEASE_CHECKLIST.md` before tag push.
   - Preserve all published immutable releases and tags (e.g., `0.5.3`, `0.5.0`, `0.1.0`).
