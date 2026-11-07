# Implementation Plan: Market Closure Stock Buffer Live Cart Button Integration

## Overview
Replace the static distributor column in the Market Closure Stock Buffer Review modal (`ClosureStockBufferModal.tsx`) with the app's established **`+ Live Cart`** button (and in-cart badge), directly invoking the existing `startRefillCartJob` refill-cart workflow. This enables automated distributor live-stock verification and auto-switching across linked distributors for each refill medicine without any extraneous UI bloat.

## Target Files
- `frontend/src/components/ClosureStockBufferModal.tsx`

## Design Specifications
1. **Import `startRefillCartJob` and `refillEvent`**:
   - Import `startRefillCartJob` from `../services/refillCartJobs`.
   - Import `refillEvent` from `../services/events`.
2. **Auto-Refresh via `refillEvent`**:
   - Subscribe `refillEvent.subscribeRefresh(fetchBuffer)` inside `ClosureStockBufferModal` when `isOpen` is true so when `startRefillCartJob` adds an item, the modal updates its in-cart badge reactively.
3. **Table Header**:
   - Change `<th className="py-2.5 px-3">Distributor</th>` to `<th className="py-2.5 px-3 text-center">Live Cart</th>`.
4. **Table Cell**:
   - If `item.is_in_cart`:
     - Display the standard green in-cart badge:
       ```tsx
       <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-[11px]">
         <ShoppingCart size={11} />
         <span className="truncate max-w-[130px]">In Cart: {item.cart_store_name || item.distributor_name || 'Live Cart'}</span>
       </span>
       ```
   - If not in cart:
     - Render the **`+ Live Cart`** button matching CRM styling:
       ```tsx
       <button
         type="button"
         onClick={(e) => {
           e.stopPropagation();
           const qtyToOrder = orderQtys[item.refill_id] && orderQtys[item.refill_id] > 0
             ? orderQtys[item.refill_id]
             : (item.shortfall_packs > 0 ? item.shortfall_packs : 1);
           startRefillCartJob(item.patient_name || 'Patient Refill', [
             { refillId: item.refill_id, medicineId: item.medicine_id, medicineName: item.medicine_name, qty: qtyToOrder }
           ]);
         }}
         className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary text-[11px] font-bold transition-all cursor-pointer shadow-xs"
         title={`Add ${orderQtys[item.refill_id] && orderQtys[item.refill_id] > 0 ? orderQtys[item.refill_id] : (item.shortfall_packs > 0 ? item.shortfall_packs : 1)} pack(s) to Live Cart with automatic distributor stock check`}
       >
         <ShoppingCart size={12} />
         <span>+ Live Cart ({orderQtys[item.refill_id] && orderQtys[item.refill_id] > 0 ? orderQtys[item.refill_id] : (item.shortfall_packs > 0 ? item.shortfall_packs : 1)})</span>
       </button>
       ```
5. **Preserve All Existing Features**:
   - Stepper (`-`/`+`), selection checkboxes, and bulk actions remain 100% functional.
   - Zero modifications to other files or backend logic.

---

## Tasks & Progress Tracking

- [x] Task 1: Update imports in `ClosureStockBufferModal.tsx` (`startRefillCartJob`, `refillEvent`).
- [x] Task 2: Subscribe to `refillEvent` in `ClosureStockBufferModal.tsx` for real-time in-cart synchronization.
- [x] Task 3: Replace static distributor header and cell with the `+ Live Cart` button and in-cart badge.
- [x] Task 4: Run guardrails and TypeScript verification (`npm run guardrails`, `npx tsc --noEmit`).
- [x] Task 5: Update project knowledge graph (`node scripts/quick-update.mjs`).

## Verification Summary
- **Guardrails**: Passed cleanly (`tsc --noEmit` and speed architecture check 100% OK).
- **Knowledge Graph**: Synchronized cleanly via `node scripts/quick-update.mjs` (1491 nodes).
- **Scope**: Surgical edit strictly in `ClosureStockBufferModal.tsx`, zero extraneous modifications.
