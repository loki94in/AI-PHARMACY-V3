# Special Orders 3-Section Redesign & Symbol Root-Cause Resolution Plan

## 1. Executive Summary & Root-Cause Explanation

### Why was there a symbol (`•` / `` ` ``) for Mr. BHIMRAO PAGARE?
- **Exact Database Finding**:
  In `special_orders` table (created on `2026-11-07 05:06:46 - 05:06:47`):
  - ID 175: `THIOWELL TAB (QUREWELL)` - Qty: 1, Advance: ₹60, Distributor: SENIOR AGENCY
  - ID 176: `PREQM NT TAB (QUREWELL)` - Qty: 1, Advance: ₹0, Distributor: SENIOR AGENCY
  - ID 177: `NUREWIRE` - Qty: 1, Advance: ₹0, Distributor: J M PHARMA
  - **ID 178**: `\` (ASCII char code 96 - backtick) - Qty: 1, Advance: ₹0, Distributor: null
- **Root Cause**:
  1. The user entered 3 genuine medicines in the batch intake modal (`QuickOrderModal`).
  2. While typing on the keyboard, the backtick key `` ` `` (located directly next to `1` and above `Tab` on standard keyboards) was accidentally pressed.
  3. Because the modal's `handleAddItemToCart()` and the backend's `/orders/batch` only checked `if (!product.trim())`, the backtick passed validation as a "valid" medicine.
  4. It was added as a 4th staged item and submitted to SQLite as `medicine_name = '\`'`.
  5. In the UI, rendering `💊 ${order.product}` displayed `💊 \``, which looks like a small dot/symbol next to the other 3 medicines.
- **Prevention Gate**:
  Enforce strict alphanumeric validation (`/[a-zA-Z0-9]{2,}/`) in `QuickOrderModal.tsx`, `SpecialOrderAddModal.tsx`, and backend route `src/routes/orders.ts` so pure punctuation/symbols can never be submitted as medicine names.

---

## 2. Elephant & Goldfish (EGM) Architectural Analysis

### Elephant (System Architecture, Contracts, & Database Safety)
1. **One Source of Truth**: Special orders live strictly in `special_orders` table (`status` column: `Pending`, `Ordered`, `Waiting`, `Ready`/`Arrived`, `Fulfilled`/`Completed`, `Cancelled`).
2. **Workflow Pipeline**:
   - `Running`: `Pending` | `Ordered` | `Waiting` | `Inquiry`
   - `Ready`: `Ready` | `Arrived`
   - `Completed`: `Fulfilled` | `Completed` | `Cancelled`
3. **POS Handover**: The `Ready` status connects directly to POS checkout. Clicking `Sell in POS` passes `specialOrderId` and pre-fills the sale with advance payment already credited.
4. **Guardrail Compliance**: Must preserve zero layout shift, semantic Tailwind color tokens (`bg-bg`, `text-text`, etc.), no raw hex/dark overrides, and zero breaking changes to existing SSE push events (`order_updated`, `order_delta`).

### Goldfish (Tactical, Surgical Cleanliness, UI Simplicity)
1. **Kill 8 Fragmented Status Tabs**: Replace `All`, `Inquiries`, `Pending`, `Ordered`, `Waiting`, `Arrived`, `Not Arrived`, `Cancelled` with 3 clean, high-level Segment Tabs:
   - **Running Orders** (Pending, Ordered, Waiting) with badge count
   - **Ready for Pickup** (Arrived, Ready in shop) with badge count
   - **Completed** (Fulfilled at POS, Cancelled) with badge count
2. **Kill 10-Button Row Clutter**:
   - Replace the row of 10 tiny buttons (`Sell`, `+50 QR`, `Ready`, `Pending`, `Waiting`, `Cart`, `Refill`, `Modify`, `Edit`, `Cancel`) with clean, context-specific actions:
     - **Running Section**: `[Mark Ready]` (emerald), `[Live Cart]`, `[···]` dropdown menu for (Edit, Change Priority, Cancel).
     - **Ready Section**: `[Sell in POS]` (primary green button), `[Notify WhatsApp]`, `[Collect QR]`, `[···]` dropdown.
     - **Completed Section**: `[View Invoice / Receipt]`, `[Re-order]`.
3. **Eliminate Duplicate Pill Badges**: Merge the "BOOKED ITEMS" pill row and "ITEM LEVEL DETAILS" into one clean, scannable customer card layout.

---

## 3. Detailed 3-Section UI/UX Specifications

### Section 1: Running Orders (चालू ऑर्डर्स)
- **Filters Included**: `Pending` (needs ordering), `Ordered` (placed with distributor / in cart), `Waiting` (delayed / supplier stock wait).
- **Header Badge**: Active count of pending customer requests.
- **Card Content**:
  - Customer name & phone with 1-click WhatsApp chat link.
  - Advance payment badge (e.g. `₹50.00 Advance Paid`).
  - Medicines list with quantity, distributor name, and order date.
  - **Quick Action**: Single prominent `✓ Mark Ready` button that transitions the items to the Ready section and triggers arrival notification.

### Section 2: Ready Orders (तयार / पिकअपसाठी उपलब्ध)
- **Filters Included**: `Ready`, `Arrived`.
- **Card Content**:
  - Clear visual indicator: Green border/accent `Ready for Pickup`.
  - Storage location or notes if specified.
  - Advance payment deductible summary.
- **Primary Actions**:
  - `[🛒 Sell in POS]`: Opens POS with customer, medicine, and advance pre-loaded.
  - `[💬 WhatsApp Ready Notice]`: Re-sends arrival notice with store pickup hours.
  - `[QR Payment]`: Generates dynamic UPI QR for remaining balance.

### Section 3: Completed Orders (पूर्ण झालेले ऑर्डर्स)
- **Filters Included**: `Fulfilled`, `Completed`, `Cancelled`.
- **Card Content**:
  - Compact, low-visual-weight rows.
  - Date completed / invoice number.
  - Clean filter by date range (`15d`, `30d`, `All`).
  - Searchable by customer, medicine, or invoice number.

---

## 4. Input Sanitization & Dropdown-Only Selection Lock (User Enforced)

### Dropdown-Only Medicine Selection Lock (100% Elimination of Symbols & Typo Rogues)
In both `QuickOrderModal.tsx` and `SpecialOrderAddModal.tsx`:
1. **Verified Selection State**:
   - Introduce a `verifiedMedicine: SuggestionMedicine | null` state.
   - When user clicks or presses Enter on a dropdown item -> `verifiedMedicine` is set to the selected catalog/Pharmarack item.
   - If the user modifies or backspaces the input box -> `verifiedMedicine` is reset to `null`.
2. **Hard Gate in `handleAddItemToCart` / `handleSubmit`**:
   - Adding an item is **STRICTLY BLOCKED** unless `verifiedMedicine` is selected from the dropdown.
   - If user attempts to add raw text without selecting a dropdown item:
     - The raw text is rejected.
     - Toast: *"Please select a medicine from the dropdown list."*
     - If dropdown suggestions exist, pressing Enter highlights and selects the top matching suggestion.
3. **Backend Safeguard Gate (`src/routes/orders.ts`)**:
   - Both `/orders` (single) and `/orders/batch` (multi-item) must reject any item where the medicine name does not contain at least 2 alphanumeric characters (`/[a-zA-Z0-9]{2,}/`).
4. **Database Cleanup**:
   - Delete rogue record `id: 178` (`medicine_name = '\`'`) for Mr. Bhimrao Pagare.

---

## 5. Implementation Task Checklist & Verification

- [x] Task 1: Cleaned up rogue record `#178` (`medicine_name = '\`'`) and purged pure symbol records from `special_orders`.
- [x] Task 2: Implemented Dropdown-Only Selection Lock in `QuickOrderModal.tsx` and `SpecialOrderAddModal.tsx` (blocking unselected raw keystrokes/symbols) plus backend alphanumeric validation in `src/routes/orders.ts`.
- [x] Task 3: Refactored `SpecialOrdersSection.tsx` into 3 clean, dedicated sections:
  - **Running Orders**: Active procurement pipeline (`Pending`, `Ordered`, `Waiting`, `Inquiry`) with 1-click `✓ Mark Ready` & Live Cart integration.
  - **Ready for Pickup**: Arrived inventory (`Ready`, `Arrived`) with prominent `⚡ Sell in POS` and `Notify Arrival` WhatsApp trigger.
  - **Completed**: Historical archive (`Fulfilled`, `Completed`, `Cancelled`) with quick `Re-order` and date-range inspection.
- [x] Task 4: Removed the 8 fragmented status filter buttons and eliminated the 10-button clutter per row by introducing high-contrast primary actions (`Mark Ready` for running, `Sell in POS` for ready) and a clean `··· More` popover.
- [x] Task 5: Verified full performance guardrails with `npm run guardrails` (PASS, 0 violations) and built production client bundle with `npm run build:client` (PASS). Knowledge graph updated.

