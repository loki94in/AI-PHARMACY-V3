# Implementation Plan: Universal Patient PIN Auto-Generation, Refill Live-Cart Direct Flow, Special Order Advance Gate & Credit Portal Payments

## Executive Summary
This implementation plan establishes:
1. **Universal Patient PIN Auto-Generation**: Automatic generation of 4-digit web login PINs in `customer_portal_accounts` for all old and new patients across CRM Refills, Special Orders, Customer Credit, and POS Sales, ensuring their clinical and billing data populate cleanly in their dedicated CRM sections.
2. **Refill 1-Click Live Cart Automation**: Reordering chronic refills on the customer portal instantly queues the medicines into the 24/7 cloud holding buffer and drains directly into the shop's Live Pharmarack Cart.
3. **Special Order Advance Payment Gate**: Special shortage requests remain held in `Pending Advance Confirmation` with a dynamic UPI QR, and only unlock into the live procurement queue once advance payment is confirmed.
4. **Credit Patient Portal Settlement**: Credit customers can view their outstanding ledger balance and settle unpaid invoices via UPI directly through the website portal.
5. **Offline PC Holding & Boot-Up Auto-Drain**: 24/7 cloud buffering in Vercel KV while the pharmacy PC is offline, with automated single-flight draining into the Live Cart the moment the desktop app comes live.

---

## Architecture & Data Flow

```mermaid
sequenceDiagram
    autonumber
    actor Patient as Patient (Web Portal)
    participant Cloud as Cloud Website (Vercel KV / catalog.js)
    participant Local as Pharmacy PC Backend (Express / SQLite)
    participant Cart as Live Pharmarack Cart
    participant POS as POS Counter & CRM

    Note over Local, POS: Phase 1: Universal PIN Auto-Generation
    POS->>Local: Save/Create Patient (Refill, Special Order, Credit, POS Sale)
    Local->>Local: ensureCustomerPortalAccount (Generates unique 4-digit PIN)
    Local->>POS: Data displays in Refills, Special Orders, Credit & Web Logins tabs

    Note over Patient, Cloud: Phase 2: Refill vs Special Order vs Credit Flow
    alt Patient Reorders Refill
        Patient->>Cloud: POST /api/catalog?action=refill_request
        Cloud->>Cloud: Pushes to cart_add_queue (24/7 Cloud Buffer)
        alt PC is Online
            Local->>Cloud: GET cart_queue_get
            Local->>Cart: addItemsToPharmarackCart (Direct Auto-Add)
            Local->>Cloud: POST cart_queue_ack
        else PC is Offline
            Cloud->>Cloud: Safely buffers items in KV until PC boots up
            Local->>Local: On Boot (startupSyncCoordinator) -> Drains into Cart
        end
    else Patient Submits Special Order
        Patient->>Cloud: POST /api/catalog?action=special_order
        Cloud->>Patient: Returns Advance Payment UPI QR (Status: Pending Advance)
        Patient->>Cloud: Confirms UPI Advance Payment
        Cloud->>Local: Syncs to Special Orders tab with advance verified
        Local->>Cart: Unlocks into Distributor Priority / Live Cart
    else Credit Patient Pays Balance
        Patient->>Cloud: Views Unpaid Bills & Scans Dynamic UPI QR
        Patient->>Cloud: Declares Payment (UTR / Ref)
        Local->>POS: Alert at POS -> Pharmacist confirms -> Credit balance cleared
    end
```

---

## Detailed Task Breakdown

### Task 1: Universal Patient PIN Auto-Generation (Backend & DB)
- **Files**:
  - `src/routes/customerPortal.ts`
  - `src/routes/orders.ts`
  - `src/routes/sales.ts`
  - `src/routes/crm.ts`
  - `src/database.ts`
- **Actions**:
  - Update `ensureCustomerPortalAccount` to safely handle missing PINs and ensure any existing account with blank `pin_display` is auto-assigned a valid 4-digit PIN.
  - Add boot-time automatic sync check in `src/database.ts` (or fast-boot path) to ensure all existing patients with valid 10-digit phones in `customers` table have an active record with `pin_display` in `customer_portal_accounts`.
  - Wire `ensureCustomerPortalAccount` call into `src/routes/orders.ts` (when Special Orders are created).
  - Wire `ensureCustomerPortalAccount` call into `src/routes/sales.ts` (when POS counter sales or credit sales create/update customers).

### Task 2: Cloud Refill Reorder Direct Live-Cart Queue
- **Files**:
  - `website/api/catalog.js`
  - `website/public/catalog.html`
  - `src/services/cartQueueSyncService.ts`
- **Actions**:
  - In `website/api/catalog.js`, when action `refill_request` succeeds, automatically trigger `cart_queue_add` internally for each refill item, tagging `is_refill: true` and `source: 'patient_portal_refill'`.
  - In `website/public/catalog.html`, ensure patient refill booking provides instant positive feedback indicating items are being prepared in the pharmacy's live distributor cart.

### Task 3: Special Order Advance Payment Gate
- **Files**:
  - `website/api/catalog.js`
  - `website/public/catalog.html`
  - `src/routes/orders.ts`
- **Actions**:
  - Update `website/api/catalog.js` action `special_order` to compute required advance amount (e.g. min 50% or configurable default) and return the pharmacy's UPI payment URI and QR payload with order status `Pending Advance Confirmation`.
  - Add action `advance_declared` in `website/api/catalog.js` where the patient submits their payment confirmation.
  - When advance is declared/confirmed, tag the order so `src/routes/orders.ts` imports it as `advance_payment > 0` and unlocks distributor procurement.

### Task 4: Credit Patient Online Bill Settlement
- **Files**:
  - `website/api/catalog.js`
  - `website/public/catalog.html`
  - `src/routes/customerPortal.ts`
- **Actions**:
  - Ensure `customer_login` in `website/api/catalog.js` returns `credit_balance` and unpaid invoices with dynamic UPI QR links.
  - Allow credit patients on `catalog.html` to pay their balance or individual bills, triggering `payment_declared` which notifies the pharmacy CRM credit section.

### Task 5: 24/7 Offline Holding & Boot-Up Auto-Drain Verification
- **Files**:
  - `src/services/startupSyncCoordinator.ts`
  - `src/services/cartQueueSyncService.ts`
- **Actions**:
  - Verify that `startupSyncCoordinator.ts` reliably runs `cartQueueSyncService.drainCartAddQueue()` on first boot and when network reconnects, properly mapping `medicine_distributor_links`.

---

## Task Progress & Verification Log
- [x] Task 1: Universal Patient PIN Auto-Generation (Backend & DB)
  - **Completed**:
    - Updated `ensureCustomerPortalAccount` in `src/routes/customerPortal.ts` to automatically generate and assign a 4-digit PIN whenever an existing account lacks a `pin_display`.
    - Enhanced `syncAllCustomersToPortal` in `src/routes/customerPortal.ts` to first repair all accounts with missing or empty `pin_display`, and auto-provision all saved customers into `customer_portal_accounts`.
    - Wired automatic boot-up sync into `src/services/startupSyncCoordinator.ts` so old/existing customers get PINs on boot without manual button clicks.
    - Added `ensureCustomerPortalAccount` hooks into `src/routes/orders.ts` (special orders) and `src/routes/sales.ts` (POS & credit sales).
- [x] Task 2: Cloud Refill Reorder Direct Live-Cart Queue
  - **Completed**:
    - Updated `refill_request` in `website/api/catalog.js` to automatically push each refill item directly into the persistent 24/7 cloud buffer `cart_add_queue:${storeId}` and `cart_item:${reqId}` with `is_refill: true`.
    - When the pharmacy PC is online (or upon boot via `startupSyncCoordinator.ts`), `cartQueueSyncService.drainCartAddQueue()` drains items directly into the live Pharmarack distributor cart.
- [x] Task 3: Special Order Advance Payment Gate
  - **Completed**:
    - Updated `special_order` in `website/api/catalog.js` to compute required advance amount, generate store UPI payment URI (`upi_uri`), and set status to `Pending Advance Confirmation`.
    - Updated `payment_declared` in `website/api/catalog.js` to verify advance declaration and only then unlock the item into `cart_add_queue` for live distributor procurement.
    - Updated `website/public/catalog.html` with explicit advance payment notices and dynamic UPI buttons.
- [x] Task 4: Credit Patient Online Bill Settlement
  - **Completed**:
    - Updated `renderBills` in `website/public/catalog.html` so unpaid credit bills render an outstanding Khata alert with a direct **"Pay via UPI"** link and **"I Have Paid (Settle Credit Bill)"** declaration.
    - Handled bill payment declarations in `website/api/catalog.js` action `payment_declared`.
- [x] Task 5: Verification, Guardrails & Knowledge Graph Update
  - **Completed**:
    - `npm run guardrails` verified: TypeScript compilation clean (`tsc --noEmit` OK), 0 guardrail violations, exit code 0.
    - `node scripts/quick-update.mjs` executed: 1345 nodes, 852 edges, exit code 0.

- [x] Task 6: Mandatory Shop Login Gate, Patient/Owner Login Toggle, Forgot PIN WhatsApp Recovery, Refill Fulfillment History & Special Shortage Orders
  - **Completed**:
    - **Mandatory Login Gate**: Added automatic login enforcement on `DOMContentLoaded` in [`website/public/catalog.html`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/website/public/catalog.html). When navigating to `/shop`, if neither `customer_portal_session` nor `pharma_owner_token` is found, the modal opens with `forced = true`, locking the backdrop and hiding the close button until authenticated.
    - **Patient vs Pharmacy Owner Toggle**: Added a 2-segment switch in the authentication modal:
      - *Patient Login*: 10-digit mobile number (+91 prefix), 4-digit PIN input with show/hide eye toggle, "Login & Access Prescriptions" button, and "Forgot / Reset PIN?" recovery link.
      - *Pharmacy Owner*: Username/Password and Admin Secret Key mode toggle with store selection, authenticating against `/api/catalog?action=owner_login` and redirecting to the Owner Console.
    - **Forgot / Reset PIN WhatsApp Flow**: Implemented `action === 'forgot_pin'` / `action === 'request_login_pin'` in [`website/api/catalog.js`](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/website/api/catalog.js). Fetches the auto-generated PIN, records it into the pharmacy's reminder queue, returns the PIN to the user, auto-fills the login input, and provides a direct WhatsApp link to message the pharmacy.
    - **Refill Past Sold & Booking History**: Added a dedicated history container (`#refillsHistoryContainer`) in `#portalView-refills` showing:
      - Past booking records (`#RFL-...`) with booking dates, statuses (`Booked`, `In Live Cart`, `Fulfilled`).
      - Past POS sold bills that contained chronic refill medicines, showing the exact sold/fulfilled dates, medicines, pack quantities, and bill amounts.
    - **Special Shortage Orders & Advance Payment Gate**: Added a dedicated container (`#specialOrdersContainer`) in `#portalView-orders` showing:
      - All special shortage requests (`SP-...`) with medicine names, request dates, notes, and quantities.
      - Live advance deposit status badges (`Advance Payment Required`, `In Live Cart / Procuring`, `Advance Confirmed`).
      - 1-click UPI payment action links (`upi://pay?...`) and instant "Confirm Advance Deposit Paid" declaration button.
    - **Multi-lingual Support**: All new labels localized into Marathi (`mr`), Hindi (`hi`), and English (`en`).
    - **Verification**: `npm run guardrails` passed (TypeScript compilation clean, zero violations), `node scripts/quick-update.mjs` executed cleanly.