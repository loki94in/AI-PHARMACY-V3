# Implementation Plan: Automated Release Cloud Publishing & In-App Update Notification

## 1. Goal
Ensure that running `npm run release` automatically builds, uploads assets to GitHub Releases, and publishes the version metadata to the Vercel update registry, so all existing client installations (including `v0.1.134`) immediately notice and receive the update without requiring manual multi-step CLI flags.

## 2. Root Cause & Solution Design
1. **Root Cause**: `scripts/release.mjs` defaulted `isRemote = false` unless `--remote` or `git vercel` was explicitly supplied. Furthermore, `--skip-build` still incremented `pkg.version` before locating the on-disk installer, causing a mismatch (`0.1.136` expected vs `0.1.135` on disk).
2. **Solution**:
   - Update `scripts/release.mjs` to auto-detect `--skip-build` and disable version bumping (`shouldBump = false`).
   - Default `isRemote = true` when `ADMIN_SECRET` is present in the environment/`.env`, unless `--local` is explicitly passed.
   - Restore `package.json` to `0.1.135` and publish the existing verified `v0.1.135` installer and update package to GitHub and Vercel.
   - Verify that querying the update check endpoint for `v0.1.134` returns `hasUpdate: true` with `latestVersion: "0.1.135"`.

## 3. Step-by-Step Plan
- [x] Step 1: Restore `package.json` to version `0.1.135`.
- [x] Step 2: Update `scripts/release.mjs` to make remote publishing default (with `--local` opt-out) and auto-suppress bumping on `--skip-build`.
- [x] Step 3: Publish `v0.1.135` to GitHub Releases and Vercel Update Server.
- [x] Step 4: Verify the live update check API returns `v0.1.135` for `v0.1.134`.
- [x] Step 5: Run performance guardrails (`npm run guardrails`) and synchronize the knowledge graph (`node scripts/quick-update.mjs`).

---

## 4. Completed Tasks Log
- **Default Remote Publishing Configured**: In `scripts/release.mjs`, configured `isRemote` to default to `true` whenever `ADMIN_SECRET` is available (with `--local` opt-out). Whenever `npm run release` is run, it will automatically build and publish to GitHub Releases and Vercel update registry in a single step.
- **Smart `--skip-build` Version Locking**: Configured `shouldBump = false` when `--skip-build` is used so it locks and re-publishes the on-disk built version without failing on version lookups.
- **Live v0.1.135 Published to GitHub & Vercel**:
  - Installer: `https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v0.1.135/AI-Pharmacy-OS-Portable-Setup-v0.1.135.exe`
  - Update ZIP: `https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v0.1.135/AI-Pharmacy-OS-Update-v0.1.135.zip`
  - APK: `https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v0.1.135/AI-Pharmacy-Mobile-v0.1.135.apk`
- **Live Verification**: Tested `https://website-woad-seven-26.vercel.app/api/updates/check?version=0.1.134` and confirmed it returns `hasUpdate: true` with `latestVersion: "0.1.135"`. All client PCs running `v0.1.134` will now detect and download the update automatically on boot/daily idle poll, or immediately via Settings > Check for Updates.
