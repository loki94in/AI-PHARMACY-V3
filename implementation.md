# Implementation Plan — Consolidated Multi-Medicine Refill Booking, Ceiling MRP Pricing, POS Disclaimer & Owner-Patient Toggle

## 1. Goal
1. Allow patients to select multiple chronic medicines with checkboxes and custom quantities, submitting them as **one consolidated refill order** (`#RFL-XXXX`) instead of creating fragmented single-medicine orders.
2. Enable "Add to Cart" directly from the refills list so patients can combine chronic refills and regular OTC store products in one shopping cart checkout.
3. Display the **latest highest MRP (`MAX(mrp)`)** across active batches as the upper-bound ceiling price so patients have a reliable estimate with no counter surprises.
4. Add clear **POS collection billing disclaimers** across the UI, checkout drawer, success modal, and WhatsApp confirmation (in Marathi, Hindi, and English) noting that final bill amounts are generated at the counter POS upon medicine collection.
5. Provide a seamless **Owner <-> Patient toggle** both on the cloud website (`/shop` <-> `/owner`) and inside the desktop Electron app.

---

## 2. Root Cause & Architectural Gaps
1. **Frontend Refills UI Fragmentation (`website/public/catalog.html`):**
   - Each card in `renderRefills` rendered an individual `requestRefill('${r.medicineName}', ${r.price})` button that triggered an immediate single-item POST request, generating separate `#RFL-XXX` orders for each click.
2. **Missing Multi-Select & Cart Staging:**
   - No checkbox selection, quantity adjuster, or "Add to Cart" existed on chronic refills. Patients couldn't select a customized subset of due medications or combine them with OTC store medicines.
3. **Static Master MRP vs. Highest Inventory Batch MRP:**
   - Queries previously retrieved `m.sell_price` or `m.mrp` from `medicines` without aggregating `MAX(im.mrp)` from `inventory_master`, potentially showing older lower rates that differ from current batches on the shelf.
4. **Missing POS Collection Note:**
   - No explicit counter collection billing disclaimer existed on the refill bar, cart drawer, confirmation modal, or WhatsApp text.
5. **Separate Unlinked Portals:**
   - `catalog.html` and `owner.html` lacked quick one-click toggles, forcing users to manually type URLs to switch between Patient Shop and Owner Console.

---

## 3. Step-by-Step Implementation Plan

### Step 1: Multi-Select Refill Basket & Cart Staging in `website/public/catalog.html`
- Add reactive refill selection state (`selectedRefills: Set<string>`, `refillQuantities: Record<string, number>`).
- Enhance `renderRefills(refills)`:
  - Add individual selection checkboxes (auto-checked for due/overdue medicines).
  - Add quantity stepper (`- 1 +`) for each refill item.
  - Add an `"Add to Cart" (🛒)` button on each refill card calling `addRefillToCart(r.id)`.
  - Add a `"Select All / Deselect All"` control button.
  - Add a sticky/header Multi-Refill Booking Bar:
    - Displays selected items count, estimated total, and POS billing note.
    - Button: `"Book Selected Refills (N Items — ₹Total)"`.
- Implement `requestSelectedRefills()` to submit all chosen medicines in a single POST request with `items: [...]`.

### Step 2: Ceiling MRP (`MAX(mrp)`) Resolution in Backend Sync & APIs
- In `src/services/cloudCatalogSyncService.ts`:
  - Upgrade catalog query and patient refills query to resolve:
    `COALESCE((SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id AND im.quantity > 0), (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id), m.mrp, m.sell_price, 0) as price`
    and `mrp`.
- In `src/routes/customerPortal.ts`:
  - Ensure customer portal profile and live catalog endpoints also resolve `MAX(mrp)` for active batches.

### Step 3: POS Counter Billing Disclaimer (Web UI, Modals & WhatsApp)
- In `website/public/catalog.html`:
  - Add disclaimer to the multi-refill booking bar.
  - Add disclaimer above the "Confirm & Place Order" button in `cartModal`.
  - Add an amber info banner in `successModal`.
  - Add multilingual strings in `i18n` dictionary (`mr`, `hi`, `en`).
- In `website/api/catalog.js`:
  - In `action === 'refill_request'` and `action === 'order'`, append the POS disclaimer note to the generated WhatsApp message text.

### Step 4: Owner <-> Patient Toggle in Web Portal & Desktop App
- In `website/public/catalog.html`:
  - Add an "🛡️ Owner Console" quick switch button in the top navigation bar linking to `/owner`.
- In `website/public/owner.html`:
  - Add a "🛒 Patient Shop" quick switch button in the header bar linking to `/shop`.
- In `frontend/src/components/PortalAccountsManager.tsx`:
  - Add view switcher buttons: "👤 Patient Portal (Shop)" vs "🛡️ Owner Console" so the pharmacy owner can inspect and test both experiences directly inside the desktop app.

### Step 5: Verification & Performance Guardrails
- Run `npm run guardrails` (ensure 0 violations, clean TypeScript compilation).
- Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## 4. Completed Tasks Log
- [x] **Step 1: Multi-Select Refill Basket & Cart Staging in `website/public/catalog.html`**
  - *Completed*: Added reactive refill selection state (`selectedRefillIds: Set`, `refillQuantities: Record`), rendered checkboxes and quantity steppers (`- 1 +`) on each refill card, added "Select All" toggle button, added a sticky summary action bar displaying selected count and estimated Max MRP, and implemented `requestSelectedRefills()` which submits all selected medicines in a single consolidated order (`#RFL-XXXX`). Also implemented `addRefillToCart(id)` so patients can put chronic medicines directly into the universal cart and order alongside OTC products.
- [x] **Step 2: Ceiling MRP (`MAX(mrp)`) Resolution in Backend Sync & APIs**
  - *Completed*: Updated `pushLocalCatalogToCloud` and patient refills query in `src/services/cloudCatalogSyncService.ts` as well as `src/routes/customerPortal.ts` to resolve `COALESCE((SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id AND im.quantity > 0), (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id), m.mrp, 0)` so that customers always see the latest highest batch MRP ceiling upfront, guaranteeing that counter billing upon collection is never higher than expected.
- [x] **Step 3: POS Counter Billing Disclaimer in Web UI, Modals & WhatsApp**
  - *Completed*: Added the POS counter billing notice to the sticky multi-refill booking bar, the cart checkout drawer (`cartModal`), the order success modal (`successModal`), and the generated WhatsApp messages in `website/api/catalog.js` for both refills and general store orders. Added localized strings in Marathi, Hindi, and English.
- [x] **Step 4: Owner <-> Patient Toggle in Web Portal & Desktop App**
  - *Completed*: Made the "Owner Console" button prominently visible on all screen sizes in `website/public/catalog.html` linking to `/owner`. Added a "Patient Shop" quick switch button in `website/public/owner.html` linking to `/shop`. Added an "Owner Console" action button directly in the desktop app's `frontend/src/components/PortalAccountsManager.tsx` header for instant switching between patient experience and owner remote management.
- [x] **Step 5: Verification, Guardrails & Knowledge Graph Sync**
  - *Completed*: Verified with `npm run guardrails` (exit code 0, 0 violations, clean TypeScript compilation), verified client production build with `npm run build:client` (exit code 0, 2687 modules transformed, clean bundle), and refreshed the auto-knowledge graph with `node scripts/quick-update.mjs` (exit code 0, Nodes: 1345, Edges: 851, Layers: 10).
