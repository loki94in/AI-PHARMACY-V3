# Installer Custom Data Storage Location Implementation Plan

> **Tracking ID**: `TASK-INSTALLER-DATA-DIR-002`  
> **Target**: Allow user during installation to select a custom drive/folder for Database, Uploads, and Backups; automatically provision directory tree, seed files, and write `DATA_DIR` into `.env`.  
> **Status**: COMPLETED

---

## 1. Requirement & Design

- **Wizard UI**: Add a dedicated Inno Setup wizard page right after the destination directory selection:
  - Page Title: "Select Database & Storage Location"
  - Sub-caption: "Where should AI Pharmacy OS store your database, patient history, and bill uploads?"
  - Input field with `Browse...` dialog.
  - Smart default: `D:\AI_Pharmacy_Data` (if D: exists) -> `E:\AI_Pharmacy_Data` (if E: exists) -> `{app}\data`.
- **Automatic Provisioning**:
  - Automatically create:
    - `<selectedPath>\data`
    - `<selectedPath>\uploads`
    - `<selectedPath>\uploads\temp`
    - `<selectedPath>\backup`
  - Copy seed files (`reference_medicines.csv`, `medicine_reference_seed.json`) into `<selectedPath>\data`.
  - Write `DATA_DIR=<selectedPath>` into `{app}\.env`.
- **Zero C: Drive Bloat**: The program binary stays in `{app}` while all heavy data lives on the selected drive forever.

---

## 2. Implementation Tasks & Checklist

- [x] **Task 1: Add Custom Data Directory Wizard Page to Inno Setup**
  - File: `installer.iss`
  - Implementation: Declared `DataDirPage: TInputDirWizardPage;` and initialized it in `InitializeWizard` after `wpSelectDir` with automatic detection of secondary drives (`D:\`, `E:\`).
  - Verification: Compiled and validated via Inno Setup 7 ISCC.

- [x] **Task 2: Automatic Storage Tree Provisioning & Seed File Copying**
  - File: `installer.iss`
  - Implementation: In `CurStepChanged(ssPostInstall)`, added automatic directory creation for `<dataDir>\data`, `<dataDir>\uploads`, `<dataDir>\uploads\temp`, and `<dataDir>\backup`. Automatically copies `reference_medicines.csv` and `medicine_reference_seed.json` into the target data folder.
  - Verification: ISCC validated.

- [x] **Task 3: Inject DATA_DIR into Installed .env**
  - File: `installer.iss`
  - Implementation: In `CurStepChanged(ssPostInstall)`, loads or creates `{app}\.env` and sets `DATA_DIR=<targetDataDir>`.
  - Verification: Tested string file generation logic.

- [x] **Task 4: Verification & Guardrails**
  - ISCC compiler test: Clean compilation with 0 syntax errors.
  - Run `npm run guardrails` -> PASS (0 violations, clean TypeScript compilation).
  - Run `node scripts/quick-update.mjs` -> PASS (1082 nodes, 542 edges synchronized).

---

## 3. Execution Log
- **2026-09-26 14:28**: Created plan for installer custom storage location.
- **2026-09-26 14:29**: Added `DataDirPage` in `installer.iss` with `InitializeWizard`, `GetDataDir`, and automated directory provisioning in `CurStepChanged(ssPostInstall)`.
- **2026-09-26 14:29**: Successfully validated Pascal syntax with Inno Setup 7 compiler (`ISCC.exe`).
- **2026-09-26 14:30**: Verified clean TypeScript compilation, 0 guardrail violations, and synced knowledge graph.
