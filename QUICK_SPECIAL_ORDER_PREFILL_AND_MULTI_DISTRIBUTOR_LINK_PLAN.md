# QUICK_SPECIAL_ORDER_PREFILL_AND_MULTI_DISTRIBUTOR_LINK_PLAN

## Objective
Enable seamless re-ordering and customer ordering directly from the Special Orders page (`CRM → Special Orders`) using the **Quick Special Order popup (`SpecialOrderAddModal`)** instead of the wholesale Live Cart Add modal. Pre-fill the customer's identity (name, phone, salutation) while allowing single-click modification for new/different patients, pre-fill medicine details, apply the 2-word search token rule, auto-stage deliverable stock ($\ge 15$ quantity) from mapped distributors, enable easy switching to alternative distributors if the current distributor is out of stock, and automatically persist multi-distributor links for the medicine.

---

## Architecture Flow

```mermaid
flowchart TD
    A["Special Orders Card (CRM)"] -->|User clicks 'Cart' (Re-order)| B["Open SpecialOrderAddModal (Quick Special Order)"]
    B --> C["Pre-fill: Patient details + Medicine Name + Qty"]
    C --> D{"Re-order for Same or Different Patient?"}
    D -- "Same Patient" --> E["Keep existing customer details"]
    D -- "Different Patient" --> F["Edit Customer Name / Select from Suggestions"]
    E --> G["Live Distributor Search (First 2 Alphanumeric Words)"]
    F --> G
    G --> H{"Current Distributor Stock >= 15?"}
    H -- "Yes" --> I["Auto-stage deliverable stock with green High badge"]
    H -- "No / OOS" --> J["Highlight Alternative Stocked Distributors in Dropdown"]
    J --> K["User selects alternate distributor"]
    I --> L["Submit 'Log & Sync Cart' (Human-in-the-Loop)"]
    K --> L
    L --> M["Auto-persist Link in medicine_distributor_links"]
    L --> N["Create Order in special_orders"]
    L --> O["Dispatch Quick Assist & CRM real-time events"]
```

---

## Implementation Details

1. **`frontend/src/utils/searchTokens.ts`**:
   - `getFirstTwoAlphanumericTokens(query: string)`: Cleans all non-alphanumeric punctuation and extracts the first two words (e.g. `AUGMENTIN-625 DUO TAB` $\to$ `AUGMENTIN 625`, `PAN-D CAP` $\to$ `PAN D`).
   - `hasMinStock15(result: PharmarackSearchResult)`: Checks if a distributor has at least 15 units available or high stock indicator.

2. **`frontend/src/components/SpecialOrderAddModal.tsx`**:
   - Added `initialOrder?: Partial<SpecialOrderItem> | null` prop.
   - Pre-fills patient identity (`salutation`, `name`, `phone`) and medicine details (`product`, `qty`, `distributor`, `rate`, `mrp`, `scheme`, `product_id`, `store_id`).
   - Renders a prominent **"Re-order Special Request"** header with **"Re-order Mode"** badge and helpful subtext.
   - Allows changing patient name, phone, or quantity for new or different patients without restriction.
   - Uses `getFirstTwoAlphanumericTokens` for medicine search, auto-staging $\ge 15$ stock options.
   - Dispatches `specialOrdersEvent.triggerUpdated()` and `'refresh-special-orders'` DOM events to refresh QA instantly.

3. **`frontend/src/pages/CRM/SpecialOrdersSection.tsx`**:
   - Swapped out wholesale `LiveCartAddModal` for `SpecialOrderAddModal`.
   - Wired `handleAddToCart(order)` to set `reorderItem` and open `SpecialOrderAddModal`.
   - Passing `initialOrder={reorderItem}` and resetting on modal close.

4. **`frontend/src/components/LiveCartSearchSection.tsx` & `LiveCartAddModal.tsx`**:
   - Synchronized with `getFirstTwoAlphanumericTokens` and stock threshold $\ge 15$.

---

## E2E Verification (`tests/special-order-reorder.e2e.ts`)

Executed via `npx e2e run tests/special-order-reorder.e2e.ts`:
- **Test 1 (`Clicking Cart in Special Orders opens Quick Special Order modal instead of wholesale Live Cart modal`)**:
  - Navigates to `/crm` and switches to the `Special Requests` tab.
  - Locates the special order card's `Cart` button and clicks it.
  - Asserts that `SpecialOrderAddModal` opens with header `"Re-order Special Request"` and badge `"Re-order Mode"`.
  - Asserts that `LiveCartAddModal` (`"Add Medicine to Live Wholesale Cart"`) does NOT open.
  - Asserts that medicine name and patient details are pre-filled.
  - Asserts that the patient name can be modified for re-ordering to a different customer.
  - Closes the modal cleanly via Cancel button.
  - **Verdict**: PASS.
- **Test 2 (`Medicine search token rule (first 2 words/alphanumerics) and stock checks`)**:
  - Validates token extraction across various formats (`TELMA 40MG TAB 10S` $\to$ `TELMA 40MG`, `PAN-D CAPSULE STRIP` $\to$ `PAN D`, `AUGMENTIN-625 DUO TAB` $\to$ `AUGMENTIN 625`).
  - **Verdict**: PASS.

---

## Performance & Quality Gate Status
- `npm run guardrails`: 0 violations (`tsc --noEmit` clean, speed architecture intact).
- `npm --prefix frontend run build`: Successful clean build.
- `node scripts/quick-update.mjs`: Knowledge graph updated (1,470 files).
