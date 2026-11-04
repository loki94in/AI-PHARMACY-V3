# Current Implementation Plan: Systemic Unification on `medicine_name` Column & Removal of Stale `product` Queries

**Plan File:** `SYSTEMIC_MEDICINE_NAME_COLUMN_UNIFICATION_FIX_PLAN.md`  
**Status:** Completed & Verified (Zero-Bugs Gate Passed)

## Plan Overview
Ensured 100% of backend queries and frontend callers use the single canonical column `special_orders.medicine_name` without creating or adding back any duplicate `product` column in the SQLite schema, and added defensive null-guards to all `.toLowerCase()` callers across frontend views.

## Tasks & Resume Log
- [x] **Task 1: Update Backend SQL Queries to query `medicine_name` (routes & services)**
- [x] **Task 2: Update Frontend `.toLowerCase()` calls with safe guards**
- [x] **Task 3: Run Guardrails, Production Build & Knowledge Graph Update**
- [x] **Task 4: Human-in-the-Loop Verification**
