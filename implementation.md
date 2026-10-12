# Implementation Plan: Installed App Cold-Boot Database Readiness & Release Automation

## 1. Problem Summary & Root Causes
When launching a newly installed packaged build (`PharmacyOS.exe`), cold boot was experiencing errors, premature splash dismissal, and startup termination:
1. **Premature Health Gating in `electron/main.ts`**: `HEALTH_URL` probed `/api/health` (process liveness, HTTP 200 within ~50ms) instead of `/api/health/ready` (database schema readiness, HTTP 503 while schema initializes). This removed the splash screen immediately, exposing the UI while SQLite was still initializing and causing cascading 503 API errors.
2. **Hard 30-Second Termination Cap in `electron/main.ts`**: `waitForBackend(timeoutMs = 30_000)` killed the application process with `app.quit()` if cold-boot disk reads or migrations on the 420 MB database took longer than 30s.
3. **Template Database Schema Gap in `data/app.db`**: The bundled template database packaged by `installer.iss` was stamped with `schema_version = 74`, while code in `src/database.ts` requires `CURRENT_SCHEMA_VERSION = 75`. This mismatch forced every fresh installation to fail the instant fast-boot check and run the full 3,200-line DDL migration wall on first launch.

---

## 2. Proposed Changes & Implementation Strategy

### Task 1: Update `electron/main.ts`
- Change `HEALTH_URL` to `${BACKEND_URL}/api/health/ready` so the Electron launcher waits until database schema and indexes are 100% verified.
- Increase `waitForBackend` timeout from `30_000` ms to `90_000` ms so cold-boot on slower HDDs/systems never causes premature `app.quit()`.
- Add an inline lightweight status progression to `SPLASH_URL` (transitions from "Starting…" to "Preparing database…" at T+4s).

### Task 2: Synchronize `data/app.db` to Schema Version 75
- Run schema migration v75 (`autoHealDistributorPhoneMappings`) on `data/app.db`.
- Stamp `schema_version = '75'` and `schema_migrations = 75` in `data/app.db`.
- Ensure newly installed instances hit the instant `<50ms` fast-boot path immediately on cold boot.

### Task 3: Performance Guardrails & Knowledge Graph Verification
- Run `npm run guardrails` (`scripts/performance-guardrails.mjs`) to ensure zero performance, lint, or architecture violations.
- Run `node scripts/quick-update.mjs` to synchronize `.understand-anything/knowledge-graph.json`.

### Task 4: Automated Build & Production Release
- Stage and commit changes.
- Execute `npm run release` to bump version, build SEA bundle, package Inno Setup installer, create update ZIP, and verify release artifacts.

---

## 3. Execution & Task Checklist

- [x] Task 1: Update `electron/main.ts` (`HEALTH_URL = /api/health/ready`, `timeoutMs = 90_000`, splash timer).
- [x] Task 2: Synchronize `data/app.db` schema version to 75.
- [x] Task 3: Verify performance guardrails (`npm run guardrails`) and update knowledge graph (`node scripts/quick-update.mjs`).
- [/] Task 4: Execute release command (`npm run release`) and confirm release package.
