# Implementation Plan: Automatic Git-Powered Release Notes Generator

## Problem Summary
When `npm run release` or `npm run release:pilot` is executed, `scripts/release.mjs` previously used a single hardcoded line:
`AI Pharmacy OS ${tagName} — Production Release`
Because of this, the in-app update banner on client PCs showed only that one line under "What's new in this update", leaving users and store owners without visibility into what was fixed or added.

---

## Technical Design & Strategy
1. **Automated Commit Discovery:**
   - Detect previous release tag using `git describe --tags --abbrev=0 HEAD~1` or scanning git tags.
   - Run `git log <previousTag>..HEAD --oneline --no-merges` to retrieve all commit titles since the last release.
2. **Clean Markdown Bullet Formatting:**
   - Strip commit hashes.
   - Filter out internal commits (e.g., `chore(release): bump version...`, `Merge branch...`).
   - Format cleanly as bullet points under `## What's New in <version>`.
   - Support manual overrides via `--notes "..."` CLI argument or a local `RELEASE_NOTES.md` file.
3. **Unified Publishing:**
   - Supply the rich markdown notes to:
     - GitHub Releases (`gh release create ... --notes "${releaseNotes}"` and GitHub REST API `body: releaseNotes`).
     - Vercel update server metadata (`changelog: releaseNotes`).
4. **Immediate Update for v0.1.260:**
   - Update existing GitHub release `v0.1.260` notes and the live Vercel update server metadata so currently running app instances immediately show the rich notes.

---

## Tasks & Progress Tracking

- [x] Task 1: Add auto-changelog generator function in `scripts/release.mjs`
  - *Completed:* Implemented `generateReleaseNotes(targetTagName, isPilotRelease)` in `scripts/release.mjs`. Automatically finds previous git tag, pulls commits with `git log <prevTag>..HEAD --no-merges --pretty=format:"%s"`, filters out chore/bump commits, and formats conventional commit headers into readable bold bullet points (`• **Category**: Message`).
- [x] Task 2: Wire generated notes into GitHub release creation and Vercel publish payload in `scripts/release.mjs`
  - *Completed:* Wired `releaseNotes` into both `gh` CLI flags (`--notes`) and GitHub REST API calls (`body: releaseNotes` for new releases, and `PATCH /releases/{id}` for existing releases). Added robust token resolution using local `git credential fill` before environment fallbacks. Passed `changelog: releaseNotes` in the `/api/updates?action=publish` POST body.
- [x] Task 3: Update GitHub Release `v0.1.260` and Vercel update server metadata with v0.1.260 changelog
  - *Completed:* Patched GitHub Release `v0.1.260` body via GitHub REST API with full `## What's New in v0.1.260` bullet points. Published the updated changelog to the Vercel update server (`https://website-woad-seven-26.vercel.app/api/updates?action=publish`), verified via `action=check` endpoint.
- [x] Task 4: Verify with `npm run guardrails` and update knowledge graph via `node scripts/quick-update.mjs`
  - *Completed:* Guardrails passed with clean TypeScript compilation. Knowledge graph refreshed.
