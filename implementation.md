# Implementation Plan — Add Medicine Name Search in CRM Refills Section

## 1. Goal
Allow pharmacists to search refill patients not only by **patient name** and **phone number**, but also by the **name of any prescribed medicine** (e.g., typing "Telma", "Metformin", or "Pantop") in the Refills Section search bar.

---

## 2. Root Cause Analysis
- In `frontend/src/pages/CRM/RefillsSection.tsx` (line 1214):
  ```tsx
  const q = search.toLowerCase().trim();
  const matchesSearch = !q || (p.patient_name?.toLowerCase().includes(q)) || (p.patient_phone?.includes(q));
  if (!matchesSearch) return false;
  ```
  The filter function currently checks only `p.patient_name` and `p.patient_phone`.
- The patient's prescribed medicines list `p.medicines` (each having `medicine_name: string`) is loaded and present in state, but is never checked during filtering.
- Searching for a medicine name yields zero patient matches.

---

## 3. Step-by-Step Implementation

### Step 1: Expand Filter Logic in `frontend/src/pages/CRM/RefillsSection.tsx`
- Update `matchesSearch` on line 1214 to check `p.medicines`:
  ```tsx
  const matchesMedicine = p.medicines?.some(m =>
    m.medicine_name?.toLowerCase().includes(q) ||
    (m.batch_no && m.batch_no.toLowerCase().includes(q))
  );
  const matchesSearch = !q ||
    (p.patient_name?.toLowerCase().includes(q)) ||
    (p.patient_phone?.includes(q)) ||
    matchesMedicine;
  ```

### Step 2: Update Search Input Placeholder & Matching Indicator
- In `frontend/src/pages/CRM/RefillsSection.tsx`:
  - Update search input placeholder to `"Search patient, mobile, medicine or barcode..."`.
  - On the patient sidebar card (around lines 1683–1688), when `q` matches a medicine name, show a small visual badge (e.g., `💊 [Matched Medicine]`) so the user immediately sees why the patient is in the search results.

### Step 3: Verification & Safety Gates
- Run `npm run guardrails` (ensure 0 violations, clean TypeScript compilation).
- Run `node scripts/quick-update.mjs` (synchronize knowledge graph).
- Test search filtering with:
  1. Patient name
  2. Phone number
  3. Medicine name

---

## 4. Completed Tasks Log
- [x] Step 1: Update search filter logic in `RefillsSection.tsx` to include `p.medicines`.
  - *Completed*: In `frontend/src/pages/CRM/RefillsSection.tsx`, updated the `filtered` calculation so `matchesSearch` checks `p.medicines` for matching `medicine_name` and `batch_no` in addition to `p.patient_name` and `p.patient_phone`.
- [x] Step 2: Update placeholder and add matching medicine highlight badge on patient card.
  - *Completed*: Updated search placeholder to `"Search patient, mobile, medicine or barcode..."` and added an inline `💊 [Medicine Name]` indicator on the patient card when a search query matches one of their prescribed medicines.
- [x] Step 3: Run guardrails and update knowledge graph.
  - *Completed*: `npm run guardrails` passed with exit code 0 (`tsc --noEmit` clean, zero violations). Ran `node scripts/quick-update.mjs` successfully updating the knowledge graph (Nodes: 1345, Edges: 851).
