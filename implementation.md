# Implementation Plan: 24/7 Patient Web Portal (Marathi/Hindi/English), Offline Auto-Sync & Automated Cart-to-WhatsApp Flow

## 1. Overview & Architecture
This plan implements a complete 24/7 Patient Health & Refill Portal with:
1. **Multi-Language Web Portal (मराठी, हिंदी, English)**: Patients can switch between English, Marathi, and Hindi at any time. The selection is sticky (saved in browser `localStorage`), sets their permanent default language in `customers.preferred_language`, and controls all interface text and subsequent WhatsApp notifications.
2. **24/7 Self-Service for CRM Patients**:
   - Patients log in using their 10-digit registered mobile number + WhatsApp Portal PIN.
   - View and manage chronic prescription refills (interval, due date, dosage).
   - 1-Click Refill re-order requests.
   - Special Order shortage request booking (for non-catalog or out-of-stock items) with optional notes or prescription photos.
   - View past counter invoices and purchase receipts.
3. **Offline-Resilient Cloud Queue & Auto-Pull**:
   - When the pharmacy PC is offline (shut down at night, power outage, or disconnected), all website bookings are safely stored in the 24/7 cloud buffer (Upstash Redis / Vercel KV).
   - When the pharmacy PC boots up or reconnects to the internet, it automatically pulls pending orders into SQLite without duplicates, notifies the counter via SSE, and acknowledges the cloud queue.
4. **Counter Review & Manual Edit (Human-in-the-Loop)**:
   - The pharmacist can review and manually adjust/edit the patient's requested medicines, quantities, or notes in Quick Assist / CRM prior to fulfillment.
5. **Add to Cart Triggers Automated Booking Confirmation WhatsApp**:
   - When the pharmacist clicks "+ Live Cart" or "Order to Cart" to procure the item via Pharmarack distributors, the app adds the item to the distributor live cart and **automatically sends the Booking Confirmation WhatsApp message** to the patient in their preferred language.
6. **Arrival Triggers "Collect Your Medicine" WhatsApp Reminder**:
   - When the stock arrives at the pharmacy counter, the system sends the localized "Your medicines are ready for collection" reminder in their preferred language.

---

## 2. Technical File Changes

### 1. Website Frontend (`website/public/catalog.html`)
- Add responsive Language Switcher (🇬🇧 English, 🇮🇳 मराठी, 🇮🇳 हिंदी) in the top header.
- Add complete dictionary (`translations = { en: {...}, mr: {...}, hi: {...} }`) translating all portal elements:
  - Header, tabs (Catalog, My Refills, Special Order, Past Bills), search bar, cart badges.
  - Refill cards (dosage, days left, "Reorder Refill" button: `औषध पुन्हा मागवा` / `रिफिल ऑर्डर करें`).
  - Special Order request modal (medicine name, quantity, prescription notes, submit button).
  - Status tags (Pending, Confirmed, Ready for Collection, Completed).
- Persist language in `localStorage.getItem('portal_lang')`.
- Pass `preferredLanguage` (`'mr' | 'hi' | 'en'`) with all API requests (`refill_request`, `order`, `special_order`).

### 2. Cloud Serverless API (`website/api/catalog.js`)
- Store `preferredLanguage` in orders, refill requests, and customer profiles.
- Support a dedicated `special_order` action or tag `orderType: 'SPECIAL_ORDER'` with notes and requested items.
- Return localized response messages.

### 3. Desktop Cloud Sync Service (`src/services/cloudCatalogSyncService.ts`)
- Update `pullCloudOrdersToLocal()`:
  - Distinguish between standard Cart Orders, Special Orders, and Refill Requests.
  - If Refill Request: match patient's active row in `patient_refills`, flag `refill_requested = 1`, and update timestamps.
  - If Special Order: insert into `special_orders` table with `customer_order_source = 'website_247'` and `sync_id = orderId`.
  - Save customer's `preferred_language = order.preferredLanguage || 'mr'` into `customers` and `whatsapp_chats`.
  - Broadcast real-time SSE alerts (`refill_updated`, `order_created`, `toast_alert`).
  - Send acknowledgment to clear imported orders from the cloud queue.

### 4. Desktop Auto-Sync Background Scheduler (`src/server.ts` & `src/services/cloudCatalogSyncService.ts`)
- Trigger `pullCloudOrdersToLocal()` automatically:
  - At server boot (inside startup sequence).
  - On a quiet 60-second periodic background timer (gated properly, non-blocking).

### 5. Multi-Language WhatsApp Notification Service (`src/services/whatsappLocalizer.ts`)
- Create centralized helper `getLocalizedMessage(type, lang, params)`:
  - Types:
    - `booking_confirmed`: Sent when pharmacist clicks "Add to Cart" / live cart addition succeeds.
    - `collection_reminder`: Sent when order arrives and is ready for pickup.
    - `refill_reminder`: Scheduled chronic reminder.
    - `portal_password`: Customer's portal login PIN.
  - Languages: `'mr'` (Marathi, default), `'hi'` (Hindi), `'en'` (English).

### 6. Refill Cart Live Addition Hook (`src/services/refillCartService.ts`)
- In `processRefillCartItem()`, when distributor addition succeeds (`status === 'added'`):
  - Check customer's phone and `preferred_language`.
  - Queue `booking_confirmed` WhatsApp message to the customer automatically.

### 7. Collection Reminder Verification (`src/services/collectionReminderWorker.ts` & `src/routes/orders.ts`)
- Ensure ready-for-collection notifications dynamically resolve customer's `preferred_language` and format using `whatsappLocalizer`.

---

## 3. Step-by-Step Implementation Checklist

- [x] **Step 1**: Create `src/services/whatsappLocalizer.ts` with standardized multi-language templates (Marathi, Hindi, English) for booking confirmations, collection reminders, refill reminders, and portal PINs.
- [x] **Step 2**: Enhance `src/services/cloudCatalogSyncService.ts` to sync `preferred_language`, link refill requests to `patient_refills`, route shortage requests to `special_orders`, and deduplicate via `sync_id`.
- [x] **Step 3**: Integrate automatic cloud order pulling on startup and quiet background timer in `src/server.ts` / `cloudCatalogSyncService.ts`.
- [x] **Step 4**: Hook `src/services/refillCartService.ts` to automatically send the localized booking confirmation WhatsApp message to the patient when an item is added to the distributor live cart.
- [x] **Step 5**: Update `src/services/collectionReminderWorker.ts` and `src/routes/orders.ts` to respect customer's `preferred_language` when medicines are ready for collection.
- [x] **Step 6**: Update `website/api/catalog.js` to handle `preferredLanguage` and dedicated special orders.
- [x] **Step 7**: Update `website/public/catalog.html` with the Language Switcher (मराठी, हिंदी, English), complete i18n dictionary, Special Order modal, and sticky language persistence.
- [x] **Step 8**: Run TypeScript compiler verification (`tsc --noEmit`) and guardrails check (`npm run guardrails`).
- [x] **Step 10**: Synchronize Special Order modal dimensions with "Add to Live" popup (`LiveCartAddModal`: `w-[95vw] max-w-6xl xl:max-w-7xl h-[85vh] min-h-[560px] max-h-[840px]`).
- [x] **Step 11**: Fix dropdown lag and selection misses by isolating state into `SpecialOrderAddModal.tsx`, implementing in-memory query caching, and replacing click with `onMouseDown` selection.

---

## 4. Progress Tracking & Completion Log

| Task | Status | Completed At | Details & Artifacts |
|---|---|---|---|
| Step 1: `whatsappLocalizer.ts` | Completed | 2026-10-22 21:55 | Created `src/services/whatsappLocalizer.ts` with Marathi, Hindi, and English templates for booking confirmations, collection reminders, refill reminders, and portal PINs. Default language is Marathi. |
| Step 2: `cloudCatalogSyncService.ts` | Completed | 2026-10-22 22:00 | Added `preferred_language` propagation into `customers` and `whatsapp_chats`. Refill requests match and update active `patient_refills`; special orders route to `special_orders` table with sync deduplication and SSE triggers. |
| Step 3: Auto-sync on startup & timer | Completed | 2026-10-22 22:03 | Initialized `startCloudOrderSyncPoller()` in `src/server.ts`. Staggered pull at boot and periodic background polling gated on `activityTracker.isIdle()`. |
| Step 4: `refillCartService.ts` hook | Completed | 2026-10-22 22:02 | In `processRefillCartItem()`, when Live Cart addition succeeds (`status === 'added'`), the patient's phone and `preferred_language` are retrieved and a localized booking confirmation WhatsApp message is automatically queued. |
| Step 5: `collectionReminderWorker.ts` | Completed | 2026-10-22 21:58 | Updated collection reminder queries to resolve `COALESCE(pr.language, c.preferred_language, c.language, 'mr')` and format messages via `whatsappLocalizer.ts`. |
| Step 6: `website/api/catalog.js` | Completed | 2026-10-22 21:58 | Enhanced serverless API to accept and store `preferredLanguage` across order and refill payloads, and added dedicated `action === 'special_order'`. |
| Step 7: `website/public/catalog.html` | Completed | 2026-10-22 22:01 | Added Language Switcher (🇬🇧 English, 🇮🇳 मराठी, 🇮🇳 हिंदी), responsive dictionary translations, Special Shortage Order modal and tab, Portal PIN login, and persistent `localStorage` selection. |
| Step 8: Verification & Guardrails | Completed | 2026-10-22 22:04 | Clean `tsc --noEmit` check, database schema verification, and 100% passed `npm run guardrails`. |
| Step 9: Knowledge Graph update | Completed | 2026-10-22 22:04 | Ran `node scripts/quick-update.mjs` (1316 nodes, 832 edges updated). |
| Step 10: Special Order Modal Dimensions | Completed | 2026-10-22 22:15 | Sized Special Order Add modal identically to Live Cart Add Modal (`w-[95vw] max-w-6xl xl:max-w-7xl h-[85vh] min-h-[560px] max-h-[840px]`), utilizing a 2-column widescreen layout (Distributor Search vs Customer & Order Details). |
| Step 11: Dropdown Lag & Selection Fix | Completed | 2026-10-22 22:18 | Isolated modal state inside `SpecialOrderAddModal.tsx` to stop re-rendering the 2,600-line CRM parent on keystrokes. Added in-memory `prCacheRef` cache and switched to `onMouseDown` handler to prevent blur-race selection misses. |

