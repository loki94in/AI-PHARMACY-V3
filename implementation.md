# Implementation Plan — Separate Headers for Refills, Online Orders, Special Orders & All Today's Orders

## 1. Goal
Add separate dedicated category headers / tabs in the Order Cart (`PharmarackCart` split-pane view) for:
1. **🌟 All Today's Orders**: Quick 1-click view displaying all present-day orders (Website, WhatsApp, Refills, and In-Shop Shortage Requests) with summary totals.
2. **🌐 Online Orders**: Dedicated filter for customer website and web app orders.
3. **🔄 Refills**: Dedicated filter for patient refill requests and due refill reminders.
4. **📋 Special Orders**: Dedicated filter for in-shop customer shortage special orders.

---

## 2. Technical Architecture & State Design
1. **Category Filter State in `PharmarackCart/index.tsx`**:
   - `onlineCategory: 'today' | 'all' | 'online' | 'refills' | 'special'` (defaults to `'today'`).
   - When `'today'` is active, sets `selectedOnlineOrderDate = getTodayString()` and displays all present day orders with a distinct summary header.
2. **Category Splitting & Item Mapping**:
   - **Online Orders**: `customer_order_source === 'website' || customer_order_source === 'whatsapp'`.
   - **Refills**: `customer_order_source === 'website_refill'` OR matching items from `pendingRefills` (patient refills due on that date).
   - **Special Orders**: In-shop customer shortage orders (`customer_order_source !== 'website' && customer_order_source !== 'website_refill' && customer_order_source !== 'whatsapp'`).
3. **Refill Card Support in Detail Panel**:
   - Renders Refill items with patient details, due date, needed vs in-stock qty, `Add to Cart`, `Open in POS`, and `WhatsApp` notification shortcuts.
4. **Interactive Header Bar**:
   - Horizontal category pill bar with color-coded badges, live counts for each category on the active date, and instant 1-click category switching.
   - Dedicated "🌟 Today's Active Orders" banner when viewing today's orders.

---

## 3. Step-by-Step Implementation

### Step 1: Add Category State & Count Calculation in `PharmarackCart/index.tsx`
- Define `onlineCategory` state: `'today' | 'all' | 'online' | 'refills' | 'special'`.
- Calculate counts for the active date and for today:
  - `todayOrdersCount`: all orders + refills for today
  - `allDateOrdersCount`: all orders for selected date
  - `onlineOnlyCount`: website + whatsapp orders
  - `refillsCount`: website refills + pending refills due
  - `specialCount`: in-shop shortage special orders
- Filter the displayed items based on `onlineCategory`.

### Step 2: Render Category Navigation Headers
- In the Right Detail Panel, right above the orders list:
  - Render the category selector bar with:
    - 🌟 All Today's Orders
    - All ({selectedDate})
    - 🌐 Online Orders
    - 🔄 Refills
    - 📋 Special Orders
- Add present-day summary banner when `selectedOnlineOrderDate === getTodayString()`.

### Step 3: Support Refill Items Rendering in Detail View
- Ensure both `SpecialOrder` items and `Refill` items are supported in the orders list with appropriate action buttons:
  - `Add to Live Cart`
  - `Open in POS`
  - `WhatsApp Patient / Customer`
  - Status updates

### Step 4: Verification & Guardrails
- Run `npm run guardrails` (`tsc --noEmit` + guardrail scanner).
- Run `node scripts/quick-update.mjs` to update knowledge graph.

---

## 4. Execution Tracking

- [x] Step 1: Add Category State & Count Calculation in `PharmarackCart/index.tsx`
  - Added `onlineCategory` state (`'today' | 'all' | 'online' | 'refills' | 'special'`).
  - Added dynamic count aggregates: `todayTotalOrdersCount`, `onlineCategoryCount`, `refillsCategoryCount`, `specialCategoryCount`, `totalSelectedCount`.
  - Added `filteredRefills` memo to link patient refills (`pendingRefills`) with the active calendar date.
- [x] Step 2: Render Category Navigation Headers in Right Detail Panel
  - Added left sidebar quick button: **"🌟 All Today's Orders"** with live `todayTotalOrdersCount` badge.
  - Added interactive category pills bar with theme-safe color chips (`emerald`, `sky`, `amber`, `purple`, `primary`).
  - Added Present Day Orders banner when viewing today's date (`Present Day's Orders (${getTodayString()})`).
  - Added distinct category section dividers in the cards list (`Online Orders`, `Patient Refills & Web Refills`, `Customer Special Orders`).
- [x] Step 3: Support Refill Items Rendering in Detail View
  - Added `renderRefillCard` helper to render patient refill items alongside shortage and website orders.
  - Equipped refill cards with `Add to Cart`, `Open in POS`, and `WhatsApp` shortcuts.
- [x] Step 4: Verification with Guardrails & Quick-Update
  - Ran `npm run guardrails`: TypeScript compiled cleanly (`tsc --noEmit`), 0 speed architecture or UI violations.
  - Ran `node scripts/quick-update.mjs`: Knowledge graph synchronized successfully.
