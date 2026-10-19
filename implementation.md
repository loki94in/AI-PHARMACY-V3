# Implementation Plan: Fix Pharmarack Cart-to-PO-History Sync & Profile Discovery Gap

**Goal:**
Fix the fatal SQLite query error (`no such column: id`) in `src/routes/pharmarack.ts`, implement multi-candidate Chrome profile discovery (`C:\Users\ratna\AppData\data\pharmarack_profile` and local `data/pharmarack_profile`), fix the loopback port resolution from hardcoded 3001 to `config.port`, and ensure that when orders are placed on Pharmarack and clear from the cart, they are immediately synchronized from `DisplayOrders` into `pharmarack_synced_orders` and the Sent PO History, with the official Order IDs dispatched to saved distributor WhatsApp numbers.

---

## 1. Root Cause & Architecture Review

1. **Fatal SQLite Error in Order Sync Reconciliation**:
   - In `src/routes/pharmarack.ts` line 2894:
     ```sql
     SELECT order_no, store_name, order_amount FROM pharmarack_synced_orders WHERE order_date = ? ORDER BY id DESC
     ```
   - The table `pharmarack_synced_orders` primary key is `order_no`, and it uses `first_seen_at` for timestamps. It has no column named `id`.
   - This threw an unhandled SQL error that caused `POST /cart/place-official-orders` to crash with HTTP 500, aborting the sync of placed orders to Sent PO History and triggering the fallback cart window.

2. **Chrome Profile Resolution Gap**:
   - In `src/services/pharmarackCheckoutService.ts`, `mainProfilePath` was strictly resolved to `path.resolve(getAppDataDir(), 'data', 'pharmarack_profile')`.
   - On the user's Windows machine, the actual authenticated Chrome session is located at `C:\Users\ratna\AppData\data\pharmarack_profile`.
   - The absence of the folder in the local project directory caused automated checkout to return `'No active Pharmarack profile found'` without attempting headless checkout.

3. **Loopback Port Misconfiguration**:
   - In `src/routes/pharmarack.ts`, the code called `http://127.0.0.1:${appPort}` where `appPort` fell back to `3001`. The server actually runs on `config.port` (5174/5175).

4. **Cart-Clearing to Sent PO History Bridge**:
   - When orders are placed (either automatically or via the 1-click fallback cart window), Pharmarack removes items from `/cart` and moves them to `/orderhistory` (`DisplayOrders`).
   - The app must immediately invoke `syncPharmarackOrders()` to capture the real `OrderNo`s and populate Sent PO History, then broadcast SSE events so the UI updates seamlessly.

---

## 2. Proposed Changes

### A. Fix SQL Queries & Loopback Port in `src/routes/pharmarack.ts`
- Fix `SELECT ... FROM pharmarack_synced_orders WHERE order_date = ? ORDER BY first_seen_at DESC`.
- Use `config.port` instead of `process.env.PORT || 3001`.
- When orders are placed, invoke `syncPharmarackOrders()` and reconcile captured Order IDs.
- In `POST /cart/open-official-window`, return resolved profile path so the launched Chrome window always points to the authenticated profile directory.
- Add an explicit sync hook `POST /cart/sync-post-checkout` so when the user returns or closes the cart window, the app immediately updates the Sent PO History.

### B. Multi-Candidate Profile Resolution in `src/services/pharmarackCheckoutService.ts`
- Add `resolvePharmarackProfilePath()` to check:
  1. `path.resolve(getAppDataDir(), 'data', 'pharmarack_profile')`
  2. `path.resolve(process.env.USERPROFILE || '', 'AppData', 'data', 'pharmarack_profile')`
  3. `path.resolve(process.env.LOCALAPPDATA || '', 'AI Pharmacy OS', 'data', 'pharmarack_profile')`
  4. `path.resolve(process.cwd(), 'data', 'pharmarack_profile')`
- If found at an external location (e.g. `AppData/data/pharmarack_profile`), automatically use it.

### C. Frontend Post-Checkout Re-Sync in `frontend/src/pages/PharmarackCart/index.tsx`
- Ensure that whenever the batch order modal completes or the cart window is opened, the page triggers `fetchPendingOrders()`, `fetchLatestSentMap()`, and `loadSentDates()` to immediately reflect the cleared cart and new Sent PO numbers.

---

## 3. Verification Plan

1. **TypeScript Compilation**:
   - Backend: `npx tsc --noEmit`
   - Frontend: `npx tsc -p frontend/tsconfig.app.json --noEmit`
2. **Performance Guardrails**:
   - `npm run guardrails` (zero violations)
3. **Knowledge Graph Sync**:
   - `node scripts/quick-update.mjs`

---

### Tasks & Progress Tracking

- [x] Task 1: Add multi-candidate profile resolution in `src/services/pharmarackCheckoutService.ts`
  - *Completed*: Created `resolvePharmarackProfilePath` searching local data dir, `%USERPROFILE%\AppData\data\pharmarack_profile`, and `%LOCALAPPDATA%\AI Pharmacy OS\data\pharmarack_profile`. Automatically syncs and copies active profile to local data directory so headless checkout and 1-click browser window find authenticated session.
- [x] Task 2: Fix `ORDER BY first_seen_at DESC` and port resolution in `src/routes/pharmarack.ts`
  - *Completed*: Fixed SQL crash (`no such column: id`) by replacing with `ORDER BY first_seen_at DESC`. Fixed loopback port to dynamically bind to `config.port` (5174/5175). Cleaned up route definitions and added `POST /cart/sync-post-checkout`.
- [x] Task 3: Bridge cart-clearing and Sent PO History updates in `src/routes/pharmarack.ts` and `frontend/src/pages/PharmarackCart/index.tsx`
  - *Completed*: Synchronized placed orders from `DisplayOrders` immediately during and after order placement. Added `waitingForManualOrderSyncRef` in `index.tsx` and connected window `focus` event listener: when user returns from the live cart window, the app immediately reconciles the placed orders, updates Sent PO History, and clears the cart lines. Added `syncPharmarackPostCheckout` in frontend API.
- [x] Task 4: Verify typecheck, run performance guardrails, and update knowledge graph
  - *Completed*: `npx tsc --noEmit` passed (0 errors), `npx tsc -p frontend/tsconfig.app.json --noEmit` passed (0 errors), `npm run guardrails` passed (0 violations), and `node scripts/quick-update.mjs` synchronized the project knowledge graph.
