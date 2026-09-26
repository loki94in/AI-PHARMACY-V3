# Automated Google Drive Database Backup — Implementation Plan

## Objective
Implement an automated, zero-data-loss Google Drive backup system for AI Pharmacy OS. The system ensures 100% protection for all Billing/Sales, Purchases, Patients, CRM, Refills, Customer Credits, Inventory, and Settings by streaming point-in-time SQLite hot-backups directly to Google Drive on a scheduled daily basis, with human-in-the-loop controls and email fallback.

---

## Architecture Overview
1. **Zero-Loss Hot Snapshot**: Uses SQLite native `db.backup()` API to flush WAL and produce an atomic point-in-time copy without interrupting POS billing or locking the database.
2. **Gzip Compression**: Compresses the `.db` snapshot into `.db.gz` with `zlib`.
3. **Google Drive Integration**: Uses OAuth2 (`https://www.googleapis.com/auth/drive.file`) to upload files directly into a dedicated folder `AI Pharmacy Backups`.
4. **Cloud Retention Policy**: Retains the latest 30 daily backups on Google Drive to prevent quota overflow.
5. **Human-in-the-Loop Safeguards**:
   - Web UI control in Settings (`Data & Backups`) and `BackupCenterModal`.
   - Live Google Drive status indicator (Connected Account, Last Upload Timestamp, Folder Name).
   - "Upload to Drive Now" manual button.
   - "Test Connection" button.
   - Dual-protection: Optional email dispatch using existing Gmail App Password credentials.

---

## Tasks & Checklist

- [x] **Task 1: Database Schema & Backend Settings (`src/database.ts`)**
  - Add schema defaults for `backup_gdrive_enabled`, `backup_gdrive_folder_id`, `backup_gdrive_folder_name`, `backup_email_backup_enabled`, `backup_last_gdrive_upload`, `backup_last_gdrive_error` in `src/database.ts`.
  - Status: Completed

- [x] **Task 2: Enhanced Google Drive Backup Service (`src/services/backupRecoveryService.ts` & `src/services/backupService.ts`)**
  - Enhanced `uploadFileToGoogleDrive()` with multipart upload for `.db.gz`, `.zip`, `.db`.
  - Automatic `AI Pharmacy Backups` folder query and creation.
  - Automatic cloud retention (prunes older than 30 files in Drive folder).
  - Added `uploadBackupFileToGoogleDrive()` export and hooked cloud sync into `createBackup()`.
  - Added email dispatch fallback via `dispatchBackupEmailIfConfigured()`.
  - Status: Completed

- [x] **Task 3: Automated Scheduler Integration (`src/services/triggerSchedulerService.ts`)**
  - Nightly database backup at `trigger_backup_time` (e.g. 21:59) automatically calls `createBackup()`, triggering both local compression and Google Drive cloud upload.
  - Status: Completed

- [x] **Task 4: REST API Endpoints (`src/routes/utilities.ts` & `src/routes/settings.ts`)**
  - Extended `GET /api/utilities/backup/status` with Google Drive account, folder, status, and last upload timestamp.
  - Added `POST /api/utilities/backup/gdrive/toggle` to toggle auto-upload.
  - Added `POST /api/utilities/backup/gdrive/test` to test credentials and folder access.
  - Added `POST /api/utilities/backup/gdrive/upload-now` for instant manual cloud backup.
  - Added `POST /api/utilities/backup/email-toggle` and `POST /api/utilities/backup/gdrive/folder`.
  - Status: Completed

- [x] **Task 5: Frontend UI & Human Controls (`frontend/src/components/BackupCenterModal.tsx` & `Settings/index.tsx`)**
  - Added Google Drive status card and dedicated **Google Drive Auto-Backup & Offsite Protection** section in `BackupCenterModal.tsx`.
  - Added "Connect Google Drive", "Test Connection", and "Upload to Drive Now" buttons.
  - Added Google Drive schedule toggles and vault shortcuts in `Settings/index.tsx` under `Data & Backups`.
  - Status: Completed

- [x] **Task 6: Verification & Guardrails**
  - Passed `npm run guardrails` with 0 errors (TypeScript compilation OK, zero ungated timers, semantic styles preserved).
  - Ran `node scripts/quick-update.mjs` to synchronize the knowledge graph.
  - Status: Completed
