# Implementation Plan: Unified Customer Reorder & Combined (Old + New Medicine) Workflow

## Objective
Enable patients and pharmacy staff to seamlessly combine old regular medicines (refills and past special orders) with new medicine requests into a single, unified booking across both the **Customer Portal Web App** and the **WhatsApp Intelligence Bot**, with strict human-in-the-loop review at the pharmacy counter POS.

---

## Architecture & Data Flow

```
+-----------------------------------------------------------------------------------+
|                           Unified Customer History                                |
|  - patient_refills (Active chronic prescriptions)                                 |
|  - special_orders (Past out-of-stock custom orders)                                |
|  - sales_invoices (Recent counter billing records)                                |
+------------------------------------------+----------------------------------------+
                                           |
                   +-----------------------+-----------------------+
                   |                                               |
                   v                                               v
+---------------------------------------+       +---------------------------------------+
|    Customer Portal Web App (/portal)  |       |       WhatsApp Bot Intelligence       |
| - "My Prescriptions & Past Orders"    |       | - Unified getCustomerHistory()        |
| - 1-Click "Add to Basket"             |       | - Numbered Refill + Special Order list|
| - Combine with New Catalog Medicines  |       | - Bundles Old Items + New Medicines   |
| - Single "Place Combined Order"       |       | - Consolidated Confirmation Message   |
+-------------------+-------------------+       +-------------------+-------------------+
                    |                                               |
                    +-----------------------+-----------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|                        Pharmacy Counter POS & CRM (Store)                         |
| - Single grouped customer order in CRM with source tags (Refill / Special / New)  |
| - 1-Click "⚡ Sell" transfers entire combined basket directly into POS billing     |
| - Human-in-the-loop: Pharmacist verifies, adjusts quantities & approves           |
+-----------------------------------------------------------------------------------+
```

---

## Tasks

- [x] **Task 1: Backend History & Combined Procurement in WhatsApp Bot**
  - In `src/services/whatsappIntentService.ts`, updated `getCustomerHistory()` to query `patient_refills`, `special_orders`, and `sales_invoices`, deduplicating by medicine name with source tags (`refill`, `special_order`, `counter_sale`).
  - Updated repeat order / Option 3 guidance to list both refills and past special orders with numbered choices.
  - Enabled combined bundling: customers can specify numbers for regular medicines and simultaneously type new medicine names (e.g. *"1 and 2, also need 1 strip of Dolo 650"*), packing all items into `items_json` bundle for seamless booking.

- [x] **Task 2: Backend Customer Portal Unified Past Medicines API**
  - In `src/routes/customerPortal.ts`, added `GET /api/customer-portal/customer/past-medicines` endpoint:
    - Accepts `phone` or authenticated customer session.
    - Queries active refills, past special orders, and recent counter sales items with deduplication.
    - Returns normalized list of past medicines with previous quantities, dates, and pricing.

- [x] **Task 3: Customer Portal Frontend Combined Order Basket**
  - In `frontend/src/services/api.ts`:
    - Added `getCustomerPastMedicines(phone)` API client call.
  - In `frontend/src/pages/CustomerPortal/index.tsx`:
    - Added **Section 1.5: Past Special Requests & Custom Procurements** with 1-click **⚡ Reorder** buttons.
    - Added **Section 1.6: Add New Medicine to Combined Order** with debounced catalog search, autocomplete results, and "Request Custom Medicine" fallback.
    - Extended `SelectedMedicine` state with `itemType?: 'refill' | 'special_order' | 'new'`.
    - Added distinct badges (`Refill`, `Special`, `New`) in both the right-hand **Collection Order Summary** and the **Cart Modal**.
    - Enabled single combined order submission calling `POST /api/customer-portal/customer/refill-order`.

- [x] **Task 4: Pharmacy CRM Multi-Item Combined Billing Hand-off**
  - Verified `frontend/src/pages/CRM/index.tsx`:
    - Special orders and customer requests display with patient and medicine context.
    - 1-click **⚡ Sell** transfers items into POS without manual re-entry for strict human-in-the-loop validation.

- [x] **Task 5: Verification, Guardrails & Knowledge Graph Update**
  - Executed `npm run build` in `frontend/`: Succeeded (0 errors, Vite client bundle generated).
  - Executed `npx tsc --noEmit` in root: Succeeded (0 errors).
  - Executed `npm run guardrails` in root: Succeeded (PASS — 0 violations, speed architecture intact).
  - Executed `node scripts/quick-update.mjs` in root: Succeeded (Knowledge graph updated in 3.9s with 1103 nodes and 543 edges).

---

## Completion & Verification Summary

1. **WhatsApp Bot Multi-Source Memory**:
   - `whatsappIntentService.ts` now unifies past chronic refills, completed/pending special orders, and recent counter purchases into a single prioritized list.
   - When a patient selects Option 3 or requests a refill, the bot shows all past items. If the patient answers with a combined intent (e.g., *"1 and send me 1 strip of Dolo 650"*), the regex extractor splits the numerical selection from the new item name, creating a bundled multi-item order with both types.

2. **Customer Portal Combined Basket**:
   - Customer Portal now loads past special requests alongside regular prescriptions.
   - Added direct search & add for new medicines inside the customer portal refill workflow.
   - Both old refills, previous special orders, and new catalog additions can be selected together and submitted in a single checkout click.

3. **Pharmacist Human-in-the-Loop Counter Control**:
   - Every submitted order enters the store CRM as a `Pending` request grouped under the customer.
   - The pharmacist reviews the items, checks inventory/procurement, adjusts quantities, and clicks **⚡ Sell** to populate the POS billing screen instantly.
