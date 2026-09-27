# Implementation Plan: Daily Morning Operational Briefing & IMAP Connection Cleanup

## Context & Objectives
1. **Morning Operational Briefing**:
   - Fix SQLite aggregate collapse bug (`MIN(...)` without `GROUP BY`) in `src/services/refillService.ts` so ALL refills due in the next 7 days appear with all medicine names and quantities.
   - Unify active Special Orders, Website Orders, WhatsApp Orders, and Online Orders into the briefing with source badges and statuses.
   - Include ALL daily actionable tasks (urgent reorders for out-of-stock refills, pending call board follow-ups, and staged messages) so no daily work is missed.
   - Remove the footer line: `🔒 Human-in-the-Loop: Visit http://localhost:5173/crm to review & 1-click approve before dispatch.`.
2. **Monthly Overview Preservation**:
   - Ensure monthly expiring batches and broader inventory planning remain in `src/services/monthlyReportService.ts` for the 1st-of-the-month report.
3. **IMAP Boot Error Resolution**:
   - Add `emailService.gracefulShutdown()` into `src/server.ts` shutdown flow so IMAP sends `LOGOUT` before closing, preventing lingering socket limits on Google servers.
   - De-duplicate `startEmailPoller()` calls between worker supervisor and trigger scheduler.
   - Demote `isSimultaneousLimit` error logging in `emailService.ts` from full stack trace to a concise notice.

---

## Tasks Checklist
- [x] **Task 1**: Fix Refill Due Query in `src/services/refillService.ts`
  - Removed `MIN(...)` aggregate function from `refillDetailRows` query (replaced with `DATE(pr.next_refill_date) as due_date`).
  - Increased limit to 50 to accommodate multi-medicine prescriptions.
  - Verified grouped patient & medicine output.
- [x] **Task 2**: Unify Active Orders & Complete Daily Tasks in `src/services/refillService.ts`
  - Expanded `activeOrders` query to include `customer_order_source` (Website, WhatsApp, Special Order).
  - Added actionable tasks: Urgent stock reorders for hold medicines, pending call board tasks, staged messages so no daily task is missed.
  - Implemented Date-Driven Auto-Add: Automatically injects Periodic Expiry Audit and Overdue Credit Audit on milestone dates (1st of month, 15-18th mid-month review, month-end, or dates configured in settings).
  - Removed `🔒 Human-in-the-Loop: Visit http://localhost:5173/crm ...` footer line across all templates.
  - Updated all templates (`detailed`, `compact`, `checklist`, `executive`) consistently.
- [x] **Task 3**: Preserve Monthly Overview in `src/services/monthlyReportService.ts`
  - Verified and enhanced monthly report with monthly expiring batches, pending call board metrics, and staged notification counts for the 1st-of-month report.
- [x] **Task 4**: Resolve IMAP Connection Leak in `src/server.ts` & `src/services/emailService.ts`
  - Added `emailService.gracefulShutdown()` to `server.ts` `gracefulShutdown()`.
  - Formatted `isSimultaneousLimit` in `emailService.ts` cleanly without redundant scary stack trace.
  - Prevented duplicate `startEmailPoller()` registration via `isPollingStarted` flag.
- [x] **Task 5**: Verify With Automated Tests & Knowledge Graph Update
  - Ran database query verification script across all templates.
  - Passed `npm run guardrails` (tsc + speed rules).
  - Ran `node scripts/quick-update.mjs`.
