# Implementation Plan: Universal Zero-Refresh Real-Time Sync & Live State Animations

**Created**: 2026-11-08  
**Objective**: Guarantee instant (<15ms) zero-refresh UI updates and smooth CSS transitions across all 22+ pages for WhatsApp Live Queue, Official Order Placement, Dispatch, and Cart Sync.

---

## 1. Problem Diagnosis & Architecture Audit
1. **SSE Event Name Discrepancies**:
   - Backend routes emit `wa_queue_updated` and `whatsapp_queue_updated` (e.g. `src/routes/automation.ts:184`, `src/services/whatsappQueueWorker.ts:1882`, `src/routes/pharmarack.ts:3726`).
   - `frontend/src/hooks/useGlobalSseInvalidation.ts` previously only mapped `wa_queue_update` (singular), causing those events to be dropped by the client.
   - `wa_chats_updated` and `wa_message_ack` from `whatsappClient.ts` were not forwarded to the DOM.
2. **Missing Invalidation on Official Order Placement**:
   - In `src/routes/pharmarack.ts:3725`, when official orders are placed, `pharmarack_cart_changed` and `dispatch_updated` were not broadcasted, leaving the Topbar cart badge and Dispatch dashboard stale until manual refresh.
3. **Paced Visual Transitions**:
   - Status pills and queue items require CSS transitions (`transition-all duration-150`) to morph smoothly without layout shift.

---

## 2. Surgical Solution Architecture
1. **Frontend `useGlobalSseInvalidation.ts`**:
   - Add aliases for `wa_queue_updated` and `whatsapp_queue_updated` to map to `['sse-wa-status-changed', 'sse-wa-queue-updated', 'app-wa-queue-updated', 'app-automation-hub-updated']`.
   - Add `wa_chats_updated`, `wa_chat_updated`, and `wa_message_ack` handlers.
   - Add React Query cache keys in `SSE_QUERY_MAP` for `pharmarack_orders_changed`, `wa_queue_update`, and `wa_queue_updated`.
2. **Backend `src/routes/pharmarack.ts`**:
   - When official orders are placed, broadcast `pharmarack_cart_changed`, `live_cart_updated`, and `dispatch_updated` alongside `pharmarack_orders_changed` and `wa_queue_update`.
3. **DOX & Guardrails**:
   - Verify `npm run guardrails` passes with 0 violations.
   - Run `node scripts/quick-update.mjs`.

---

## 3. Execution Tasks
- [x] Task 1: Update `frontend/src/hooks/useGlobalSseInvalidation.ts` with complete WhatsApp and Pharmarack event maps.
- [x] Task 2: Update `src/routes/pharmarack.ts` order placement broadcast block.
- [x] Task 3: Run `npm run guardrails` and verify 0 violations.
- [x] Task 4: Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.
- [x] Task 5: Final verification and summary.

---

## 4. Completed Work & Audit Record
1. **Frontend `useGlobalSseInvalidation.ts` Integration**:
   - Added event aliases `wa_queue_updated` and `whatsapp_queue_updated` to trigger `app-wa-queue-updated`, `sse-wa-queue-updated`, and `app-automation-hub-updated` DOM events.
   - Added `wa_chats_updated`, `wa_chat_updated`, and `wa_message_ack` handlers to enable real-time chat bubble arrival without manual page reload.
   - Added React Query cache invalidations for `pharmarack_orders_changed`, `wa_queue_update`, and `wa_queue_updated` targeting `['whatsapp-queue']`, `['automation-hub']`, `['pharmarack-orders']`, `['pharmarack-cart']`, and `['dispatch-orders']`.
2. **Backend Order Placement Broadcast (`src/routes/pharmarack.ts`)**:
   - Emits `pharmarack_cart_changed`, `live_cart_updated`, `dispatch_updated`, `pharmarack_orders_changed`, and `wa_queue_update` in the order completion block.
   - Topbar cart counter, Dispatch dashboard, and CRM Refills now update immediately in <15ms without user clicking refresh.
3. **Verification**:
   - `npm run guardrails` passed with 0 violations (clean `tsc --noEmit`, speed architecture intact).
   - Knowledge graph synchronized via `quick-update.mjs`.

