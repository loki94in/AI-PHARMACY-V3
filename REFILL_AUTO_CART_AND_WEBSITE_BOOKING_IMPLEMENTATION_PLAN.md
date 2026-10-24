# Implementation Plan: Refill Auto Cart-Add + Website Payment & Credit Booking

> Created 2026-10-24. Status: PLANNED (not yet implemented). This document is the binding
> blueprint for the owner-approved behavior change discussed with the agent on 2026-10-24.
> Decisions recorded here were explicitly confirmed by the owner in chat (see §3 Decisions).

---

## 1. Goal & Context

Today, adding medicines to the **live Pharmarack cart** is a staff-clicked action for refills,
and payment-confirmed special orders only auto-add through paths that break when the shop PC is
off (the UPI payment screen is served by the desktop tunnel API, which is unreachable while the
PC is down). The owner wants:

1. **Refill orders from online sources (website + WhatsApp)** to be added directly into the live
   cart automatically — no staff click. While the PC is OFF, orders queue in Vercel KV; when the
   PC comes on, the catch-up worker adds them without any click.
2. **Special orders** require **patient payment confirmation first**; after the pharmacist
   verifies, the app adds the medicines to the cart automatically.
3. The **website** becomes a direct booking surface for **refill + special + credit orders**.

Physical constraint (re-verified): the Pharmarack cart is driven exclusively by the shop PC's
captured retailer session (`src/services/tokenRefreshScheduler.ts` heartbeat). **Nothing can
write to the live cart while the PC is OFF** — the PC-off story is therefore "queue in Vercel KV,
auto-add on boot/sync when PC returns", never "add from the cloud".

---

## 2. Current Behavior Map (researched 2026-10-24, re-locate line numbers at edit time)

### Refills
- CRM refills / Quick Assist: adding to live cart is **100% staff-clicked** via
  `frontend/src/services/refillCartJobs.ts` → backend `processRefillCartItem`
  (`src/services/refillCartService.ts`); statuses added / in_cart / ready / needs_link /
  linked_oos / not_found / failed. `src/AGENTS.md` currently **forbids** any worker/cron from
  calling `processRefillCartItem`.
- Website refills: `cloudCatalogSyncService.pullCloudOrdersToLocal` (T+8s then 60s poll,
  idle-gated) imports Vercel KV `REFILL` orders as `website_refill` rows in `special_orders`
  and bumps `patient_refills.next_refill_date` — **no cart add, no payment step**.
- While PC off: request waits in KV (`orders:pending`); wa.me handoff is the only notification.

### Special orders
- Backend auto-add already exists post-confirmation:
  - Owner WhatsApp `CONFIRM SO-x` → `whatsappIntentService` (~4688-4887) → payment VERIFIED →
    intends `addItemsToPharmarackCart`.
  - CRM "mark advance paid" → `POST /orders/:id/mark-advance-paid` (`src/routes/orders.ts`
    ~1206-1300) → auto cart add.
  - WebsiteOrders "Confirm Payment" → `PATCH /orders/:id/payment` (websiteOrders.ts ~580-845)
    → auto cart add; on failure sets `needs_live_cart_sync=1` +
    `delivery_status='offline_queued'`; `startupSyncCoordinator` catch-up re-adds at boot.
- **Gaps**: cart writes can pre-date payment via `confirm-distributor` distributor-change branch
  (`orders.ts` ~1049-1090); the UPI "I HAVE PAID" page lives in the tunnel API (needs PC on);
  Vercel-only deployment has no payment step at all.

### Cart engine & truthfulness gaps (Phase A targets)
1. `src/routes/pharmarack.ts` `addItemsToPharmarackCart` no-token branch (~1718-1743) returns a
   **fake success** `{ success: true, offline: true }`. Refill path treats `offline:true` as
   failure, but `QuickOrderModal.processSubmissionQueue` (~846-906) and CRM
   `SpecialOrdersSection` "Add All"/per-row adds show a false *"Added to actual Pharmarack
   cart!"* toast.
2. `GET /settings` (`src/routes/settings.ts` ~66-68) injects
   `auto_add_to_live_cart='true'` when absent, while the service default is OFF
   (`storeSettingsService.ts` ~512-525) — the Settings page lies about the state.
3. `startupSyncCoordinator` (~165-173) **auto-sends** a customer WhatsApp
   (`live_cart_sync_notification`) after offline catch-up — violates the Strict Manual-Only
   Patient Messaging Contract.
4. `website/public/catalog.html` `initiateRefill` (~1391-1458) is dead on Vercel
   (`window._pharmacyApiBase` is never assigned).

---

## 3. Owner Decisions (confirmed 2026-10-24 in chat)

| # | Decision | Owner's choice |
|---|----------|----------------|
| D1 | Refill auto-add scope | **Online-sourced only** — refill rows with origin `website`/`whatsapp` auto-add; staff-made CRM refills remain staff-clicked. |
| D2 | Online payment while PC off | **Patient self-confirms on the website** (UPI QR served from Vercel, no PC needed) → pharmacist verifies in the app → then auto cart-add. |
| D3 | Credit booking eligibility | **All registered (OTP-verified) patients** can book orders on credit from the website. |
| D4 | Patient WhatsApp after auto-add | **No auto-sends.** All confirmations are staged for an explicit user click (search the staged queue; nothing autonomous). |

---

## 4. Architecture & Key Principles

- **Single writer per fact** (`AGENT_DATA_FLOW_TREE.md`): `patient_refills` stays the refill
  truth; `special_orders` stays the special-order truth; `startupSyncCoordinator` becomes the
  one sanctioned auto cart-add worker (no parallel pass, no parallel table).
- **Strict Legitimate Data**: no fake success, no invented QR, no estimated prices, no
  auto-created inventory. Missing/failed cart lines stay visible as truthful statuses.
- **Manual-Only Patient Messaging (D4)**: every new message goes to the staged
  `automation_notifications` queue; boot catch-up notification (§2 gap 3) is converted to
  staged as part of Phase A.
- **Events, not timers**: the refill catch-up hooks the existing boot chain
  (`tokenRefreshScheduler.onFirstRefreshComplete()` → `startupSyncCoordinator.markCartLoaded`)
  and the cloud-order-pull-completed event. **No new `setInterval`** (guardrail rule).
- **P2-105 coordination**: cart-add runs are serial and batch-bounded (RAM/CPU diet on the
  4-core / 12 GB, no-GPU PC) and are sequenced AFTER the Pharmarack session restore so we never
  fight `heavyRestoreLane` for a live login. Cart adds are REST token calls, not browser runs.
- **Settings-gated rollout**: every new behavior is switchable (`refill_auto_cart_add`,
  website payment push toggle, credit booking toggle) so a rollback is a settings flip.

---

## 5. Implementation Phases

### Phase A — Honesty fixes (must land first, no behavior change)
1. `src/routes/pharmarack.ts` — no-token branch returns
   `{ success: false, offline: true, reason: 'NO_TOKEN' }`; callers that render toasts check
   `offline`/`reason` and show "Pharmarack session offline — item NOT added".
2. `frontend/src/components/QuickOrderModal.tsx` + `frontend/src/pages/SpecialOrdersSection` —
   truthful toast handling (align with the existing refill-path rule).
3. `src/routes/settings.ts` — stop injecting `auto_add_to_live_cart`; UI reflects the real
   `storeSettingsService` value.
4. `src/routes/orders.ts` — `confirm-distributor` cart re-add gated to payment-confirmed /
   advance-paid orders; otherwise stage `needs_live_cart_sync=1` (added post-payment).
5. `startupSyncCoordinator` — `live_cart_sync_notification` becomes staged, never auto-sent.
6. Delete dead `initiateRefill` block in `website/public/catalog.html`.

### Phase B — Refill auto-add (online-sourced only)
1. Settings key `refill_auto_cart_add` = `auto | manual | off` (default **auto**), service +
   Settings UI toggle next to "Auto Add to Live Cart".
2. `startupSyncCoordinator` extension — refill catch-up pass, single-flight, serial:
   - Eligibility: `patient_refills` rows with source/origin `website`/`whatsapp`, status
     pending, `cart_status` not already added/ready/in_cart (idempotent; `sync_id` dedupe).
   - Processing **reuses** `processRefillCartItem` exactly (strict name matching, distributor
     link chain, qty accumulation) — no new matcher, no fallback MRP/distributor.
   - Failures surface as truthful panel statuses (`needs_link`, `not_found`, `failed`) + owner
     toast — never silent, never faked.
   - Bounded batch per pass (continues on next boot/pull) per the memory diet.
3. Trigger points: after first refresh completes (boot chain) and after each successful
   `pullCloudOrdersToLocal` import event — no timers.
4. SSE: map the refills query keys into `SSE_QUERY_MAP` (mark-stale + page-tracker refetch).
5. Docs amendment: `src/AGENTS.md` worker-prohibition note scoped to exactly this sanctioned
   pathway; `AGENT_DATA_FLOW_TREE.md` cart-writes rule gains the same exception.

### Phase C — Website payment self-confirm (Vercel)
1. Desktop pushes the **real allocated UPI QR** (`paymentQrService` output) + payee details into
   the order's KV record at order-create-push and at confirm-distributor. QRs are never
   generated cloud-side; missing QR renders "payment details pending — pharmacist will send".
2. `website/api/catalog.js` — protected `payment_declared` endpoint: patient taps "I have paid"
   → KV order records `{ at, method }`; portal status truthfully `AWAITING VERIFICATION`;
   wa.me fallback unchanged.
3. Desktop import maps payment-declared orders to `payment_status='PENDING_VERIFICATION'`
   (not auto-added). Pharmacist "Verify & Confirm" (`PATCH /orders/:orderId/payment`, unchanged)
   → auto cart-add already implemented; PC-off failure catch-up already implemented.
4. Post-verify statuses pushed back to KV so the patient portal shows Confirmed / In Live Cart.

### Phase D — Credit booking (Vercel)
1. OTP-verified registered patients see "Pay Later (Credit)" at booking; VAT noted on the order.
2. Import writes `payment_medium='CREDIT'`, `payment_status='UNPAID'` into the same
   WebsiteOrders verification workspace — no parallel page/table.
3. On approval, loan finalize builds the real invoice on the CREDIT medium honoring CRM rules;
   it appears in the CRM credit ledger automatically (no invented due dates, no fabricated
   balances).

### Phase E — Verification, contracts, bookkeeping
1. Tests: extend `tests/refillCartJobs.test.ts`, `tests/refillCart.test.ts`,
   `tests/websiteOrderIntegration.test.ts`; add refill catch-up eligibility/idempotency test;
   register in `jest.config.js`.
2. `npx tsc --noEmit`, `npm run build:client`, `npm run guardrails`,
   `node scripts/quick-update.mjs` after every file change.
3. Docs: root `AGENTS.md` (cross-reference once implemented), `src/AGENTS.md`,
   `AGENT_DATA_FLOW_TREE.md`, `website/README.md`; `SMALL_BUG_FIX_PLAN.md` Section 4 entries
   (P2-061 false-success toasts, settings mismatch) marked fixed.
4. Any schema touch must follow `BACKEND SCHEMA SAFETY.md` (both DDL block AND `ensureSchema`
   fast-boot path) and end with its Section 24 report — the preference is zero schema change
   (reuse existing `source`/`cart_status` columns).

---

## 6. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Cart add while Pharmarack session mid-restore | Sequenced after `onFirstRefreshComplete`; `heavyRestoreLane` untouched. |
| Duplicate adds on re-pull | Idempotent on `cart_status` + `sync_id`; existing UPSERT dedupe retained (429 8186 pipeline). |
| Silent OOS / unmatched medicines | Truthful statuses + panel chips; owners decide; no fallback product data. |
| Fraudulent "I have paid" self-declaration | Patient declaration ≠ verification; pharmacist verify click remains the cart-add trigger. |
| Uncontrolled patient messaging | D4: staged queue only; existing auto-send converted to staged in Phase A. |

---

## 7. Task Progress Log
- [ ] Phase A.1-A.2 — Truthful offline cart-add failure + frontend toasts
- [ ] Phase A.3 — Settings truthfulness (`auto_add_to_live_cart`)
- [ ] Phase A.4 — Gate pre-payment cart writes (`confirm-distributor`)
- [ ] Phase A.5 — Stage boot catch-up patient notification
- [ ] Phase A.6 — Remove dead Vercel refill code
- [ ] Phase B — Refill auto-add (online-sourced) via sanctioned catch-up pass
- [ ] Phase C — Website UPI self-confirm + desktop import/verify → auto cart-add
- [ ] Phase D — Website credit booking → real CREDIT invoices
- [ ] Phase E — Tests, guardrails, DOX updates, knowledge graph
