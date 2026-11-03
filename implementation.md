# Implementation Plan: Refill Cart WhatsApp Summary — Display Old Qty, Added Qty & Distributor Stock

**Plan Name:** `refill_cart_summary_old_added_qty_and_stock`  
**Target:** Enhance the WhatsApp owner refill cart summary message (`sendRefillCartSummary` in `src/services/refillCartService.ts`) so that when an item was already in the live cart (or merged/increased), the message clearly shows the **old quantity**, the **added quantity**, the **total quantity**, and the **live distributor stock** (e.g. `(67)`).

---

## 1. Context & User Requirement Analysis

### Current Message Format:
```text
🛒 *Refill cart — Mr. SANTROSH PARAB*

*BAJAJ PHARMA*
• NICOTEX 4 TIN  40TAB × 2 (67)
```
- Header: `🛒 *Refill cart — <Patient Name>*`
- Store Section: `*<Distributor Name>*`
- Item Line: `• <Medicine Name> × <Qty> (<Distributor Stock>)`

### The Problem:
1. When a medicine already exists in the live distributor cart (from previous orders, other refills, or manual cart entries), `processRefillCartItem` merges the quantities (`hit.qty + qty = total`).
2. However, the WhatsApp summary sent to the store owner previously printed only the final quantity (`× 3`), completely hiding the fact that `1` was already in the cart and `2` was freshly added.
3. In update paths (e.g. lines 418–424 in `src/services/refillCartService.ts`), `distributorStock` was omitted in the returned `line` object, leading to missing stock counts `(67)` in the message.
4. When `status === 'in_cart'` (already present in cart, no new quantity added), it appended `(already in cart)`, but `distributorStock` was frequently missing because `mine.raw?.stock` in Pharmarack's cart API response was often `null` or undefined.

---

## 2. Message Formats Implemented

### Case A: Newly added medicine (clean new line in cart)
```text
• NICOTEX 4 TIN  40TAB × 2 (67)
```

### Case B: Already in cart & quantity was increased (e.g. old: 1, added: 2 ➔ total: 3)
```text
• NICOTEX 4 TIN  40TAB × 3 (old: 1, added: 2) (67)
```

### Case C: Already in cart with exact quantity needed (no new qty added)
```text
• NICOTEX 4 TIN  40TAB × 2 (already in cart) (67)
```

---

## 3. Technical Changes & Data Flow

### A. Backend Schema & Service (`src/services/refillCartService.ts`)
1. Extended `RefillCartResult.line` and `RefillCartSummaryRow` to include `oldQty?: number`, `addedQty?: number`, and `distributorStock?: string | number`.
2. In `processRefillCartItem`:
   - When increasing an existing cart line (`hit`):
     - Record `oldQty = hit.qty`, `addedQty = qty`, `total = hit.qty + qty`.
     - Extract `distributorStock` via live search fallback if `hit.raw?.stock` is null/empty.
     - Include `oldQty`, `addedQty`, and `distributorStock` in the returned `line`.
   - When `mine` is already in the cart (`in_cart`):
     - Resolve live `distributorStock` via live search fallback if `mine.raw?.stock` is null/empty.
     - Include `oldQty: mine.qty`, `addedQty: 0`, and `distributorStock`.
3. In `sendRefillCartSummary`:
   - Format: `• ${name} × ${qty}${qtyDetail}${stockStr}`
   - Where `qtyDetail` is ` (old: ${oldQty}, added: ${addedQty})` when both are > 0, or ` (already in cart)` when `in_cart`.
   - Where `stockStr` is ` (${distributorStock})` whenever stock is available.

### B. Frontend Plumbing (`frontend/src/services/api.ts` & `frontend/src/services/refillCartJobs.ts`)
1. Updated `sendRefillCartSummary` signature and `RefillCartResult` in `frontend/src/services/api.ts` to include optional `oldQty?: number` and `addedQty?: number`.
2. In `frontend/src/services/refillCartJobs.ts`:
   - Mapped `oldQty: r.line?.oldQty` and `addedQty: r.line?.addedQty` when calling `api.sendRefillCartSummary`.

### C. Inbound WhatsApp Intent Service & Confirmation Routes
1. In `src/services/whatsappIntentService.ts` & `src/routes/refills.ts`:
   - Forward `oldQty: cartRes.line?.oldQty`, `addedQty: cartRes.line?.addedQty`, and `distributorStock: cartRes.line?.distributorStock` to `sendRefillCartSummary`.

---

## 4. Tasks & Progress Tracking

- [x] Task 1: Update `RefillCartResult` and `RefillCartSummaryRow` interfaces in `src/services/refillCartService.ts` and `frontend/src/services/api.ts`.
  - *Completed*: Added optional `oldQty` and `addedQty` fields to `RefillCartResult.line` and `RefillCartSummaryRow` across backend and frontend API types.
- [x] Task 2: Update `processRefillCartItem` to capture and pass `oldQty`, `addedQty`, and fallback distributor stock for existing cart lines.
  - *Completed*: Updated `processRefillCartItem` for both `mine` (`in_cart`) and `hit` (increased) scenarios to resolve live distributor stock and accurately populate `oldQty` and `addedQty`.
- [x] Task 3: Update `sendRefillCartSummary` to format lines displaying `old: X, added: Y` and distributor stock `(Z)`.
  - *Completed*: Implemented formatted output `• Name × Total (old: X, added: Y) (Stock)` with regex fallback parsing on message for backward compatibility.
- [x] Task 4: Connect frontend mapping in `frontend/src/services/refillCartJobs.ts` and backend callers (`whatsappIntentService.ts`, `routes/refills.ts`).
  - *Completed*: Wired `oldQty`, `addedQty`, and `distributorStock` through `refillCartJobs.ts`, `routes/refills.ts`, and `whatsappIntentService.ts`.
- [x] Task 5: Run tests, `npm run guardrails`, and `node scripts/quick-update.mjs`.
  - *Completed*: Added automated unit tests in `tests/refillTodayListTruth.test.ts` (11/11 passed), verified `tsc -b frontend/tsconfig.json` (0 errors), passed `npm run guardrails` (PASS with 0 violations), and refreshed knowledge graph.

---
*All tasks completed successfully with zero regressions.*
