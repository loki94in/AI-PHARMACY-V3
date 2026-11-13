# POS.md — Point of Sale (Billing) Contract & Architecture Standard

> **DOX Hierarchy**: Subtree of root `AGENTS.md`  
> **Target Audience**: AI Agents (opencode, Claude, Cursor, Antigravity) & Human Developers  
> **Status**: BINDING CONTRACT — NEVER VIOLATE OR REVERT THESE RULES

---

## 1. Shop Role & Data-Flow Tree Position

The **POS Page** (`frontend/src/pages/POS/index.tsx`) is the **sole writer of retail sales** in the entire pharmacy system.

Per `AGENT_DATA_FLOW_TREE.md`:
```
Inventory Batches (stock_qty, loose_quantity)
       │
       ▼
   POS Sale (Only Writer of Sales)
  ┌────┴───────────────────────────┐
  ▼                                ▼
sales & sale_items (DB)    Inventory Decrement (DB + Cache)
  │                                │
  ▼                                ▼
Ledger / Sells (Read-Only)  Compact Inventory Cache Sync
```
- **One Writer Rule**: POS is the only page that executes customer sales and commits inventory decrements for retail billing. Other pages (`Sells`, `Reports`, `AuditCenter`) read and inspect POS invoices, but never invent separate sales records.
- **Speed Contract**: The cashier at the pharmacy counter must be able to bill a 10-item prescription in under 30 seconds using **only the keyboard**, without ever touching the mouse.

---

## 2. Fast Cashier Medicine Selection Flow

### A. Loose-Sale Enabled Medicines (`allow_loose_sale === 1`)
Typical for solid oral tablets and capsules with pack size > 1 (e.g., strips of 10 or 15 tablets):
1. **Quantity Initialization**:
   - `qty = 0` (0 full strips).
   - `looseQty = 0` (shows placeholder `"0"`).
   - **CRITICAL INVARIANT**: Never auto-allocate 1 full strip (`qty = 1`) when loose selling is enabled. Doing so charges the customer 1 full strip PLUS loose tablets, causing severe inventory and billing discrepancies.
2. **Focus Routing**:
   - Focus is dispatched directly to the loose sell section: `row-loose-input-${targetIndex}`.
   - The cashier immediately types the number of tablets/capsules (e.g., `2`, `5`, `10`).
   - Pressing **Enter** in `row-loose-input-${targetIndex}` automatically advances focus to the next medicine row search input (`row-med-input-${targetIndex + 1}`).
3. **Selling Full Packs on Loose Medicines**:
   - If the cashier actually wants 1 full strip instead of loose tablets, they can press **ArrowLeft** or **Shift+Tab** to move into `row-qty-input-${targetIndex}` and enter the strip count.

### B. Non-Loose Medicines (`allow_loose_sale === 0`)
Applies to liquids, syrups, suspensions, bottles, drops, ointments, creams, inhalers, respules, vials, amps, and items explicitly restricted to full-pack-only:
1. **Quantity Initialization**:
   - `qty = 1` (1 pack/bottle).
   - `looseQty = 0` (`N/A`).
2. **Focus Routing**:
   - Focus **automatically advances to the next medicine row search input** (`row-med-input-${targetIndex + 1}`).
   - The cashier does not need to press Enter or Tab — they can immediately begin typing the name of the second medicine.
   - The cashier can still edit the quantity of the current row at any time using **ArrowLeft** or by clicking the quantity field.

### C. Inline Restriction Unlock
1. In the loose quantity column, medicines restricted to Full Pack Only display an inline lock toggle button.
2. Clicking this lock button toggles `allow_loose_sale` from 0 to 1 via `api.patchAllowLooseSale`, updates the live cart, and **immediately shifts focus into `row-loose-input-${rowIdx}`** for typing loose quantity.

---

## 3. Keyboard Navigation Matrix

The POS page is completely operable without a mouse.

| Key | Context | Action | Target |
|---|---|---|---|
| **Down / Up Arrow** | In search dropdown | Navigate search suggestions | Highlighted suggestion |
| **Enter** | In search dropdown | Select highlighted medicine | Routes focus per Loose Rule |
| **Enter** | In Search (Trailing Empty Row) | Bill checkout hop | `pos-bill-discount-input` (Cash discount) |
| **Enter** | In Strip `Qty` (`row-qty-input`) | Forward navigation | `row-loose-input` (if loose allowed) or `row-med-input-${idx+1}` |
| **Enter** | In Loose `Qty` (`row-loose-input`) | Forward navigation | Next medicine row: `row-med-input-${idx+1}` |
| **ArrowRight** | In Strip `Qty` | Move to next column | `row-loose-input` (if enabled) or `row-disc-input` |
| **ArrowLeft** | In Loose `Qty` | Move to previous column | `row-qty-input` |
| **ArrowLeft** | In Strip `Qty` | Move to previous column | `row-med-input` (Medicine Name) |
| **Tab** | In Loose `Qty` | Move to next editable cell | `row-disc-input` (or next medicine if no discount) |
| **Shift + Tab** | In Loose `Qty` | Step backwards | `row-qty-input` |
| **F2 / Ctrl + K** | Anywhere in POS | Universal Search Focus | Empty row search input or top search bar |
| **F4** | Anywhere in POS | Barcode Scanner Modal | Toggles Barcode Scanner dialog |
| **F8** | Anywhere in POS | Bill Discount Focus | Focuses cash discount (`pos-bill-discount-input`) |
| **F9** | Anywhere in POS | Quick Save / Direct Cash Sale | Saves bill as Cash without opening modal |
| **F10** | Anywhere in POS | Save & Print Invoice | Opens checkout confirmation / print invoice |
| **Esc** | In modal / dropdown | Close / Dismiss | Returns focus to active medicine row |

---

## 4. FEFO Batch Allocation Standard

1. **Earliest Expiry First (FEFO)**:
   - When a medicine is added, `allocateMedicineBatches` scans active inventory batches strictly by earliest expiry date.
   - Near-expiry stock is liquidated first to protect pharmacy margins.
2. **Multi-Batch Splitting**:
   - If a customer requests 15 tablets, but the earliest batch only has 10 tablets remaining, the allocator automatically creates **two rows**:
     - Row 1: Batch A (10 tablets, expiring sooner).
     - Row 2: Batch B (5 tablets, next earliest expiry).
3. **Manual Batch Pinning**:
   - When a cashier clicks "Switch Batch" to manually pin a specific batch, `manualBatchSelected: true` prevents auto-rebalancing from undoing the cashier's choice.

---

## 5. Medical Safety Guardrails

- **Zero-Tolerance Expired Product Block**:
  - The POS actively rejects adding or billing any batch whose expiry date is in the past.
  - A red error banner notifies the cashier, and the item cannot be added.
- **Schedule H / H1 / X Prescription Safeguards**:
  - Narcotics and restricted drugs display a pulsing `℞ H` / `℞ H1` badge with red/amber styling.
  - Cashier is alerted that a doctor prescription is legally required.
- **Pack Size Mismatch Detector**:
  - If a manufacturer changes packaging (e.g. 10s to 15s) and inventory records don't match OCR packaging, an amber alert is shown with a 1-click `Apply` button to auto-heal the record.

---

## 6. Non-Negotiable Developer Invariants (NEVER BREAK)

1. **Never use `setInterval` in POS**: Guardrail `[F5]` blocks ungated `setInterval` in frontend. Always use recursive micro-step `setTimeout(poll, 16)` inside `routePosMedicineFocus`.
2. **Never call `focusCartMedicineInput(true)` for loose-allowed medicines**: That helper force-focuses the trailing search box and steals focus away from the cashier typing in `row-loose-input`.
3. **Never hardcode raw Tailwind colors**: Always use semantic tokens (`bg-bg`, `bg-bg2`, `text-text`, `text-muted`, `border-border`). Guardrail `[F6]` enforces this.
4. **Window first, backend second**: The POS page must render instantly (<50ms) using in-memory precomputed compact inventory cache. Never block UI render on network calls.
5. **No GPU acceleration switches**: Per owner contract, the app runs on CPU SwiftShader (`electron/main.ts`). All animations must be CSS-cheap.
