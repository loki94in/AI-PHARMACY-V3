# Implementation Plan: App Version Display & Software Update Card Fix

> **Goal**: 
> 1. Fix missing version number in Settings Software Update card (`You're up to date — v`).
> 2. Add prominent permanent "Installed Version: v0.1.27" badge in Settings and Sidebar.
> 3. Ensure backend reliably provides `currentVersion` and `latestVersion` in all update checks.
> **Status**: In-Progress

---

## 1. Objectives & Scope
- **Backend API (`src/services/licenseService.ts` & `src/routes/license.ts`)**:
  - Load `APP_VERSION` dynamically from `package.json` if not in environment.
  - Return `{ currentVersion, latestVersion, hasUpdate, ... }` in all check-update calls.
  - Expose current version in `GET /api/license/status` and `GET /api/license/version`.
- **Frontend Settings (`frontend/src/pages/Settings/index.tsx`)**:
  - Show permanent `Installed Version: v{currentVersion}` badge in the Software Update card header.
  - Fix up-to-date message template: `You're up to date — v{result.latestVersion || result.currentVersion || '0.1.27'}`.
  - Fetch installed version on mount.
- **Frontend Sidebar (`frontend/src/components/Layout.tsx`)**:
  - Show version pill `OS Version 2.0 · v0.1.27` in sidebar navigation.
- **Verification**:
  - Pass `npm run guardrails`.
  - Update knowledge graph via `node scripts/quick-update.mjs`.

---

## 2. Tasks Checklist

- [x] `Task 1`: Update `src/services/licenseService.ts` & `src/routes/license.ts` to guarantee `currentVersion` and fallback `latestVersion`.
- [x] `Task 2`: Update `frontend/src/pages/Settings/index.tsx` to display installed version badge and fix up-to-date template string.
- [x] `Task 3`: Update `frontend/src/components/Layout.tsx` to display version in sidebar.
- [x] `Task 4`: Run `npm run guardrails` and `node scripts/quick-update.mjs` (Verified: Exit 0, 0 violations).
