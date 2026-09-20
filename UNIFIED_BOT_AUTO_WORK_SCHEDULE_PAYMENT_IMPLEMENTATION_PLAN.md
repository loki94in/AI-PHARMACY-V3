# UNIFIED BOT AUTO-WORK — SCHEDULED MESSAGE → OWNER FORWARDING → PAYMENT SCREENSHOT → SCHEDULE PIPELINE

**Single implementation plan — root folder. Fix items ONE BY ONE in order. No implementation in this file.**
**Path:** `UNIFIED_BOT_AUTO_WORK_SCHEDULE_PAYMENT_IMPLEMENTATION_PLAN.md` (repository root)
**Date:** 2026-09-20 | **Status:** PLAN ONLY — do not implement from this file without opening a build task per phase.
**Contracts:** `AGENTS.md` (§SPA Performance, §Pharmarack Session Persistence, §Manual-Only Patient Messaging, §Page Ownership), `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` (P1 events-not-timers, P2 cache-first, P3 gated workers, P4 credentials sacred), `src/AGENTS.md`, `frontend/AGENTS.md`, `scripts/performance-guardrails.mjs`

---

## 1. GOAL (one sentence)

Make the WhatsApp bot auto-work with zero `failed` / `scheduled-cred-lost` stalls, forward every order to the owner **strictly per the app schedule date/time**, and handle **payment QR + payment screenshot shared by anyone** end-to-end — with any agent able to implement it **one small change at a time without breaking the app**.

---

## 2. CURRENT WORKFLOW MAP (verified read-only)

```
WA message (text / image)
 → src/whatsappClient.ts (wwebjs LocalAuth, .wwebjs_auth, idle-sleep evaluator ~60s)
 → src/services/whatsappIntentService.ts handleInbound / handleOcrComplete
     extractMedicineCandidates() (src/services/intentKeywords.ts, splits aur/and/plus, cap 8)
     → passesGate() 0.60 with-intent / 0.72 implicit (whatsappIntentService.ts:29)
     → resolveInventoryStock() batched is_active=1 → classifyAvailability()
        IN_STOCK | REGISTERED_NO_STOCK | EXTERNAL_ONLY
     → detectNonAllopathicKind() (cosmetic/ayurvedic/homeopathy → skip Pharmarack)
     → searchCatalog() + ONE live performPharmarackSearch per candidate (ONE per photo primary)
     → eventService.broadcast('wa_medicine_match') (:2590 / :3101 / :3272)
 → src/services/eventService.ts:15 broadcast(type, payload)
 → ONE global EventSource frontend/src/hooks/useGlobalSseInvalidation.ts:120
     SSE_QUERY_MAP:17 + SSE_CUSTOM_EVENTS:43 (refetchType:'none' deferred-stale)
 → consumers:
     frontend/src/pages/AIEngineering/WaRequestsPanel.tsx:542 sse-wa-medicine-match → feedCache:61 + waMediaCache:187
     frontend/src/components/Layout.tsx:2555 QuickAssistSidebar (chrome, OUTSIDE KeepAliveOutlet)
     Topbar / WhatsAppQueuePopover / AutomationHubPopover
 → side effects:
     special_orders insert (customer_order_source='whatsapp') → broadcast('order_updated')
     wa_pending_clarifications steps: awaiting_medicine / awaiting_customer_name /
       awaiting_order_customer_name / awaiting_owner_selection (72h) / awaiting_payment / awaiting_owner_payment_confirmation
     waAdminEscalationService.maybeEscalate() → whatsappQueueWorker.enqueue() → owner WA
     addItemsToPharmarackCart() if auto_add_to_live_cart ON (hard-gated success===true)
     staged customer message in automation_notifications (needs_confirmation=1, NEVER auto-sent)
```

**Scheduler:** `src/services/orderScheduleService.ts:228 calculateOrderSchedule()` is the ONLY scheduler. Reads `app_settings` + `store_settings` (`pharmacy_cutoff_time` default `23:00`, `delivery_window_start/end`, `sunday_*`, `pharmacy_timezone Asia/Kolkata`, holidays `pharmacy_holidays`). Outputs `scheduled_processing_at (08:00 IST target day) / estimated_delivery_start/end / cutoff_at / schedule_status (standard|post_cutoff|sunday_shift|holiday_shift|overridden) / schedule_version`. Persisted by `persistOrderSchedule()` into `special_orders` cols + `order_tracking_events`. Owner override via `overrideOrderSchedule()` → `schedule_status='overridden'`, `schedule_version++`, `broadcast('order_updated')`.

**Payment:** `src/services/paymentQrService.ts:115 allocateNextQr()` rotates `QR_1/2/3 != last_selected_payment_qr`, `buildUpiUri(upiId,payee,50,soCode)` → `upi://pay?pa=&pn=&am=50.00&cu=INR&tr=SO-XXX`, `generateQrBuffer()` 300px PNG. Saved per order `payment_qr_id` + `payment_status='AWAITING_PAYMENT'`.

**Screenshot:** `downloadMediaWithRetry:46` (3×1s) → `saveInboundMedia:80` → `data/inbound_media/<safeId>.jpg` + `<appDataDir>/uploads/<safeId>.jpg` → `ocrScanQueue broadcast('ocr_scan_complete')` → V2 gate + `resolveRelatedMedicinesLocal()` → same `imagePath` attached to owner escalation, served `GET /api/messaging/wa-media/:msgId` (module-cached, one fetch ever).

---

## 3. ALL ISSUES / GAPS (fix one by one — do not skip)

### ISSUE-01 — New queryKey without SSE mapping goes stale silently (P1)
- **Where:** `frontend/src/hooks/useGlobalSseInvalidation.ts:17-40 SSE_QUERY_MAP`, any new `useApiQuery(['my-key'])`, `KeepAliveOutlet.tsx:24 HIGH_PRIORITY_PATHS`, `PageQueryTracker.tsx:64-86`.
- **Symptom:** hidden KeepAlive page (`/pos /inventory /crm /pharmarack-cart`) never refreshes after backend write.
- **Root cause:** SSE invalidations are mark-stale-only (`refetchType:'none':145`); visible page's tracker refetches owned keys on activation. Unmapped key = never marked = stale forever. Guardrails F1/F2 only catch *eager* refetch, not *missing* mapping.
- **Fix (Phase 1):** rule `F11_missing-sse-mapping` — every `queryKey ['x']` must appear in `SSE_QUERY_MAP` values or carry `// sse-exempt: <rationale>` comment. Fail message tells exact fix.

### ISSUE-02 — Backend broadcast ↔ frontend listener name drift (P1)
- **Where:** `src/services/eventService.ts:15` ↔ `frontend/src/services/events.ts:81-127` ↔ `WaRequestsPanel.tsx:542` (`sse-wa-medicine-match`, `app-special-orders-updated`, `refresh-special-orders`, `sse-wa-session-updated`).
- **Symptom:** one typo in event string → silent drop, feed looks dead, no error.
- **Root cause:** string-literal coupling with no static check. Guard F3 only blocks second `EventSource`.
- **Fix (Phase 1):** rule `F12_custom-event-coupling` — cross-parse all `broadcast('X')` in `src/` vs `addEventListener('sse-*'|'app-*')` in `frontend/src`; orphan broadcast OR orphan listener → FAIL (allow `toast_alert|connected`).

### ISSUE-03 — Bot stalls on `scheduled` / credential expiry (P1)
- **Where:** `src/services/tokenRefreshScheduler.ts:364` (`pharmarack_session_refreshed` probe 401/403), `src/services/whatsappQueueWorker.ts` (`skipped_not_on_whatsapp` / `review_required` / `invalid_phone`), `src/whatsappClient.ts` idle-sleep (`whatsapp_idle_sleep_min` default 15 → `wa_status_changed sleeping`).
- **Symptom:** orders hang in queue; Pharmarack token dies overnight; WA sleeps and never visibly wakes.
- **Root cause:** lazy workers (by design) but no synthetic probe proving round-trip; no UI badge distinguishing `sleeping` (healthy) vs `disconnected` (broken). `GET /messaging/qr` correctly does NOT auto-restore sleeping client — but nothing tells the pharmacist.
- **Fix (Phase 3):** `src/services/connectivityProbe.ts` one-shot synthetic `wa_medicine_match {__probe__:true}` after first SSE `connected`, dropped by UI (no DB write), else `toast_alert error`. Dev-only `Topbar` badge `SSE ✓ | WA feed ✓ | QuickAssist ✓` from last-event timestamps (event-driven, no timer).

### ISSUE-04 — QuickAssist never refreshes if `order_updated` removed (P1)
- **Where:** `src/routes/quickAssistant.ts:1-97` (aggregator, **zero** `broadcast`), `src/routes/orders.ts:26` (`broadcast('order_updated')`), `frontend/src/components/Layout.tsx:2555 QuickAssistSidebar` (outside KeepAliveOutlet, no PageQueryTracker), `CHROME_INSTANT_KEYS:88` (`orders/refills/settings` only).
- **Symptom:** `ready_to_notify / overlaps_pending / today_orders` stale until manual refresh.
- **Fix (Phase 1):** rule `B4_quick-assist-connectivity` — `special_orders` write without `broadcast('order_updated')` → FAIL; QuickAssist queryKey not in `CHROME_INSTANT_KEYS` → FAIL.

### ISSUE-05 — WA Requests one-search rule regressed by retry (P1)
- **Where:** `WaRequestsPanel.tsx:552 handleLookup` must fire **exactly ONE** `api.searchPharmarack(q)` per explicit click, no auto-retry.
- **Symptom:** retry storm → upstream 401 NEED_LOGIN + rate-limit + duplicate cards.
- **Fix (Phase 1):** rule `F13_one-search` — count of `searchPharmarack(` call sites in `WaRequestsPanel.tsx` must be exactly 1.

### ISSUE-06 — Stale feed illusion via module cache (P2)
- **Where:** `WaRequestsPanel.tsx:61 feedCache` + `:187 waMediaCache` survive navigation; `feedCache.sort()` on history load `:503`.
- **Symptom:** feed shows old cards as if live while SSE is down.
- **Fix (Phase 3):** probe + badge above; history merge keeps `existingKeys` set dedupe (`customerPhone-medicineName-ts`).

### ISSUE-07 — Payment screenshot orphan while `awaiting_payment` (P1)
- **Where:** `whatsappIntentService.ts:936-1040` (`awaiting_payment` branch: `isQrKeyword` regex, cancellation regex, supersede probe `SELECT name FROM medicines WHERE name LIKE ?`, fallback wait message), `wa_pending_clarifications` TTLs (`awaiting_owner_selection` 72h, else 45m).
- **Symptom:** customer sends screenshot but step never advances to `awaiting_owner_payment_confirmation`; or types new medicine name and gets stuck in wait loop instead of new inquiry.
- **Fix (Phase 5):** keep `isQrKeyword` re-allocate + `created_at=CURRENT_TIMESTAMP` refresh + `payment_reminder_sent=0` reset; keep supersede probe → `step='superseded'` → fall through to `handleInbound`; keep cancellation → `step='cancelled'` + `special_orders status='Cancelled'`. Add `tests/chatbotConnectivity.test.ts` probe for this branch.

### ISSUE-08 — Owner 1-click reply path diverges from UI path (P2, already fixed P2-10 — lock it)
- **Where:** WA owner reply `SO-10452 2` (`whatsappIntentService.ts:1868 allocateNextQr + enqueue`) vs CRM UI `PUT /api/orders/:id` newly-assigned `pharmarack_distributor` → allocate QR + `payment_status='AWAITING_PAYMENT'` + enqueue (returns `payment_qr_sent`).
- **Symptom (if regressed):** UI-assign sends no QR.
- **Fix (Phase 5):** never remove either branch; both call `paymentQrService.allocateNextQr()`.

### ISSUE-09 — Delivery-boy fallback bypass (P2)
- **Where:** `src/utils/whatsappTemplateBuilder.ts resolveActiveDeliveryBoy` (reads `delivery_boys.whatsapp_number`, NOT `phone`), `scripts/performance-guardrails.mjs:221 F10` (same-line regex only).
- **Symptom:** template shows raw `919876543210` or `Not assigned yet` while active boys exist; or reads `app_settings.owner_whatsapp_number` as delivery boy.
- **Fix (Phase 1):** harden F10 to 20-line window for `delivery_boy` + `owner_whatsapp_number|shop_phone`. Resolution order stays: (1) assigned boy → (2) first `delivery_boys is_active=1` name + `+91 XXXXX XXXXX` → (3) `Admin / Store Owner` fallback.

### ISSUE-10 — Backend timer / autonomous-send bypass via rename (P2/P1)
- **Where:** `scripts/performance-guardrails.mjs:236 B1` (string-checks `activityTracker|isIdle|dataFetchControl`), `:272 B3` (matches `sendMessage|sendText|sendRawMessage` in `*cron*|*scheduler*|*worker*` except `whatsappQueueWorker.ts`), `src/utils/backgroundJobLane.ts runHeavyJob()`.
- **Symptom:** new `setTimeout` loop / `node-cron` string / `whatsappBusinessService.sendX` evades regex and either burns CPU or auto-texts patients.
- **Fix (Phase 1+4):** harden B3 to also match `whatsappBusinessService|telegramBot|waAdminEscalationService`; harden B2 to `cpSync|execSync.*cp`; route every new heavy job through `runHeavyJob(name,fn)` (FIFO + per-name single-flight). Token heartbeat + queue dispatch stay lane-exempt (latency), documented in ALLOW.

### ISSUE-11 — No end-to-end probe (P1)
- **Where:** 42 jest suites mock `whatsappClient` via `WWEBJS_AUTH_DIR` temp seam — green CI with broken wiring.
- **Symptom:** mocks hide `handleInbound → wa_medicine_match → WaRequestsPanel` breakage.
- **Fix (Phase 6):** `tests/chatbotConnectivity.test.ts` round-trip (no WA mock): synthetic `eventService.broadcast('wa_medicine_match') → recordIncomingMatch → feedCache length 1` + `order_updated → orders invalidation`. Negative: missing SSE mapping fails guardrail.

---

## 4. HOW WE SOLVE IT (design — what each phase builds)

**A. Never-fail scheduled creds (no new polling).**
- Pharmarack: keep `runSessionHeartbeat()` (`trigger_pharmarack_refresh_interval_min`, default 20) — ONE `GetUserCartDetails` probe per interval (P4-exempt, idle-immune). 401/403 → single-flight `executeRefresh()` mutex + dynamic lock cleanup + async `copyProfileFolder` (never sync) + session copy-back on exit. Boot warm-up `warmupStartupCart()` via `onFirstRefreshComplete()` + T+50s fallback → `startupSyncCoordinator` truthful toast.
- WhatsApp: idle-sleep evaluator destroys client after `whatsapp_idle_sleep_min` idle (never mid init/QR/sync) → `wa_status_changed sleeping`. Wakes demand-only: `sendMessage()/getChats()` auto-init, queue-worker silent `initClient()` 60s-cooldown, explicit Connect. `ensureSessionHealth` probes ≥15m inactivity. Queue worker LAZY (no constructor loop): 10s active / 30s offline / 15m idle.

**B. Schedule-locked owner forwarding.**
- Single scorer `src/utils/orderNameMatcher.ts ARRIVAL_MATCH_THRESHOLD=75` for all arrival matching; candidate scope = active statuses only (`CREATED/PENDING/IN_TRANSIT/OVERLAP_DETECTED/POTENTIAL_ARRIVAL/Pending/Ordered` + `Ready` at sale time). Fulfilled/Cancelled never match; strength-variant siblings rejected.
- Only `calculateOrderSchedule()` computes schedule. Every new order path must call it then `persistOrderSchedule()` then `broadcast('order_updated')`. Forwarding fires at `scheduled_processing_at`, never early. Cutoff/Sunday/holiday shifts via `advanceToNextOpenDay()`. Manual override = `overridden` + version bump + tracking event.
- `POST|PUT /api/orders/:id/status` AND generic `PUT /api/orders/:id` share `enqueueArrivalWhatsApp()` — idempotent on `notified===1`, missing phone skips, returns `whatsapp_queued` (toast reflects truthfully). `skipWhatsApp:true` honored (P2-11 Mark Ready in Store).

**C. Payment + screenshot end-to-end (anyone can share).**
- QR allocate → `payment_qr_id` + `AWAITING_PAYMENT` → enqueue PNG + UPI link to customer (WA reply path AND UI path, ISSUE-08).
- Screenshot from ANY number: `downloadMediaWithRetry` → `saveInboundMedia` → OCR gate → if `awaiting_payment`: QR-keyword → fresh QR; cancellation → cancel; `medicines.name LIKE ?` hit → supersede → new inquiry; else wait message with `Reply QR or new medicine name`. Image always persisted before OCR so nothing is lost.
- Owner gets imagePath-attached escalation (`wa.me` link, `REQ-XXX`/`RX-XXX` in `wa_owner_pending_requests`, 24h dedupe in `wa_admin_escalations`) and confirms with 1-click reply (`REQ-123-1`, `CONFIRM RX-1234`) → `addItemsToPharmarackCart()` hard-gated `success===true` → `special_orders Confirmed` → `broadcast('order_updated')` + `broadcast('pharmarack_cart_changed')` → QuickAssist + LiveCart refresh.

**D. Patient-send inviolable rule.** Workers stage only (`automation_notifications staged needs_confirmation=1`). Patient WA requires explicit UI click (`📱 Send Arrival WA / Resend`, `📱 Remind Now`, POS toggle, QR confirm). `whatsappQueueWorker.forceNext()` only after user-clicked enqueue (instant dispatch); background/bulk keep pacing.

---

## 5. PONYTAIL SMALL-CHANGE RULES (mandatory — any agent implementing this file)

1. **Does this need to exist? (YAGNI)** → skip it. No new tables, no new EventSource, no new poller unless this plan names it.
2. **Stdlib / platform / installed dep first** → reuse `orderNameMatcher`, `copyProfileFolder`, `runHeavyJob`, `resolveActiveDeliveryBoy`, `paymentQrService`, `waAdminEscalationService`. Mark intentional simplifications with `ponytail:` comment.
3. **One line → one line.** Each phase below is sized to ≤3 files. Never bundle phases.
4. **Modify ONLY necessary files.** File change map in §8 is exhaustive — touching any other file requires writing the rationale into the PR + extending `ALLOW` with `AGENTS.md` section reference.
5. **Small diff, verify, commit, next.** Implement ONE issue → `npm run guardrails` → `npx tsc --noEmit` → `node scripts/quick-update.mjs` → commit → next issue. Never batch ISSUE-01..11 in one diff.
6. **Keep hot paths intact:** single global `EventSource`, `refetchType:'none'` mark-stale-only, async profile copies, `KeepAliveOutlet HIGH_PRIORITY_PATHS`, `prewarmRoute()`, `PageQueryTracker` deferred pattern, `WARMUP_PATHS` in `App.tsx`.

---

## 6. AGENT CROSS-CHECK RULES (100% — every new modification)

Any agent developing or implementing from this file MUST pass ALL gates before the task is done:

1. **Changed-lines scan:** `git diff HEAD --stat` → `npm run guardrails` (default changed-lines mode, <2s). Exit `1` = violations MUST be fixed — no exceptions. Extends with `F11 / F12 / B4 / F13` (§3) once Phase 1 lands; until then manually verify mapping per ISSUE-01/02/04/05 checklist.
2. **Full audit on subsystem refactors:** `npm run guardrails -- --all` (advisory for whole-subsystem PRs).
3. **Scanner self-proof:** `npm run guardrails -- --self-test` after editing the scanner itself.
4. **Connectivity audit:** `node scripts/connectivity-audit.mjs --ci` (Phase 2+) — `broadcasts / listeners / orphan: 0 / uncovered queryKeys: []`. CI fails PR if orphans > 0.
5. **Types:** `npx tsc --noEmit` (scanner auto-runs when TS changed) — catches `delivery_boys.phone` vs `whatsapp_number` drift etc.
6. **Graph sync:** `node scripts/quick-update.mjs` after ANY add/edit/delete/rename (<30s). Updates `.understand-anything/knowledge-graph.json` + `PROJECT_AUDIT.md` + `meta.json`.
7. **Tests:** `npx jest tests/chatbotConnectivity.test.ts` (Phase 6+) + related suites in isolation; compare against stashed baseline before attributing failures (native-module contention note in `src/AGENTS.md`).
8. **Pre-push hook:** git `pre-push` enforces guardrails automatically before any push.
9. **PR checklist (paste into every PR from this plan):**
   `- [ ] guardrails PASS (changed) - [ ] audit 0 orphans - [ ] tsc --noEmit PASS - [ ] graph updated - [ ] connectivity test PASS - [ ] only §8 files touched`

---

## 7. PHASES — STEP-BY-STEP (one by one, in order)

- [ ] **Phase 0 — Baseline (no code).** Run `node scripts/quick-update.mjs`; run `npm run guardrails -- --all` (must PASS); list `SSE_QUERY_MAP` vs all `useApiQuery` keys drift (paste into PR as baseline).
- [ ] **Phase 1 — Connectivity Guard (scanner).** Extend `scripts/performance-guardrails.mjs` `ALLOW:44` + `RULES:109`: add `F11_missing-sse-mapping`, `F12_custom-event-coupling`, `B4_quick-assist-connectivity`, `F13_one-search`; harden `F10` (20-line window), `B3` (+`whatsappBusinessService|telegramBot|waAdminEscalationService`), `B2` (+`cpSync|execSync.*cp`). Add `--self-test:390` bad/clean samples for each. Verify: delete one `SSE_QUERY_MAP` entry → guardrail FAILs `[F11]` with file:line fix.
- [ ] **Phase 2 — Build-time graph audit.** New `scripts/connectivity-audit.mjs` (reuses `walkAll:321` + `knowledge-graph.json`): writes `docs/CHATBOT_CONNECTIVITY_REPORT.md` (+ JSON). Chain in `package.json` after scanner. Verify: `--ci` exits 0, report shows 0 orphans.
- [ ] **Phase 3 — Runtime probe (no polling).** New `src/services/connectivityProbe.ts` (gated via `dataFetchControl`); hook boot after `tokenRefreshScheduler.start()`; `WaRequestsPanel.tsx:488 useEffect` drops `__probe__` (no DB write). Dev-only `Topbar` badge from last-event timestamps. Verify: block SSE → error toast within 8s; normal boot → silent.
- [ ] **Phase 4 — Schedule fidelity + lane.** Ensure every schedule write calls `calculateOrderSchedule()` → `persistOrderSchedule()` → `broadcast('order_updated')`; move ad-hoc IST math to `getTimezoneParts/combineYmdAndTime`; route new daily crons via `runHeavyJob()`. Verify: order at 22:59 cutoff 23:00 → same-day; at 23:01 → `post_cutoff` next open day 08:00 + evening window; Sunday/holiday shifts correct.
- [ ] **Phase 5 — Payment screenshot pipeline.** Lock QR dual-path (WA reply + UI `PUT /:id`); lock `awaiting_payment` branch (QR regex / cancel / supersede / wait message); keep amount `50` fixed; keep image persisted before OCR. Verify: send `Dolo 650 1 strip` → card <1s, NETWORK = 1 search; reply screenshot → owner gets image + `wa.me` link <3s.
- [ ] **Phase 6 — Owner forwarding + test.** Lock `notifyOwnerOfSpecialOrderPharmarackResults()` + `maybeEscalate()` (`REQ-XXX/RX-XXX`, 24h dedupe, `resolveAdminWhatsappNumber` priority, `escalateGuard` toggle + self-send guard); owner reply → cart hard-gate → `Confirmed` → both broadcasts. New `tests/chatbotConnectivity.test.ts` round-trip + negative. Verify per §9.
- [ ] **Phase 7 — Docs/DOX close-out.** Update `AGENTS.md` (§SPA Performance + §Page Ownership) + `frontend/AGENTS.md` (WaRequests one-search) pointers; move fixed entries in `SMALL_BUG_FIX_PLAN.md` Open → Fixed with root-cause + verification; final `node scripts/quick-update.mjs`.

---

## 8. FILE CHANGE MAP (only these — anything else needs written rationale)

| Area | Files | Action |
|---|---|---|
| Scanner | `scripts/performance-guardrails.mjs:44-280,390` | Add F11/F12/B4/F13 + hardened F10/B3/B2 + self-test |
| Audit | `scripts/connectivity-audit.mjs` (new), `package.json` scripts | `--ci` audit + chain after guardrails |
| Probe | `src/services/connectivityProbe.ts` (new), `src/server.ts` boot, `frontend/src/pages/AIEngineering/WaRequestsPanel.tsx:488` | Synthetic probe + drop |
| Schedule | `src/routes/orders.ts:26`, `src/routes/special_orders.ts`, `src/services/orderScheduleService.ts:228`, `src/utils/backgroundJobLane.ts` | Lane + persist + broadcast |
| Payment | `src/services/paymentQrService.ts:115`, `src/routes/orders.ts` `PUT /:id`, `src/services/whatsappIntentService.ts:936-1900`, `src/services/waAdminEscalationService.ts:880` | QR + screenshot gate |
| Frontend badge | `frontend/src/components/Layout.tsx` Topbar | Dev-only event-driven badge |
| Docs | `AGENTS.md`, `frontend/AGENTS.md`, `docs/CHATBOT_CONNECTIVITY_REPORT.md` (generated) | Contract pointers + report |
| Tests | `tests/chatbotConnectivity.test.ts` (new) | Round-trip + negative |
| Graph | `.understand-anything/knowledge-graph.json, meta.json, PROJECT_AUDIT.md` via `node scripts/quick-update.mjs` | Post-change <30s sync |

---

## 9. VERIFICATION (per phase — must all pass)

1. `npm run guardrails -- --self-test` PASS (new rules fire on bad, silent on clean).
2. `npm run guardrails -- --all` PASS; then redact one mapping → FAIL `[F11]` with actionable file:line.
3. `node scripts/connectivity-audit.mjs --ci` PASS (0 orphans).
4. `npx jest tests/chatbotConnectivity.test.ts` PASS; removing `broadcast('wa_medicine_match')` makes it FAIL.
5. Manual: WA text `Dolo 650 1 strip` → `data/inbound_media/*.jpg` saved → WaRequests card <1s (mapped + truthful stock badge + balanced hits `MIN_MAPPED=5 MIN_NON_MAPPED=2`), NETWORK = 1 search; `₹50` QR PNG + UPI link sent; customer screenshot → owner WA image-attached escalation <3s; owner `REQ-XXX 1` → `pharmarack_cart_changed` + `order_updated` → QuickAssist `ready_to_notify` increments without refresh.

---

## 10. WHAT WE ARE NOT CHANGING (owner locks — never regress)

- No second `EventSource` — add to `SSE_QUERY_MAP/SSE_CUSTOM_EVENTS` instead (F3).
- No `setInterval`/`refetchInterval` SPA polling (F4/F5) or ungated backend `setInterval` (B1) — SSE + `dataFetchControl` + `activityTracker.isIdle()` only.
- No autonomous patient WA from cron/worker (B3) — stage-only; explicit UI click + `forceNext()` only.
- No invented fallback data (F8: `BATCH123/B-GEN/+91 99999`) — missing boy → `Admin / Store Owner` fallback, never `Not assigned yet` when boys exist.
- Keep `KeepAliveOutlet HIGH_PRIORITY_PATHS` + `prewarmRoute()` + `PageQueryTracker` deferred pattern + `App.tsx WARMUP_PATHS` intact; async `copyProfileFolder`; single-flight `executeRefresh()` mutex; demand-only WA wakes.

---

## 11. ACCEPTANCE

- **Bot:** inbound WA text+image → `wa_medicine_match` <1s, no `FAILED/scheduled` residue, idle-sleep wakes instantly, Pharmarack token survives reboot (`warmupStartupCart` → truthful sync toast).
- **Schedule:** `scheduled_processing_at` honored (forward at window, never early); cutoff/Sunday/holiday shifts correct; override = `overridden` + version bump + tracking event.
- **Payment:** fixed `₹50` QR PNG + UPI link; screenshot from any number → persisted image → owner image + `wa.me` link → 1-click confirm → `Confirmed` + live-cart hard-gate.
- **Cross-check:** any new `queryKey`/`broadcast` without mapping is blocked by `npm run guardrails` with exact file:line; audit 0 orphans; graph synced.

---

*After approval, implement Phase 0 → 7 in order. After each fix, move the entry in `SMALL_BUG_FIX_PLAN.md` Open → Fixed per `BUG_FIX_RULE_GUIDE.md`. This file itself is PLAN ONLY.*

