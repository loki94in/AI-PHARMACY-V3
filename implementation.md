# Implementation Plan — Multi-Select & Single-Select Distributor Filter in Add to Live Cart

## Overview
Add a flexible distributor filter to the "Add to Live Cart" modal (`LiveCartAddModal.tsx` and `LiveCartSearchSection.tsx`).
Supports:
1. **Default State**: All Distributors (100% current behavior, zero extra clicks).
2. **Single-Select Mode**: Pick any single distributor to see products from that distributor only.
3. **Multi-Select Mode**: Check multiple distributors (e.g., 2 or 3 specific distributors) to compare and search products from only the selected subset.
4. **Quick Reset**: One-click reset back to "All Distributors".

---

## Technical Design

### 1. State Management in `LiveCartAddModal.tsx`
- `selectedStoreIds: number[]`
  - Empty array `[]` = **All Distributors** (Default).
  - Array with 1 element `[104]` = **Single Distributor** filtered.
  - Array with multiple elements `[104, 201]` = **Multiple Distributors** filtered.
- Pass `restrictStoreIds?: number[]` to `LiveCartSearchSection`.

### 2. Search & Filtering in `LiveCartSearchSection.tsx`
- Update `restrictStoreId?: number` to also support `restrictStoreIds?: number[]`.
- Cache key: `${(restrictStoreIds ?? []).sort().join(',')}|${cleanQuery.toLowerCase()}`.
- In suggestion filtering:
  ```typescript
  if (restrictStoreIds && restrictStoreIds.length > 0) {
    if (!restrictStoreIds.includes(Number(item.storeId))) return;
  }
  ```
- If exactly 1 store is selected, also pass `storeId` to `/api/pharmarack/search?storeId=...` for optimal upstream indexing.

### 3. UI Component (Multi-Select Popover with Single-Select Shortcut)
- **Trigger Button**:
  - Empty: `All Distributors (Default) ▾`
  - 1 selected: `Distributor: Mediline Health [✕]`
  - 2+ selected: `Distributors: 2 Selected [✕]`
- **Dropdown Menu**:
  - `[✓] All Distributors (Reset)`
  - Search/filter input if there are many distributors.
  - Each distributor row:
    - Checkbox (allows picking multiple).
    - Distributor Name & Store ID.
    - Badges for `🛒 In Cart` (if currently in live cart).
    - "Only" button on hover for 1-click single-selection.

---

## Tasks & Progress Tracking

- [x] Task 1: Update `LiveCartSearchSectionProps` to accept `restrictStoreIds?: number[]` and filter suggestions by the selected array of store IDs.
- [x] Task 2: Build the multi-select distributor dropdown popover in `LiveCartAddModal.tsx` with support for both single-click isolation ("Only") and multi-checkbox selection.
- [x] Task 3: Wire `selectedStoreIds` state into `LiveCartSearchSection` with live distributor catalog store hydration (`/pharmarack/distributor-stores`).
- [x] Task 4: Verify with `npm run build`, `npm run build:client`, and `npm run guardrails`.
- [x] Task 5: Auto-update knowledge graph (`node scripts/quick-update.mjs`).
