# Refill to Live Cart Quantity & Focus-Shift Commit Architecture Plan (EGM Standard)

## 1. Executive Summary: User-Proposed Focus-Shift Architecture

The user identified a critical UX & networking flaw in the Live Cart page (`PharmarackCart`):
> *"When user change the qty in the Pharmarack cart, the app fires API requests immediately. Can we pause/delay this, wait until user finishes, and wait for the user to shift focus away from the input before firing the API request? This will stop unnecessary API calls and avoid confusion/errors."*

This is an optimal, high-performance architecture pattern (Commit on Blur/Unfocus + Debounced Stepper), which eliminates concurrent API collisions against Pharmarack's single-flight cart endpoint.

---

## 2. Comparison: Current (Old) vs. New (Focus-Shift) Behavior

| Aspect | Current (Old) Behavior | New (Proposed Focus-Shift) Behavior |
| :--- | :--- | :--- |
| **Typing Quantity in Box** | 1.2s timer fires while user is still typing. If user pauses to think (e.g. types `1`, pauses before typing `0`), the app fires an API call for `1` while their cursor is still in the box! | **Zero network calls while focused**. User can type, delete, backspace freely. Network request fires **ONLY when focus shifts away (on Blur / click outside)** or on **Enter**. |
| **Clicking `+` / `-` Stepper** | **Every click immediately dispatches a separate API call**. Clicking `+` 3 times fires 3 parallel requests to Pharmarack, triggering 503 collisions and red error toasts. | Display updates instantly on every tap, but network dispatch has a **500ms trailing debounce**. Clicking `+` 3 times rapidly (2 → 3 → 4 → 5) dispatches **exactly ONE API request** for `5`. |
| **Cancelling / Reverting** | Escape blurs but timer may have already committed partial value. | Pressing **Escape** reverts to the original quantity immediately with **zero API calls**. |
| **In-Flight Flight Lock** | Stepper buttons remain clickable while network request is in flight, allowing user to spam clicks into an active request. | Stepper and input are locked with subtle loading indicator (`isUpdating`) while Pharmarack confirms the write, preventing race conditions. |
| **Error / Toast Feedback** | Competing requests fail with HTTP 503, triggering false `"Failed to update quantity"` toasts while the UI refreshes to the new quantity. | Single-flight requests succeed cleanly. No overlapping collisions. Clear green confirmation toast. |

---

## 3. Detailed Component Architecture

### Component 1: `CartItemQtyEditor` in `frontend/src/pages/PharmarackCart/index.tsx`
1. **Local State Only While Focused**:
   - Maintain `localVal` strictly in local component state.
   - `onChange`: Only updates `localVal` (sanitize digits, no commit timer while focused).
2. **On Blur / Shift Focus (`handleBlur`)**:
   - When focus shifts away (`isFocused` becomes false), compare `parsedVal` with current `qty`.
   - If changed: call `onCommit(parsedVal)`.
   - If unchanged or invalid: revert `localVal` to `qty`.
3. **On Enter Key (`handleKeyDown`)**:
   - Immediately commit `parsedVal` and blur the input.
4. **On Escape Key**:
   - Revert `localVal` to `qty` and blur without committing.
5. **On Stepper `+` / `-` (`handleStep`)**:
   - Instantly update `localVal`.
   - Run a trailing 500ms timer: if user clicks `+` again within 500ms, reset timer.
   - When timer expires (user finished clicking): call `onCommit(finalQty)`.

---

### Component 2: Backend Success Recognition in `src/routes/pharmarack.ts`
1. Update `isPharmarackCartSuccess`:
   - Recognize messages: `/updated|quantity\s*updated|record\s*updated|cart\s*updated/i`.
   - Support `StatusCode === 0` (standard .NET success code).

---

### Component 3: Backend Refill Quantity Enforcement in `src/services/refillCartService.ts`
1. When user adjusts refill quantity, eliminate `hit.qty + qty`.
2. Always enforce `targetCartQty = qty` so the live cart line matches the user-edited quantity.
3. Accept Pharmarack's HTTP 200 write response and save confirmed tracking in `patient_refills`.

---

## 4. Implementation Tasks & Verification Checklist

- [x] **Task 1: Focus-Shift & Debounced Stepper in `CartItemQtyEditor` (`PharmarackCart/index.tsx`)**
  - Removed aggressive auto-timer while typing; commits strictly on `onBlur` (shift focus) and `Enter`.
  - Added trailing 500ms debounce to `handleStep` (+/- buttons) so rapid clicks coalesce into ONE single clean API request.
  - Locked stepper and input while `isUpdating` is true to prevent spam-click race conditions.

- [x] **Task 2: Success Recognition Parser (`src/routes/pharmarack.ts`)**
  - Broadened `isPharmarackCartSuccess` to accept `"Quantity updated"`, `"Record updated"`, `"Item updated"`, and status code `0` (`.NET` success indicator).

- [x] **Task 3: Refill Absolute Quantity & Write Acceptance (`src/services/refillCartService.ts`)**
  - Replaced `hit.qty + qty` with exact requested `qty` (`total = (opts.qty !== undefined && opts.qty !== null) ? qty : ...`) so the live cart line always matches the user's edited quantity.
  - Accepted Pharmarack's HTTP 200 write response without prematurely declaring failure on remote re-read lag.
  - Synchronized confirmed `cart_store_id`, `cart_product_code`, and `cart_qty` to `patient_refills`.

- [x] **Task 4: Double-Queue Prevention & Events Safety (`refillCartJobs.ts` & `events.ts`)**
  - Fixed double-execution in `refillCartJobs.ts` by queuing only genuinely updated items in `recheckQueue`.
  - Added `typeof window === 'undefined'` guard to `refillEvent.triggerRefresh` in `events.ts` to prevent SSR/test crashes.

- [x] **Task 5: Zero-Bugs Gate Verification**
  - `npm test -- tests/refillCartJobs.test.ts` passed 100% (4/4 tests passed).
  - `npm run guardrails` passed (Clean TypeScript compilation, zero guardrail violations).
  - `node scripts/quick-update.mjs` synchronized knowledge graph.

---

## 5. Summary of Completed Implementation & Handover Notes for Any New Agent

### Exactly What Was Changed:
1. **[PharmarackCart/index.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/pages/PharmarackCart/index.tsx)**:
   - `CartItemQtyEditor`: `handleChange` no longer schedules a timer. Network commit fires exclusively when focus shifts away (`handleBlur`) or `Enter` is pressed.
   - `handleStep`: 500ms trailing debounce allows fluid clicking without spamming concurrent HTTP requests to Pharmarack.
2. **[src/routes/pharmarack.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/routes/pharmarack.ts)**:
   - `isPharmarackCartSuccess`: Accepts `.NET` status code `0` and recognizes `/record.*updated|quantity.*updated/i`.
3. **[src/services/refillCartService.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/src/services/refillCartService.ts)**:
   - `processRefillCartItem`: Compounding `hit.qty + qty` eliminated when user specifies `opts.qty`.
   - Positive write acceptance: When Pharmarack write responds with success, tracking is saved to `patient_refills` immediately.
4. **[RefillOrderModal.tsx](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/components/RefillOrderModal.tsx)**:
   - Stepper buttons and input disabled while `isJobRunning` is active.
5. **[refillCartJobs.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/services/refillCartJobs.ts)** & **[events.ts](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/frontend/src/services/events.ts)**:
   - `recheckQueue` prevents double-queuing in-flight refill rows; SSR window guards protect test/node environments.

### How to Verify:
Run `npm run guardrails` and `npm test -- tests/refillCartJobs.test.ts`. Both exit code `0`.
