# Sale Bill Management, Item Modification & Deletion Implementation Plan

## Objective
Provide an interactive, human-in-the-loop **Bill Management & Deletion Modal** in the Sells page that allows the pharmacy user to:
1. Inspect all items in the bill with live stock context.
2. Modify item quantities/lines (e.g. if customer returned partial items or line items need adjustment) and save the modified bill with automatic net stock reconciliation.
3. Delete or void the entire bill with an explicit stock restoration preview and audit reason.
4. Eliminate all stale data reflection across the frontend (Sells page, Investigation Center, POS, Dashboard) with instant optimistic UI updates and backend cache eviction.

---

## Root Causes & Functional Requirements
1. **Partial / Disputed Bill Handling**: A user might not want to delete the whole bill if only certain medicines were taken or returned. The popup allows editing quantities or deleting specific lines before deciding to save or completely delete.
2. **Stale UI Lag on Delete/Edit**: The frontend Sells table and Investigation timeline held stale cache references. All mutations must update local state immediately (0ms lag) and flush `timelineCache`.
3. **Audit Compliance**: Every edit and deletion records a structured entry in `action_logs` with the operator's reason.

---

## Tasks Checklist

- [x] **Task 1: Backend Sale Deletion & Audit Invalidation (`src/routes/sales.ts`)**
  - Accepted optional `reason` in request body.
  - Invalidated `timelineCache` via `invalidateInvestigationTimelineCache()`.
  - Recorded structured audit log in `action_logs` (`sale_deleted`, metadata with invoice_no, items restored, total amount, reason).
  - Broadcasted SSE `sales_sync` ({ action: 'delete', id, invoice_no }), `inventory_sync`, and `inventory_changed`.

- [x] **Task 2: Sells Bill Management & Modification Modal (`frontend/src/pages/Sells/index.tsx`)**
  - Upgraded the bill action dialog into a comprehensive **Bill Management & Deletion Modal**:
    - **Header**: Invoice No, Date, Customer Name/Phone, Payment Mode, Total Amount.
    - **Item Table**: Medicine Name, Batch No, Expiry, Qty, Loose Qty, MRP, Unit Price, Line Total.
    - **Inline Edit Capabilities**: Increment/decrement quantities, remove individual items, or adjust prices.
    - **Live Delta Summary**: Displays net stock returning to shelf vs remaining sold.
    - **Action Controls**:
      - **"Save Bill Changes"**: Calls `PUT /api/sales/:id` to commit modifications and reconcile shelf stock.
      - **"Delete Entire Bill"**: Prompts for reason and calls `DELETE /api/sales/:id` to restore full stock.
      - **"Cancel"**: Closes modal with zero state mutation.

- [x] **Task 3: Optimistic UI Updates & Instant Cache Sync (`frontend/src/pages/Sells/index.tsx` & `frontend/src/hooks/useInfiniteScroll.ts`)**
  - On delete: Immediately filters out the deleted invoice from `items` and purges `globalModuleCache['sells-invoices-cache']` in 0ms.
  - On save/modify: Optimistically updates the invoice row values (subtotal, total_amount, item_count) in `items`.
  - Added direct query cache eviction in `useGlobalSseInvalidation.ts` so `sales_sync` delete event removes the invoice ID from TanStack React Query cache across all pages/tabs.

- [x] **Task 4: Timeline Cache Integration (`src/routes/investigation.ts`)**
  - Exported `invalidateInvestigationTimelineCache` and ensured sales deletion invokes it immediately.

- [x] **Task 5: Verification & Safety Guardrails**
  - Ran `npm run guardrails` (Passed with 0 violations, clean TypeScript `tsc --noEmit`).
  - Ran `npm --prefix frontend exec -- tsc --noEmit` (Passed with 0 violations).
  - Updated knowledge graph via `node scripts/quick-update.mjs`.

---

## Completed Summary
All 5 tasks are fully implemented and verified. The Sells page now features 0ms optimistic eviction on delete/edit, backend timeline cache invalidation, and an interactive human-in-the-loop Bill Management modal with shelf stock delta reconciliation.
