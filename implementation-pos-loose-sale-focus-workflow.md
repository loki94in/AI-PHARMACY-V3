# Implementation Plan: POS Loose Sale Focus & Auto-Advance Workflow

## Problem Statement & Root Cause
In POS billing, when selecting medicines:
1. **Loose-sale enabled medicines (`allow_loose_sale === 1`)**:
   - `changeRowMedicine` erroneously hardcoded `defaultQty = 1` for empty rows, allocating 1 full strip instead of 0 full strips.
   - The focus routing logic in `fetchDetailsAndChangeRowMedicine` and `addToCart` used fragile, short timeouts (20-30ms) and had a fallback `focusCartMedicineInput(true)` that forcibly stole focus away to the next medicine search input instead of keeping focus in the loose quantity input (`row-loose-input-${targetIndex}`).
   - The user/cashier was unable to cleanly input loose quantity without first clearing the unwanted full strip quantity and having their focus stolen.
2. **Non-loose medicines (`allow_loose_sale === 0` - syrups, drops, liquids, ointments, full-pack only)**:
   - Should auto-add 1 pack/unit (`qty = 1`, `looseQty = 0`).
   - Focus must automatically advance to the next medicine row search input (`row-med-input-${targetNext}`) so the cashier can type the next item without clicking.
   - Cashier retains full ability to edit quantity if more than 1 pack is required.
3. **Loose Sale Toggle on Restricted Items**:
   - `toggleAllowLooseSale` lacked focus routing after enabling loose sales on a row.
   - The loose quantity cell displayed "Click lock icon to enable loose sales", but lacked an inline toggle button for quick 1-click unlocking.

---

## Technical Design & Unified Solution

### 1. Unified Quantity Assignment (`changeRowMedicine` & `addToCart`)
- When a medicine has `isLoose = resolveAllowLooseSale(med) === 1`:
  - `defaultQty = opts?.presetQty ?? (isOrigEmpty ? 0 : (isLoose ? 0 : 1))`
  - `defaultLooseQty = opts?.presetLooseQty ?? 0`
  - When added to an empty row: `qty = 0`, `looseQty = 0` (shows placeholder "0" in loose input, cursor focused inside).
- When a medicine has `isLoose = 0` (liquids, single unit, or restricted full pack):
  - `defaultQty = opts?.presetQty ?? (isOrigEmpty ? 1 : Math.max(1, originalItem?.qty || 1))`
  - `defaultLooseQty = 0`
  - When added to an empty row: `qty = 1`, `looseQty = 0`, automatically jumps to the next row's medicine input.

### 2. Rock-Solid Focus Dispatcher (`routePosMedicineFocus`)
Replaced fragile, racing timeouts with a dedicated single-purpose focus runner using CPU-friendly micro-step polling:
```typescript
const routePosMedicineFocus = useCallback((targetIndex: number, isLooseAllowed: boolean) => {
  justSelectedMedicineRef.current = true;
  setTimeout(() => { justSelectedMedicineRef.current = false; }, 350);

  let attempts = 0;
  const maxAttempts = 20; // 20 * 16ms = ~320ms polling window (CPU SwiftShader friendly)
  const poll = () => {
    attempts++;
    if (isLooseAllowed) {
      const looseInput = (
        document.getElementById(`row-loose-input-${targetIndex}`) ||
        document.querySelector<HTMLInputElement>(`input[data-pos-row-index="${targetIndex}"][data-pos-field="looseQty"]`)
      ) as HTMLInputElement | null;
      if (looseInput && !looseInput.disabled) {
        looseInput.focus();
        looseInput.select?.();
        return;
      }
    } else {
      const targetNext = targetIndex + 1;
      const nextInput = (
        document.getElementById(`row-med-input-${targetNext}`) ||
        document.querySelector<HTMLInputElement>('input[placeholder="Search medicine..."]')
      ) as HTMLInputElement | null;
      if (nextInput && !nextInput.disabled) {
        nextInput.focus();
        nextInput.select?.();
        return;
      }
    }
    if (attempts < maxAttempts) {
      setTimeout(poll, 16);
    }
  };
  poll();
}, []);
```
- **Crucial Rule**: For loose-allowed medicines, NEVER fall back to `focusCartMedicineInput(true)`.

### 3. Inline Lock / Unlock Toggle Button in Loose Column
- In `frontend/src/pages/POS/index.tsx`, when `!isLooseAllowed && !item.isEmptyRow`:
  - An inline lock toggle button is rendered inside the loose sale cell calling `toggleAllowLooseSale(item)`.
  - When toggled to enabled (`newFlag === 1`), `routePosMedicineFocus` immediately focuses `row-loose-input-${rowIdx}` so cashier can type loose tablets directly.

### 4. Seamless Enter Key Behavior in Loose Input
- In `row-loose-input-${rowIdx}`, pressing `Enter` hops directly to the next medicine search input (`row-med-input-${rowIdx + 1}`), matching the cashier's natural fast billing flow.

---

## Tasks & Progress Log
- [x] Task 1: Comprehensive codebase investigation and root cause diagnosis.
- [x] Task 2: Implement unified `routePosMedicineFocus` and fix `changeRowMedicine` quantity initialization for loose items.
- [x] Task 3: Update `addToCart` and `fetchDetailsAndChangeRowMedicine` to use the unified focus router.
- [x] Task 4: Connect inline lock toggle button in the loose sale cell with auto-focus upon unlocking.
- [x] Task 5: Run `npm run guardrails` and verify build and type safety (PASS - 0 violations, clean tsc).
- [x] Task 6: Run `node scripts/quick-update.mjs` to keep knowledge graph synchronized.
