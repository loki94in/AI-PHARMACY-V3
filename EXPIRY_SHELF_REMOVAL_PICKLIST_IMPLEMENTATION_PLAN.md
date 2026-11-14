# Implementation Plan: Expiry Shelf Removal Pick-List PDF & Mobile Dispatch

## Executive Summary
This feature introduces a specialized "Shelf Removal Pick-List" PDF generation and WhatsApp dispatch system within the Expiry module (`/expiry`). Pharmacists and shop staff can generate a printable or mobile-friendly pick-sheet organized either Alphabetically (A-Z) or Company-wise (Manufacturer) or by Rack/Shelf location, filtered by Dosage Form (Solid vs. Liquid vs. All). Each item features a physical checkbox `[ ]`, rack location, batch number, expiry date, available quantity, and MRP, enabling pharmacy staff to walk down aisles and systematically pull expiring medicines from shelves.

---

## 1. Scope & Architecture (Elephant View)

```
[ Frontend: /expiry ]
       │
       ├── User clicks "Shelf Removal PDF" button
       │
       ▼
[ ShelfRemovalModal (Frontend Modal) ]
       │
       ├── Select Sorting: Alphabetical (A-Z) | Company-wise | Rack Location | Expiry Date
       ├── Select Dosage Form: All | Solid (Tabs/Caps) | Liquid (Syrups/Drops)
       ├── Select Date Window: Current Range / Expired / 30d / 60d / 90d
       │
       ├── Action 1: "Download PDF" ───► GET /api/expiry/shelf-removal-pdf
       │                                     │
       │                                     └── Streams A4 PDF Pick-Sheet with [ ] Checkboxes
       │
       └── Action 2: "Send to WhatsApp" ──► POST /api/expiry/shelf-removal-pdf/send-whatsapp
                                             │
                                             └── Generates PDF to temp & enqueues to whatsappQueueWorker
```

---

## 2. Detailed Technical Tasks (Goldfish View)

### Task 1: Backend PDF Generator & Classifier
- **File:** `src/utils/reportExporter.ts`
- Implement `exportShelfRemovalPdf(res, options, items, storeInfo)`:
  - Supports A4 layout with letterhead.
  - Generates clear section banners when grouped by Company (e.g. `=== CIPLA LTD (4 items) ===`) or by Dosage Form.
  - Table columns:
    1. `[ ]` (Square checkbox cell for physical pen tick)
    2. `Rack / Shelf`
    3. `Medicine Name`
    4. `Dosage Form`
    5. `Batch No`
    6. `Expiry Date (MM/YY)`
    7. `Qty to Remove`
    8. `MRP (₹)`
  - Classifies dosage forms into:
    - **Solid:** `TABLET`, `CAPSULE`, `TAB`, `CAP`, `STRIP`, `BOLUS`, `PILL`
    - **Liquid:** `SYRUP`, `SUSPENSION`, `SOLUTION`, `DROPS`, `LIQUID`, `TONIC`, `ELIXIR`
    - **Topical/Other:** `OINTMENT`, `CREAM`, `GEL`, `INJECTION`, `RESPULE`, etc.

### Task 2: Backend Routes for Shelf Removal PDF
- **File:** `src/routes/expiry.ts`
- Add `GET /api/expiry/shelf-removal-pdf`:
  - Query parameters:
    - `date_from`, `date_to`: Date range
    - `sort_by`: `'alphabetical' | 'company' | 'rack' | 'expiry_date'` (default: `'alphabetical'`)
    - `dosage_form`: `'all' | 'solid' | 'liquid'` (default: `'all'`)
    - `format`: `'pdf' | 'csv'`
  - Queries active inventory nearing expiry, joining `medicines` (`dosage_form`, `manufacturer`, `rack`).
  - Sorts and groups according to user selection.
  - Returns streamed PDF with header `attachment; filename=shelf_removal_picklist_<timestamp>.pdf`.
- Add `POST /api/expiry/shelf-removal-pdf/send-whatsapp`:
  - Generates PDF file to temp directory.
  - Enqueues WhatsApp message with attached PDF to owner/store phone number via `whatsappQueueWorker`.
  - Message text: `📋 *[Store Name] - Shelf Removal Pick-List PDF*\nAttached is your near-expiry removal pick-list ([count] batches). Use this to pull expired/near-expiry stock from your shelves.`

### Task 3: Frontend API Service Extension
- **File:** `frontend/src/services/api.ts`
- Add API methods:
  - `downloadShelfRemovalPdf(params)`
  - `sendShelfRemovalWhatsApp(params)`

### Task 4: Frontend UI Modal in Expiry Page
- **File:** `frontend/src/pages/Expiry/ShelfRemovalModal.tsx` & `frontend/src/pages/Expiry/index.tsx`
- Add "Shelf Removal PDF" button with clipboard / download icon next to the existing export buttons.
- Render `ShelfRemovalModal` when clicked:
  - Radio toggle for Sorting:
    - Alphabetical (A → Z)
    - Company-wise (Manufacturer)
    - Rack / Shelf Location
  - Radio toggle for Dosage Form:
    - All Types
    - Solid Only (Tablets & Capsules)
    - Liquid Only (Syrups & Drops)
  - Time Horizon quick selectors:
    - Expired
    - Next 30 Days
    - Next 60 Days
    - Next 90 Days
  - Live count preview showing matching items.
  - Buttons:
    - "Download / Print PDF"
    - "Send to WhatsApp" (with loading state and success toast)

### Task 5: Verification & Guardrails
- Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`).
- Verify no TypeScript or compile errors.
- Run `node scripts/quick-update.mjs` to keep knowledge graph up to date.

---

## Tracking & Completion Checklist

- [x] Task 1: Backend PDF Generator (`src/utils/reportExporter.ts`)
  - Added `detectItemDosageForm` to classify medicines into SOLID, LIQUID, or OTHER.
  - Added `exportShelfRemovalPdf` generating A4 layout with letterhead, group banners (`SECTION [ A ]`, `COMPANY: CIPLA`, `SHELF: RACK-1`), and physical `[ ]` checkboxes for each batch.
- [x] Task 2: Backend Routes (`src/routes/expiry.ts`)
  - Added `fetchShelfRemovalBatches` helper joining `inventory_master` and `medicines`.
  - Added `GET /api/expiry/shelf-removal-pdf` with query parameters `sort_by`, `dosage_form`, `date_from`, `date_to`.
  - Added `POST /api/expiry/shelf-removal-pdf/send-whatsapp` creating PDF and enqueuing via `whatsappQueueWorker`.
- [x] Task 3: Frontend API Service (`frontend/src/services/api.ts`)
  - Added `downloadShelfRemovalPdf` and `sendShelfRemovalWhatsApp` with proper TypeScript payloads.
- [x] Task 4: Frontend UI & Modal (`frontend/src/pages/Expiry/ShelfRemovalModal.tsx` & `index.tsx`)
  - Created `ShelfRemovalModal.tsx` with sorting selectors, dosage form toggles, date controls, and WhatsApp override input.
  - Integrated `ShelfRemovalModal` and floating action trigger in `frontend/src/pages/Expiry/index.tsx`.
- [x] Task 5: Testing, Guardrails & Knowledge Graph Update
  - Ran `npm run guardrails` (`tsc --noEmit` and speed architecture): PASSED (0 violations).
  - Ran `node scripts/quick-update.mjs`: Knowledge graph synchronized (1634 nodes, 919 edges).
