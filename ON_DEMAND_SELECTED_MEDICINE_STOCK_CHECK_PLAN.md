# On-Demand Selected Medicine Stock Check Implementation Plan

## 1. Executive Summary & Root Cause

### Problem
Previously, when the user loaded the Reorder Hub (`/pharmarack-cart?tab=reorder`), `GET /api/pharmarack/reorder-recent` looped through **every single medicine** in the recent order history and executed a database query against `distributor_catalog` to calculate `highestStockDistributor`.
If 30-50 medicines were in recent history, this fired 30-50 separate queries immediately on page mount, causing unnecessary database load, network overhead, and latency for items the user had no intention of reordering.

### Solution
Replace eager page-load stock scanning with **On-Demand Stock Checking** for **only the selected medicine**:
1. `GET /api/pharmarack/reorder-recent` returns immediately with 0 catalog queries upfront.
2. A dedicated endpoint `GET /api/pharmarack/check-medicine-stock?name=...` checks stock for a single medicine on demand.
3. In the UI, each card has a `[ ⚡ Check Stock ]` button. When clicked, it queries stock **only for that medicine**, displays the highest stock distributor, and allows immediate 1-click reorder.
4. Results are cached in a local session map so repeated checks for the same medicine incur zero additional requests.

---

## 2. Technical Architecture

### Component 1: Dedicated On-Demand Endpoint (`src/routes/pharmarack.ts`)
- **`GET /api/pharmarack/check-medicine-stock`**:
  - Query parameter: `?name=MEDICINE_NAME`
  - Normalizes search token (removes dosage brackets, uses first significant tokens).
  - Queries `distributor_catalog`:
    ```sql
    SELECT store_id, store_name, product_name, distributor_price, CAST(availability AS INTEGER) as avail
    FROM distributor_catalog
    WHERE product_name LIKE ?
      AND CAST(availability AS INTEGER) > 0
    ORDER BY CAST(availability AS INTEGER) DESC, distributor_price ASC
    LIMIT 5
    ```
  - Returns:
    - `highestStockDistributor`: Top distributor by available quantity.
    - `alternateDistributors`: Other stocking distributors with their rates.

### Component 2: Frontend API Client (`frontend/src/services/api.ts`)
- Add method:
  ```ts
  checkMedicineStock: (medicineName: string) =>
    apiClient.get<{
      success: boolean;
      highestStockDistributor: { storeId: number; storeName: string; availability: number; ptr: number } | null;
      alternateDistributors: Array<{ storeId: number; storeName: string; availability: number; ptr: number }>;
    }>('/pharmarack/check-medicine-stock', { params: { name: medicineName } }).then(res => res.data)
  ```

### Component 3: Frontend UI on Reorder Cards (`frontend/src/pages/PharmarackCart/index.tsx`)
- State management:
  - `checkingStockMed`: Track which specific medicine is currently querying (`string | null`).
  - `checkedStockMap`: Cache results per medicine name (`Record<string, HighestStockResult>`).
- UI Rendering:
  - If stock has NOT been checked yet for this medicine:
    - Render a compact, clean button: `[ ⚡ Check Highest Stock ]`.
  - While loading:
    - Render `<Loader2 size={12} className="animate-spin" /> Checking...` on that card only.
  - Once checked:
    - If in stock elsewhere:
      - Display highlight banner: `⚡ Highest Stock: [Distributor Name] ([avail] in stock @ ₹[ptr])`
      - Display 1-click button: `[ ⚡ Reorder from Highest Stock ]`
    - If no stock found:
      - Display badge: `No alternate stock found in catalog`.

---

## 3. Human-in-the-Loop & Safety Verification
- **Zero Accidental Refetches**: Checked stock persists in module/component state while navigating subtabs.
- **Rule 6 Compliance**: When user adds to live cart from the highest stock distributor, the item enters the Live Cart review section where the user must review before final dispatch.
- **Guardrails Compliance**: Semantic Tailwind classes only (`bg-primary`, `bg-bg2`, `text-text`, `text-muted`).

---

## 4. Implementation Checklist

- [x] **Task 1: Create On-Demand Stock Check Endpoint**
  - Add `GET /api/pharmarack/check-medicine-stock` in `src/routes/pharmarack.ts`.
  - Remove eager catalog loop from `GET /api/pharmarack/reorder-recent`.
  - *Verification*: Verified `reorder-recent` returns immediately without catalog scans; `/api/pharmarack/check-medicine-stock` serves highest-stock distributors on demand.

- [x] **Task 2: Expose Service Method in `frontend/src/services/api.ts`**
  - Add `checkMedicineStock` to `api` object.

- [x] **Task 3: Implement On-Demand "Check Stock" UI on Reorder Cards**
  - Add `checkingStockMed` and `checkedStockMap` states in `frontend/src/pages/PharmarackCart/index.tsx`.
  - Add `handleCheckStock(medicineName)` handler.
  - Render `[ ⚡ Check Highest Stock ]` button and lazy results card on each medicine card.

- [x] **Task 4: Run Guardrails & Update Knowledge Graph**
  - Run `npm run guardrails` -> PASS (Exit 0, TypeScript clean).
  - Run `node scripts/quick-update.mjs`.

---

## 5. Resumption Log

| Step | Status | Completed At | Notes |
|------|--------|--------------|-------|
| Requirement Analysis | Completed | 2026-09-26 10:43 | User requested checking stock only for selected medicine to avoid unnecessary queries |
| User Decision via MCQ | Completed | 2026-09-26 10:44 | User selected Option 1: On-Demand via 'Check Stock' button on specific card |
| Plan Formulation | Completed | 2026-09-26 10:45 | Created `ON_DEMAND_SELECTED_MEDICINE_STOCK_CHECK_PLAN.md` |
| Execution | Completed | 2026-09-26 10:50 | Eager loops removed; on-demand endpoint and interactive UI implemented; guardrails passed |
