# Zoom Out Evaluation Report: `design_draft.md`

**Overall Verdict:** **FAIL**

---

### Executive Summary & Top 3 Critical Findings

1. **Reinventing Existing Database Concurrency & Dangerous Regression (Blocker)**:
   The document identifies SQLite lock contention during POS checkout as a breaking point and proposes building a "Write Serialization Lane" and setting `PRAGMA busy_timeout = 10000;`. The author missed that:
   - `src/database/connection.ts` **already implements** a prioritized transaction mutex with VIP queue jumping (`dbManager.runWithPriority('VIP' | 'NORMAL' | 'BACKGROUND')`).
   - `src/routes/sales.ts` (lines 36–38) **already wraps all POS billing routes in `VIP` priority** with built-in retry backoff (`SQLITE_BUSY_RETRIES = 5`).
   - `busy_timeout` is **already set to 30,000ms**; reducing it to 10,000ms as proposed is an active reliability regression.
   - The proposal conflates `src/utils/heavyRestoreLane.ts` (a Chromium headless browser RAM throttle for WhatsApp/Pharmarack) with SQLite write serialization.

2. **Unfocused "Grab Bag" Scope Lacks Root Problem Focus (Major)**:
   The specification attempts to solve 6 disconnected problems in one document: SQLite write concurrency, medicine fuzzy token matching, loose-tablet strip inventory math, UTC/IST time handling, modal distributor validation, and ghost customer record prevention. By treating this as a single "architecture specification", it lacks a unified root problem and bundles unrelated domain fixes together without cohesive architectural boundaries.

3. **Architectural Boundary Breach — Shared Frontend/Backend Modules (Blocker)**:
   Section 5 claims: *"Client modules import identical score metrics and tokenizers exported directly from the shared engine (`src/utils/orderNameMatcher.ts`)"*. This ignores the repo structure: `frontend/` is an isolated Vite SPA with its own build pipeline, dependencies, and `tsconfig.app.json` (`"include": ["src"]`). Client-side React code cannot directly import Node backend modules from `../src/utils/` without violating bundler boundaries and bundling Node-specific runtime logic into the browser.

---

### Detailed Review Findings

#### Finding 1: Reinventing the Concurrency Wheel & Timeout Downgrade
* **Severity**: Blocker
* **Affected Scope**: Section 4 (lines 70–79), Section 5 (lines 111–114, 131–136, 142–143)
* **Simplicity & Reuse Rationale**:
  - The repo already has a robust prioritized transaction scheduler in `src/database/connection.ts` (`txWaiters: { VIP, NORMAL, BACKGROUND }`). POS sales already execute at `VIP` priority via Express middleware in `src/routes/sales.ts`.
  - Proposing a new "Write Priority Lane" with vague `yielding: true` interrupts adds redundant abstraction.
  - SQLite WAL mode is configured in `src/database/connection.ts` with `busy_timeout = 30000` (30s). Proposing `busy_timeout = 10000` weakens lock tolerance by 66%.
  - `src/utils/heavyRestoreLane.ts` is explicitly built for Chromium headless process throttling (bug P2-105) to protect 12 GB RAM machines from browser process thrashing; referencing it for DB writes demonstrates misdiagnosis of existing utilities.

#### Finding 2: Cross-Boundary Imports Violate Vite Architecture
* **Severity**: Blocker
* **Affected Scope**: Section 5 (lines 103–109, 139–141), Section 6 (lines 151–154)
* **Simplicity & Reuse Rationale**:
  - The blueprint assumes Vite frontend components can import `src/utils/orderNameMatcher.ts`.
  - In reality, `frontend/src/utils/orderFuzzyMatcher.ts` exists specifically as a client-side port because Vite compiles `frontend/` independently from the backend Express server.
  - Proposing direct cross-boundary module imports creates build failures under `tsc --noEmit` and Vite bundling rules without setting up a dedicated shared npm package/workspace or an API scoring endpoint.

#### Finding 3: Premature Pack-Size Hard-Blocking (Over-Engineering / Breaking Single-Unit SKUs)
* **Severity**: Major
* **Affected Scope**: Section 4 (lines 80–88)
* **Simplicity & Reuse Rationale**:
  - The mitigation states: *"Hard reject loose tablet sales if pack_size is missing, NULL, or < 2."*
  - Many pharmacy products (syrups, drops, inhalers, ointments, single devices, surgicals) legally and correctly have `pack_size = 1`.
  - Blocking any sale where `pack_size < 2` without checking dosage form or item categorization will cause cashier checkout failures for genuine single-unit inventory during busy store hours.
  - Pack size validation belongs in the inventory intake verification (`purchases.ts`) rather than a hard checkout barrier at the cash register.

#### Finding 4: Conflating Separate Subsystems in a Single Mega-Spec (Altitude / Weeds)
* **Severity**: Major
* **Affected Scope**: Section 3 (lines 38–65), Section 4 (lines 68–98)
* **Simplicity & Reuse Rationale**:
  - The document oscillates between high-altitude architecture (DB WAL concurrency) and hyper-specific code weeds (`COALESCE(m.pack_size, 1)`, `formatExpiryToMMYY`, default GST 2.5% + 2.5%, customer name string checks).
  - These should be partitioned into their governing domain contracts (e.g., POS Billing Safety, Purchase Intake Validation, and Order Matcher Parity) rather than mashed into an unwieldy architectural overhaul.

#### Finding 5: Redundant Expiry Engine Specification
* **Severity**: Nit / Minor
* **Affected Scope**: Section 3 (lines 49–57), Section 5 (lines 107, 125–127)
* **Simplicity & Reuse Rationale**:
  - The local timestamp standard (`src/utils/localTime.ts`) and expiry check (`src/utils/inventoryActive.ts`) are already established and enforced by `scripts/performance-guardrails.mjs` (Guardrail Rule B4).
  - The design frames this as a new consolidation requirement, ignoring that `localTime.ts` is already the single source of truth for bill timestamps.

---

### Recommendation

**Reject `design_draft.md` in its current form.**
1. **Remove Database Concurrency**: Acknowledge and rely on `DatabaseManager`'s existing `VIP`/`NORMAL`/`BACKGROUND` mutex in `src/database/connection.ts` and keep `busy_timeout = 30000`.
2. **Decouple Matcher Architecture**: Instead of proposing invalid cross-root imports between frontend and backend, decide whether matching happens via a backend API endpoint (`POST /api/orders/match`) or by keeping a mirrored, pure TypeScript utility file with identical test suites.
3. **Split into Surgical Task Specs**: Break this mega-document into targeted, domain-specific plans per DOX guidelines:
   - POS Billing & Synthetic Fallback Sanitization (`sales.ts`).
   - Medicine Strip/Loose Accounting & Intake Validation (`purchases.ts` & `inventoryActive.ts`).
   - Order Arrival Matcher Parity.

