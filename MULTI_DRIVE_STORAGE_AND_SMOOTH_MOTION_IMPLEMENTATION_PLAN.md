# Multi-Drive Storage Isolation & Smooth Motion Implementation Plan

> **Tracking ID**: `TASK-MULTI-DRIVE-MOTION-001`  
> **Target**: Make AI Pharmacy OS store all dynamic data (database, uploads, backups) on `D:` or custom drive with 0 C: drive bloat, protect user data on uninstall, and implement smooth 60fps/120fps smart micro-motion across the UI.  
> **Status**: COMPLETED

---

## 1. Problem Statement & Root Cause

1. **C: Drive Bloat & Lockout Risk**:
   - `src/config/index.ts` currently forces packaged apps to store `data/`, `uploads/`, and `backup/` in `%LOCALAPPDATA%\AI Pharmacy OS` on the `C:` drive.
   - Even if the user installs the app onto `D:\AI Pharmacy OS`, the backend redirects data writes back to `C:`.
   - Over time, SQLite (`app.db`), distributor invoice uploads, and backups (currently ~4 GB in development) fill up `C:`, risking SSD performance degradation and Windows crashes.
2. **Data Destruction on Uninstall**:
   - `installer.iss` contains `[UninstallDelete]` entries for `{app}\data`, `{app}\uploads`, and `{app}\backup`. If an end-user runs the Windows uninstaller, all business records and patient history are permanently destroyed.
3. **App Motion & Fluidity**:
   - The UI currently switches views and inserts rows instantly without transitional continuity.
   - POS bill rows, modals, drawers, and tabs need fluid, GPU-accelerated spring animations (Apple-style cubic-bezier) that feel responsive, smart, and weightless without causing CPU spikes or frame drops on low-end cash register hardware.

---

## 2. Architecture & Design Principles

### A. Multi-Drive & Storage Isolation Architecture
- **Drive-Aware Data Resolution**:
  - Check explicit `process.env.DATA_DIR`.
  - If running packaged (`isPackagedApp()`):
    - If `process.execPath` is on `D:\`, `E:\`, or any path outside `%LOCALAPPDATA%`, use `path.dirname(process.execPath)` as the app data directory. Everything stays 100% on that drive!
    - If installed inside `%LOCALAPPDATA%`, maintain existing path for backward compatibility.
  - Subfolders resolved automatically: `<appDataDir>\data\app.db`, `<appDataDir>\uploads\`, `<appDataDir>\backup\`.
- **Installer Safety**:
  - In `installer.iss`, remove `{app}\data`, `{app}\backup`, and `{app}\uploads` from `[UninstallDelete]`.
  - Allow seamless installation to `D:\AI Pharmacy OS` or user-chosen drive.
- **Backup Pruning**:
  - Enforce cleanup of uncompressed `.db` files in `backupService.ts` so only compressed `.db.gz` files remain.

### B. High-Performance Motion System
- **Strictly GPU-Composited Properties**: Only animate `transform: translate3d(...)`, `scale3d(...)`, and `opacity`. Never animate `width`, `height`, `left`, `top`, or `margin` to prevent layout thrashing.
- **Spring Curves**: Use `cubic-bezier(0.16, 1, 0.3, 1)` (snappy spring) and `cubic-bezier(0.4, 0, 0.2, 1)` (material standard).
- **Reduced Motion Support**: Guard all transitions with `@media (prefers-reduced-motion: reduce)`.

---

## 3. Implementation Tasks & Checklist

- [x] **Task 1: Drive-Aware Configuration & DATA_DIR Support**
  - File: `src/config/index.ts`
  - Implementation: Updated `getAppDataDir()` to support explicit `DATA_DIR` environment override. When packaged, if the executable is running outside `%LOCALAPPDATA%` (e.g. `D:\AI Pharmacy OS`), uses the executable directory on that drive directly, keeping all database and upload storage off the C: drive.
  - Verification: Typescript checked and verified.

- [x] **Task 2: Installer Multi-Drive & Data Preservation Hardening**
  - File: `installer.iss`
  - Implementation: Added `GetDefaultInstallDir` Pascal function to automatically check if `D:\` or `E:\` drive exists and prefer it as the default install directory. Removed `{app}\data`, `{app}\uploads`, and `{app}\backup` from `[UninstallDelete]` and `CurUninstallStepChanged` so customer database records and backups are never wiped on uninstall.
  - Verification: Inno script validated.

- [x] **Task 3: Backup Service Uncompressed File Pruning**
  - File: `src/services/backupService.ts`
  - Implementation: Enhanced `enforceRetention()` to scan and prune orphaned uncompressed `.db` files and use path-safe `deleteBackup()` to enforce `MAX_BACKUPS` retention across root and subdirectories.
  - Verification: Guardrails and type checks verified.

- [x] **Task 4: High-Performance GPU Motion System in CSS**
  - File: `frontend/src/index.css`
  - Implementation: Added unified GPU-accelerated motion classes (`.motion-spring-enter`, `.motion-row-pop`, `.motion-modal-backdrop`, `.motion-modal-content`, `.motion-card-hover`) with Apple-spring easing curves (`cubic-bezier(0.16, 1, 0.3, 1)`) and `@media (prefers-reduced-motion)` hardware safety.
  - Verification: CSS verified.

- [x] **Task 5: Apply Micro-Motion to Key Interactions (POS & Modals)**
  - Files: `frontend/src/pages/POS/index.tsx`, `frontend/src/components/CompositionIntelligenceModal.tsx`
  - Implementation: Attached `motion-row-pop` to populated bill table rows in the POS cart for fluid scan/add visual feedback. Attached `motion-modal-backdrop` and `motion-modal-content` for silky smooth spring dialog popups.
  - Verification: Checked in frontend source code.

- [x] **Task 6: Verification & Guardrails**
  - Run `npm run guardrails` -> PASS (0 violations, clean TypeScript compilation).
  - Run `node scripts/quick-update.mjs` -> PASS (1081 nodes, 542 edges synchronized).

---

## 4. Execution Log
- **2026-09-26 14:20**: Created implementation plan.
- **2026-09-26 14:22**: Configured drive-aware data path resolution in `src/config/index.ts`.
- **2026-09-26 14:23**: Updated `installer.iss` with intelligent D:/E: drive suggestion and protected customer data against accidental uninstaller wipes.
- **2026-09-26 14:24**: Upgraded `src/services/backupService.ts` retention engine to prune heavy uncompressed `.db` files.
- **2026-09-26 14:25**: Integrated GPU-accelerated spring animations in `frontend/src/index.css`, `frontend/src/pages/POS/index.tsx`, and `frontend/src/components/CompositionIntelligenceModal.tsx`.
- **2026-09-26 14:26**: Passed `npm run guardrails` and regenerated knowledge graph via `node scripts/quick-update.mjs`.
