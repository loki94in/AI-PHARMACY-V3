# Live Cart Modal Speed Optimization & Silent Refresh Implementation Plan

## Goal
Optimize the "Add to Live" popup (`LiveCartAddModal` / `LiveCartSearchSection`) and keyboard shortcut (`Alt + L`):
1. **Instant Modal Open (0ms)**: Pre-warm the lazy-loaded `LiveCartAddModal` bundle on app idle in `Layout.tsx` so pressing `Alt + L` opens the modal instantaneously without script parsing delays.
2. **Eliminate Mount Request Avalanche**: Hydrate the modal immediately from module cache without blocking loaders; stagger secondary background network requests (`refills`, `recon-orders`, `ignored-words`) so the search input and UI thread remain 100% responsive.
3. **Snappy Autocomplete Search**: Optimize search debounce to 120ms and ensure instant client cache rendering so results appear with zero lag.
4. **Smooth Focus & Match UI**: Preserve immediate quantity auto-focus while eliminating layout shifts.

---

## Proposed Changes

### File 1: `frontend/src/components/Layout.tsx`
- Add an idle `useEffect` timer (1200ms after mount) to pre-warm the dynamic chunk `void import('./LiveCartAddModal')`.
- Ensures that when the user presses `Alt + L` or clicks "Add to Live", the component is already in browser memory.

### File 2: `frontend/src/components/LiveCartAddModal.tsx`
- When `isOpen` becomes true:
  - Immediately display cached cart items from module-level variable `cachedCartDistributors` with zero loading spinners.
  - Run `fetchLiveCartSummary(hasCache)` silently.
  - Stagger secondary background lists (`fetchPendingRefills`, `fetchReconOrders`, `fetchIgnoredWords`) with a 400ms timeout so initial keyboard input is never blocked by network/CPU contention.

### File 3: `frontend/src/components/LiveCartSearchSection.tsx`
- Refine debounce timer to 120ms (down from 150ms) for quicker keystroke responsiveness.
- Ensure instantaneous cache rendering from `clientSearchCache` while background revalidation updates rates smoothly.

---

## Verification & Guardrails
1. Run `npm run guardrails` (`tsc --noEmit` and performance scanner) to verify 0 errors and compliance.
2. Run `npm run build:client` to confirm the frontend bundle builds cleanly.
3. Run `node scripts/quick-update.mjs` to keep the Auto-Knowledge Graph synchronized.

---

## Tasks & Progress Tracking

- [x] Task 1: Pre-warm `LiveCartAddModal` chunk on idle in `Layout.tsx`
- [x] Task 2: Stagger secondary background requests and ensure instant cache display in `LiveCartAddModal.tsx`
- [x] Task 3: Optimize search debounce and instant cache retrieval in `LiveCartSearchSection.tsx`
- [x] Task 4: Run guardrails, client build, and synchronize Auto-Knowledge Graph

---

## Completed Tasks Summary

### Task 1: Pre-warm `LiveCartAddModal` Chunk in `Layout.tsx`
- Added an idle timer (1200ms after shell mount) to preload the `LiveCartAddModal` chunk in the background.
- Eliminates the dynamic chunk fetch and parse delay so pressing `Alt + L` or clicking "Add to Live" renders the modal instantaneously (0ms).

### Task 2: Staggered Secondary Requests & Silent Cache in `LiveCartAddModal.tsx`
- Hydrated modal instantly from module-level variable `cachedCartDistributors` with no blocking loading spinner when data already exists.
- Switched live cart summary fetch to silent background refresh.
- Moved non-critical secondary fetches (`fetchPendingRefills`, `fetchReconOrders`, `fetchIgnoredWords`) into a 400ms staggered timeout so that the search input, cursor, and main UI thread have 100% responsiveness without network congestion on mount.

### Task 3: Tuned Search Debounce & Instant Cache in `LiveCartSearchSection.tsx`
- Reduced search debounce timer from 150ms to 120ms for faster, near-instant keystroke response.
- Preserved user suggestion navigation index during background revalidation updates so the dropdown never jumps or flickers.

### Task 4: Verification & Knowledge Graph
- `npm run guardrails`: Passed clean (exit 0; `tsc --noEmit` OK, 0 guardrail violations).
- `npm run build:client`: Passed clean in 49.20s with 0 errors.
- `node scripts/quick-update.mjs`: Knowledge Graph synchronized (1,173 nodes, 783 edges).
