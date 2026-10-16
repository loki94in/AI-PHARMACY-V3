# Implementation Plan: Bidirectional Customer Autocomplete & Dropdown in Special Orders

## Objective
Enable a seamless, bidirectional customer lookup dropdown (by **Patient Name** OR **Phone Number**) when creating or editing a Special Order / Quick Special Request. All 9,394+ existing saved customers (walk-in POS customers, active refill patients, past special order customers) can be searched directly. Selecting a customer or entering an exact 10-digit number auto-populates the customer's name, salutation, phone number, language, and customer ID.

---

## Changes Implemented

### 1. Backend Contact Enrichment & Search (`src/routes/crm.ts`)
- Enriched `GET /api/crm/patients` to check `special_orders` so patients with past special orders receive `has_special_order = 1` badge signal.
- Self-healing customer sync: On search or startup, added `syncLegacySpecialOrdersToCustomers` to ensure any distinct phone number from `special_orders` not yet in `customers` table is safely indexed into `customers`.
- Prioritized exact phone digit matches at the top of search results with `ORDER BY CASE WHEN phone = ? THEN 0 WHEN phone LIKE ? THEN 1 WHEN name LIKE ? THEN 2 ELSE 3 END, id DESC`.

### 2. Enhanced Phone Input with Autocomplete (`frontend/src/components/PhoneInputWithBadge.tsx`)
- Added props `enablePatientAutocomplete?: boolean` and `onSelectPatient?: (patient: PatientSuggestionItem) => void`.
- Implemented debounced patient phone autocomplete lookup (250ms when `cleanDigits.length >= 3`) querying `api.getPatients({ q: cleanDigits, limit: 8 })`.
- Rendered an accessible, semantic dropdown list using `.dropdown-scroll` showing:
  - Patient Name
  - Formatted Phone Number
  - Indicator badges: `🔁 Refill`, `⭐ Walk-in / POS`, `📦 Special Order`
- Keyboard navigation (ArrowDown, ArrowUp, Enter, Escape).
- Automatic 10-digit matching: If exact 10 digits match an existing customer, automatically calls `onSelectPatient(patient)` to populate name and language without requiring an extra click.

### 3. Quick Special Request Modal Upgrade (`frontend/src/components/QuickOrderModal.tsx`)
- Enabled `enablePatientAutocomplete={true}` and connected `onSelectPatient` to `SalutationNameInput`.
- Replaced the plain `<input type="tel">` with `PhoneInputWithBadge` passing `enablePatientAutocomplete={true}` and `onSelectPatient`.
- Added `customerId` state and connected `customer_id: customerId || undefined` to `api.createBatchOrders`.
- Ensured bidirectional auto-population:
  - Typing/selecting Name $\rightarrow$ fills Phone, Salutation, Language, and `customerId`.
  - Typing/selecting Phone $\rightarrow$ fills Name, Salutation, Language, and `customerId`.

### 4. CRM Special Orders Modal Upgrade (`frontend/src/pages/CRM/SpecialOrdersSection.tsx`)
- Connected `enablePatientAutocomplete={true}` and `onSelectPatient` on `PhoneInputWithBadge` in both the **New Special Order** dialog and **Edit Special Order** dialog so typing/selecting phone digits auto-populates Customer Name, Salutation, and Language.

### 5. CRM Refills Modal Upgrade (`frontend/src/pages/CRM/RefillsSection.tsx`)
- Connected `enablePatientAutocomplete={!editingPatient}` and `onSelectPatient` on `PhoneInputWithBadge` in the **New Refill** dialog so refill creation also gains phone-based customer auto-population.

---

## Verification & Guardrails

### Automated Checks
- `npm run guardrails`: **PASS** — 0 violations, clean `tsc --noEmit`. Speed architecture intact.
- `npm run build:client`: **PASS** — Vite client built in 1m 11s with 0 errors.
- `node scripts/quick-update.mjs`: **PASS** — Knowledge graph synchronized (1,194 nodes, 800 edges).

---

## Task Progress Checklist
- [x] Task 1: Backend contact enrichment & search sorting in `src/routes/crm.ts`
- [x] Task 2: Enhance `PhoneInputWithBadge.tsx` with customer dropdown & auto-fill
- [x] Task 3: Upgrade `QuickOrderModal.tsx` with bidirectional Name & Phone autocomplete
- [x] Task 4: Upgrade `SpecialOrdersSection.tsx` with phone autocomplete
- [x] Task 5: Upgrade `RefillsSection.tsx` with phone autocomplete
- [x] Task 6: Run guardrails, build check, and update knowledge graph
