# Implementation Plan — Owner Web Portal & Live-Cart Auto-Sync

> **Status:** IN PROGRESS — Executing Phase 1
> **Governing Blueprint:** `OWNER_WEB_PORTAL_IMPLEMENTATION_PLAN.md`
> **Target:**
> 1. Owner can log in remotely via Cloudflare Tunnel or LAN (`/owner/login`) and access full CRM, Live Cart, and Website Orders with zero desktop-app disruption (desktop local remains 100% login-free).
> 2. Direct live-cart additions from remote portal when PC is ON.
> 3. Automatic cloud sync for CRM/refills so data is never stale when PC is OFF.
> 4. `cart_add_queue` pipeline on cloud: owner can queue medicines from phone when PC is OFF; auto-drained into Pharmarack Live Cart with merge logic when PC boots/syncs.
> 5. Same-medicine merge rule locked across POS, CRM, Website Orders, and Cart Queue.

---

## 1. Architecture & Blueprint Overview

| Layer | File | Planned Work |
|---|---|---|
| `layer:infrastructure` | `src/middleware/tenantAuth.ts` | Add `isLocalRequest()`, `ownerRemoteGate` middleware with endpoint whitelist. Verify local loopback bypass vs remote Bearer owner token. |
| `layer:api` | `src/server.ts` | Mount `ownerRemoteGate` globally on `/api/*` ahead of protected routes. Preserve tunnel CORS and customer-portal access. |
| `layer:api` | `src/routes/auth.ts` | Add `/api/auth/session` (mode: local/remote, authRequired), enforce owner-only role check for remote logins, in-memory IP rate limiter & lockout. |
| `layer:presentation` | `frontend/src/pages/OwnerLogin/index.tsx` | New standalone Owner Login page using semantic Tailwind tokens (`bg-bg2`, `text-text`, `bg-primary`, etc.), Enter-to-submit, truthful errors. |
| `layer:presentation` | `frontend/src/lib/pageImports.ts`, `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx` | Register `/owner/login` route. Add RemoteSessionGuard / auth check; redirect unauthenticated remote requests from internal pages to `/owner/login?next=`. Allow authenticated owner full app layout. |
| `layer:presentation` | `frontend/src/api/client.ts`, `frontend/src/services/api.ts` | Attach `pharmacy_owner_token` to Authorization header. On remote 401, redirect to `/owner/login`. |
| `layer:presentation` | `frontend/src/pages/Settings/tabs/OnlineStoreTab.tsx` | Display Owner Portal URL, quick-link button, and active owner username. |
| `layer:data` | `src/database.ts` | Add additive `cloud_exec_ledger` table in full DDL migration block and `ensureSchema` fast-boot path. Add `remote_auth_mode`, `cloud_sync_auto`, `cloud_cart_queue_mode` app_settings. |
| `layer:service` | `src/services/cloudCatalogSyncService.ts` | Implement event-driven auto-push (debounced ≥5min, idle-gated) on refills/orders/sales. Remove hardcoded `'admin@pharmacy2026'` secret fallback. Push owner auth PBKDF2 hash to cloud. |
| `layer:service` | `src/services/cartQueueSyncService.ts` (new) | Implement `drainCartAddQueue()`, single-flight FIFO batch processing, idempotency via `cloud_exec_ledger`, same-medicine merge rule, cloud acking. |
| `layer:api` | `website/api/catalog.js` | Add `owner_login` verification, `cart_queue_add`, `cart_queue_get`, `cart_queue_ack` actions. Quarantine demo fallback data for owner flows. |
| `layer:presentation` | `website/public/owner.html` | Cloud owner mobile console: login with store owner account, search synced catalog, view active refills/pending orders, queue add to live cart. |
| `layer:service` | `src/services/startupSyncCoordinator.ts`, `src/server.ts` | Wire cart queue drain into 60s cloud poller and boot T+8s catch-up pipeline (`runRefillAutoCartCatchUp('cloud_cart_queue')`). |
| `layer:service` | `src/routes/pharmarack.ts`, `frontend/src/pages/POS/index.tsx` | Extract & apply `normalizeCartAddRequest()` merge helper so multiple adds coalesce quantity into a single line. |

---

## 2. Checklist & Execution Phases

- [ ] **Phase 0 — Pre-flight Baseline**
  - [x] Check git status and baseline performance guardrails (`npm run guardrails` exit 0).
  - [x] Verify no regressions in existing codebase.

- [ ] **Phase 1 — Owner Login Gate & Remote Full App**
  - [ ] Implement `isLocalRequest()` and `ownerRemoteGate` middleware in `src/middleware/tenantAuth.ts`.
  - [ ] Mount `ownerRemoteGate` in `src/server.ts` on `/api` with strict whitelist.
  - [ ] Add `/api/auth/session` endpoint, remote owner-only role restriction, and in-memory rate limiter in `src/routes/auth.ts`.
  - [ ] Create `frontend/src/pages/OwnerLogin/index.tsx` with semantic Tailwind styles.
  - [ ] Register `/owner/login` in `frontend/src/lib/pageImports.ts` and `frontend/src/App.tsx`.
  - [ ] Update `frontend/src/components/Layout.tsx` so remote authenticated owners have full access to CRM, Live Cart, Dashboard, etc., while unauthenticated remote requests redirect to `/owner/login`.
  - [ ] Update `frontend/src/api/client.ts` and `frontend/src/services/api.ts` to attach `pharmacy_owner_token` and handle remote 401 redirects.
  - [ ] Add Owner Portal status & quick-link card to Settings Online Store tab.
  - [ ] Verify `npm run guardrails` passes.

- [ ] **Phase 2 — Automatic Cloud Sync (PC-off data freshness)**
  - [ ] Implement event-driven auto-push debouncing in `src/services/cloudCatalogSyncService.ts`.
  - [ ] Enforce secret hygiene: remove hardcoded `'admin@pharmacy2026'` fallback.
  - [ ] Add owner PBKDF2 auth hash sync to Redis (`owner_auth:<storeId>`).
  - [ ] Quarantine demo/fallback data in `website/api/catalog.js` for owner flows.
  - [ ] Verify `npm run guardrails` passes.

- [ ] **Phase 3 — Cloud `cart_add_queue` & Local Drain Pipeline**
  - [ ] Add `cloud_exec_ledger` table to `src/database.ts` (both DDL migration and `ensureSchema` fast-boot path).
  - [ ] Add `cart_queue_add`, `cart_queue_get`, `cart_queue_ack`, and `owner_login` to `website/api/catalog.js`.
  - [ ] Build `website/public/owner.html` cloud console for PC-off queuing & CRM viewing.
  - [ ] Create `src/services/cartQueueSyncService.ts` to drain cloud queue with idempotency & Pharmarack mutex safety.
  - [ ] Connect drain trigger to `startupSyncCoordinator.ts` and 60s poller in `src/server.ts`.
  - [ ] Add live-cart queue status indicator & SSE reflection in `LiveCart/index.tsx`.
  - [ ] Verify `npm run guardrails` passes.

- [ ] **Phase 4 — Same-Medicine Merge Rule Lock**
  - [ ] Create `normalizeCartAddRequest()` helper in `src/routes/pharmarack.ts`.
  - [ ] Unify add-to-cart logic across POS, Quick Assist, CRM, Website Orders, and Cart Queue.
  - [ ] Verify `npm run guardrails` passes.

- [ ] **Phase 5 — Docs, Knowledge Graph & Verification**
  - [ ] Update `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md`.
  - [ ] Complete `BACKEND SCHEMA SAFETY.md` Section 24 report for `cloud_exec_ledger`.
  - [ ] Run `node scripts/quick-update.mjs` to synchronize architecture layers.
  - [ ] Run final `npm run guardrails` to guarantee 0 violations.

---

## 3. Tasks & Completed Work Log

*(Tasks will be logged here chronologically as each phase finishes)*
