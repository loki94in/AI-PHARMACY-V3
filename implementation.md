# Implementation Plan: 100% Reliable Background Pharmarack Checkout with Safety Fallback

## 1. Problem Overview & Root Cause
When a user clicks "Place Official Orders & Dispatch" in AI Pharmacy's Pharmarack Cart modal:
1. **Low Viewport / Responsive Collapse:** Headless Puppeteer defaulted to an `800x600` viewport. Pharmarack's Angular SPA collapsed into mobile layout, moving or hiding the desktop "Place Order" button.
2. **Aggressive Checkbox Unchecking:** The script attempted to tokenize and match distributor headers. Unmatched headers caused the script to uncheck store checkboxes, which disabled or removed the "Place Order" button.
3. **Synthetic DOM Clicks:** Using `btn.click()` inside `page.evaluate()` failed to trigger Angular Zone.js reactive form submission.
4. **Premature Fallback Pop-up:** When background placement resulted in 0 placed orders, the frontend caught the error and popped open the live Chrome browser window (`api.openOfficialPharmarackCartWindow()`), forcing the user to manually click "Place Order" on the website.

The user wants the background automation to place the order directly and successfully so no browser window pops up, but wants the Chrome popup preserved strictly as a safety net fallback if any genuine error occurs.

---

## 2. Proposed Implementation

### Task 1: Desktop Viewport, Resilient Button Detection & Real OS Mouse Clicks in `src/services/pharmarackCheckoutService.ts`
- **1080p Desktop Emulation:**
  - Launch Chrome with `--window-size=1920,1080`.
  - Set `page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })`.
- **Preserve Checkbox Selection:**
  - Remove aggressive checkbox-unchecking. Cart items on Pharmarack are selected by default.
- **Resilient Primary Button Targeting:**
  - Locate primary action buttons (`button`, `[role="button"]`, `.btn-primary`, `.ant-btn`, `.mat-button`) whose visible text or attributes indicate "Place Order", "Confirm Order", "Proceed to Buy", "Checkout", or "Order Now".
  - Scroll into view using `scrollIntoViewIfNeeded()`.
  - Use real Puppeteer pointer coordinates: `await btnHandle.click({ delay: 50 })`.
- **Auto-Confirm Simple Dialogs:**
  - If a simple confirmation popup appears (e.g. "Are you sure?"), click "Confirm" / "Proceed" / "Yes" / "OK".
- **Capture Order IDs & Verify Order Submission:**
  - Monitor network stream for order confirmation endpoints.
  - Detect URL redirect or completion banners.
  - Return `{ ok: true, placedCount, orders }`.

### Task 2: Verify Frontend Fallback Safety Net in `frontend/src/pages/PharmarackCart/index.tsx`
- Ensure the primary path cleanly succeeds, clears the cart, shows success toast, and does NOT open the Chrome popup.
- Verify that if `api.placeOfficialPharmarackOrders()` rejects or fails, the `catch` block still invokes `api.openOfficialPharmarackCartWindow()` so the user can manually place the order without losing their cart.

### Task 3: Guardrails & Knowledge Graph Synchronization
- Run `npm run guardrails` to verify clean TypeScript compilation and rule compliance.
- Run `node scripts/quick-update.mjs` to auto-update the project knowledge graph.

---

## 3. Execution Status & Completion Details
- [x] **Task 1: Desktop Viewport & Real Pointer Clicks in `pharmarackCheckoutService.ts`**
  - Updated Puppeteer launch arguments to include `--window-size=1920,1080` for both main profile and lock-copy fallback instances.
  - Set `page.setViewport({ width: 1920, height: 1080 })` and realistic desktop user-agent to ensure Pharmarack loads the full desktop layout with the primary "Place Order" button.
  - Removed aggressive distributor header matching that unchecked cart items.
  - Switched from synthetic DOM `btn.click()` to native Puppeteer OS-level coordinate clicks (`page.mouse.click` on bounding box and `btnHandle.click({ delay: 60 })`).
  - Added auto-confirmation for simple modal popups if prompted.
  - Integrated order sync check against DB `pharmarack_synced_orders` to guarantee genuine placed orders return `ok: true`.
  - Refined `src/routes/pharmarack.ts` to determine success accurately without returning false negatives when orders are synced.
- [x] **Task 2: Verify Frontend Fallback Safety Net in `frontend/src/pages/PharmarackCart/index.tsx`**
  - Confirmed the primary success flow cleanly marks orders queued, triggers success toast, and does not open any external browser window.
  - Preserved `api.openOfficialPharmarackCartWindow()` inside the `catch` block so that if background automation ever encounters an error or timeout, the live Chrome window immediately opens as the safety fallback for 1-click manual placement.
- [x] **Task 3: Run Guardrails & Update Knowledge Graph**
  - Ran `npm run guardrails`: clean pass (`PASS — no guardrail violations. Speed architecture intact.`).
  - Ran `node scripts/quick-update.mjs`: successfully updated knowledge graph (1275 nodes, 810 edges).
