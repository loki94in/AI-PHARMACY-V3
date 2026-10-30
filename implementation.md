# Implementation Plan: Coucou-Style Changelog & In-App Release Notes Enrichment

## 1. Problem Statement & Scope
Following the reverse-engineering analysis of Coucou's update pipeline (`coucou.log` and `coucou.exe`), AI Pharmacy OS can adopt Coucou's seamless release notes experience:
1. In Coucou, update release notes are always visible because it directly ingests the markdown release body (`## What's new`) from GitHub Releases.
2. In AI Pharmacy OS, if the Vercel update server returns an empty or minimal changelog, the top `UpdateBanner` cannot display what is new.
3. When an update was previously downloaded in background and detected on boot (`boot_staged`), `autoUpdateService.ts` broadcasts `update_available` without attaching any changelog.
4. When background download completes (`downloadProgress = 100`), the broadcast event previously omitted `changelog`.
5. `UpdateBanner.tsx` displayed raw pre-line text without parsing markdown bolding or styled bullet points.

## 2. Architecture & Design
1. **GitHub Release Notes Ingestion (`autoUpdateService.ts`)**:
   - Introduce `resolveChangelogForVersion(version, existingChangelog?)` using `updateHistoryService.ts`.
   - Introduce `extractWhatsNewSection(body)` to cleanly parse `## What's new` sections from GitHub markdown.
   - Automatically backfill release notes during:
     - Active update check (`runCheck`)
     - Boot staged package discovery (`boot_staged`)
     - Background download completion broadcast
2. **Rich Formatted "What's New" UI (`UpdateBanner.tsx`)**:
   - Add semantic bullet and bold text parser (`renderFormattedChangelog`) that transforms GitHub markdown bullets into readable, theme-aware list items (`text-text`, `text-muted`, `text-primary`).
   - Retain full Rule 6 Human-in-the-Loop controls ("Install Now", "Later", expandable toggle).

---

## 3. Surgical Technical Tasks

### Task 1: Enrich Changelog Extraction in `src/services/autoUpdateService.ts`
- Implement `extractWhatsNewSection` and `resolveChangelogForVersion`.
- Attach enriched changelog in `runCheck`, `boot_staged`, and download completion broadcast.

### Task 2: Enhance Release Notes Rendering in `frontend/src/components/UpdateBanner.tsx`
- Implement formatted bullet points and bold title rendering matching Coucou's release view.
- Maintain light/dark theme tokens (`text-text`, `text-muted`, `text-primary`, `border-border`).

### Task 3: Regression Verification & Performance Guardrails
- Run `npm run guardrails` (verify 0 violations).
- Run `npm run build:client` (verify frontend compiles cleanly).
- Update `SMALL_BUG_FIX_PLAN.md` with `[Fixed] P2-139`.
- Run `node scripts/quick-update.mjs`.

---

## 4. Execution Log & Tasks
- [x] Task 1: Enrich Changelog Extraction in `src/services/autoUpdateService.ts`
  - Implemented `extractWhatsNewSection` and `resolveChangelogForVersion` integrating GitHub Releases.
  - Attached enriched changelog to `runCheck`, `boot_staged`, and background download completion broadcasts.
- [x] Task 2: Enhance Release Notes Rendering in `frontend/src/components/UpdateBanner.tsx`
  - Implemented `renderFormattedChangelog` parsing GitHub markdown bullets and bold text with light/dark theme variables.
  - Preserved changelog in `frontend/src/services/updateStatusStore.ts`.
- [x] Task 3: Regression Verification & Performance Guardrails
  - `npm run guardrails` passed with exit 0 (`tsc --noEmit` clean, 0 violations).
  - Frontend production build (`npm run build:client`) succeeded in 46.50s with 0 errors.
  - Documented `[Fixed] P2-139` in `SMALL_BUG_FIX_PLAN.md`.
