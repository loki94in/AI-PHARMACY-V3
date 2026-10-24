# OWNER WEB PORTAL & LIVE-CART AUTO-SYNC — IMPLEMENTATION PLAN

| Field | Value |
|---|---|
| **Status** | APPROVED BLUEPRINT — **ZERO-TOUCH** (no source/config/runtime file modified during plan creation) |
| **Created** | 2026-10-24 |
| **Approval** | Owner confirmed via plan-mode Q&A (portal style: *full app + login gate*; credentials: *owner-only account*; same-medicine rule: *merge qty*; PC-off: *online queue auto-triggers on PC sync*) |
| **Name rationale** | Document owns the implementation of the owner web portal + live-cart queue pipeline (this is the fix/implementation blueprint it is named after) |
| **Governing contracts** | Root `AGENTS.md` (all sections), `AGENT_DATA_FLOW_TREE.md`, `BACKEND SCHEMA SAFETY.md`, `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md`, `frontend/AGENTS.md`, `src/AGENTS.md` |
| **Line references** | Snapshots from planning-session research (2026-10-24). Re-verify at implementation time; line numbers may drift. |

---

## 0. ZERO-TOUCH STATEMENT

**During creation of this document, ZERO source code, configuration, runtime modules, database files, or app settings were created, edited, deleted, or renamed.**
The only artifact produced is this blueprint file. All implementation actions below are **pending** and begin only after the owner switches to a Build agent.

---

## 1. PROBLEM STATEMENT (owner's words → engineering scope)

1. When the pharmacy owner is away from the PC, he must be able to log in **on the website** and see **ALL CRM data** (patients, refills, special orders) and the **Live Cart**.
2. He must be able to **add medicines to the Live Cart directly from the website** (instant add when PC is on) — and when the shop PC is off, the add must **queue online** and **auto-trigger into the Live Cart when the PC comes back and syncs** — reusing the add-to-cart/live machinery that already works.
3. The online cloud must hold the CRM/refill data the owner and patients need, so a PC being off is **never a blocker**.
4. Same medicine added multiple times (anywhere) must **merge quantity into ONE row** — never duplicate rows.

**Verified answer to the owner's question ("website or PC?" for live-cart adds):** the Pharmarack live cart is executed by the shop PC's backend. PC ON → direct from website works instantly. PC OFF → only queue-then-sync is possible; nothing else technically exists.

---

## 2. CURRENT STATE — VERIFIED FACTS (what already exists and gets REUSED, not rebuilt)

| # | Capability | Where it lives today (file : anchor) | Reuse decision |
|---|---|---|---|
| 2.1 | POS cart merges same medicine into one row (qty +1) | `frontend/src/pages/POS/index.tsx:2962` (`addToCart`; existing-row branch at 2999–3022) | Keep as reference Rule |
| 2.2 | Pharmarack live cart upstream merge via SET-qty | `src/routes/pharmarack.ts:2038–2061` (targetCartQty), upstream `AddUserProductCartDetail` at 2143; route `POST /api/pharmarack/cart/add` at 2245 | **Pipeline executor reused as-is** |
| 2.3 | Refill "in_cart, never re-add" rule | `src/services/refillCartService.ts` `processRefillCartItem` (refs 341/497) | Keep; merge rule complements it |
| 2.4 | Staff login endpoint + `pharmacy_users` table | `src/routes/auth.ts:22–58`; `src/database.ts:780–783` (seed 826); PBKDF2 via `src/utils/password.ts` | **Remote owner gate uses this** |
| 2.5 | Desktop auth-bypass fallback | `src/middleware/tenantAuth.ts:83–133` (`isDesktopFallback`) | Must stay for local; replaced by owner gate for remote |
| 2.6 | Whole app served as website | `src/server.ts:440–474` (static + SPA fallback); port `5174/5175` (`src/config/index.ts:134–135`) | Serve new `/owner/login` under same shell |
| 2.7 | Cloudflare tunnel (public URL) | `src/routes/tunnel.ts:6–43`; `src/services/cloudflareTunnelService.ts` (CORS at `src/server.ts:222`) | The "website" transport |
| 2.8 | Local→cloud push (catalog ≤1000 meds + store profile + last 150 bills + active refills) | `src/services/cloudCatalogSyncService.ts:17,21–133`; manual trigger routes `src/routes/customerPortal.ts:2560–2578` | **Change: manual-only → automatic (Phase 2)** |
| 2.9 | Cloud→local order pull (60 s poller, idle-gated, boot T+8 s) + ack | `src/server.ts:607–610`; `cloudCatalogSyncService.ts:163...,400–416` | **Extend: also drains cart queue** |
| 2.10 | Cloud orders queue (`orders:pending`) + patient portal (login, bills/refills/orders, refill_request, special_order, cart order) | `website/api/catalog.js` (action dispatcher 208; orders ACK 862–911); `website/public/catalog.html` | Cloud queue pattern copied for cart queue |
| 2.11 | **Boot catch-up that executes queued cart adds after PC returns** | `src/services/startupSyncCoordinator.ts:76–125` (`runRefillAutoCartCatchUp`, single-flight, bounded ≤10); fired on `'cloud_pull'` at `cloudCatalogSyncService.ts:376` | **The auto-trigger core — extended** |
| 2.12 | Durable outbox patterns | `src/services/whatsappQueueWorker.ts` (`whatsapp_send_queue`, dedupe, scheduled_at); staged rows + `sync_client_refs` idempotency | Ledger pattern to copy |
| 2.13 | SSE single-connection + `SSE_QUERY_MAP` + `PageQueryTracker` | Root AGENTS.md "Keep-Alive Is Real" | New events must plug in, never poll |

**Not to be invented:** no second patient list, no parallel cart table, no second sale writer, no GPU flags, no automatic patient messaging (Manual-Only Patient Messaging Contract intact).

---

## 3. AGENT ROLES — VERIFIED MAP (owner-mandated trio)

The implementation was decomposed so each role owns ONE boundary. Roles map onto the existing runtime subsystems of this repository; nothing new is spawned as a separate process.

### 3.1 Ingestion & Validation Agent (INTAKE)
Owns every entry point where data enters the pipeline, and refuses invalid data (Strict Legitimate Data Contract: *real → process; missing → request; invalid → reject; never invent*).

| Intake | Validation duties | Owner files (future) |
|---|---|---|
| Remote HTTP request (owner portal) | Host detection (local vs tunnel/LAN), Bearer-owner-token verify, role=`owner` only for remote login, brute-force limiter | `src/middleware/tenantAuth.ts` (extension), `src/routes/auth.ts` |
| Cloud `cart_add_queue` item | Schema shape (req_id, medicine_name, qty, source, user, ts), qty ≥ 1 & sane cap, req_id dedupe, name must exist in the last synced cloud catalog for that store | `src/services/cartQueueSyncService.ts` (new) |
| Local auto-push bundle | Assemble only from real SQLite rows (catalog ≤1000 visibility rule, active refills, pending orders); **no invented fields**; secret must come from env/app_settings — **no hardcoded fallback** (`'admin@pharmacy2026'` default must be removed) | `src/services/cloudCatalogSyncService.ts` |

### 3.2 Core Processing Pipeline Agent (CORE)
Owns execution state transitions and the live-cart writer.

| Duty | Detail |
|---|---|
| Queue drain executor | Single-flight pipeline: pull `cart_add_queue` (bounded batch ≤10, FIFO order) → ledger idempotency check → route by source (refill-item → `refillCartService` semantics; plain search-add → `addItemsToPharmarackCart`) → **same-medicine merge (set-qty, never a second line)** → ack to cloud → mark ledger row processed only AFTER successful ack (at-least-once + dedupe ⇒ effectively-once) |
| Trigger wiring | (a) inside existing 60 s cloud-order poller after order pull; (b) boot T+8 s pull → chain drain; (c) `runRefillAutoCartCatchUp('cloud_cart_queue')` trigger added to `startupSyncCoordinator`; (d) manual retry button (user click only) |
| Session safety | Heavy browser work honors `heavyRestoreLane` FIFO, Pharmarack single-flight refresh mutex, idle-gating via `activityTracker.isIdle()`, below-normal process priority untouched |
| Merge-rule lock | One helper `normalizeCartAddRequest()` used by ALL add paths (POS staging result, CRM/refill add, website orders, queue drain) so behavior cannot drift |

### 3.3 Notification Broker Agent (BROKER)
Owns all outward signaling — and NOTHING it may auto-send to patients.

| Channel | Rule |
|---|---|
| SSE (`eventService` → `/api/notifications/stream`) | New events: `cart_queue_changed`, `cart_queue_processed`, `owner_auth_required` broadcast on status flips; keys registered in `SSE_QUERY_MAP`; invalidations MARK-STALE only (`refetchType: 'none'`) per Deferred-SSE contract |
| Toasts | Truthful only (queued / added / failed + reason); never fabricate success |
| WhatsApp | **Manual-click only** (existing queue worker; owner digest to owner number allowed like current automation_notifications pattern; patients NEVER auto-messaged). Cloud `wa.me` deep-links (patient clicks send himself) unchanged |
| Cloud acks | `POST {orderIds}/{reqIds}` ack removes from Redis pending list (existing orders ACK pattern 862–911 reused) |

---

## 4. BLUEPRINT ARCHITECTURE LAYERS (mapped to knowledge-graph layers)

| Layer | Artifacts in this plan |
|---|---|
| `layer:presentation` | `pages/OwnerLogin/index.tsx` (new, semantic Tailwind only), `RemoteSessionGuard` in `App.tsx`, axios interceptors (`api/client.ts`, `services/api.ts`), Settings portal-status card, cloud owner console page (`website/public/owner.html`) |
| `layer:api` | `src/routes/auth.ts` (+`/api/auth/me`, `/api/auth/session`, remote role rule, limiter), `src/server.ts` gate mounting + drain wiring, `website/api/catalog.js` new actions (`owner_login` extension, `cart_queue_add`, `cart_queue_get`, `cart_queue_ack`) |
| `layer:service` | `src/services/cartQueueSyncService.ts` (new), `cloudCatalogSyncService.ts` (auto-push debounce + owner-auth record push + queue pull), `startupSyncCoordinator.ts` (new trigger) |
| `layer:data` | `app_settings` keys (below); **additive** table `cloud_exec_ledger` (id TEXT PK, kind, payload_json, received_at, attempts, processed_at, result_text) — must appear in BOTH the full DDL migration block AND `ensureSchema` fast-boot path; Redis keys `owner_auth:<storeId>`, `cart_add_queue` (list), `cart_add_rate:<ip>` |
| `layer:infrastructure` | `tenantAuth.ts` remote gate, cloudflareTunnelService (status card only), SSE event mapping |

**Redis/cloud contract:** additive only; existing actions (`sync`, `orders`, `refill_request`, ...) untouched so deployed site keeps working before/after.

---

## 5. PIPELINE DIAGRAMS (data flow — must satisfy AGENT_DATA_FLOW_TREE: one writer per fact)

```
PC ON (tunnel reachable)
  Owner URL → /owner/login → pharmacy_users (role=owner) → owner token
  → Full SPA (CRM / Live Cart / Website Orders) — all existing endpoints, now token-gated
  → "Add to Live Cart" → POST /api/pharmarack/cart/add → addItemsToPharmarackCart (set-qty MERGE) → done

PC OFF
  Owner (or patient) uses cloud site (ai-pharmacy-os.vercel.app)
  → owner console: search synced catalog → "Queue Add to Live Cart" → Redis cart_add_queue
  → patients: refill/special/cart orders (existing)        → Redis orders:pending
                 │  PC still off: everything waits safely online
                 ▼  PC boots → backend up
  existing pull (T+8s / 60s idle-gated) → import orders → special_orders (one-writer rule)
                                        → drain cart_add_queue → ledger check
                                        → runRefillAutoCartCatchUp('cloud_cart_queue')
                                        → addItemsToPharmarackCart (MERGE qty) → ack cloud
                                        → SSE toast "Queued online items moved to Live Cart (N)"

CRM patient flow (unchanged, one writer):
  CRM refills (patient_refills) ─┐
  CRM special orders (special_orders) ─┤─► Quick Assist same rows ─► Live Cart add (merge rule)
  Website/queue items (source='website') ─┘   NO new patient lists, NO new fact tables
```

---

## 6. EXECUTION PHASES

### Phase 0 — Pre-flight (no product code)
1. Re-read DOX chain root→leaf for every path listed in §4; `AGENT_DATA_FLOW_TREE.md`, `BACKEND SCHEMA SAFETY.md`, `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md`, bug-fix rulebook if any defect encountered.
2. Baseline: `npm run guardrails` (pass), `node scripts/quick-update.mjs`, build passes `tsc --noEmit`.
3. Re-verify §2 line snapshots; capture git branch `owner-web-portal`.

### Phase 1 — Owner login gate + remote full app
| Task | File | DoD |
|---|---|---|
| `isLocalRequest()` + `ownerRemoteGate` middleware | `src/middleware/tenantAuth.ts` | Local host ⇒ unchanged desktop fallback. Non-local host without valid **owner** token ⇒ 401 on every `/api/*` except whitelist {`/api/auth/login`, `/api/auth/me`, `/api/auth/session`, `/api/customer-portal/*` (self-authenticating), minimal `/api/health`, `OPTIONS` preflight}. SSE accepts `?token=` (EventSource can't set headers) |
| Whitelist review | `src/server.ts:399–412` mount order | Gate mounted BEFORE protected routes; customer-portal auth paths still work; tunnel CORS intact (`server.ts:222`) |
| Remote login role rule + limiter | `src/routes/auth.ts:22–58` | Remote origin + role≠owner ⇒ 403 clear message; in-memory limiter (10 req/min/IP; 5 fails ⇒ 15-min lockout); response truthfully names the owner |
| `/api/auth/session`, `/api/auth/me` | `src/routes/auth.ts` | `{mode:'local'|'remote', authRequired:boolean}`; `me` validates PBKDF2-issued staff token |
| `/owner/login` page | `frontend/src/pages/OwnerLogin/index.tsx` + route in `App.tsx:~99` | Semantic colors only (`bg-bg2`, `text-text`…), Enter-to-submit, error truthful; NO "simulation" language anywhere |
| Session guard + interceptors | `App.tsx`, `frontend/src/api/client.ts:20`, `services/api.ts:58` | Token in `localStorage.pharmacy_owner_token`; boot check via `/auth/session`; any 401 (non-auth endpoints) ⇒ redirect `/owner/login?next=`; **local mode ⇒ zero behavioral change** |
| Settings card | `frontend/src/pages/Settings/*` | Shows portal URL (tunnel status exists already), "Open owner portal" link, current owner account name |

**Phase 1 DoD:** overnight-remote test: tunnel URL ⇢ login wall ⇢ owner in — CRM patients/refills/special orders, Live Cart search+staged add, Website Orders all usable; direct quick "add to live" executes on Pharmarack instantly. Desktop app opens with NO login exactly as today.

### Phase 2 — Automatic cloud sync (PC-off data never stale)
| Task | File | DoD |
|---|---|---|
| Event-driven auto-push (debounce ≥ 5 min, idle-gated) on `refill_updated`, `order_created`, `stock_write`, sale-save events | `cloudCatalogSyncService.ts` | Replaces manual-only push; no timers; skip silently + Settings truth chip when cloud not configured; **default `cloud_sync_auto=on` for refill/order snapshot only** (contains CRM data owner expects online); catalog push debounced daily-or-on-demand (≤1000 cap preserved) |
| Secret hygiene | same file + `src/server.ts` | `ADMIN_SECRET` required from env/app_settings — **hardcoded `'admin@pharmacy2026'` fallback removed** (Strict Legitimate Data: never invent credentials); UI shows one actionable fix message if missing |
| Owner-auth record push | same | Push PBKDF2 `{user, hash, salt}` from `pharmacy_users` role=owner into Redis `owner_auth:<storeId>` (NO plaintext passwords leave the PC) during sync |
| Cloud demo-fallback quarantine | `website/api/catalog.js`, `catalog.html` | NEW owner console NEVER reads `DEFAULT_MEDICINES`/demo PIN data; `customer_login` demo-fallback branches flagged `ponytail:` legacy and excluded from owner path |

**Phase 2 DoD:** owner switches PC off → waits 5 min → phone: cloud site shows active refills + pending orders matching pre-shutdown reality; timestamps truthful (`catalog:last_synced_at`).

### Phase 3 — `cart_add_queue` pipeline (online → live cart on PC sync)
| Task | File | DoD |
|---|---|---|
| Cloud actions | `website/api/catalog.js` | `cart_queue_add` (owner-session): validate against synced catalog of that store (name equality, qty 1–99, req_id v4); dedupe in-flight by req_id. `cart_queue_get` (secret): pending ≤100 FIFO. `cart_queue_ack` (secret): remove acked req_ids, status marks, rate-limit |
| Cloud owner console | `website/public/owner.html` (+ linked from `index.html`/`catalog.html` header for owner role) | Owner login = SAME username/password (server verifies PBKDF2 hash vs `owner_auth:<storeId>`), 5-fail lockout counter in Redis; shows synced CRM-lite truth (active refills, pending orders w/ statuses) + **"Queue Add to Live Cart"** rows (search box → catalog). Read-only CRM; no patient messaging of any kind |
| Local drain service | `src/services/cartQueueSyncService.ts` (new) | Single-flight `drainCartAddQueue()`; batch ≤10; ledger insert-or-ignore(req_id) → for each: source routing (refill semantics vs plain add) → **merge rule §3.2** → success ⇒ ack (ledger row `processed_at` set only after ack success); failure ⇒ attempts++, status `failed_session|failed_catalog` retained for retry/owner button; respects Pharmarack refresh mutex + heavy-lane |
| Trigger wiring | `src/server.ts:607–610`, `startupSyncCoordinator.ts:76–125` | (a) after each order pull; (b) boot T+8 s chain; (c) `runRefillAutoCartCatchUp('cloud_cart_queue')` already-existing function gains the trigger id; (d) SSE events; (e) manual "Retry failed queue items" button (user click) |
| Frontend reflection | `LiveCart/index.tsx`, `SSE_QUERY_MAP` | "N online items queued / pending" chip — SSE-driven only (no polling), truthful statuses |

**Phase 3 DoD:** kill PC → queue 3 medicines online → boot PC → within first idle-gated sync cycle cart contains the 3 items with correct merge behavior, cloud shows "Added to live cart", toasts truthful, ledger shows 3 processed rows, replay crash-test (kill backend mid-drain) does not double-add.

### Phase 4 — Same-medicine merge rule locked everywhere
1. `normalizeCartAddRequest()` single helper; used by POS staging, CRM/refill add-buttons, website-order import add, queue drain.
2. Behavior: read live cart ⇒ same product lines MERGE to set-qty (never second line); refill-context keeps existing `in_cart` one-time rule; UI increment possible.
3. Upstream contract preserved: payload `Quantity` = target qty (`pharmarack.ts:2038–2061`), never double-add fallbacks.

**Phase 4 DoD:** automated test: add→add→add same medicine via any path ⇒ operand qty 1 line becomes 3 after third add; CRM patient medicine added twice from owner console ⇒ one line qty 2 + truthful second-line "already counted (qty 2)".

### Phase 5 — Docs, audit, hardening, release
1. `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` — register `/owner/login` (+ cloud owner.html) ownership/rules.
2. `SMALL_BUG_FIX_PLAN.md` — add entry only if defects discovered during work (per Bug Fix Rulebook).
3. DOX updates: root AGENTS.md contract sections + `frontend/AGENTS.md` + `src/AGENTS.md` + `.agents/rules/*` pointers as needed (remote-auth rule + cloud queue contract with exception rationale referencing governing sections).
4. **`BACKEND SCHEMA SAFETY.md` Section 24 Final Mandatory Report** for the additive `cloud_exec_ledger` (both DDL + `ensureSchema`).
5. `node scripts/quick-update.mjs` + `npm run guardrails` (exit 0, violations fixed BEFORE done, ALLOW-extensions only with written rationale).
6. Release only on owner command: "deploy pilot" ⇒ `npm run release:pilot` (Automated Release contract: guardrails → commit/push → release → report version).

---

## 6.x Database & Backend Schema Safety gate (applies to Phases 2–3)

- Feature → Backend Code → **Schema** → Migration → Indexes (id/kind, processed_at partial) → Constraints (attempts ≥0, kind CHECK) → **no seeds needed** → Initialization (ensureSchema fast-boot + DDL block) → Runtime verification (boot log + ledger row lifecycle) → Tests → **Section 24 report**. One atomic unit; additive-only.

## 6.y Performance contract gate (guardrails map)

- No new polling timers (drain rides the EXISTING 60 s poller; SSE marks stale; `usePageActive` gates remote pages like Dispatch/CRM already do).
- One global SSE connection; new keys in `SSE_QUERY_MAP`; visible-page instant + idle deferred refetch via `PageQueryTracker`.
- No GPU-forcing anything; `dropdown-scroll`, semantic colors; no `text-text`/`text-muted` on accent fills (P2-05 exception honored: accent fills take `text-white`).

---

## 7. ERROR BOUNDARIES

| # | Boundary | Detection | Behavior | Rollback path |
|---|---|---|---|---|
| E1 | Wrong/brute-forced owner login | `/api/auth/login` limiter | 401/403 truthful reason; lockout 15 min after 5 fails; fails logged in-memory only | Kill-switch `remote_auth_mode=local_only_fallback` in `app_settings` ⇒ gate off without code change |
| E2 | Token expired mid-session | Any gated 401 | Clear token + redirect `/owner/login?next=`; local mode never sees this | — |
| E3 | Tunnel down / URL changed | Owner can't reach portal | Cloud owner console + patient cloud portal still work for QUEUEING (data waiting online) | Settings tunnel card: reconfigure/custom domain (owner action) |
| E4 | Cloud KV unconfigured / secret missing | Push/pull fetch errors; missing env | Skip + Settings status truth chip ("Cloud sync not configured — set ADMIN_SECRET / KV"); NEVER silent success, NEVER demo data | Auto-push flag off default? No: `cloud_sync_auto` on, but push hard-fails safe ⇒ status only |
| E5 | Pharmarack session dead at drain | add failure class (`401/403`, profile errors) | Item stays pending `failed_session`, attempts+, retried next cycle; heartbeat/auth mutex path untouched (P4 credentials sacred) | "Retry" button; auth will restore session |
| E6 | Medicine not in synced cloud catalog | pre-validate at `cart_queue_add` | 422 truthful reason; taxa: suggest owner sync catalog; never invent substitutes (e.g., never "Generic Medicine"/guessed mrp) | — |
| E7 | Crash mid-drain | ledger row unprocessed + unacked | At-least-once redelivery; req_id dedupe ⇒ no double add; ack-then-mark ordering | manual retry button |
| E8 | Duplicate queue submissions | req_id / same (store,medicine) within TTL | Treat as idempotent no-op returning existing pending req | — |
| E9 | POS merge conflicts (batch vs loose) | rebalance semantics (POS 3065 `allocateMedicineBatches`) | Merge only qty; batch allocation re-run on next POS visit; never fabricate batch/expiry (no `B-*` tokens EVER) | — |
| E10 | Cloud console abuse from public IP | Redis rate counters `cart_add_rate:<ip>`, login lockout | 429; owner can rotate owner password from Staff & Security (syncs new hash) | password rotate |

## 8. ROLLBACK STRATEGIES

1. **Worktree branch** `owner-web-portal`; revert = branch checkout + `node scripts/quick-update.mjs` + `npm run guardrails`.
2. **Runtime flags** (no code edits): `remote_auth_mode` (`owner_required` | `local_only_fallback`), `cloud_sync_auto` (snapshots on/off), `cloud_cart_queue_mode` (`off` → feature dark until alpha-safe; owner enables).
3. **Schema additive-only**: `cloud_exec_ledger` droppable with no app dependency; no destructive migration on existing tables ⇒ old app version boots against same DB.
4. **Cloud additive-only**: new catalog.js actions + owner.html ship independently of SPA build; removal of 3 actions + 2 Redis keys restores pre-plan cloud exactly.
5. **All legacy local flows untouched in Phase 1** (desktop fallback preserved verbatim) — worst case remote feature is DARK while desktop behaves exactly as today.

## 9. VERIFICATION CHECKLIST (pre-hand-off)

- [ ] Guardrails exit 0; graph updated; `tsc --noEmit` clean
- [ ] Desktop local: NO login (byte-for-byte old UX); LAN/ tunnel: owner gate enforced; staff role 403 remotely
- [ ] Live-cart merge: same medicine added 2×/3× from POS, CRM, owner console, queue ⇒ one line each time; no `B-*`/ fabricated batches anywhere
- [ ] PC-off rehearsal: queue from cloud → boot → autoloaded to live cart → ack → statuses truthful; ledger shows exactly-once
- [ ] Patient cloud portal unaffected (refill_request/special_order/order actions + BYO wa.me links)
- [ ] NO automatic patient WhatsApp/SMS introduced tonight or any night; WhatsApp only manual-click / patient self-send
- [ ] No "simulation/mock" wording in any UI; live data only (No Simulated/Mock rule)
- [ ] DOX chain updated (root 🔧, frontend, src; data-flow tree + schema-safety + release rule files)
- [ ] Page audit directory updated; graph node for new files/pipeline present

## 10. EXPLICIT NON-GOALS
No GPU/ECM changes (No-GPU Desktop Rendering Contract E1). No tunnel auto-start changes. No new patient-messaging automation. No new parallel CRM/cart tables. No `refetchInterval`/`setInterval` of any kind added. No rewriting of catalog.js existing actions. No cloud OAuth/keywords — reuse pharmacy_users.

---

## 11. MANDATORY AUDIT SUMMARY (contract §8-point report at every task close)

1. **Existing dummy/fallback logic found:** cloud `DEFAULT_MEDICINES`/demo-PIN fallbacks; hardcoded `ADMIN_SECRET` default `'admin@pharmacy2026'` (pre-existing; documented, flagged for removal in Phase 2 — untouched tonight)
2. **Removed/changed:** nothing (zero-touch)
3. **New dummy/fallback logic introduced:** None
4. **Missing-data handling:** blueprint mandates truth chips + actionable owner instructions (never invented data)
5. **Error/fallback behavior:** §7 table (10 boundaries with detection/response/rollback)
6. **Auto-created records/values:** none tonight; implementation creates only additive, owner-visible `cloud_exec_ledger` rows from REAL queued actions
7. **Data source & traceability:** repository evidence §2 (file:line snapshots from this session's codebase research) + owner-approved Q&A
8. **Remaining risk / needs review:** line-number drift by implementation date; cloud console must exclude demo fallbacks (E4/§2 task); tunnel URL rotation (reconfigure/custom domain — owner action after Phase 1)

---

**NEXT STEP (owner-gated):** Switch to Build agent and say **"start implementing"** — work begins at Phase 0 pre-flight, in phase order, with the Contract checklist live from task 1.
