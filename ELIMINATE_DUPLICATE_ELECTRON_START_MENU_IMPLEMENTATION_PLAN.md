# Implementation Plan: Eliminate Duplicate Electron Entry in Start Menu & Notifications

## Objective
Ensure that on Windows PCs, users only ever see a single app entry: **"AI Pharmacy OS"** with the blue plus icon, and never a duplicate "Electron" entry.

---

## Tasks

- [x] **Task 1: Update `electron/main.ts`**
  - Set `app.name = 'AI Pharmacy OS'`
  - Set `app.setAppUserModelId('com.aipharmacy.os')` on Windows
  - Add auto-cleanup routine at startup to silently delete any stray `Electron.lnk` in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Electron.lnk`

- [x] **Task 2: Update `installer.iss`**
  - Add `AppUserModelID: "com.aipharmacy.os"` to all `[Icons]` definitions
  - Add `{userprograms}\Electron.lnk`, `{commonprograms}\Electron.lnk`, and `{userprograms}\{#MyAppName}\Electron.lnk` to `[InstallDelete]`

- [x] **Task 3: Update `scripts/buildSea.cjs` to Brand `PharmacyOS.exe`**
  - Brand `PharmacyOS.exe` with `rcedit.exe` (from `node_modules/electron-winstaller/vendor/rcedit.exe`):
    - Set icon to `packaging/app.ico`
    - Set `ProductName` to `"AI Pharmacy OS"`
    - Set `FileDescription` to `"AI Pharmacy OS"`
    - Set `CompanyName` to `"AI Pharmacy Team"`

- [x] **Task 4: Clean current machine's stray `Electron.lnk`**
  - Purged `C:\Users\ratna\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Electron.lnk`

- [x] **Task 5: Verification & Guardrails**
  - Verified `Electron.lnk` is completely purged from Start Menu and Desktop
  - Compiled Electron main bundle cleanly (`esbuild`)
  - `npm run guardrails` passed with 0 violations
  - Knowledge graph refreshed via `node scripts/quick-update.mjs`
