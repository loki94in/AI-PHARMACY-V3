# Implementation Plan: Fix Call Reminder Dismiss in CRM Page

## Overview
Resolves the issue where users are unable to dismiss call tasks in the CRM Call Task Board (`CallTaskBoard.tsx`).
- Root cause: `src/routes/callTasks.ts` directly destructures `req.body` (`const { notes } = req.body`), throwing a `TypeError: Cannot destructure property 'notes' of 'req.body' as it is undefined` on requests sent without a JSON body, resulting in HTTP 500.
- Solution: Safe fallback `req.body || {}` in `src/routes/callTasks.ts` for all PATCH endpoints (`/:id/dismiss`, `/:id/complete`, `/:id/reschedule`, `/:id`), and explicit `{}` payload with feedback toast in `frontend/src/components/CallTaskBoard.tsx`.

---

## Tasks & Progress Tracking

- [x] Task 1: Safeguard `req.body || {}` in `src/routes/callTasks.ts` across `/:id/dismiss`, `/:id/complete`, `/:id/reschedule`, and `/:id`.
- [x] Task 2: Update `dismissMutation` in `frontend/src/components/CallTaskBoard.tsx` to pass empty body `{}` and provide immediate toast feedback.
- [x] Task 3: Verify fix by testing dismiss endpoint and checking `patient_call_tasks`.
- [x] Task 4: Run performance guardrails (`npm run guardrails`) and update knowledge graph (`node scripts/quick-update.mjs`).

---

## Completion Report

### Summary of Completed Work
1. **Backend Crash Fixed (`src/routes/callTasks.ts`)**:
   - Replaced unsafe `req.body` destructuring across all 4 PATCH endpoints:
     - `/:id/dismiss` &rarr; `const { notes } = req.body || {};`
     - `/:id/complete` &rarr; `const { call_outcome, notes } = req.body || {};`
     - `/:id/reschedule` &rarr; `const { reschedule_date, notes } = req.body || {};`
     - `/:id` &rarr; `const { notes, call_outcome } = req.body || {};`
   - Requests sent with no body or missing `Content-Type: application/json` now safely default to `{}` instead of throwing `TypeError (HTTP 500)`.

2. **Frontend Call & Feedback (`frontend/src/components/CallTaskBoard.tsx`)**:
   - Updated `dismissMutation` to pass `{}` as the payload payload to guarantee valid JSON headers:
     ```ts
     mutationFn: (id: number) => apiClient.patch(`/call-tasks/${id}/dismiss`, {})
     ```
   - Added immediate user feedback: `toastEvent.trigger('Call task dismissed', 'info', '/crm')` on success and an error toast on failure.

3. **Verification**:
   - `npm run guardrails` passed (`tsc --noEmit` OK, zero violations).
   - `node scripts/quick-update.mjs` synchronized the knowledge graph.
