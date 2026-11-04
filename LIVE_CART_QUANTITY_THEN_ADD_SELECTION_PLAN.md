# Implementation Plan: Live Cart Quantity Confirmation Before Add & Instant Focus Flow

**Plan Name:** `live_cart_quantity_then_add_selection`  
**Target:** Restore quantity selection (`qty`) before adding to live cart, while keeping zero-delay, zero-lag focus transitions between search, quantity, and next-medicine search in [`LiveCartAddModal.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/LiveCartAddModal.tsx) and [`LiveCartSearchSection.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/LiveCartSearchSection.tsx).

---

## 1. Problem Statement

In the previous change, selecting a medicine from the dropdown was made to immediately add the item with default quantity 1.
However, user workflow requires selecting or confirming the **quantity** (`qty`) before the item is added to the live cart.
At the same time, the process must feel instantaneous:
1. Selecting a medicine from dropdown must immediately focus the Quantity input (with quantity value highlighted).
2. Pressing `Enter` on Quantity must immediately add to cart, clear the search, and instantly restore focus to the search input.
3. No timeouts or re-render stalls.

---

## 2. Solution Workflow

### Step 1: Select Medicine from Dropdown (`LiveCartSearchSection.tsx` & `LiveCartAddModal.tsx`)
- When user clicks a suggestion or presses `Enter` on the dropdown:
  - Populate selected medicine details (`product`, `distributor`, `rate`, `productId`, `storeId`, etc.).
  - Close suggestion dropdown.
  - Immediately focus the Quantity input (`qtyInputRef.current?.focus(); qtyInputRef.current?.select()`) with 0ms delay.
  - Update dropdown badge to `↵ Select`.

### Step 2: Confirm Quantity & Add (`LiveCartAddModal.tsx`)
- User is now in the Quantity field.
- If user wants quantity 1, they simply tap `Enter`.
- If user wants a custom quantity (e.g. `10`), they type `10` and tap `Enter`.
- Form submits (`handleSubmit`):
  - Item is queued to live cart (`pendingAdds`) with truthful `Adding...` status.
  - Background Pharmarack sync runs detached.

### Step 3: Instant Next-Medicine Search
- Upon submission, form resets immediately and focus jumps directly back to the Search input (`productInputRef.current?.focus()`).
- User can immediately begin typing the next medicine name with zero delay and no dropped keystrokes.

---

## 3. Tasks & Execution Status

- [x] Task 1: Update `selectSuggestion` in [`LiveCartAddModal.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/LiveCartAddModal.tsx) to select medicine and focus Quantity input immediately
  - **Completed**: In `selectSuggestion`, set medicine details and immediately called `qtyInputRef.current?.focus(); qtyInputRef.current?.select();` with 0ms delay.
- [x] Task 2: Update [`LiveCartSearchSection.tsx`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/LiveCartSearchSection.tsx) selection callback and dropdown badge to `↵ Select`
  - **Completed**: Updated `selectSuggestion` to populate `med.medicine_name`, dismiss suggestions, and updated suggestion badge to `↵ Select`.
- [x] Task 3: Ensure `handleSubmit` clears state and focuses search input instantly for next search
  - **Completed**: In `handleSubmit`, queues item into `pendingAdds`, clears form and draft quantity, and immediately focuses `productInputRef.current?.focus()`.
- [x] Task 4: Run performance guardrails and update knowledge graph
  - **Completed**: Verified `npm run guardrails` passed (clean compile, 0 violations). Ran `node scripts/quick-update.mjs` (1440 nodes, 879 edges).
