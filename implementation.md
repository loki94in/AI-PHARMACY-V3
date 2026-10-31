# Implementation Plan: Universal Title-Agnostic Search & CRM Tab Search Auto-Expansion

## Objective
Make patient, customer, and order searching universal, title-agnostic, and punctuation-resilient across CRM Refills, Special Orders, POS, and all 22+ pages. Eliminate empty search results when searching without salutations ("nigde") or with variations ("mr nigde", "mr, nigde", "mr. nigde"), and prevent the CRM "Overdue" default tab from hiding non-overdue matches during search.

---

## Root Causes Addressed
1. **Salutation & Punctuation Mismatch**:
   - Customer and patient names are saved with prefixes (e.g. `Mr. MADNE`, `Mrs. MANGALA SHIRGONKAR`, `Mr. JADHAV`) while legacy/POS names are saved without prefixes (e.g. `rutuja nigde`).
   - Standard `.includes(q)` and SQL `LIKE '%q%'` fail when punctuation differs (e.g. `"mr, nigde"` or `"mr nigde"` vs `"Mr. Nigde"`), or when searching just the surname/first name without prefix.
2. **Tab Isolation in CRM Refills & Special Orders**:
   - Default tab is `Overdue`. When searching for a patient whose refill is active or in lead window, the tab filter drops them, showing 0 results (empty screen).
   - Switching tabs while search is active can desynchronize selection and leave empty panels.

---

## Implementation Details

### Task 1: Create Universal Search Utility (`frontend/src/utils/searchUtils.ts`)
- `normalizeSearchQuery(query: string)`: Strips salutation prefixes (`mr`, `mrs`, `ms`, `miss`, `dr`, `shri`, `smt`) and punctuation (`,`, `.`, `-`).
- `matchUniversalTokens(target: string | (string | undefined | null)[], query: string)`: Breaks query into normalized tokens and ensures all tokens match anywhere in target.
- `stripSalutation(name: string)`: Helper to strip prefix for clean display and indexing.

### Task 2: Update Backend Patient Search (`src/routes/crm.ts`)
- In `GET /crm/patients`:
  - Normalize query `q` by extracting salutation tokens and core search terms.
  - Query SQLite with both raw query and stripped terms so searching `"nigde"`, `"mr nigde"`, or `"mr, nigde"` returns all matching records.

### Task 3: Upgrade CRM Refills Search & Tab Flow (`frontend/src/pages/CRM/RefillsSection.tsx`)
- Replace strict `patient_name.toLowerCase().includes(q)` with `matchUniversalTokens`.
- Auto-expand search across all refill tabs when search query is entered (length >= 2), displaying tab status badges so the user sees matches even if they are not overdue.
- When search is cleared, seamlessly restore current tab view without empty state confusion.
- Keep selected patient in sync when clearing or switching search.

### Task 4: Upgrade CRM Special Orders Search (`frontend/src/pages/CRM/SpecialOrdersSection.tsx`)
- Use `matchUniversalTokens` across `product`, `requester`, `phone`, and `pharmarack_distributor`.
- Auto-expand search across status tabs when search query is entered (length >= 2).

### Task 5: Enhance `SalutationNameInput.tsx` Autocomplete & Name Handling
- In `SalutationNameInput.tsx`, strip salutation if typed into name input, setting salutation dropdown automatically and preventing duplicate prefix issues.
- Query autocomplete with normalized query.

### Task 6: Verification, Guardrails & Knowledge Graph
- Verify TypeScript compilation (`tsc --noEmit`).
- Verify frontend build (`npm run build`).
- Verify `npm run guardrails` passes.
- Run `node scripts/quick-update.mjs`.

---

## Tasks & Progress Tracker

- [ ] Task 1: Create `frontend/src/utils/searchUtils.ts` with universal token matching and salutation normalization.
- [ ] Task 2: Enhance backend `GET /crm/patients` in `src/routes/crm.ts` with title-agnostic query parsing.
- [ ] Task 3: Upgrade `RefillsSection.tsx` with universal token search and smart tab auto-expansion.
- [ ] Task 4: Upgrade `SpecialOrdersSection.tsx` with universal search across all statuses.
- [ ] Task 5: Enhance `SalutationNameInput.tsx` to handle typed titles gracefully and cleanly autocomplete.
- [ ] Task 6: Run verification tests, performance guardrails, and knowledge graph update.
