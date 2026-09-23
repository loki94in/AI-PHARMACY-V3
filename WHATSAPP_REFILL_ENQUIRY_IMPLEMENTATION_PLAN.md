# WhatsApp Refill + Medicine Enquiry + New/Repeat Order — Detailed Implementation Plan

> **Status:** PLAN ONLY — no code touched. Approved scope: all four flows, both channels (manual + WhatsApp auto-intake), repeat from history + WhatsApp "same", enquiry converts to Order/Refill.
> **Owner contracts preserved:** `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` (single source of truth), `AGENTS.md` (manual-only patient messaging, legitimate data, SPA/perf, SSE single connection), `BACKEND SCHEMA SAFETY.md` (atomic DB unit), `.agents/rules/*`.

---

## 1. Goal (what user asked, in short)

1. **Refill patient workflow** — old + refill patients can re-adjust their date/qty over WhatsApp via bot multi-questions, without breaking current refill flow.
2. **Medicine enquiry** — any user sends medicine name; bot asks type; app searches Pharmarack accurately.
3. **New order + Repeat enquiry** — enquiry converts to `special_orders` (new) or `patient_refills` (refill); repeat via CRM history button + WhatsApp "same/wahi".
4. **Dosage tabs** — `TAB` (solid: tablet/cap/soft-gel) and `BOTTLE/LIQ` (liquid: syp/suspension/kadha/tonic/elixir/drops) so search is scoped and user picks without typing long names.
5. **MRP-only confirm** — browse + confirm cards show `MRP ₹` only (no rate/stock/distributor); same MRP is written to order; user cross-checks strip MRP + Google MRP link before booking.
6. **Payment + Live Cart** — user shares screenshot → forwarded to owner → owner `CONFIRM SO-xxxx` → medicine added to Pharmarack live cart (manually removable/editable) → app confirmation sent to user.
7. **1/2-only replies** — no `yes/no` words. `1 = YES/confirm/TAB`, `2 = NO/cancel/BOTTLE` (context decides). Variant pick uses `1..N`.

---

## 2. Final per-message flow (exact bot instructions)

Applies to **any sender** (new/old/refill — bot detects via `lookupCustomer` + `getCustomerHistory` by `patient_phone LIKE %last10`).

### 2.1 New / unknown medicine path (7 messages)

| # | Direction | Exact instruction / content |
|---|-----------|------------------------------|
| 1 | Bot → User | `Welcome to <Store>. Send medicine name (e.g. GLYCOMET)` |
| 1 | User → Bot | `glycomet` (free text, no list) |
| 2 | Bot → User | `Found "GLYCOMET" — Reply: 1 TAB  2 BOTTLE` |
| 2 | User → Bot | `1` (TAB) or `2` (BOTTLE). No words accepted. |
| 3 | Bot → User | Pharmarack-scoped variant list (only matches, each with MRP): `Found GLYCOMET (TAB) — reply number: 1 Glycomet 500 — MRP ₹29.28 / 2 Glycomet 500 SR — MRP ₹38.10 / 3 Glycomet GP 0.5 — MRP ₹52.00 / 4 Glycomet GP 1 — MRP ₹61.00` |
| 3 | User → Bot | `2` (numeric pick only) |
| 4 | Bot → User | Cross-confirm: `Confirm: *Glycomet 500 SR* — MRP ₹38.10 / Check strip MRP = ₹38.10? Verify: https://www.google.com/search?q=Glycomet+500+SR+MRP / Reply 1 to book, 2 to cancel` |
| 4 | User → Bot | `1` → book (`1=YES`); `2` → cancel (`2=NO`) |
| 5 | Bot → User | Booking + payment: `Booking: *Glycomet 500 SR* — MRP ₹38.10  SO-TMSA-10453 / Pay ₹50 advance & reply with payment screenshot / UPI: <qr card> Payee: <name>` |
| 5 | User → Bot | Sends **screenshot image** (no text needed) |
| 6 | Bot internal | Saves `uploads/payment_proof_SO-xxxx.jpg`, `UPDATE special_orders payment_status='SCREENSHOT_RECEIVED'`, `UPDATE wa_pending_clarifications step='awaiting_owner_payment_confirmation'`, forwards screenshot to owner: `Payment Screenshot Received — Reply CONFIRM SO-TMSA-10453`, customer gets `screenshot received, verifying…` |
| 6 | Owner → Bot | `CONFIRM SO-TMSA-10453` |
| 7 | Bot → User | App confirmation: `Payment verified — *Glycomet 500 SR* added to Live Cart (SO-TMSA-10453) at <Store> — MRP ₹38.10` + medicine in Pharmarack live cart (removable/editable in `/pharmarack-cart`) |

Invalid input (e.g. `3` on 1/2 prompt, wrong word) → bot **repeats the exact instruction line** for that step. No fallback to word matching.

### 2.2 Refill patient shortcut (same 1/2 rule)

If `isRefillConfirmationResponse` fast path (`REFILL`) fires OR bot sees `patient_refills WHERE is_active=1 AND patient_phone LIKE %last10`:

- Msg 2 instead: `Your refill: DOLO 650 TAB due 12 Oct (30d), Telma 40 TAB / Reply 1 to confirm all, 2 to change date/qty`
- `1` → existing `UPDATE patient_refills patient_confirmed=1, confirmed_at=datetime('now')` + `broadcast refill_updated` + `refillOrderReconciler.upsertForPhone(source='whatsapp_refill_confirm')` + hours-aware ack (`whatsappIntentService.ts:2494` path, untouched).
- `2` → `awaiting_refill_date`: `Send new date (DD/MM/YYYY) or TOMORROW / NEXT WEEK / 15 DAYS` → validate → `advanceToNextOpenDay(db)` → `UPDATE patient_refills SET next_refill_date=?` + `checkAllRefills(db)` → `Reply 1 to save, 2 to cancel`. Qty adjust (`awaiting_refill_qty`) and add-med (`awaiting_refill_add_med`, same `POST /refills` logic) follow same 1/2 pattern.

### 2.3 Repeat path

- CRM invoices sub-view (`frontend/src/pages/CRM/index.tsx:1680`): per-row `Repeat` button → creates `repeat_order` enquiry with `repeat_source_invoice_id` pre-filled → opens Enquiries tab.
- WhatsApp `isRepeatRequest` (`same/wahi/wohi/repeat/fir se`) → last invoice lookup via `crm.ts:274` pattern → same repeat enquiry → same 1/2 confirm.

---

## 3. Current state (verified, read-only)

- **Refills:** `src/routes/refills.ts:126` `POST /` idempotent, `src/routes/refills.ts:278` `PUT /patient-medicines`, `src/routes/refills.ts:538` `GET /panel` two-pass grouped-by-phone + chunked (≤500) window over `inventory_master` (~4ms), `src/routes/refills.ts:1014` `POST /:id/fulfill` writes `refill_fulfillments` + advances cycle. Frontend `frontend/src/pages/CRM/index.tsx:192` TABS + `frontend/src/pages/CRM/index.tsx:239` `RefillsSection` (module cache `cachedRefillsData`, `handleSaveRefill:850`, `handleSellRefillPatient:636` → `/pos state.prefill`, `handleRemindNow:621` manual WA).
- **Special orders:** `src/routes/orders.ts:46` `GET /`, `src/routes/orders.ts:231` `POST /` + `src/routes/orders.ts:75` `POST /batch` (`orderScheduleService.calculateOrderSchedule`, `notified=0`), `src/routes/orders.ts:408` `enqueueArrivalWhatsApp` manual-only + 60m dedupe, `src/routes/orders.ts:521` `POST /:id/notify-arrival`, `src/routes/orders.ts:977` `PUT /:id` Ready→queue. Indexed `idx_special_orders_date`.
- **CRM patients/history:** `src/routes/crm.ts:25` `GET /patients` enriched (`purchase_count/last_sale_date/active_refill`), `src/routes/crm.ts:201` `GET /:id/history` + `src/routes/crm.ts:274` `GET /history-by-phone/:phone`.
- **WA intake:** `src/services/whatsappIntentService.ts:2494` refill ACK, `src/services/whatsappIntentService.ts:967` `checkMedicineClarificationResponse` FSM (`wa_pending_clarifications` steps `awaiting_customer_name → awaiting_medicine → awaiting_selection → awaiting_medicine_confirmation → awaiting_qty → awaiting_qty_confirmation`), `src/services/whatsappIntentService.ts:1641` `proceedWithConfirmedProcurement` (2-stage search word1 → 1s → 2-word core → 5s settle → 1 retry → `INSERT special_orders` + staged WA + owner options), `src/services/whatsappIntentService.ts:228` `filterCandidatesByFormulation`, `src/services/whatsappIntentService.ts:3277` `searchAndBroadcast` (per-candidate, `passesGate 0.60/0.72`, `classifyAvailability IN_STOCK/REGISTERED_NO_STOCK/EXTERNAL_ONLY via resolveInventoryStock`, NON_ALLOPATHIC skip, one-live-search-per-photo, `relatedMedicines` local-only). Repeat `src/services/intentKeywords.ts:444`, refill confirm `src/services/intentKeywords.ts:455`.
- **Pharmarack search:** `src/routes/pharmarack.ts:51` `fetchPharmarack` (Bearer + `devicetype:web`, 401/403 → `pharmarack_session_status=expired`), `src/services/intentKeywords.ts:566` `sanitizePharmarackQuery` (2–3 core words, strips TAB/CAP/SYP/STRIP/MG + pack size, keeps brand+strength), `src/services/pharmarackCatalogCache.ts:75` `scoreProductName` + `hasFormulationModifierConflict` + native `pharmarackRank<25%` + `score>=0.65`, 35-min `ensureCatalogSyncCron` (token-gated, `runHeavyJob` single-flight), `src/services/searchCache.ts:35` 5-min fresh / 7-day stale-while-revalidate (≤100, disk `data/search-cache.json`).
- **Catalog:** `src/database.ts:1408` `medicines.dosage_form TEXT` (+ `src/database.ts:1066` idempotent ALTER), `src/database.ts:3447` `distributor_catalog.dosage_form` + `src/database.ts:3458` `idx_dist_catalog_form`, `src/services/pharmarackCatalogCache.ts:355` already supports `AND dosage_form = ?`. Values mixed (`Tablet/Capsule/Soft Gel/Syrup/Suspension/Drops/Kadha/Tonic/Elixir/Injection/Cream…`). No grouping yet.
- **No `medicine_enquiries` table or `/api/enquiries` route exists** (glob `src/routes/*.ts` confirms). No persisted enquiry record — only transient `wa_medicine_match` SSE → `WaRequestsPanel` display-only + shortage tracking.

---

## 4. Architecture decisions (why this design)

1. **New `medicine_enquiries` table, not columns on `special_orders`.** `special_orders` owns fulfilment schedule (`scheduled_processing_at/cutoff_at/timezone`), distributor mapping, payment QR. Enquiries are pre-order questions with different lifecycle. Preserves page ownership (`AGENTS.md`): `/crm?tab=enquiries` primary, no new top-level page debt.
2. **Additive FSM only.** New WA steps are new `step` strings in same `wa_pending_clarifications` table (already idempotently altered in `ensureClarificationsTable:629`). Existing `handleInbound` order unchanged; new branches return `true` to stop fall-through. Fast `REFILL` ack stays first.
3. **1/2-only replies.** Replace `isAffirmative/isNegative` word regexes with strict `^1$` / `^2$` in the new path (old paths untouched except also accepting `1` as confirm). Removes `1..15 + MORE` list (type already disambiguates) except variant pick `1..N` in Msg 3.
4. **TAB vs BOTTLE groups (indexed).** `TAB=solid oral (tablet/cap/capsule/soft gel/dt/caplet)`, `BOTTLE=liquid oral (syrup/suspension/liquid/elixir/tonic/kadha/kwath/drops)`. `Inj/Cream/Gel` stay under `ALL` only. Uses existing `idx_dist_catalog_form` + new `idx_medicines_dosage_form` (Section 6).
5. **MRP-only truthfulness.** Browse/confirm show `medicines.mrp` / `distributor_catalog.mrp` only. Same value written to `special_orders.pharmarack_mrp`. No `rate/stock/distributor` on patient cards. No invented `mrp*0.7` (legitimate-data contract). Missing MRP → `MRP N/A`, never estimated.
6. **Reuse, don't fork:** enquiry `medicine_id` via `LOWER(name)=?` else `requires_resolution` (strict master-name contract — never auto-create `medicines`); conversion calls existing `POST /api/orders` / `POST /api/refills` logic inside transaction; availability via `medicineAvailabilityEngine`; schedule via `orderScheduleService.calculateOrderSchedule`; calendar via `advanceToNextOpenDay`.

---

## 5. Data model — `medicine_enquiries` (new)

```sql
CREATE TABLE IF NOT EXISTS medicine_enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER DEFAULT 1,
  customer_id INTEGER REFERENCES customers(id),
  patient_name TEXT,
  patient_phone TEXT,              -- digits-only (same rule orders.ts:98)
  medicine_id INTEGER REFERENCES medicines(id),
  medicine_name TEXT NOT NULL,
  dosage_group TEXT CHECK (dosage_group IN ('TAB','BOTTLE','ALL')) DEFAULT 'ALL',
  dosage_form TEXT,                -- raw form when known
  qty INTEGER DEFAULT 1,
  mrp REAL,                        -- snapshot shown to user, must equal order MRP
  enquiry_type TEXT CHECK (enquiry_type IN ('medicine_info','new_order','repeat_order')) DEFAULT 'medicine_info',
  source TEXT CHECK (source IN ('manual','whatsapp','phone','walkin','website')) DEFAULT 'manual',
  status TEXT CHECK (status IN ('open','answered','converted','closed','cancelled')) DEFAULT 'open',
  repeat_source_invoice_id INTEGER REFERENCES sales_invoices(id),
  converted_order_id INTEGER REFERENCES special_orders(id),
  converted_refill_ids TEXT,       -- JSON array of patient_refills ids
  notes TEXT,
  answered_at TEXT, converted_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_enquiries_status_date ON medicine_enquiries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enquiries_phone ON medicine_enquiries (patient_phone);
CREATE INDEX IF NOT EXISTS idx_enquiries_customer ON medicine_enquiries (customer_id);
CREATE INDEX IF NOT EXISTS idx_medicines_dosage_form ON medicines (dosage_form);
```

- **BACKEND SCHEMA SAFETY atomic unit:** DDL in `src/database.ts` full migration block **AND** fast-boot `ensureSchema` alterStatements + bump `CURRENT_SCHEMA_VERSION`. Indexes in both. Seeds: none. Missing phone → stays missing (request it, never invent).
- **DOX:** nearest `src/AGENTS.md` + root `AGENTS.md` re-read before edit (build phase).

---

## 6. Backend API — new `src/routes/enquiries.ts` (`/api/enquiries`)

| Method | Endpoint | Behaviour |
|--------|----------|-----------|
| POST | `/` | Create (manual + WA + repeat). Validates `patient_name\|phone\|medicine_name`, digit-cleans phone, resolves `medicine_id` (`LOWER(name)=?` else null + `requires_resolution`), snapshots `mrp` from `medicines.mrp`, dedupe: same `phone+LOWER(medicine_name)` open within 30 min → touch `updated_at`, return existing. Broadcast `enquiry_updated`. |
| GET | `/` | List (store-scoped, ≤1000, `ORDER BY created_at DESC`). |
| GET | `/panel` | Grouped-by-`patient_phone` (mirror `refills.ts:538`): base `medicine_enquiries × medicines × customers` (language joins), then **one** chunked (≤500) stock pass **only if needed** — patient cards show MRP-only so stock pass is optional/skipped for speed. Returns `{patient_name, patient_phone, language, enquiries: [{id, medicine_name, dosage_group, mrp, enquiry_type, status, ...}]}`. |
| GET | `/browse?group=TAB\|BOTTLE\|ALL&q=&page=&limit=50` | **Dosage browse without searching.** Indexed `WHERE LOWER(dosage_form) IN (group list)` + optional `name LIKE q%` prefix (fallback `%q%` only if <15 rows). Returns `{id,name,manufacturer,dosage_form,strength,pack_size,mrp}` **only**. No rate/stock/distributor. Budget 100–300ms. |
| PUT | `/:id` | Edit open enquiry (name/phone/qty/notes). |
| POST | `/:id/answer` | **Manual-only** WA reply: builds MRP + availability message via `medicineAvailabilityEngine` + `storeSettingsService`, `whatsappQueueWorker.enqueue` + `forceNext`, logs `automation_notifications(type='enquiry_answer')`. Respects `isWhatsAppExplicitlyDisabled`. Sets `status='answered'`. |
| POST | `/:id/convert-to-order` | Txn: insert `special_orders` via `orderScheduleService.calculateOrderSchedule` + `broadcast order_updated`, set `status='converted'`, `converted_order_id`, `converted_at`. Response carries `whatsapp_queued` truthfully. |
| POST | `/:id/convert-to-refill` | Txn: insert/update `patient_refills` (same `POST /refills:126` logic) + `checkAllRefills(db)` + `broadcast refill_updated`, set `converted_refill_ids`. |
| POST | `/:id/close` `/:id/cancel` | Terminal states. |

- **SSE:** `eventService.broadcast('enquiry_updated')` on every mutation; `order_updated`/`refill_updated` on conversions. Add `enquiry_*` keys to `SSE_QUERY_MAP` (`useGlobalSseInvalidation.ts`); chrome instant keys unchanged.
- **Pharmarack search extension:** `GET /api/pharmarack/search?query=&dosage_form=&dosage_group=` + `searchCatalog(query, dosageForm, dosageGroup)` — adds `AND LOWER(dosage_form) IN (...)` (uses `idx_dist_catalog_form`). `performPharmarackSearch` keeps single core; adds `searchCache.lookup(sanitized)` check before live call (repeat `dolo 650 + TAB` <1ms). Adaptive settle: replace fixed 5s with `500ms×6` early-exit when count stabilizes (keep 1 retry). One live call per WA message preserved.
- **Mount:** `src/server.ts` → `app.use('/api/enquiries', enquiriesRouter)`.

---

## 7. Frontend — `frontend/src/pages/CRM/index.tsx` + services

1. **New tab** `enquiries` in `TABS:192` (icon `MessageSquare`), `EnquiriesSection` sibling to `RefillsSection:239` reusing split-view + resizable panel + module-level cache + `withSilentRetry` + `PageActiveContext` gating + `PageQueryTracker`.
2. **Manual create** `+ New Enquiry` modal: reuses `SalutationNameInput`, `PhoneInputWithBadge`, medicine search with ≥2-char gating (same `fetchSuggestions:703` pattern), `enquiry_type` radio (`medicine_info/new_order/repeat_order`), `dosage_group` pills `TAB | BOTTLE | ALL`, qty. Browse mode default (paginated `GET /browse`, no typing needed); typing narrows within group.
3. **TAB | BOTTLE | ALL pills** also added above POS medicine picker (same `GET /browse` client). Selection confirms with MRP chip `₹ MRP`; same MRP flows into order.
4. **Answer flow:** per-card `Answer on WhatsApp` → `POST /:id/answer` (shows MRP + availability + Google verify link).
5. **Convert actions:** `Convert to Order` → `POST /:id/convert-to-order` (toast reflects `whatsapp_queued`, never fabricate), `Register Refill` → `POST /:id/convert-to-refill`.
6. **Repeat:** invoices sub-tab (`frontend/src/pages/CRM/index.tsx:1642`) per-row `Repeat` button → `POST /enquiries {enquiry_type:'repeat_order', repeat_source_invoice_id}` pre-filled from `inv.items` → opens Enquiries tab filtered to patient. No auto-order creation.
7. **Typed clients** `frontend/src/services/api.ts` (`enquiry` shapes, `browseMedicines`, query keys `enquiries`, `enquiry-panel`, `medicine-browse`); SSE map in `useGlobalSseInvalidation.ts`.
8. **UI rules:** semantic Tailwind only (`bg-bg/text-text/border-border`), no `bg-white/black/gray`, no `z-[9999]`, no `alert()/confirm()` (use `toastEvent`), autocomplete ≥2-char gate, no focus-open.

---

## 8. WhatsApp bot — additive FSM (`src/services/whatsappIntentService.ts`)

**Keep order:** `isIgnored → isDistributorOrInternal → isRefillConfirmationResponse:2494 (fast REFILL, untouched, also accept 1) → greeting → payment screenshot → checkMedicineClarificationResponse:2768 (existing) → NEW refill-adjust + name→type branches → parseMessage/isRepeatRequest/extractMedicineCandidates/searchAndBroadcast`. New branches return `true` to stop fall-through.

### 8.1 Detect old/refill patient (additive, after `lookupCustomer:2490`)

```ts
const history = await getCustomerHistory(customer).catch(()=>[]);
const activeRefills = await db.all(`SELECT ... FROM patient_refills WHERE patient_phone LIKE ? AND is_active=1 ...`, [`%${last10}`]);
const isRefillPatient = history.length>0 || activeRefills.length>0;
// stash in wa_pending_clarifications.options_json {isRefillPatient, refillIds, next_refill_date}
```

### 8.2 New steps (same table, new `step` strings — no migration)

| Step | Trigger | Bot message | User reply | Write |
|------|---------|-------------|------------|-------|
| `awaiting_refill_choice` | refill patient, non-REFILL text | `Your refill: ... Reply 1 to confirm all, 2 to change date/qty` | `1` → confirm path (§2.2); `2` → `awaiting_refill_date` | — |
| `awaiting_medicine_name` (reuse `awaiting_medicine`) | any new enquiry | `Send medicine name (e.g. GLYCOMET)` | free text `glycomet` → store `suggested_name=sanitizePharmarackQuery`, step=`awaiting_dosage_group` | `medicine_enquiries(source='whatsapp', enquiry_type by availability)` + dedupe 30m |
| `awaiting_dosage_group` (new) | after name | `Found "X" — Reply: 1 TAB  2 BOTTLE` | `1`/`2` only → `dosage_group=TAB/BOTTLE`, step=`awaiting_variant_pick` | update enquiry `dosage_group` |
| `awaiting_variant_pick` (new) | after group | Variant list `1 Name — MRP ₹.. / 2 ...` (Pharmarack filtered, MRP-only) | `1..N` only → store `medicine_id/mrp`, step=`awaiting_final_book` | update enquiry `medicine_id/mrp` |
| `awaiting_final_book` (new) | after variant | `Confirm: *Name* — MRP ₹.. / Verify: google... / Reply 1 to book, 2 to cancel` | `1` → `proceedWithConfirmedProcurement` → `INSERT special_orders` + `enquiry.status='converted'`; `2` → cancel + `Send name again` | txn |
| `awaiting_refill_date` | refill `2` | `Send new date (DD/MM/YYYY) or TOMORROW...` | date → `advanceToNextOpenDay` → `UPDATE patient_refills` + `checkAllRefills` → `Reply 1 to save` | refill update + `broadcast refill_updated` |
| `awaiting_refill_qty` / `awaiting_refill_add_med` | refill menu | same 1/2 pattern | qty `2 → 5` or new med name (reuses `awaiting_medicine` search but inserts `patient_refills`) | refill update/insert |

- **1/2 swap:** new-path `isAffirmative = /^1$/`, `isNegative = /^2$/`. Old `isRefillConfirmationResponse:455` kept for fast `REFILL` but also accepts `1`. No `yes/no/haan/ho` evaluated in new path. Invalid → repeat exact instruction.
- **Enquiry bridging:** after `searchAndBroadcast`, if `availability != IN_STOCK` or `isRepeatRequest` → `createEnquiryFromIntent()` (`enquiry_type = repeat? 'repeat_order' : (REGISTERED_NO_STOCK|EXTERNAL_ONLY ? 'new_order' : 'medicine_info')`, `repeat_source_invoice_id` via last invoice, 30-min dedupe, `broadcast enquiry_updated`, no auto WA reply).
- **Payment (existing, reused):** `awaiting_payment` (QR via `paymentQrService.allocateNextQr/buildUpiUri/generatePaymentCard`, `soCode=generateStoreSpecialOrderCode`) → screenshot (`handleInbound:2668` `hasMedia+pendingPayment` → `uploads/payment_proof_SO-xxxx.jpg` → `payment_status='SCREENSHOT_RECEIVED'` → forward to owner `Reply CONFIRM SO-xxxx`) → owner `CONFIRM SO-xxxx` (`handleOwnerInteractiveReply:1929`) → `payment_status='VERIFIED' status='Confirmed'` → `addItemsToPharmarackCart` → `broadcast order_updated/pharmarack_cart_changed` → staged + direct `customer_order_confirmed` WA. Customer WA stays staged until owner confirms (manual-only contract).

---

## 9. Pharmarack accuracy + optimization (scoped, no extra calls)

1. **Type-accurate:** `dosage_group` → `AND LOWER(dosage_form) IN (...)` before scoring (uses `idx_dist_catalog_form` + new `idx_medicines_dosage_form`). `TAB` never returns syrup; `BOTTLE` never returns tablet. Keeps `filterCandidatesByFormulation` (P/SP/L/GP/SR shield) + `score>=0.65` + native rank cutoff.
2. **Cache-first:** WA checks `searchCache.lookup(sanitized+group)` before `performPharmarackSearch` (repeat term <1ms). Stale-while-revalidate preserved (serve stale + background revalidate, single-flight per key).
3. **Adaptive settle:** `500ms×6` early-exit instead of fixed 5s; keep 1 retry on `connection_error`; keep truthful OOS vs search-failed split (`searchFailed` flag → "search temporarily unavailable" not false "all OOS").
4. **One live call/message:** batch multi-candidates into ≤2 sanitized queries; photo = 1 live (extras local-only `relatedMedicines`); text bundle = consolidated confirm.
5. **Sanitize everywhere:** all live calls via shared `sanitizePharmarackQuery` (never raw `body`).

---

## 10. Guardrails & contracts (must-pass before done)

- `npm run guardrails` (changed-lines, exit 0), `npx tsc --noEmit`, `node scripts/quick-update.mjs`, `node scripts/generate-project-docs.mjs`.
- No eager refetch storms (mark-stale-only), no `refetchInterval/setInterval` polling, one global SSE (`useGlobalSseInvalidation`), semantic Tailwind only, no `B-*`/dummy (`BATCH123`, `mrp*0.7`, `Generic Medicine`), no `alert()/confirm()`, delivery-boys via `/dispatch` only, `copyProfileFolder` async-await, single-flight `executeRefresh`, P4 credential heartbeat untouched.
- **Audit summary (8-point, mandatory in build response):** 1) dummy/fallback found, 2) removed/changed, 3) new dummy (must be None), 4) missing-data handling, 5) error/fallback, 6) auto-created records, 7) data source/traceability, 8) remaining risk.

---

## 11. Phased execution (build order)

- **Phase 1 — DB + API:** `medicine_enquiries` DDL (both blocks) + `idx_*`, `src/routes/enquiries.ts` + mount, `GET /browse` + `dosage_group` filter, SSE `enquiry_updated`. Verify: `tsc`, guardrails, `SELECT` panel <100ms, MRP snapshot equals `medicines.mrp`.
- **Phase 2 — CRM UI:** Enquiries tab + `+ New Enquiry` modal + TAB/BOTTLE/ALL pills + Answer/Convert/Close + invoices `Repeat`. Verify: manual enquiry → answer WA → convert-to-order (`special_orders` + `order_updated`) → convert-to-refill (`patient_refills` + `refill_updated`).
- **Phase 3 — WA bot:** `isRefillPatient` detect + `awaiting_dosage_group/variant_pick/final_book/refill_date/qty` + 1/2-only + enquiry creation + repeat lookup + MRP+Google card. Verify: `glycomet → 1 → 2 → 1` books correct variant; `REFILL → 1` confirms; `2` adjusts date via `advanceToNextOpenDay`; screenshot → owner `CONFIRM` → live cart + app confirm.
- **Phase 4 — Optimize + docs:** cache-first WA, adaptive settle, `quick-update` + `generate-project-docs`, `SMALL_BUG_FIX_PLAN.md` move Open→Fixed (if bug-linked), final audit report (`BACKEND SCHEMA SAFETY.md` §24).

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Enquiry spam from noisy WA | 30-min `phone+LOWER(name)` dedupe + `passesGate` + manual-only answers |
| Wrong variant booked (typo `dollo`) | Group filter + `enhancedSimilarity` + MRP strip/Google cross-check before `1` book; `0 hits` → `No TAB found — reply 2 for BOTTLE?` (no list) |
| `dosage_form` null/legacy rows | `ALL` group fallback; browse shows `Form N/A`; never invent form |
| MRP mismatch (catalog vs strip) | Show both `medicines.mrp` used for order; if null → `MRP N/A`; Google link lets user verify |
| Breaking existing FSM | Additive steps only; existing `awaiting_*` strings untouched; fast REFILL first; single-flight `runHeavyJob` for sync; no new timers |

---

## 13. Manual test matrix (must all pass)

1. Manual enquiry → answer WA → convert to order (verify `special_orders` + `pharmarack_mrp` = shown MRP + arrival `whatsapp_queued` flag truthful).
2. Convert to refill (verify `patient_refills` + `refill_updated` + CRM chip).
3. Repeat from CRM invoice (verify `repeat_source_invoice_id` + pre-filled meds).
4. WA `glycomet → 1 (TAB) → 2 (500 SR) → 1 (book)` → `SO-xxxx` + variant MRP correct.
5. WA `REFILL → 1` confirms; `REFILL → 2 → 15/10/2026 → 1` adjusts date (open-day shifted).
6. Screenshot → owner sees image → `CONFIRM SO-xxxx` → live cart has item → user gets app confirm → manual remove/edit in `/pharmarack-cart` works.
7. Browse `TAB` shows only solids, `BOTTLE` only liquids, `q=gly` narrows within group, MRP-only (no rate/stock).
8. Guardrails + `tsc` + `quick-update` green.

---

*End of plan — awaiting Build Mode approval. No code was modified to produce this document.*
