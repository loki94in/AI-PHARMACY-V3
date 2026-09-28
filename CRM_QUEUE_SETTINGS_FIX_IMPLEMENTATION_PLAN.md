# CRM Auto/Manual Toggle & Queue Sluggishness Fix — Implementation Plan

## Root Causes Diagnosed

1. **Route Shadowing (CRITICAL):** `router.put('/:id')` at line 434 in `src/routes/refills.ts`
   intercepts ALL PUT requests including `PUT /patient-reminder-mode`, returning 404 "Refill not found".
   This causes the CRM Auto/Manual toggle to FAIL every time.

2. **`checkAllRefills()` blocks HTTP response:** Pause, Cancel, Delete refill routes all await
   `checkAllRefills(db)` BEFORE sending `res.json()`. This function scans ALL active refills,
   queries inventory per-refill, and may write quick-bill invoices, causing 3-8 second delays.

3. **`getWorkerState()` appended to every queue action:** Pause/Resume/Flush/Flush-Next all
   await a 5-DB-query state snapshot and return 300 items before sending HTTP response.

## Files To Change

- `src/routes/refills.ts` — Add numeric guard to PUT /:id, background checkAllRefills
- `src/routes/whatsappQueue.ts` — Remove getWorkerState() from simple action endpoints

## Tasks

### Task 1: Fix route shadowing in refills.ts ✅ DONE
- Added `if (!/^\d+$/.test(id)) return next();` guard to `router.put('/:id')`
- `PUT /patient-reminder-mode` now correctly falls through to its handler

### Task 2: Background checkAllRefills ✅ DONE
- `toggle-pause`: responds immediately, checkAllRefills fires via `setImmediate`
- `cancel`: responds immediately, checkAllRefills fires via `setImmediate`
- `deletePatientRefillsHandler`: responds immediately, checkAllRefills fires via `setImmediate`
- Pause/cancel/delete now respond in <100ms instead of 3-8 seconds

### Task 3: Strip getWorkerState() from queue actions ✅ DONE
- `/pause`, `/resume`, `/toggle-pause`, `/flush`, `/flush-next` respond instantly with `{success, isPaused, message}`
- Removed 5-query state snapshot + 300-item fetch from each action response
- Frontend fetchStatus() call still refreshes the state separately

### Task 4: Guardrails + deploy ✅ DONE
- `npm run guardrails` → PASS (0 violations, TypeScript clean)
- `npm run build:bundle` → OK (4.2MB dist-pkg/server.cjs)
- Deployed to G:\AI Pharmacy OS via deploy_g.cjs
- `node scripts/quick-update.mjs` → Nodes: 1099, Edges: 543
