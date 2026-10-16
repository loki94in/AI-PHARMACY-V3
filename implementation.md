# Implementation Plan: Permanent Durability & Unification of Distributor Dispatch Reminder Setting

## Overview
User settings must be permanently durable across app restarts and updates. When a user turns the "Distributor Dispatch Reminder" ON or OFF (in either Automation Hub or Settings), the setting must stay locked to their choice and never be reset or changed during app updates.

Currently, `automationCatalog.ts` used `trigger_wa_dispatch_reminder_enabled`, while the background worker, scheduler, boot sequence, and Settings tab read `trigger_dispatch_reminder_enabled`. This mismatch caused the toggle state to desynchronize and appear reset on app update.

This plan unifies the setting keys to `trigger_dispatch_reminder_enabled`, migrates any existing saved choice safely, ensures bidirectional synchronization between Automation Hub and Settings, triggers immediate live scheduler reloads on toggle, and protects user choices with strict `INSERT OR IGNORE` boot guarantees.

---

## Tasks

- [x] **Task 1: Unify Key in Automation Catalog & State Resolver**
  - **File**: `src/services/automationCatalog.ts`
  - **Action**: 
    1. Update `appSettingsKey` for `dispatch_reminder` to `trigger_dispatch_reminder_enabled`.
    2. In `getAutomationToggleStates`, check canonical `trigger_dispatch_reminder_enabled` with fallback to legacy `trigger_wa_dispatch_reminder_enabled`.

- [x] **Task 2: Update Automation Route to Sync Keys & Reload Schedules Live**
  - **File**: `src/routes/automation.ts`
  - **Action**:
    1. In `POST /catalog/:id/toggle`, when `dispatch_reminder` is toggled, update both `trigger_dispatch_reminder_enabled` and `trigger_wa_dispatch_reminder_enabled`.
    2. Call `triggerSchedulerService.reloadSchedules(db)` so the background worker starts/stops live without needing an app restart.

- [x] **Task 3: Safe Schema Migration & Zero-Reset Boot Guarantee**
  - **File**: `src/database.ts`
  - **Action**:
    1. In both fast-boot `ensureSchema` and full DDL migration blocks, add a migration to copy any existing `trigger_wa_dispatch_reminder_enabled` value to `trigger_dispatch_reminder_enabled`.
    2. Add `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('trigger_dispatch_reminder_enabled', 'false')` ensuring existing user settings are NEVER overwritten.

- [x] **Task 4: Bidirectional Sync in Settings UI**
  - **File**: `frontend/src/pages/Settings/TriggerSchedulesTab.tsx`
  - **Action**:
    1. Read `triggerDispatchReminderEnabled` checking both canonical and legacy keys.
    2. On saving triggers, write both keys in sync so Automation Hub and Settings are always identical.

- [x] **Task 5: Verification & Performance Guardrails**
  - **Action**:
    1. Run `npm run guardrails` (`tsc --noEmit` and speed architecture checks).
    2. Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.
    3. Update `SMALL_BUG_FIX_PLAN.md` with the bug fix entry.

---

## Task Completion Log
- **Task 1 Completed**: In `src/services/automationCatalog.ts`, updated `appSettingsKey` for `dispatch_reminder` to `trigger_dispatch_reminder_enabled` and added transparent fallback in `getAutomationToggleStates` to read legacy `trigger_wa_dispatch_reminder_enabled` if canonical key is not yet set.
- **Task 2 Completed**: In `src/routes/automation.ts`, updated `POST /catalog/:id/toggle` to persist both `trigger_dispatch_reminder_enabled` and `trigger_wa_dispatch_reminder_enabled` in lockstep, and immediately invoked `triggerSchedulerService.reloadSchedules(db)` so the background worker updates its runtime state live without server reboot.
- **Task 3 Completed**: In `src/database.ts`, added automatic schema migration across both fast-boot `ensureSchema` and full DDL initialization to migrate legacy keys into `trigger_dispatch_reminder_enabled` using `INSERT OR IGNORE`, guaranteeing zero-overwrite of existing user preferences on app update.
- **Task 4 Completed**: In `frontend/src/pages/Settings/TriggerSchedulesTab.tsx`, initialized `triggerDispatchReminderEnabled` from either key and saved both keys simultaneously to preserve bidirectional state consistency across screens.
- **Task 5 Completed**: Ran `npm run guardrails` exit 0 (`tsc --noEmit` clean, database schema & integrity OK, 0 violations); updated `SMALL_BUG_FIX_PLAN.md` with **P2-93**; synchronized 3D knowledge graph via `node scripts/quick-update.mjs`.
