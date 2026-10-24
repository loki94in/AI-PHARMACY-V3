# Implementation Plan: Refill Auto Cart-Add + Website Payment & Credit Booking

> Based on `REFILL_AUTO_CART_AND_WEBSITE_BOOKING_IMPLEMENTATION_PLAN.md` (created 2026-10-24).
> Status: COMPLETED.

---

## 1. Goal & Context
1. **Refill orders from online sources (website + WhatsApp)** to be added directly into the live Pharmarack cart automatically — no staff click. While the PC is OFF, orders queue in Vercel KV; when the PC comes on, the catch-up worker adds them without any click. Staff-created CRM refills remain manual staff-click.
2. **Special orders** require **patient payment confirmation first**; after the pharmacist verifies in the app, the app adds the medicines to the cart automatically.
3. The **website** becomes a direct booking surface for **refill + special + credit orders** (with patient UPI self-declaration and registered patient credit booking).

---

## 2. Architecture & Rules
- Single writer per fact (`AGENT_DATA_FLOW_TREE.md`): `patient_refills` and `special_orders`.
- `startupSyncCoordinator` is the one sanctioned auto cart-add worker (no parallel pass/table).
- Strict legitimate data: no fake success, no invented QR, no estimated prices.
- Manual-Only Patient Messaging (Owner Decision D4): notifications staged to `automation_notifications`, never auto-sent.
- Events, not timers: refill catch-up triggered by `tokenRefreshScheduler.onFirstRefreshComplete()` and `pullCloudOrdersToLocal` import event.
- Bounded batch per pass; serial and memory-friendly (P2-105).

---

## 3. Implementation Checklist & Tasks

### Phase A: Honesty Fixes
- [x] Task A.1: Update `src/routes/pharmarack.ts` no-token branch to return `{ success: false, offline: true, reason: 'NO_TOKEN' }` and typed `reason?: string`.
- [x] Task A.2: Update `frontend/src/components/QuickOrderModal.tsx`, `SpecialOrdersSection.tsx`, and `LiveCartAddModal.tsx` to truthfully display failure/offline toast when cart add fails/is offline.
- [x] Task A.3: Remove artificial injection of `auto_add_to_live_cart='true'` in `src/routes/settings.ts` so the real `storeSettingsService` value is served.
- [x] Task A.4: In `src/routes/orders.ts` (`confirm-distributor`), gate cart re-add to payment-confirmed or advance-paid orders; otherwise mark `needs_live_cart_sync=1`.
- [x] Task A.5: In `src/services/startupSyncCoordinator.ts`, stage `live_cart_sync_notification` into `automation_notifications` with `status='staged', needs_confirmation=1` instead of auto-sending via WhatsApp.
- [x] Task A.6: Clean up dead `initiateRefill` in `website/public/catalog.html`.

### Phase B: Refill Auto-Add (Online-Sourced Only)
- [x] Task B.1: Add `refill_auto_cart_add` setting key (`auto | manual | off`, default `auto`) in `storeSettingsService.ts` and expose it in Settings UI (`IntegrationsCredentialsTab.tsx`).
- [x] Task B.2: Extend `database.ts` (all 3 schema tiers) with `source TEXT DEFAULT 'counter'` and `cart_status TEXT DEFAULT 'pending'`. Extend `startupSyncCoordinator.ts` with serial, idempotent, bounded-batch refill catch-up pass (`runRefillAutoCartCatchUp`) using `processRefillCartItem` for online sources (`website`, `whatsapp`).
- [x] Task B.3: Trigger refill catch-up pass after boot session refresh (`tokenRefreshScheduler.onFirstRefreshComplete()`) and after cloud order pull in `cloudCatalogSyncService.ts`. Also tag inbound WhatsApp confirms with `source='whatsapp'`.
- [x] Task B.4: Wire refill query invalidation / SSE updates (`useGlobalSseInvalidation.ts`) so UI reflects cart status changes.
- [x] Task B.5: Update docs (`src/AGENTS.md`, `AGENT_DATA_FLOW_TREE.md`) acknowledging this sanctioned worker path.

### Phase C: Website Payment Self-Confirm (Vercel)
- [x] Task C.1: Include live allocated UPI QR and payee details in order push payload to Vercel KV (`cloudCatalogSyncService.ts` / `orders.ts`).
- [x] Task C.2: Implement `payment_declared` endpoint and UI button ("I Have Paid (Confirm Payment)") in `website/api/catalog.js` and `website/public/catalog.html`.
- [x] Task C.3: Map payment-declared orders in desktop import (`cloudCatalogSyncService.ts`) to `payment_status='PENDING_VERIFICATION'`; pharmacist verification triggers live cart add.
- [x] Task C.4: Push verified status back to Vercel KV via `update_order_status` so customer status tracks live cart addition (`In Live Cart`, `payment_status='CONFIRMED'`).

### Phase D: Credit Booking (Vercel)
- [x] Task D.1: Add "Pay Later (Credit)" option in website checkout drawer for OTP-verified registered patients.
- [x] Task D.2: Map website credit orders to `payment_medium='CREDIT'`, `payment_status='UNPAID'` in `cloudCatalogSyncService.ts` and `website/api/catalog.js`.
- [x] Task D.3: Finalizing credit order creates the legitimate invoice on CREDIT medium into CRM credit ledger without invented data.

### Phase E: Verification, Tests, Guardrails & Bookkeeping
- [x] Task E.1: Unit tests for refill auto cart catch-up, payment declaration, and offline cart-add truthfulness (`tests/refillAutoCartCatchUp.test.ts`).
- [x] Task E.2: Run TypeScript check (`npx tsc --noEmit`), client build (`npm run build:client`), and guardrails (`npm run guardrails`).
- [x] Task E.3: Update docs, `SMALL_BUG_FIX_PLAN.md` (P2-061 / settings truthfulness), root `AGENTS.md`, and run `node scripts/quick-update.mjs`.

---

## 4. Execution Log
- **2026-10-24 09:30**: Phase A Completed:
  - `src/routes/pharmarack.ts`: Truthful `{ success: false, offline: true, reason: 'NO_TOKEN' }` when token is absent.
  - `frontend/src/components/QuickOrderModal.tsx`, `SpecialOrdersSection.tsx`, `LiveCartAddModal.tsx`: Updated toast notifications to reflect offline token state truthfully.
  - `src/routes/settings.ts`: Removed artificial override of `auto_add_to_live_cart='true'`.
  - `src/routes/orders.ts`: Gated cart re-addition on `isPaymentConfirmed` in `confirm-distributor`.
  - `src/services/startupSyncCoordinator.ts`: Staged offline sync alerts into `automation_notifications` (manual-only messaging contract D4).
  - `website/public/catalog.html`: Removed dead `initiateRefill` function.
- **2026-10-24 09:45**: Phase B Completed:
  - `src/services/storeSettingsService.ts`: Added `RefillAutoCartAddMode` (`auto | manual | off`).
  - `src/database.ts`: Added `source` and `cart_status` columns to `patient_refills` in all schema layers.
  - `frontend/src/pages/Settings/IntegrationsCredentialsTab.tsx`: Added Online Refill Auto Cart-Add UI selector.
  - `frontend/src/hooks/useGlobalSseInvalidation.ts`: Added `cart_updated` SSE event handling.
  - `src/services/startupSyncCoordinator.ts`: Implemented `runRefillAutoCartCatchUp(triggerSource)` with single-flight mutex, batch limit 10, online sources only (`website`, `whatsapp`).
  - `src/services/cloudCatalogSyncService.ts`: Wired `runRefillAutoCartCatchUp('cloud_pull')` after cloud orders import.
  - `src/services/whatsappIntentService.ts`: Tagged confirmed refills with `source='whatsapp'`.
  - `src/AGENTS.md` and `AGENT_DATA_FLOW_TREE.md`: Documented sanctioned worker policy for online refills.
- **2026-10-24 09:55**: Phase C & D Completed:
  - `website/api/catalog.js`: Added `action === 'payment_declared'` endpoint, attached `upi_uri` / `upi_id`, supported `paymentMethod` (`UPI`, `CREDIT`, `COUNTER_PICKUP`).
  - `website/public/catalog.html`: Added Payment Method cards in cart drawer, rendered UPI self-confirmation button & badges (`Awaiting Verification`, `In Live Cart`, `Khata / Pay Later`).
  - `src/routes/websiteOrders.ts`: Synchronized status updates back to Vercel KV (`status='In Live Cart', payment_status='CONFIRMED'`) upon pharmacist payment approval.
- **2026-10-24 10:05**: Phase E Completed:
  - Created unit test `tests/refillAutoCartCatchUp.test.ts` (all 5 tests passed).
  - Executed `npx tsc --noEmit` (zero errors).
  - Executed `npm run build:client` (built in 3m 5s, exit code 0).
  - Executed `npm run guardrails` (PASS — no violations).
  - Executed `node scripts/quick-update.mjs` (updated knowledge graph, exit code 0).
