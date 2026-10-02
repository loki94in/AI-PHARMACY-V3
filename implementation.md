# Active Implementation Plan: Pre-Seeded Database & Master Catalog Restore

> **Master Plan**: [PRE_SEEDED_DATABASE_AND_CATALOG_RESTORE_PLAN.md](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/PRE_SEEDED_DATABASE_AND_CATALOG_RESTORE_PLAN.md)
> **Goal**: 
> 1. Package pre-seeded `app.db` containing 286k+ medicines into Inno Setup installer (`installer.iss`) with `onlyifdoesntexist` to preserve existing CRM/orders data.
> 2. Fix SQLite `ON CONFLICT` clause mismatch in `masterMedicinesSeedService.ts` to prevent Query Compilation & Constraint Resolution Failure (Rule 9).
> 3. Enhance boot-time auto-seeding fallback in `server.ts` if medicines count is 0.
> 4. Verify clean boot, page accessibility, and performance guardrails.
> **Status**: Completed

---

## Tasks Checklist

- [x] `Task 1`: Update `installer.iss` to package pre-seeded `data\app.db` safely with `onlyifdoesntexist`.
- [x] `Task 2`: Fix SQLite Index & ON CONFLICT Constraint Mismatch in `src/services/masterMedicinesSeedService.ts` (Rule 9).
- [x] `Task 3`: Add automatic boot seeding fallback in `src/server.ts` if `medicines` count < 50.
- [x] `Task 4`: Vacuum & optimize `data/app.db` with 286k medicines and verified CRM orders integrity.
- [x] `Task 5`: Run performance guardrails, verify clean build, and sync knowledge graph.
