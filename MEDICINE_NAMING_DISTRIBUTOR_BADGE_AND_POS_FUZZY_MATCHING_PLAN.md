# Implementation Plan: Medicine Naming Accuracy, Distributor Badge, Order Sorting, and POS Fuzzy Matching

## Problem Summary
1. **Medicine Name Split into Packaging Fragment**: In WhatsApp special order flows (`whatsappIntentService.ts`), the code inserted `medName` into `medicine_name` and packaging fragments (`"15TAB"`, `"5 GM"`) into `product`. Because `product` is the canonical product column used across POS, CRM, and Live Cart, the app treated packaging tokens as separate/corrupted medicines.
2. **Newest Orders Buried / Out of Order**: `GET /orders` queried `ORDER BY date DESC`. Because `date` has only day granularity (`'2026-09-27'`), SQLite returned today's orders in ascending creation order (Order #6 first, Order #7 second, and the newest Order #8 at the bottom).
3. **Website Orders Card Missing Procurement Details**: Order cards lacked the store special order code (`SO-TMSA-xxx`), distributor badge, and distributor wholesale rate / MRP breakdown.
4. **POS Order Completion Fuzzy Matching**: When completing an order in POS, slight naming differences between the Pharmarack selected name (e.g. `GLIMIDIB M2 SR 15TAB`) and local inventory batch name (e.g. `GLIMIDIB-M2 SR`) needed intelligent token-level normalization to auto-match batches without cashier friction.
5. **Existing Corrupted Database Rows**: Orders #7 (`product: '15TAB'`) and #8 (`product: '5 GM'`) in `data/app.db` need their `product` column repaired.

## Planned Changes
- [x] Task 1: Update `src/services/whatsappIntentService.ts` to store `medName` in both `medicine_name` and `product`, and pass `productName: medName` to admin escalation. (Completed: lines 3215, 3261, 3344, 3388 updated).
- [x] Task 2: Update `src/routes/orders.ts` to sort orders by `ORDER BY created_at DESC, id DESC`. (Completed: lines 57 & 59 updated).
- [x] Task 3: Update `frontend/src/pages/WebsiteOrders/index.tsx` to sort newest first, render store order code `SO-TMSA-xxx`, display the dedicated Distributor Badge, and show Rate & MRP. (Completed: Building2 badge, rate/MRP pills, and order code added).
- [x] Task 4: Enhance POS prefill fallback in `frontend/src/pages/POS/index.tsx` with token-level medicine normalization so packaging variations auto-match shelf stock. (Completed: added packaging strip regex, multi-token fallback, and unallocated cart item fallback).
- [x] Task 5: Heal existing corrupted records (Orders #7 & #8) in `data/app.db` and add startup healing in `src/database.ts`. (Completed: updated app.db rows 7 & 8, added boot healing in both fast-boot and DDL paths).
- [x] Task 6: Run automated tests (`tests/websiteOrderIntegration.test.ts` & `tests/specialOrderNotification.test.ts`). (Completed: 9 of 9 tests passing).
- [x] Task 7: Run `npm run guardrails` and verify clean TypeScript compilation. (Completed: 0 violations, clean tsc).
- [x] Task 8: Update knowledge graph via `node scripts/quick-update.mjs` and log fix in `SMALL_BUG_FIX_PLAN.md`. (Completed).

## Completion Summary
All 8 tasks have been fully executed and verified:
1. **Medicine Naming Accuracy**: The customer-selected medicine name (`GLIMIDIB M2 SR 15TAB`, `T BACT  OINT`) is preserved identically in both `medicine_name` and `product`. Packaging strings (`15TAB`, `5 GM`) are never split into separate medicine names.
2. **Order Sorting & Visibility**: SQLite queries and frontend state now sort orders by `created_at DESC, id DESC`. Newest orders for repeat customers appear right at the top.
3. **Dedicated Distributor Badge**: Order cards in `/website-orders` display a dedicated badge with `<Building2 size={11} />`, wholesale rate, and MRP without cluttering the medicine title.
4. **Fuzzy POS Prefill**: If medicine names differ slightly between Pharmarack search and physical local inventory batches, POS strips packaging stop words to find shelf stock, or loads the row gracefully so cashiers can assign batches without re-typing.
5. **Database Healing**: Corrupted rows #7 and #8 repaired; idempotent healing runs on every boot.
