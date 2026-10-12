# Implementation Plan: Fix Order & Refill Fulfillment 15000ms Timeout in Quick Assist and Installed App

## 1. Overview & Problem Definition
- **Issue**: In the installed desktop application (`PharmacyOS.exe` / `PharmacyBackend.exe`), fulfilling an order or refill cycle in the **Quick Assist Sidebar** fails and returns a timeout error: `"timeout of 15000ms exceeded"`.
- **Root Causes**:
  1. **Global Axios Timeout (15,000ms)**: In `frontend/src/services/api.ts`, `apiClient` enforces `timeout: 15000`. Batch actions that perform multiple sequential side-effects (PDF generation, upstream cart queries, reminder purges) exceed this window under local system load.
  2. **Multi-Request Herd via `Promise.all`**: In `QuickAssistSidebar.tsx`, updating a multi-item order group fires `Promise.all(group.items.map(i => apiClient.post('/orders/' + i.id + '/status', ...)))`. On SQLite's single connection, 3–5 simultaneous write calls contend for transaction locks and queue behind each other, multiplying latency.
  3. **Blocking Synchronous Work Inside Route Handlers**: In `POST /api/orders/:id/status`, if the status is updated, it generates PDF slips (`pdfInvoiceService.generateSpecialOrderSlipPdf`) and calls upstream Pharmarack live cart sync (`adjustSpecialOrderInLiveCart` with a 1500ms race timeout per item) before sending the HTTP response.
  4. **Status Alias Inconsistency (`'Completed'` vs `'Fulfilled'`)**: Quick Assist sends `{ status: 'Completed' }`, but `handleStatusUpdate` in `src/routes/orders.ts` does not normalize `'Completed'` to `'Fulfilled'` (unlike `PUT /api/orders/:id`), causing reminder cancellation and notification updates to skip.
  5. **Background OCR Event Loop Starvation**: During distributor email sync, PDF invoice OCR (`runPdfOcrFallback` / Tesseract.js) can monopolize the Node.js event loop without yielding ticks, delaying HTTP response dispatch.

---

## 2. Surgical Implementation Plan

### Step 1: Add Atomic Batch Status Endpoint & Normalize Status in Backend (`src/routes/orders.ts`)
- In `handleStatusUpdate`: normalize `status`: if `status.toLowerCase() === 'completed'`, set `status = 'Fulfilled'`.
- Move heavy side-effects in `handleStatusUpdate` (PDF slip generation, live cart adjust, broadcasts) to non-blocking `setImmediate` background tasks so the HTTP response returns within <50ms.
- Add `POST /batch-status` (and `PUT /batch-status`) endpoint:
  - Takes `{ order_ids: number[], status: string, resend?: boolean, skipWhatsApp?: boolean }`.
  - Normalizes `'Completed'` to `'Fulfilled'`.
  - Updates all items in a single atomic SQL query:
    `UPDATE special_orders SET status = ?, notified = ?, auto_remind = ?, last_collection_reminder_at = ? WHERE id IN (...)`
  - Cancels pending WhatsApp alerts and purges reminders in one pass.
  - Returns `{ success: true, count, status }` in <50ms.

### Step 2: Optimize Refill Fulfillment Route (`src/routes/refills.ts`)
- In `POST /patient/:phone/fulfill-all`:
  - Ensure all database writes (`INSERT INTO refill_fulfillments`, `UPDATE patient_refills`) execute efficiently.
  - Ensure `purgePendingCustomerReminders` runs safely and `checkAllRefills` remains gated in `setImmediate`.
  - Respond immediately with `{ success: true, fulfilledCount, message }`.

### Step 3: Add Batch API Methods & Increase Fulfillment Timeout (`frontend/src/services/api.ts`)
- Add `updateOrdersBatchStatus`:
  ```ts
  updateOrdersBatchStatus: (orderIds: number[], status: string, options?: { skipWhatsApp?: boolean; resend?: boolean; sendWhatsApp?: boolean }) =>
    apiClient.post('/orders/batch-status', { order_ids: orderIds, status, ...options }, { timeout: 45000 }).then(res => res.data),
  ```
- Configure dedicated `{ timeout: 45000 }` on:
  - `fulfillAllRefills`
  - `fulfillRefill`
  - `fulfillSpecialOrder`
  - `updateOrderStatus`

### Step 4: Upgrade Quick Assist Sidebar to Atomic Batch Status & Resilient Error Handling (`frontend/src/components/QuickAssistSidebar.tsx`)
- In `handleUpdateGroupStatus`:
  - Replace `Promise.all(group.items.map(i => apiClient.post(...)))` with single call:
    `await api.updateOrdersBatchStatus(itemIds, newStatus, { resend: opts?.resend })`.
  - Extract detailed error message from `(err as any)?.response?.data?.error || (err as any)?.message` for toast feedback.
- In `handleFulfillRefillGroup`:
  - Extract detailed error message from response or timeout.

### Step 5: Add Event-Loop Yielding in OCR Worker (`src/services/aiCameraService.ts`)
- Insert event-loop breathing ticks (`await new Promise(r => setImmediate(r))`) during multi-page PDF image processing so counter fulfillment requests are never starved.

### Step 6: Verification, Guardrails & Knowledge Graph
- Run `npm run guardrails` to ensure zero performance guardrail violations.
- Run `npm run build:client` to verify frontend build cleanly.
- Run `node scripts/quick-update.mjs` to update `.understand-anything/knowledge-graph.json`.
- Register the fix in `SMALL_BUG_FIX_PLAN.md`.

---

## 3. Tasks & Completion Log
- [x] Task 1: Normalize status & add atomic `POST /orders/batch-status` in `src/routes/orders.ts`
  - Completed: Added `handleBatchStatusUpdate` supporting `POST /batch-status` and `PUT /batch-status`. Normalizes `'Completed'` to `'Fulfilled'`. Updates special orders in an atomic query, cleans up WhatsApp alerts and purges reminders in one pass, and offloads live cart adjustments to background `setImmediate` so responses return in <50ms.
- [x] Task 2: Optimize `src/routes/refills.ts` fulfillment routes with fast background dispatch
  - Completed: Wrapped `refills.ts` fulfillment inserts and updates in an atomic SQLite transaction (`BEGIN TRANSACTION` ... `COMMIT`), reducing multi-item schedule fulfillment disk I/O to a single flush.
- [x] Task 3: Add `updateOrdersBatchStatus` and extended 45s timeouts in `frontend/src/services/api.ts`
  - Completed: Added `updateOrdersBatchStatus` with `{ timeout: 45000 }`. Configured dedicated 45s timeouts on `fulfillAllRefills`, `fulfillRefill`, `fulfillSpecialOrder`, and `updateOrderStatus`.
- [x] Task 4: Upgrade `QuickAssistSidebar.tsx` to use atomic batch status and clear error handling
  - Completed: Replaced `Promise.all` concurrent request burst in `handleUpdateGroupStatus` with single call to `api.updateOrdersBatchStatus`. Enhanced error toasts to extract informative server error messages instead of generic fallbacks.
- [x] Task 5: Add event-loop tick yields in `src/services/aiCameraService.ts` & `src/services/emailService.ts`
  - Completed: Inserted `await new Promise(r => setImmediate(r))` breathing ticks before image preprocessing, between OCR engines, and across PDF page rendering iterations.
- [x] Task 6: Run guardrails, client build, tests, update `SMALL_BUG_FIX_PLAN.md` & knowledge graph
  - Completed: `npm run guardrails` passed with exit 0 (`tsc --noEmit` clean, 0 violations); `npm run build:client` built production bundle in 41.45s with 0 errors; registered `[Fixed] P2-87` in `SMALL_BUG_FIX_PLAN.md`; updated knowledge graph via `scripts/quick-update.mjs`.
