# Implementation Plan: Fix Pharmarack Missing Phone Badge Header Synchronization & Query Resolution

## Problem Statement
When viewing the Pharmarack Live page, distributors with missing WhatsApp numbers clearly show the `[1] Missing Phone — Click to Add` badge and the Unmapped filter count. However, the topbar Header pill (`LiveCartCountdownPill` in `Layout.tsx`) was not showing the missing mark warning badge (`⚠️ N`).

### Root Causes
1. **Frontend State Isolation:** `PharmarackCart/index.tsx` calculates unmapped distributors locally on cart fetch/refresh but never notified `Layout.tsx` via `refresh-pharmarack-cart`.
2. **Cold Boot Timeout & Cache Decoupling:** `/api/pharmarack/live-cart-summary` used an isolated 6s probe that times out on cold boot, returning `missingDistributorsCount = 0` without reading `serverCartCache`.
3. **SQLite COALESCE Empty-String Shadowing:** In `src/routes/pharmarack.ts`, queries used `COALESCE(d.phone, d.contact, m.phone)`. Because `''` is not `NULL` in SQLite, distributors with empty string phone numbers shadowed valid numbers in `pharmarack_distributor_mappings`.
4. **Validation Mismatch:** Backend accepted any 10 digits (`\d{10}`), whereas frontend strictly enforces `/^[6-9]\d{9}$/`.

---

## Changes Implemented

### 1. Database Indexing & Schema Safety
- File: `src/database.ts`
- Added performance expression indexes across both `ensureOrderTimingSchema` / `ensureSchema` fast boot and the full DDL table migration blocks:
  - `CREATE INDEX IF NOT EXISTS idx_pharmarack_dist_mappings_lower ON pharmarack_distributor_mappings(LOWER(TRIM(store_name)));`
  - `CREATE INDEX IF NOT EXISTS idx_distributors_name_lower ON distributors(LOWER(TRIM(name)));`

### 2. Backend API Fixes
- File: `src/routes/pharmarack.ts`
  - In `GET /live-cart-summary`:
    - Added fallback to `serverCartCache.distributors` when upstream probe fails or returns empty on cold boot.
    - Updated query to use `COALESCE(NULLIF(d.phone, ''), NULLIF(d.contact, ''), NULLIF(m.phone, ''))`.
    - Aligned phone number validation with frontend rule (`/^[6-9]\d{9}$/`).
  - In `GET /distributor-mappings`:
    - Updated query to use `NULLIF(d.phone, '')`, `NULLIF(d.contact, '')`, and `NULLIF(m.phone, '')` so empty strings do not shadow mapped distributor phone numbers.

### 3. Frontend Event Synchronization
- File: `frontend/src/pages/PharmarackCart/index.tsx`:
  - Dispatched `window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'))` after successfully updating distributors in `fetchCart()` and `fetchCartSilent()`.
- File: `frontend/src/components/Layout.tsx`:
  - Added route location listener inside `LiveCartCountdownPill` to call `loadCartData()` whenever navigating to `/pharmarack-cart`.

### 4. Verification & Guardrails
- `npm run guardrails` passed with 0 violations (`tsc --noEmit` clean).
- Verified `http://localhost:5174/api/pharmarack/live-cart-summary` outputs `missingDistributorsCount: 5`.
- `node scripts/quick-update.mjs` synchronized knowledge graph (1336 nodes, 871 edges).
- Updated `SMALL_BUG_FIX_PLAN.md` with issue P2-132.

---

## Tasks Execution Checklist
- [x] Task 1: Add lowercase trim indexes in `src/database.ts` (Completed: added `idx_pharmarack_dist_mappings_lower` and `idx_distributors_name_lower` in fast boot schema and full DDL).
- [x] Task 2: Fix SQL `COALESCE` with `NULLIF`, shared cart cache fallback, and phone validation in `src/routes/pharmarack.ts` (Completed: updated SQL queries and validation regex in `/live-cart-summary` and `/distributor-mappings`).
- [x] Task 3: Dispatch `refresh-pharmarack-cart` in `frontend/src/pages/PharmarackCart/index.tsx` and ensure `Layout.tsx` sync (Completed: event dispatched on cart state commit; route listener added in `LiveCartCountdownPill`).
- [x] Task 4: Run guardrails, verify tests, update knowledge graph and bug fix plan (Completed: guardrails passed, knowledge graph updated, bug fix documented).
- [x] Task 5: Human-in-the-Loop review and verification ready for user.
