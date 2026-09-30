# Active Implementation Plan: App Version Display & Software Update Card Fix

> **Master Specification**: [APP_VERSION_DISPLAY_FIX_IMPLEMENTATION_PLAN.md](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/APP_VERSION_DISPLAY_FIX_IMPLEMENTATION_PLAN.md)
> **Goal**: 
> 1. Fix missing version number in Settings Software Update card (`You're up to date — v`).
> 2. Add prominent permanent "Installed Version: v0.1.27" badge in Settings and Sidebar.
> 3. Ensure backend reliably provides `currentVersion` and `latestVersion` in all update checks.
> **Status**: In-Progress

---

## 1. Tasks Checklist

- [x] `Task 1`: Update `src/services/licenseService.ts` & `src/routes/license.ts` to guarantee `currentVersion` and fallback `latestVersion`.
- [x] `Task 2`: Update `frontend/src/pages/Settings/index.tsx` to display installed version badge and fix up-to-date template string.
- [x] `Task 3`: Update `frontend/src/components/Layout.tsx` to display version in sidebar.
- [x] `Task 4`: Run `npm run guardrails` and `node scripts/quick-update.mjs` (Verified: Exit 0, 0 violations).
