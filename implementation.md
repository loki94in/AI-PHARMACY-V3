# Implementation Plan: Fix 18 Form Field Violating Nodes (Missing id / name)

## 1. Problem Statement & Root Cause

### Observed Problem
Chrome DevTools Issues tab reports:
- `18 Improvements: A form field element should have an id or name attribute`
- `A form field element has neither an id nor a name attribute. This might stop the browser from correctly autofilling the form.`
- `AFFECTED RESOURCES: 18 resources`

### Root Cause
In `frontend/src/pages/Sells/index.tsx`, 18 form elements (`<input>` and `<select>`) were created without explicit `id` and `name` attributes:
1. Date filter "FROM" input (`line 763`)
2. Date filter "TO" input (`line 770`)
3. Table column search "Search No..." input (`line 832`)
4. Table column search "Search patient/phone/medicine..." input (`line 843`)
5. Table column search "Search doctor..." input (`line 861`)
6. Table column search "Min ₹" input (`line 873`)
7. Table column search "Max ₹" input (`line 880`)
8. Table column filter "Pay Via" `<select>` (`line 902`)
9. Edit sale modal: Customer name input (`line 1114`)
10. Edit sale modal: Customer phone input (`line 1124`)
11. Edit sale modal: Payment method `<select>` (`line 1134`)
12. Edit sale modal items: Item quantity input (`line 1238`)
13. Edit sale modal items: Loose units input (`line 1263`)
14. Edit sale modal items: Discount percentage input (`line 1284`)
15. Edit sale modal items: MRP input (`line 1295`)
16. Edit sale modal items: Unit price input (`line 1305`)
17. Edit sale modal: Audit reason input (`line 1399`)
18. Edit sale modal: Total discount amount input (`line 1426`)

Without `id` and `name` attributes, Chrome flags these elements as violating nodes, and browser autofill/extensions (e.g. Wireframeit) inject synthetic names (`field_30`, `field_32`).

---

## 2. Proposed Changes

In `frontend/src/pages/Sells/index.tsx`:
- Add semantic, unique `id`, `name`, and `autocomplete="off"` attributes to all 18 input/select elements.
- Connect labels or aria/titles where appropriate for maximum accessibility.

---

## 3. Verification Plan
1. **Frontend Type Check & Build**:
   - Run `npm run build:client` to confirm 0 TypeScript or JSX syntax errors.
2. **Performance Guardrails**:
   - Run `npm run guardrails` to confirm clean pass.
3. **Knowledge Graph Sync**:
   - Run `node scripts/quick-update.mjs`.

---

## 4. Tasks Completed & Progress Tracker
- [x] Task 1: Add id and name attributes to Date Filter inputs (Items 1-2).
  - *Completed*: Added `id="sells-filter-date-from"`, `name="sells_date_from"`, `id="sells-filter-date-to"`, `name="sells_date_to"`, `autoComplete="off"`, and connected `<label htmlFor="...">` elements.
- [x] Task 2: Add id and name attributes to Table Column Search inputs (Items 3-8).
  - *Completed*: Added semantic `id`, `name`, `autoComplete="off"`, and `aria-label` attributes to `sells-filter-invoice-no`, `sells-filter-query`, `sells-filter-doctor`, `sells-filter-min-amount`, `sells-filter-max-amount`, and `sells-filter-payment-medium`.
- [x] Task 3: Add id and name attributes to Edit Sale Modal form inputs (Items 9-18).
  - *Completed*:
    - Customer Info: `edit-sale-customer-name`, `edit-sale-customer-phone`, `edit-sale-payment-medium` with `<label htmlFor="...">`.
    - Table Item Rows: `edit-item-qty-${idx}`, `edit-item-loose-${idx}`, `edit-item-discount-${idx}`, `edit-item-mrp-${idx}`, `edit-item-price-${idx}` with dynamic names and accessibility labels.
    - Financial & Audit: `edit-sale-reason` and `edit-sale-discount-amount` with corresponding labels.
- [x] Task 4: Verify build, guardrails, and update knowledge graph.
  - *Completed*:
    - `npm run guardrails`: Passed with 0 violations.
    - `npm run build:client`: Succeeded cleanly (`tsc -b && vite build` built in 49.58s with 0 errors).
    - `node scripts/quick-update.mjs`: Knowledge graph synchronized (1120 nodes, 729 edges).
