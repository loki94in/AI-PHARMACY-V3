# Implementation Plan: Exact Requested Quantity in Live Cart & Unfiltered Cart Visibility

## Context & Problem Statement
1. **Quantity Accumulation / Unintended Inflation in Live Cart**:
   - In `src/routes/pharmarack.ts` (`normalizeCartAddRequest` & `addItemsToPharmarackCart`), adding an item to the Pharmarack live cart performs an additive merge:
     ```typescript
     targetCartQty = existingQty > 0 ? (existingQty + requestedQty) : requestedQty;
     ```
   - When a customer requested 1 strip (e.g. Special Order #177 for *Nurewire*), if a previous draft line of 12 was in the distributor cart, the app automatically computed `12 + 1 = 13`.
   - **User Rule**: The app must **never edit, auto-accumulate, or inflate** quantities in the live cart. It must strictly add **only the requester's requested number (`requestedQty`)**.
2. **Cart Visibility & Hiding Items**:
   - In `frontend/src/pages/PharmarackCart/index.tsx`, items and distributors can be partitioned or hidden across tabs (`unsent`, `sent`, `failed`, `unmapped`), or filtered out by dispatch status.
   - The user requires the app to **show actual cart values truth-first**, never hiding items or distributors that actually reside in the upstream cart.

---

## Proposed Changes

### 1. Backend: Pure Exact Quantity in `src/routes/pharmarack.ts`
- **File**: `src/routes/pharmarack.ts`
- **Location**: `normalizeCartAddRequest` (lines 2045–2055) & `addItemsToPharmarackCart` (lines 2475–2485)
- **Change**:
  - Remove the auto-accumulating `(existingQty + requestedQty)` fallback.
  - Set `targetCartQty = requestedQty` directly.
  - When the user adds 1 strip, the live cart line is set strictly to **1 strip**, replacing any old draft rather than stacking on top of it.
  - If a user/caller explicitly specifies an additive mode (`mode === 'add'`), only then add; otherwise, default to exact `requestedQty`.

### 2. Frontend: Accurate Live Cart Values & Unfiltered Cart View in `PharmarackCart/index.tsx`
- **File**: `frontend/src/pages/PharmarackCart/index.tsx`
- **Changes**:
  - Ensure `executeReorderAdd` and `openReorderModalForItem` pass exact requested quantity (`order.qty`) with `mode: 'set'`.
  - In the Live Cart rendering, ensure the full truth of the upstream cart is visible:
    - Display all active distributor carts returned by `GET /api/pharmarack/cart`.
    - Provide an unmasked view of all lines, quantities, and totals so nothing in the live cart is hidden.
    - Show clear indicators of what is in the cart without filtering out active lines.

### 3. Human-In-The-Loop Approval (Rule 6)
- The pharmacist retains complete manual control in the UI to inspect, approve, adjust (+/-), or remove any line before batching or sending official distributor orders.
- The app never auto-commits altered quantities without human confirmation.

---

## Verification Plan

### Automated Verification
1. Run performance guardrails:
   ```bash
   npm run guardrails
   ```
2. Run build verification:
   ```bash
   npm run build:client
   ```

### Manual / Behavioral Verification
1. **Exact Quantity Test**:
   - Create or pick a Special Order with quantity = 1.
   - Add to live cart.
   - Verify the live cart payload and resulting cart item has quantity = 1 (never inflated or accumulated).
2. **Cart Transparency Test**:
   - Open Pharmarack Cart page.
   - Verify all distributor carts and all lines in upstream cart display their exact quantities, rates, and totals with zero hidden lines.

---

## Task Progress & Completion Status
- [x] Task 1: Update `src/routes/pharmarack.ts` to strictly enforce exact requested quantity (`targetCartQty = requestedQty`) and eliminate auto-accumulation.
  - **Completed**: Modified `normalizeCartAddRequest` and `addItemsToPharmarackCart` to default strictly to `requestedQty` unless explicitly requested with additive mode (`mode === 'add'`). Auto-accumulation `(existingQty + requestedQty)` removed.
- [x] Task 2: Update `frontend/src/pages/PharmarackCart/index.tsx` and `frontend/src/components/LiveCartAddModal.tsx` to ensure exact quantity propagation and clear, unfiltered cart view.
  - **Completed**:
    - Added `mode?: 'set' | 'add'` to `LocalLiveCartAddPayload` in `LiveCartAddModal.tsx` and explicitly passed `mode: 'set'`.
    - Updated `executeReorderAdd` in `PharmarackCart/index.tsx` to explicitly pass `mode: 'set'`.
    - Updated `filteredDistributorList` in `PharmarackCart/index.tsx` so both `'active'` and `'all'` tabs render `activeCartDistributors`, preventing any active items or distributor carts from being hidden.
- [x] Task 3: Run `npm run guardrails`, verify clean build, and auto-update knowledge graph via `node scripts/quick-update.mjs`.
  - **Completed**:
    - Resolved pre-existing scope bug in `frontend/src/pages/CRM/WhatsAppSection.tsx` (`loadOlderMessages`).
    - Guardrails passed (`npm run guardrails` exit code 0).
    - Client build succeeded (`npm run build:client` exit code 0).
    - Knowledge graph updated (`node scripts/quick-update.mjs` completed in 3.5s).

