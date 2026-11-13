# Implementation Plan: Distributor Priority Arrow Buttons & Credit Patient Name Inline Edit

**Status:** Completed  
**Goal:** Enable one-click arrow reordering in Distributor Priority (`CRM → Distributor Priority`) and allow inline name editing for Credit Patients (`CRM → Customer Credit`) to easily correct spelling mistakes.

---

## 1. Problem Statement
1. **Distributor Priority Locked:** In `CRM → Distributor Priority`, reordering currently relies 100% on HTML5 mouse drag-and-drop. On laptops, touchpads, or in Electron, dragging non-button divs can be awkward, and the "Save priority" button starts disabled, giving users the impression that distributor priority is locked.
2. **Credit Patient Name Read-Only:** In `CRM → Customer Credit`, the customer's name is rendered as static display text with no edit button. While the backend already has `api.updatePatient` / `PUT /crm/patients/:id`, the UI lacks any way to fix misspelled customer names without going to another page.

---

## 2. Implemented Surgical Changes

### A. `frontend/src/pages/CRM/DistributorPrioritySection.tsx`
* Imported `ChevronUp` and `ChevronDown` from `lucide-react`.
* Added one-click Move Up (`ChevronUp`) and Move Down (`ChevronDown`) buttons to every distributor row.
* Clicking an arrow moves the item in the list and immediately enables the "Save priority" button.
* Kept existing drag-and-drop functionality intact for users who prefer dragging.

### B. `frontend/src/pages/CRM/CustomerCreditSection.tsx`
* Imported `Pencil` and `Check` from `lucide-react`.
* Added name editing state (`isEditingName`, `editingNameValue`, `savingName`).
* In the credit account header, displayed an edit pencil icon next to the patient's name.
* When clicked, renders an inline input field with `Save` (`Check`) and `Cancel` (`X`) buttons, supporting pressing `Enter` to save and `Escape` to cancel.
* Calls `api.updatePatient(selectedCustomer.id, { name: cleanName })`.
* Live-updates `selectedCustomer.name` and the left-side `customers` list in-place, and shows a success toast.

---

## 3. Plan Tasks & Completed Work Log

### Task 1: Add Move Up / Down Arrow Buttons to Distributor Priority
- **File:** `frontend/src/pages/CRM/DistributorPrioritySection.tsx`
- **What was completed:** Added `ChevronUp` and `ChevronDown` buttons with bounds checks and stopping propagation to avoid drag conflict. Immediately enables `Save priority`.
- **Status:** Done.

### Task 2: Add Inline Name Editing to Customer Credit
- **File:** `frontend/src/pages/CRM/CustomerCreditSection.tsx`
- **What was completed:** Added inline edit mode with auto-focus input, enter/esc keys, and `api.updatePatient` handler. Updates in-memory selected customer and cached list with a success toast.
- **Status:** Done.

### Task 3: Verification & Guardrails
- **Verification:** Ran `npm run guardrails` (`tsc --noEmit` passed, no speed architecture violations).
- **Status:** Done.
