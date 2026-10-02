# Active Implementation Plan: Zero Data Loss & Auto-Restore Migration

> **Master Plan**: [ZERO_DATA_LOSS_AUTO_RESTORE_PLAN.md](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/ZERO_DATA_LOSS_AUTO_RESTORE_PLAN.md)  
> **Goal**: 
> 1. Fix schema migration ordering in `src/database.ts` so older installed versions upgrade cleanly without SQLite column errors.
> 2. Repair and checkpoint real production database on `G:\AI Pharmacy OS\data\app.db` (9,370 customers, 44 refills, 24k bills, 38k stock).
> 3. Sync full production database into workspace `data/app.db` so new installations and upgrades have complete data automatically restored.
> 4. Add upgrade migration safety guardrail in `scripts/performance-guardrails.mjs`.
> 5. Build, verify, and package production release installer.
> **Status**: In Progress  

---

## Tasks Checklist

- [x] `Task 1`: Fix Schema Migration Sequencing & Defensive Column Checks in `src/database.ts`.
- [x] `Task 2`: Repair & Checkpoint `G:\AI Pharmacy OS\data\app.db`.
- [x] `Task 3`: Synchronize Production Database into Workspace `data/app.db`.
- [x] `Task 4`: Add Automated Upgrade Migration Guardrail in `scripts/performance-guardrails.mjs`.
- [ ] `Task 5`: Run guardrails, sync knowledge graph, commit, and build production release.

