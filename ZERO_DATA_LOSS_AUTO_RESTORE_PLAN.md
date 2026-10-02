# Zero Data Loss & Auto-Restore Migration Implementation Plan

> **Tracking ID**: `TASK-ZERO-DATA-LOSS-AUTO-RESTORE-002`  
> **Target**: Ensure seamless schema migration for updates without database boot failures, integrate full production database (9,370 customers, 44 refills, 24k bills, 38k stock) into project pre-seeded release bundle, and automate upgrade safety in guardrails.  
> **Status**: IN PROGRESS  

---

## 1. Problem Statement & Root Cause

1. **Schema Migration Failure in Existing Installations**:
   - In `src/database.ts`, `ensureOrderTimingSchema(db)` (which adds `ack_status` and `pharmacist_opened_at` to `whatsapp_messages`) was only called inside the fast-boot path (when schema version was already >= 72).
   - Databases on version 71 bypassed this and dropped into the full DDL wall, which attempted `CREATE INDEX idx_wa_msgs_ack ON whatsapp_messages (chat_id, from_me, ack_status)`.
   - SQLite failed with `no such column: ack_status`, causing the entire backend initialization to abort and all frontend pages to show errors / empty states.

2. **Database Parity Between Installed PC and Repository Seed**:
   - `G:\AI Pharmacy OS\data\app.db` holds the user's complete real shop data (9,370 customers, 44 refills, 29 special orders, 24,645 bills, 38,024 stock items, 286,500 medicines).
   - The workspace `data/app.db` had a smaller development dataset.
   - Checkpointing WAL and syncing the full real shop database to `data/app.db` ensures both clean upgrades and full data availability on fresh installs.

---

## 2. Tasks & Action Plan

- [x] **Task 1: Fix Schema Migration Sequencing & Defensive Column Checks in `src/database.ts`**
  - Called `ensureOrderTimingSchema(db)`, `ensureRefillCartLinkSchema(db)`, and `ensureMultiPharmacyAndSnapshotSchema(db)` before executing the DDL block.
  - Added post-DDL schema runners before stamping `schema_version`.
  - Verified clean TypeScript compilation.

- [x] **Task 2: Repair & Checkpoint `G:\AI Pharmacy OS\data\app.db`**
  - Merged WAL via `PRAGMA wal_checkpoint(TRUNCATE)`.
  - Added missing `ack_status` and `pharmacist_opened_at` columns, ensured `idx_wa_msgs_ack`, and stamped `schema_version = 72`.
  - Verified record counts: 9,370 customers, 44 patient refills, 29 special orders, 24,645 sales invoices, 38,024 inventory items, 286,500 medicines.
  - Verified `PRAGMA integrity_check` -> `ok`.

- [x] **Task 3: Synchronize Production Database into Workspace `data/app.db`**
  - Backed up workspace `data/app.db` to `data/app.db.dev_backup`.
  - Synchronized checkpointed database from `G:\AI Pharmacy OS\data\app.db` into `data/app.db`.
  - Verified workspace integrity check (`ok`) and verified exact row counts matching production.

- [x] **Task 4: Add Automated Upgrade Migration Guardrail in `scripts/performance-guardrails.mjs`**
  - Added Database Schema & Integrity check to `performance-guardrails.mjs`.
  - Verified `npm run guardrails` passes with 0 violations.

- [ ] **Task 5: Verification & Production Release Build**

  - Run `npm run guardrails` -> ensure 0 violations.
  - Run `node scripts/quick-update.mjs` -> sync knowledge graph.
  - Commit and push changes to git.
  - Run `npm run release` to produce installer bundling the complete real dataset.

---

## 3. Execution Log
- **2026-10-02 19:04**: Created plan and root cause analysis.
