# Implementation Plan: Market Closure Stock Buffer Distributor Linking

## 1. Overview & Objective
In the **Market Closure Stock Buffer Review** modal (`frontend/src/components/ClosureStockBufferModal.tsx`), show an additional indicator/button on each medicine row representing its Pharmarack distributor linkage status, identical to the pattern used on the CRM page:
- If the medicine is **not linked** to any distributor (`linked_distributors_count === 0`): show a clear action badge/button (`🔗 Link distributor`) so the operator can immediately link it.
- If the medicine **is linked** (`linked_distributors_count > 0`): show a priority indicator (`⭐ <DistributorName>`) that operators can click to review or update distributor priority.
- Clicking either button opens [`MedicineLinkModal`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/MedicineLinkModal.tsx).
- When links are saved, update the in-memory item state at 0ms and trigger `refillEvent.triggerRefresh()`.
- Per user instruction: **no additional unnecessary changes across the app**.

---

## 2. Target Files & Surgical Scope
1. **`frontend/src/components/ClosureStockBufferModal.tsx`**:
   - Import `MedicineLinkModal`.
   - Add state: `linkingMedicine: { id: number; name: string } | null`.
   - In table row (`Medicine & Manufacturer` cell):
     - Display the link status badge/button below or alongside the medicine name.
     - Prevent row selection click propagation when clicking the link button.
   - Render `MedicineLinkModal` when `linkingMedicine` is set.
   - Handle `onSaved`: update `linked_distributors_count` and `distributor_name` in-memory in `items` state, trigger `refillEvent.triggerRefresh()`.

---

## 3. Human-In-The-Loop Contract (Rule 6)
- The operator manually reviews whether medicines have linked distributors before staging orders for market closures.
- The operator explicitly selects and saves distributor mappings in `MedicineLinkModal`. No automatic or guessed mappings are ever applied.

---

## 4. Step-by-Step Execution Plan

### Step 1: Add Linking State and Component Integration in `ClosureStockBufferModal.tsx`
- Import `MedicineLinkModal`.
- Add `linkingMedicine` state.
- Update table column rendering to show `⭐` (linked) or `🔗` (unlinked) chip.
- Wire `onSaved` with 0ms in-memory update and `refillEvent.triggerRefresh()`.

### Step 2: Verification & Guardrails
- Run `npm run guardrails` to verify no performance guardrail violations.
- Run `tsc -b && vite build` in `frontend/`.
- Run `node scripts/quick-update.mjs`.

---

## 5. Completed Tasks & Verification Log
- [x] **Task 1**: Added `linkingMedicine` state and imported `MedicineLinkModal` in `frontend/src/components/ClosureStockBufferModal.tsx`.
- [x] **Task 2**: Updated the Medicine column to render interactive `⭐ <Distributor>` (for linked items) or `🔗 Link distributor` (for unlinked items) badges.
- [x] **Task 3**: Mounted `MedicineLinkModal` with 0ms in-memory update of `linked_distributors_count` and `distributor_name` on save.
- [x] **Task 4**: Verified `npm run guardrails` (PASS — 0 violations).
- [x] **Task 5**: Verified `tsc -b && vite build` (PASS — built in 1m 36s with 0 errors).
- [x] **Task 6**: Ran `node scripts/quick-update.mjs` (synchronized 1499 files).
