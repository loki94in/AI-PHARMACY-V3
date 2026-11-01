# Intermediate Zoom-Out Evaluation Report: `design_draft.md` (Stage 8)

**Overall Verdict:** **FAIL**

---

## Executive Summary & High-Altitude Verdict

The proposed design in `design_draft.md` fails high-altitude architectural review under the **Zoom-Out Standard** (`resources/document_standards/zoom-out-standard.md`) and the **DOX Architecture Contract**. 

While the document correctly identifies real operational symptoms (counter lock collisions, loose stock accounting drift, and ghost customer accumulation), its architectural trajectory:
1. **Severely exacerbates complexity** by inventing imaginary cooperative transaction preemption mechanics (`yielding: true` / `PRIORITY_INTERRUPT`) for SQLite.
2. **Reinvents existing core infrastructure** while actively proposing a reliability downgrade (slashing SQLite `busy_timeout` from 30,000ms to 10,000ms, when `src/database/connection.ts` already implements a robust `VIP`/`NORMAL`/`BACKGROUND` prioritized mutex).
3. **Breaches build-time architectural boundaries** by forcing Vite client components to directly import Node backend modules (`src/utils/orderNameMatcher.ts`), which violates Vite bundling and tsconfig isolation.
4. **Introduces critical checkout-stopping bugs** by proposing a blanket hard-reject on any sale where `pack_size < 2`, which will freeze checkout for thousands of single-unit non-strip medicines (syrups, drops, inhalers, surgicals).
5. **Suffers from severe scope bloat**, bundling six decoupled operational issues into an unmanageable mega-spec.

---

## High-Altitude Architectural Synthesis

### 1. Has the design addressed or exacerbated complexity in light of Critic and Comprehension findings?
**It has severely exacerbated complexity and introduced active regressions:**
* **SQLite Transaction Preemption Illusion**: SQLite in WAL mode permits exactly **one writer** at any time. SQLite C-level transactions cannot "pause", "yield", or "step aside" mid-execution. A transaction must either `COMMIT` or `ROLLBACK`. Proposing that background sync jobs "yield immediately" upon an interrupt signal introduces transaction livelock, perpetual starvation of background jobs during counter hours, or lock corruption.
* **Downgrading Database Resilience**: The draft proposes setting `PRAGMA busy_timeout = 10000;`. The production codebase (`src/database/connection.ts` lines 267, 297) already sets `busy_timeout = 30000;` (30s) and wraps all POS sales in `VIP` priority with 5 retry backoffs (`src/routes/sales.ts` lines 36–38, 60). Reducing the timeout to 10s weakens lock tolerance by 66%.
* **Misattributing RAM Protection Utilities**: Proposing to route database writes through `src/utils/heavyRestoreLane.ts` demonstrates architectural confusion. That utility was created specifically for Bug P2-105 to throttle **Chromium headless browser memory consumption** on 12 GB RAM PCs, not for SQLite write queueing.
* **Single-Unit Dispensing Paralyzed**: Retail pharmacies sell thousands of discrete items with `pack_size = 1` (syrups, ointments, eye drops, vials). A blanket rule rejecting sales with `pack_size < 2` without checking dosage form will paralyze checkout during rush hours.

### 2. Does attempting to fix all of these in a single spec make architectural sense, or must it be partitioned?
**It makes ZERO architectural sense as a monolithic specification. It must be partitioned.**
Bundling database write concurrency, medicine fuzzy token matching, loose-tablet strip inventory math, UTC/IST timestamp normalization, distributor cart threshold checking, and ghost customer record prevention violates the **Root Problem Focus** and **Anti-Weeds** principles of the Zoom-Out Standard. 

These represent three separate concern domains that must be partitioned into decoupled, surgical specs:
1. **Domain 1: Background Worker Transaction Hygiene** (Infrastructure/Backend):
   Ensuring background sync workers execute writes in small chunks (10–25 rows) using `dbManager.runWithPriority('BACKGROUND')` so the existing VIP lane in `sales.ts` never waits more than 50ms.
2. **Domain 2: Order Matcher Parity** (Algorithm / API Contract):
   Unifying medicine tokenization and scoring without violating Vite/Node compilation boundaries.
3. **Domain 3: POS Billing & Purchase Ledger Sanitization** (POS / Data-Flow Tree):
   Handling walk-in counter sales without phantom customer rows, and scoping loose tablet validation strictly to solid oral dosage forms (`TABLET`, `CAPSULE`).

### 3. What is the simplest, most minimalist path forward (YAGNI & Codebase Reuse)?

Following the project's **Ponytail (Lazy Senior Dev Mode)** and **Simplicity First** mandates:

| Level | Action | Architectural Rationale |
| :--- | :--- | :--- |
| **Rung 1 (YAGNI)** | **Drop SQLite Write Lane & Timeout Changes** | **Reuse existing `DatabaseManager`**: `src/database/connection.ts` already has a 3-tier prioritized transaction queue (`VIP`, `NORMAL`, `BACKGROUND`) and 30s `busy_timeout`. Sales are already VIP. Do not build a new serialization lane. Background workers just need to commit in micro-batches under `BACKGROUND` priority. |
| **Rung 2 (Leverage Existing)** | **Drop Expiry Engine Consolidation** | `src/utils/localTime.ts` already provides the authoritative shop IST timestamp standard, guarded by Guardrail Rule B4. Re-specifying this is duplicate work. |
| **Rung 3 (Boundary Safety)** | **Decouple Matcher Architecture** | Choose between: <br>**(A) Server-Side API**: Expose `POST /api/distributors/match-order` (zero client-server algorithm drift); OR <br>**(B) Mirrored Pure-TS Modules**: Keep `src/utils/orderNameMatcher.ts` and `frontend/src/utils/orderFuzzyMatcher.ts` in sync with a shared test vector file. Never attempt cross-root imports from `frontend/` into `../src/`. |
| **Rung 4 (Minimal Surgical Fix)** | **Dosage-Form-Aware Loose Dispensing** | Check `dosage_form IN ('TABLET', 'CAPSULE')` before validating `pack_size`. Allow cashier confirmation/override for older catalog records with missing strip data. Never block syrups, drops, or single-unit SKUs. |
| **Rung 5 (Schema Conformance)** | **Walk-In Counter Sale Schema Contract** | Ensure `sales.customer_id` is nullable in `src/database.ts` and set to `NULL` for walk-ins without creating dummy `'Customer'` records in `customers`. |

---

## Detailed Review Findings Matrix

| Finding | Severity | Affected Scope | Simplicity & YAGNI Rationale |
| :--- | :--- | :--- | :--- |
| **Reinventing SQLite Mutex & 10s Timeout Downgrade** | **Blocker** | Section 4 (lines 70–79), Section 5 (lines 111–114, 131–136, 142–143) | `DatabaseManager` in `src/database/connection.ts` already provides a prioritized transaction mutex (`VIP`/`NORMAL`/`BACKGROUND`) and 30s timeout. Adding a new "Write Priority Lane" with non-existent `yielding: true` preemption is over-engineering and drops timeout tolerance by 66%. |
| **Cross-Boundary Import Violates Vite SPA Architecture** | **Blocker** | Section 5 (lines 140–141), Section 6 (lines 151–154) | Vite frontend cannot import backend Node files from `../src/utils/orderNameMatcher.ts`. It causes build failures and leaks Node dependencies. Furthermore, rejecting client-side heuristics while bundling backend code into the client SPA is a direct contradiction. |
| **Catastrophic Checkout Blockers on Single-Unit Products** | **Blocker** | Section 4 (lines 87–88), Section 7 (line 169) | Hard-rejecting any sale where `pack_size < 2` halts dispensing for legitimate single-unit products (syrups, inhalers, drops, surgicals). Pack validation must be scoped strictly to oral solid dosage forms. |
| **Monolithic Mega-Spec Lacks Root Problem Focus** | **Major** | Entire Document | Bundles 6 distinct operational problems across backend, database, client modals, and data validation into one mega-spec. Violates the Zoom-Out Standard. Must be partitioned into discrete domain specs. |
| **Undefined Schema Contract for Walk-In Sales** | **Major** | Section 4 (lines 92–98), Section 5 (lines 144–146) | Does not specify column nullability for `sales.customer_id` or DDL migration requirements under `BACKEND SCHEMA SAFETY.md`. |
| **Redundant Expiry Normalization Task** | **Nit** | Section 3 (lines 49–57), Section 5 (lines 107, 125–127) | `src/utils/localTime.ts` is already established and strictly enforced by Guardrail B4. Adding this as a new consolidation task is redundant. |

