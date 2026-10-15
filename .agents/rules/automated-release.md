# Automated Release Workflow Rule

**MANDATORY trigger when the user mentions keywords like "pilot deploy", "deploy pilot", "deploy release", "release pilot", "npm release", or "deploy prod".**

## Trigger Keywords & Actions

1. **"pilot deploy" / "deploy pilot" / "release pilot"**:
   - Target: Pilot / Test licensed PCs only.
   - Command: `npm run release:pilot`

2. **"deploy release" / "release prod" / "production deploy" / "npm release"**:
   - Target: All customer production PCs.
   - Command: `npm run release`

## Default Execution Checklist (LOCAL BUILD ONLY)

By default, when the user asks to release/build, the agent MUST:

1. **Pre-flight Check**: Run `npm run guardrails` to ensure no compile or performance violations.
2. **Commit & Push**: Stage any pending edits (`git add .`), commit with a descriptive message, and push (`git push`).
3. **Trigger Build**: Run `npm run release:pilot` (or `npm run release`).
4. **Report to User**: Confirm the build succeeded and the local installer/exe path.

> 💡 **VERSION AUTO-BUMPING (updated 2026-09-23):**
> Every `npm run build:exe` and `npm run release` automatically increments the patch version in `package.json`
> so that the executable and in-app update checks always reflect the newly built version.
> To prevent bumping, pass `--no-bump` or `--skip-bump`.
> Cloud publishing to GitHub Release tags and Vercel license server still requires BOTH words **"git"** AND **"vercel"** in the release request (e.g. `npm run release -- git vercel`).

## Fast Paths & Performance Build Flags (Speed Architecture 2026-10)

1. **`--skip-build` (Instant Re-Publish)**:
   - Skips frontend, backend, and Inno compilation entirely; reuses existing `dist/installer` artifacts.
   - Example: `npm run release -- --skip-build git vercel`

2. **`--promote` (Pilot → All Customers in < 5 seconds)**:
   - Changes the rollout target of the already-tested pilot release from `PILOT` to `ALL` on the update server without any rebuilding.
   - Example: `npm run release -- --promote`

3. **Incremental vs Clean Builds**:
   - Default builds (`npm run release` / `npm run release:pilot`) are **fast incremental** (caches `.tsbuildinfo` and Vite chunks, skipping clean passes).
   - To force a full from-scratch clean build: pass `--clean`.
   - Example: `npm run release -- --clean`

4. **Tiered Installer Compression**:
   - Default builds use `lzma2/fast` (slashes Inno Setup packaging time by ~60–75%).
   - For maximum final production disk shrinkage when smallest installer size is required, pass `--max-compression` (uses `lzma2/max`).
   - Example: `npm run release -- --max-compression`

