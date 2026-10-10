# Unified Quick Assist & Refill Workflow: Order Progression, Persistent Visibility & POS Disarm

## Overview
This plan implements the complete unified order workflow across Quick Assist, CRM Refills, and Special/Online orders:
1. **Initial State (Pending / New):**
   - Refills: `[Add to Cart]` + `[Edit]`
   - Special Orders / Online Orders: `[Make Order]` + `[Edit]`
2. **Ordered State:**
   - Both switch to exactly two buttons: `[Mark Ready]` and `[POS]`
3. **Ready State (Persistent Visibility & Auto-Reminder):**
   - Clicking `[Mark Ready]` marks the item ready and arms `auto_remind = 1` for sending collection reminders.
   - The order **stays visible** in Quick Assist and CRM Refills until the user clicks `[POS]`.
4. **POS Click (Instant Disarm & Clearance):**
   - When the user clicks `[POS]`, the app immediately calls `/sales/counter-session` to:
     - Disarm `auto_remind = 0`
     - Purge and cancel any pending / queued collection reminders
     - Remove the order from the pending reminder/action queue, even before the bill is saved!

---

## Changes by Subsystem

### 1. Refill & Order Settled Logic (`frontend/src/utils/refillSettled.ts`)
- Modify `isRefillSettled` and `isOrderItemSettled` so that an item is only considered settled from the pending action list once POS billing / counter session has been engaged or the order is fulfilled/completed.
- Ensure ready orders stay visible in Quick Assist until POS is clicked.

### 2. Quick Assist Panel (`frontend/src/components/QuickAssistSidebar.tsx`)
- Standardize button progression:
  - **Refills:**
    - `upcoming`: `[Add to Cart]` + `[Edit]` (or `[Already Added]` if external)
    - `ordered`: `[Mark Ready]` + `[POS]`
    - `ready`: Keep visible! Show `[Re-Send Reminder]` + `[POS]`
  - **Special Orders & Online Orders:**
    - `Pending`: `[Make Order]` + `[Edit]` (plus cancel)
    - `Ordered`: `[Mark Ready]` + `[POS]`
    - `Ready`: Keep visible! Show `[Resend]` + `[POS]`
- Update `openPos` handler across all order types:
  - Immediately disarms `auto_remind` on backend via `/sales/counter-session`
  - Optimistically marks the order/refill as POS-engaged in the sidebar so it stops background reminder loops immediately.

### 3. CRM Refills Section (`frontend/src/pages/CRM/RefillsSection.tsx`)
- Prevent hiding patients who are in 'Ready' status from the Overdue / Due Soon action tabs until POS is clicked or sale is made.
- Standardize the buttons: `[Add to Cart]`, then `[Mark Ready]` + `[POS]`.

### 4. Backend Disarm & Counter Session Safety (`src/routes/sales.ts`)
- Ensure `/sales/counter-session` and POS bill save immediately mark `auto_remind = 0`, clear collection queues, and broadcast update events.

---

## Verification Plan
1. Check TypeScript compilation (`tsc --noEmit`).
2. Run automated guardrails (`npm run guardrails`).
3. Update Auto-Knowledge Graph (`node scripts/quick-update.mjs`).
4. Verify UI button progression and POS disarm flow.

---

## Completion Checklist
- [x] Task 1: Update `refillSettled.ts` to keep Ready items visible until POS engagement.
- [x] Task 2: Standardize button states and POS disarm in `QuickAssistSidebar.tsx`.
- [x] Task 3: Update `RefillsSection.tsx` so Ready patients stay visible with POS button.
- [x] Task 4: Verify backend disarm on POS click in `sales.ts`.
- [x] Task 5: Run guardrails and update knowledge graph.
