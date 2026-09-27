# Implementation Plan: 90-Day Payment Receipt Storage & Retention Management

## 1. Storage Analysis & Sizing
- **Average Size per Screenshot**: ~101 KB (WhatsApp compressed JPEG).
- **Projected Storage Usage**:
  | Daily Order Volume | Monthly Storage | 90-Day Active Window | Annual Uncapped |
  |---|---|---|---|
  | 10 orders/day | ~30 MB | **~90 MB** | ~365 MB |
  | 30 orders/day | ~90 MB | **~270 MB** | ~1.1 GB |
  | 100 orders/day | ~300 MB | **~900 MB** | ~3.6 GB |
- **With 90-Day Retention Policy**:
  - Maximum disk space capped at **~90 MB to ~900 MB** indefinitely, preventing disk bloat while retaining all active orders and the 14-day return dispute window.

## 2. Retention Safety Criteria (Zero Accidental Loss)
A payment screenshot file is eligible for purge **only** if ALL 4 conditions are met:
1. **Age**: Order timestamp is older than 90 days (`datetime('now', '-90 days')`).
2. **Delivery Status**: Order is completely fulfilled (`delivery_status = 'delivered'` or `status IN ('Fulfilled', 'Ready')`).
3. **Return Window Closed**: Past the 14-day customer return window with no active dispute (`return_status IS NULL OR return_status = 'expired'`).
4. **Payment Settled**: Payment was verified and confirmed (`payment_status IN ('CONFIRMED', 'PAYMENT_CONFIRMED', 'VERIFIED')`).
*Active, pending verification, awaiting delivery, or disputed orders are strictly protected and NEVER deleted.*

## 3. Human-in-the-Loop Controls & Automation Architecture
1. **Automated Background Lane**:
   - Integrated into `src/services/imageArchiveService.ts` running daily at 2:30 AM via `runHeavyJob('payment_receipts_retention_purge')`.
   - Safely unlinks files, updates `payment_screenshot_path = NULL`, and inserts an audit log entry into `order_tracking_events`.
2. **Human-in-the-Loop Pharmacy Oversight (UI)**:
   - In Settings / Storage Management:
     - Real-time disk badge: shows total payment screenshots count and MB consumed.
     - "Run 90-Day Cleanup Now" button with confirmation modal showing preview of files to be cleaned.
     - Toggle: Enable / Disable automated 90-day background purge.

## 4. Tasks & Verification
- [x] Task 1: Add `purgeExpiredPaymentScreenshots(daysOld = 90)` method to `src/services/imageArchiveService.ts` with strict database safety checks.
- [x] Task 2: Schedule daily execution at 2:30 AM in `ImageArchiveService.initJobs()` and boot in `src/server.ts`.
- [x] Task 3: Expose storage diagnostics and manual trigger endpoint in `src/routes/utilities.ts` (`GET /api/utilities/storage/payment-proofs` and `POST /api/utilities/storage/purge-payment-proofs`).
- [x] Task 4: Add storage metrics & manual cleanup control in Settings UI with human confirmation dialog.
- [x] Task 5: Run integration tests & `npm run guardrails` — PASS (9/9 tests passed, 0 guardrail violations).
- [x] Task 6: Update knowledge graph (`node scripts/quick-update.mjs`) and register in `SMALL_BUG_FIX_PLAN.md`.
