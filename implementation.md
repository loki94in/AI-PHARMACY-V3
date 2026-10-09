# Implementation Plan: Pharmarack Order Placement, Delivery Staff Dispatch & Deduplicated Distributor Reminder Workflow

> **Task Context & Workflow Governance:**
> Based on user specification and architectural alignment:
> 1. When clicking **"Send All via WhatsApp"** in Pharmarack Cart, the app notifies **Delivery Staff** with their assigned pickup list (and optional itemized medicine list if toggled). It does **NOT** send WhatsApp messages to distributors upfront.
> 2. The order is placed officially (via direct background checkout / manual user placement on Pharmarack).
> 3. When background sync (`pharmarackOrderSyncService`) detects newly generated official Order IDs:
>    - First dispatch message to the distributor includes the newly detected Order IDs and pickup staff details.
>    - **Deduplication Rule (Same-Day Re-orders):** If a distributor was *already sent* a dispatch reminder earlier today and a new Order ID appears later, the follow-up message contains **ONLY the newly detected Order ID(s)**. Old, already sent Order IDs are strictly excluded.
>    - **Human-in-the-Loop & 5-Minute Grace Period:** Generated distributor dispatch messages are scheduled in `whatsapp_send_queue` with a 5-minute review delay. The user can view, edit, approve immediately ("Send Now"), or cancel before release.
> 4. **No installed app code was broken or touched prematurely.** This plan governs the surgical implementation once approved.

---

## Architecture & Technical Contracts

### 1. Delivery Staff Dispatch & Optional Itemized Medicine Breakdown
- **Frontend ([BatchDispatchModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PharmarackCart/BatchDispatchModal.tsx)):**
  - Add a toggle switch in the modal: `📋 Include Detailed Medicine List in Staff Dispatch`.
  - Update confirmation summary copy: "Notifies delivery staff with pickup stores; distributor dispatch will be queued once official Pharmarack Order IDs are detected."
- **Backend ([whatsappQueue.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/whatsappQueue.ts)):**
  - In `/enqueue-pharmarack-batch`:
    - If `dispatchDistributorsLater: true`, enqueue ONLY to assigned delivery boys.
    - If `includeMedicineList: true`, format each assigned distributor section in the delivery boy's message with itemized lines (Name, Pack, Qty, MRP).
    - Save cart items and distributor preferences into `pharmarack_placed_orders` with status `awaiting_order_id`.

### 2. Official Order Placement (Pharmarack Checkout Integration)
- Connect "Send All via WhatsApp" action to trigger official order placement:
  - Background checkout call or automated headless placement where supported, while fully accommodating manual placement by the user on `retailers.pharmarack.com`.
  - Maintain session persistence without violating the no-headless-browser-loop contract (`src/AGENTS.md`).

### 3. Order Sync & Order ID Detection ([pharmarackOrderSyncService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/pharmarackOrderSyncService.ts))
- Sync detects today's orders via `POST pharmretail-api.pharmarack.com/order/api/v2/DisplayOrders`.
- Save newly detected Order IDs into `pharmarack_synced_orders`.
- Query already communicated Order IDs for each distributor today.
- Compute delta: `freshOrderNos = detectedOrderNos.filter(id => !alreadyCommunicatedIds.has(id))`.

### 4. Same-Day Deduplication & Follow-Up Formatting
- **If first dispatch today:**
  - Build standard PO dispatch reminder:
    `📦 Pharmarack Order #<orderNos> has been placed. Please pack and dispatch as soon as possible...`
- **If distributor was ALREADY sent a dispatch message today:**
  - Build follow-up message strictly mentioning **ONLY newly detected Order IDs**:
    `🆕 New Pharmarack Order #<freshOrderNos> placed. Please dispatch ASAP — to be collected by <boyName> (<boyPhone>) - <storeName>`
  - Strictly omit old, previously messaged Order IDs.

### 5. 5-Minute Grace Period & Human-in-the-Loop Safeguard
- Distributor messages are queued with `scheduled_at = Date.now() + 5 * 60 * 1000`.
- UI surfaces live banner / drawer with:
  - `[Send Immediately]`
  - `[Edit Message]`
  - `[Cancel Dispatch]`
- Real-time updates via SSE `sse-dispatch-updated` and `dispatch_updated`.

---

## Verifiable Task Breakdown

1. [x] **UI Updates in BatchDispatchModal & Cart**
   - File: `frontend/src/pages/PharmarackCart/BatchDispatchModal.tsx`
   - File: `frontend/src/pages/PharmarackCart/index.tsx`
   - File: `frontend/src/services/api.ts`
   - Completed: Added `includeMedicineList` state & toggle switch with theme-compliant semantic tokens. Wired `dispatchDistributorsLater: true` and `includeMedicineList` into batch dispatch request.

2. [x] **Backend Route Refinement in whatsappQueue.ts**
   - File: `src/routes/whatsappQueue.ts`
   - Completed: Extracted `dispatchDistributorsLater` and `includeMedicineList`. Formatted itemized medicine breakdown when toggled. Deferred immediate distributor enqueue while saving placed orders and delivery boy mappings to database. Added `/item/:id/send-now` and `/items/:id/send-now` routes for immediate release.

3. [x] **Order Sync Service Deduplication & Follow-Up Logic**
   - File: `src/services/pharmarackOrderSyncService.ts`
   - File: `src/services/distributorDispatchReminderWorker.ts`
   - Completed: Added detection of previously announced order numbers today (`pharmarack_synced_orders.announced_at`). Filtered newly detected orders strictly to unannounced IDs (`newOrderNos`). Built follow-up messages strictly omitting previously announced IDs. Enforced a 5-minute scheduled hold window for distributor reminders. Adhered to Guardrail B4 for local dates.

4. [x] **Human-in-the-Loop Queue Controls on Dispatch Page**
   - File: `frontend/src/pages/Dispatch/index.tsx`
   - Completed: Exposed `pending_queue_id`, `queue_scheduled_at`, `is_held_in_grace_period`, and `synced_order_nos` on reminder rows. Added "⏳ 5-Min Review Hold" badge, "Send Now" one-click immediate release button, and "Cancel Hold" action to delete scheduled queue items.

5. [x] **Quality Checks & Knowledge Graph Sync**
   - Executed `npm run guardrails` (`tsc --noEmit` + guardrail audit): PASS (exit code 0).
   - Executed `node scripts/quick-update.mjs`: Successfully updated knowledge graph with 1169 files.

---

## Completed Tasks Log
*(New agents will resume from here; tasks are checked off as executed)*
- [x] Documentation & Template Specification updated in `ALL_TEMPLATES_IN_DETAIL.md` (Templates 1B, 1B.1, 1B.2, and 7A).
- [x] Implementation Plan created in `implementation.md`.
- [x] BatchDispatchModal toggle switch & semantic styles implemented in `BatchDispatchModal.tsx`.
- [x] Cart batch dispatch flow updated in `PharmarackCart/index.tsx` & `api.ts`.
- [x] Backend queue routing & itemized medicines toggle in `whatsappQueue.ts`.
- [x] Same-day re-order deduplication & 5-minute grace period scheduler in `pharmarackOrderSyncService.ts`.
- [x] Reminder worker schema queries updated with queue item status in `distributorDispatchReminderWorker.ts`.
- [x] Human-in-the-loop review hold & action buttons implemented in `Dispatch/index.tsx`.
- [x] Guardrails verification & TypeScript compilation verified passing with 0 violations.
- [x] Knowledge graph refreshed via `node scripts/quick-update.mjs`.
