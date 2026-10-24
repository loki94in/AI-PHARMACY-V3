# Implementation Plan — Fix WhatsApp Queue Deadlock, ProcessGuardian Chrome Kills & Distributor Phone Normalization

## 1. Goal
Fix the distributor dispatch WhatsApp delivery failure where:
1. `ProcessGuardian.reapSystemProfileOrphans` erroneously terminates WhatsApp's active Chromium renderer tab processes, causing `Runtime.callFunctionOn timed out` errors.
2. `whatsappClient.sendMessage` hangs indefinitely without an outer watchdog timeout when Puppeteer's tab is killed, locking `whatsappQueueWorker.isProcessing = true` and stalling all pending distributor reminders.
3. `whatsappQueueWorker` lacks a stuck-item watchdog to auto-heal items stuck in `status = 'sending'`.
4. The Dispatch UI rejects distributor phone numbers with leading zeros (e.g. `09822012345`) or country code formatting instead of automatically normalizing to 10 digits.

---

## 2. Root Cause Summary
1. **False-Positive Chromium Reaping**: `reapSystemProfileOrphans` in `src/utils/chromeBrowser.ts` scans for `chrome.exe` processes matching `.wwebjs_auth`. It only added `getWhatsAppBrowserPid()` (the root process PID) to `protectedPids`. Chromium runs WhatsApp Web in a separate renderer child process (~410 MB). ProcessGuardian identified this child process as an orphan and taskkilled it (`PID 12392`).
2. **Missing Watchdog Timeout in `sendMessage`**: When the Chromium renderer was terminated, Puppeteer's Chrome DevTools Protocol request hung waiting for a CDP response that never arrived. In `src/whatsappClient.ts`, `targetClient.sendMessage()` had no watchdog timeout, causing the Promise to hang indefinitely.
3. **Queue Worker Deadlock**: Because `sendMessage` never resolved or rejected, `whatsappQueueWorker.processQueueInternal()` remained blocked in `this.isProcessing = true` and `currentSendingItemId: 1013`. All subsequent distributor reminders (such as queue item #1014 for Arnav Pharmaceuticals `9637256516`) were blocked in `"pending"`.
4. **Rigid Phone Validation in Dispatch UI**: `handleSaveDistributorPhone` in `frontend/src/pages/Dispatch/index.tsx` rejected numbers where `cleanPhone.length !== 10 && !(cleanPhone.length === 12 && cleanPhone.startsWith('91'))`. Typing a standard 11-digit number with leading zero (`09...`) triggered a validation error instead of stripping the `0`.

---

## 3. Step-by-Step Implementation Steps

### Step 1: Protect WhatsApp Process Tree in `src/utils/chromeBrowser.ts`
- In `reapSystemProfileOrphans`:
  - If WhatsApp is active or authenticated (`clientInstance` exists, `isReady` is true, or `hasSavedSession()`), exempt all `.wwebjs_auth` processes from being reaped.
  - Query all child PIDs belonging to `getWhatsAppBrowserPid()` and add them to `protectedPids`.
- **Verification**: `reapSystemProfileOrphans` never kills active WhatsApp tab renderers.

### Step 2: Add Strict 25s Watchdog Timeout to `sendMessage` in `src/whatsappClient.ts`
- Wrap `doSend(clientInstance!)` in a 25-second timeout Promise.
- If Puppeteer/CDP hangs for more than 25 seconds, cleanly reject with an explicit timeout error so execution unblocks and errors are logged properly.
- **Verification**: If a Chromium process becomes unresponsive, the Promise rejects after 25s instead of hanging indefinitely.

### Step 3: Add Stalled-Item Watchdog & Cleanup in `src/services/whatsappQueueWorker.ts`
- Ensure `processQueueInternal()` always resets `this.isProcessing = false` and `this.currentSendingItemId = null` in a `finally` block.
- Add pre-flight recovery for items stuck in `status = 'sending'` for $> 60$ seconds (recover them to `failed_offline` with an attempt log entry).
- **Verification**: Deadlocks are broken automatically within 60 seconds.

### Step 4: Auto-Normalize Phone Numbers in `frontend/src/pages/Dispatch/index.tsx`
- Update `handleSaveDistributorPhone` to use robust 10-digit normalization:
  - If input starts with `0` and has 11 digits, slice off the `0`.
  - If input starts with `91` and has 12 digits, slice off the `91`.
  - Strip all non-digit characters.
- Allow entering and saving `09822012345`, `+91 98220 12345`, or `9822012345` seamlessly.
- **Verification**: All valid 10-digit formats save without validation errors and auto-dispatch.

### Step 5: Verification & Safety Gates
- Run `npm run guardrails` (zero violations).
- Run `node scripts/quick-update.mjs` (knowledge graph auto-update).
- Verify queue processing unfreezes and dispatch reminders can be sent.

---

## 4. Completed Tasks Log
- [x] Step 1: Protect WhatsApp Process Tree in `chromeBrowser.ts`.
  - *Completed*: In `reapSystemProfileOrphans`, implemented multi-pass process tree propagation so all child, renderer, and GPU processes of `protectedPids` are protected. Added strict exemption for all `.wwebjs_auth` processes when WhatsApp is active or initializing.
- [x] Step 2: Add 25s watchdog timeout in `whatsappClient.ts`.
  - *Completed*: Added `executeWithWatchdog` wrapping all `doSend` calls with a 25-second timeout Promise race, preventing CDP hangs from blocking indefinitely. Updated `isPuppeteerDetachedError` with timeout patterns (`callFunctionOn timed out`, `Runtime.callFunctionOn`, etc.) to trigger automatic client teardown and reconnect.
- [x] Step 3: Add stalled item watchdog in `whatsappQueueWorker.ts`.
  - *Completed*: In `processQueueInternal`, added self-healing watchdog query recovering any item stuck in `status = 'sending'` for > 60 seconds to `failed_offline` with incremented retry count. Expanded startup recovery query to include `status IN ('pending', 'failed_offline', 'sending')`.
- [x] Step 4: Auto-normalize phone input in `Dispatch/index.tsx`.
  - *Completed*: In `handleSaveDistributorPhone`, normalized phone input by stripping leading `0` from 11-digit numbers and `91` from 12-digit numbers before 10-digit validation, allowing `09...`, `+91`, and standard 10-digit phone numbers to save and auto-dispatch smoothly.
- [x] Step 5: Run tests and performance guardrails.
  - *Completed*: Ran `npm run guardrails` (`node scripts/performance-guardrails.mjs`), which confirmed 0 violations and verified TypeScript compilation (`tsc --noEmit`). Ran `npx tsc -p frontend/tsconfig.app.json --noEmit`, which passed with code 0. Recorded P2-118 in `SMALL_BUG_FIX_PLAN.md`.

