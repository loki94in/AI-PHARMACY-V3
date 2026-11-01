# Stage 9: Implementation Readiness Test Report

**Target Document:** `design_draft.md`  
**Reviewer:** Pragmatic Tech Lead & Senior Implementing Engineer (Implementation Readiness Goldfish)  
**Standard:** `resources/document_standards/implementation-readiness-standard.md`, `AGENT_DATA_FLOW_TREE.md`, `BACKEND SCHEMA SAFETY.md`  
**Verdict:** **BLOCKED / NOT READY**

---

### Executive Summary

As the implementing software engineer tasked with writing code from `design_draft.md`, **I cannot proceed with code generation**. 

The document violates the foundational **Zero-Decision Rule** of the Implementation Readiness Standard. It forces the implementer to make critical architectural, concurrency, schema, and API design decisions. Furthermore, attempting to execute the plan as written would introduce severe production defects:
1. **Build Failure**: Direct cross-boundary imports from `src/utils/` into `frontend/src/` will fail Vite compilation and violate TypeScript app boundaries.
2. **Database Degradation & Livelock**: Slashing `busy_timeout` from 30s to 10s increases lock timeouts, while inventing cooperative `PRIORITY_INTERRUPT` transaction preemption for SQLite will either perpetually starve background sync jobs or cause unhandled transaction rollbacks.
3. **Counter Halts**: Hard-blocking sales with `pack_size < 2` without dosage-form scoping will crash cashier checkout for thousands of single-unit retail medicines (syrups, drops, inhalers, ointments, single devices).
4. **Missing Implementation Essentials**: The plan contains **zero DDL migrations**, **zero API request/response contracts**, and **no concrete file modification roadmap**.

---

### Implementation Readiness Audit Matrix

| Audit Dimension | Status | Evaluation & Concrete Hurdle |
| :--- | :--- | :--- |
| **Zero-Decision Rule** | **FAIL** | Leaves core technical designs to the engineer: SQLite preemption mechanics, cross-process module distribution, loose dispensing vs single-unit discrimination, and walk-in schema representation. |
| **Target Scope & File List** | **FAIL** | No explicit list of files to be created, modified, or deleted. Mentions various files opportunistically across prose without clear boundaries. |
| **Actionable Steps** | **FAIL** | Steps are phrased as high-level aspirations ("Route all background heavy mutations through Write Serialization Lane", "Hard-block checkout on unregistered tax rates") rather than precise code edits, function signatures, or algorithms. |
| **Schema & Migrations** | **FAIL** | Zero DDL migrations provided. Fails `BACKEND SCHEMA SAFETY.md`. Does not specify nullability changes, table constraints, or migration scripts for `sales.customer_id`. |
| **API & Payload Contracts** | **FAIL** | No request/response schemas or TypeScript interfaces defined for `POST /sales`, `POST /purchases`, or matching APIs. |
| **Phasing & Checkpoints** | **FAIL** | Work is not partitioned into incremental, buildable phases. Committing these changes as a bundle would destabilize the main branch. |
| **Test Plan & Verifiability** | **FAIL** | Acceptance criteria are hand-wavy ("assert 100% score parity", "zero SQLITE_BUSY errors in logs") without test files, test fixtures, assertion definitions, or test commands. |

---

### Top Implementation Blockers

#### Blocker 1: Imaginary Concurrency Architecture & Preemption Livelock
* **Affected Scope:** Section 4 (lines 70–79), Section 5 (lines 111–114, 131–136, 142–143)
* **Finding:** 
  The plan instructs the developer: *"Any background task performing database modifications must acquire the write lock with a non-blocking timeout (`yielding: true`), aborting immediately if a user-facing sale transaction requires the bus."*
* **Implementation Hurdle:**
  - SQLite in WAL mode permits exactly **one writer** across the process. SQLite C-level transactions cannot be "paused" or "yielded" mid-execution; they must either `COMMIT` or `ROLLBACK`.
  - The plan leaves the implementer to invent an in-memory bus arbitration engine. If a background sync job is aborted on every incoming sale, it will perpetually starve during business hours.
  - Furthermore, `src/database/connection.ts` **already implements** `dbManager.runWithPriority('VIP' | 'NORMAL' | 'BACKGROUND')`, and `src/routes/sales.ts` already runs in `VIP` priority with 30,000ms `busy_timeout`. Proposing `busy_timeout = 10000;` is an active regression that would force the developer to downgrade existing production resilience.
* **Guidance for Implementer:**
  Drop the fictitious "yielding" lane. Instruct background workers (catalog sync, WhatsApp worker) to execute database writes in micro-transactions (10–25 rows per batch) wrapped in `dbManager.runWithPriority('BACKGROUND')`. Between batches, the event loop yields, allowing waiting `VIP` POS sales to grab the SQLite write lock within < 50ms without dirty aborts or custom bus arbiters. Retain `busy_timeout = 30000;`.

---

#### Blocker 2: Vite SPA Cross-Boundary Import Violation
* **Affected Scope:** Section 5 (lines 103–109, 139–141), Section 6 (lines 151–154)
* **Finding:**
  The plan specifies: *"Client modules import identical score metrics and tokenizers exported directly from the shared engine (`src/utils/orderNameMatcher.ts`)"*.
* **Implementation Hurdle:**
  - `frontend/` is a separate Vite application configured with its own isolated `tsconfig.app.json` (`"include": ["src"]`). 
  - Importing backend Node modules from `../src/utils/` causes TypeScript compilation failures under `tsc --noEmit` and bundles backend Node runtime dependencies into the browser.
  - Section 6 rejects client-side matching because it "creates matcher drift", yet importing code into Vite results in client-side bundling anyway.
* **Guidance for Implementer:**
  Must choose one unambiguous architectural path:
  - **Option A (Clean API)**: Expose a dedicated backend endpoint `POST /api/orders/match` in `src/routes/orders.ts` or `src/routes/pharmarack.ts`. Frontend calls the endpoint, ensuring 100% server authority and zero client bundle bloat.
  - **Option B (Shared Isomorphic Leaf Module)**: Isolate string normalization/tokenization into a zero-dependency pure TypeScript file (e.g. `shared/orderMatcherCore.ts`) referenced via explicit monorepo workspace package or mirrored files with automated parity tests in `tests/matcherParity.test.ts`.

---

#### Blocker 3: Blind Pack-Size Gate Halts POS Checkout for Single-Unit SKUs
* **Affected Scope:** Section 4 (lines 80–89), Section 7 (line 169)
* **Finding:**
  The plan mandates: *"Hard reject loose tablet sales if pack_size is missing, NULL, or < 2."*
* **Implementation Hurdle:**
  - Retail pharmacy inventories contain thousands of discrete single-unit products (syrups, suspensions, eye drops, ointments, inhalers, surgical items, diagnostic strips) whose legal and catalog `pack_size` is legitimately `1`.
  - The plan defines no condition to distinguish loose sales from single-unit unit dispensing. A cashier selling 1 bottle of cough syrup or 1 vial of insulin will be blocked by a validation modal or 500 error.
  - Furthermore, legacy pharmacy databases contain catalog rows where `pack_size` was never populated. Hard-blocking counter checkout during peak rush creates immediate operational failure.
* **Guidance for Implementer:**
  The rule must be strictly scoped in code:
  ```typescript
  const isSolidOral = ['TABLET', 'CAPSULE', 'STRIP'].includes(item.dosage_form?.toUpperCase());
  if (isSolidOral && isLooseSale && (!item.pack_size || item.pack_size < 2)) {
    // Prompt cashier for pack size confirmation or block loose split
  }
  ```
  Non-strip formulations (syrups, drops, topicals) must completely bypass loose validation.

---

#### Blocker 4: Total Absence of Database Schema DDL & Migration Scripts
* **Affected Scope:** Section 4 (lines 90–98), Section 5 (lines 144–146)
* **Finding:**
  The plan specifies that `POST /sales` must refuse saves where `customer_name` or `phone` is empty unless marked as a "Walk-In Counter Sale", without creating an artificial `customers` row.
* **Implementation Hurdle:**
  - Violates `BACKEND SCHEMA SAFETY.md` Section 24.
  - No DDL statements are provided. In `src/database.ts`, does `sales.customer_id` allow `NULL`? If the column is `NOT NULL`, omitting a customer record causes an unhandled SQLite constraint failure (`SQLITE_CONSTRAINT: NOT NULL constraint failed: sales.customer_id`).
  - How are walk-in sales queried for GST B2C summary reporting? Does `sales.customer_name` store `"Walk-In Customer"` directly?
  - Does the POS frontend send `{ is_walk_in: true, customer_id: null }`?
* **Guidance for Implementer:**
  Provide exact DDL migration steps in `src/database.ts` (both full schema and `ensureSchema` alter table):
  ```sql
  -- Ensure sales.customer_id is nullable for walk-in counter sales
  -- Payload contract: { customer_id: null, customer_name: 'Walk-In Customer', is_walk_in: true }
  ```

---

#### Blocker 5: Lack of Phasing, File Change Plan, and Test Harness
* **Affected Scope:** Entire Document
* **Finding:**
  The plan attempts to address 6 unrelated subsystems in one giant leap with no execution sequence or automated test definitions.
* **Implementation Hurdle:**
  - An implementer cannot write code atomically without breaking the build across POS, Purchases, Refills, and Sync Workers.
  - The test plan in Section 8 provides no reproducible test commands or fixtures (e.g. what are the "100 medicine strings"? Where is the mock distributor catalog?).
* **Guidance for Implementer:**
  Partition into three isolated, sequential implementation specs:
  1. **Phase 1: Worker Micro-Transactions & Mutex Hygiene**: Wrap background batch loops in `dbManager.runWithPriority('BACKGROUND')` with 25-row chunking.
  2. **Phase 2: Walk-In Sales & Strip-Aware Dispensing**: Nullable `customer_id` DDL migration, walk-in payload handling, and `dosage_form`-aware loose tablet gate.
  3. **Phase 3: Matcher Parity**: Centralize tokenization via server API or shared utility with a dedicated test suite in `tests/matcherParity.test.ts`.

---

### Conclusion & Verdict

**Verdict:** **BLOCKED / NOT READY**

The document `design_draft.md` cannot be passed to a code generation agent. The plan must be revised by the architect to resolve the 5 blockers above, adhere to the zero-decision rule, provide exact DDL schemas and API contracts, and partition the work into incremental phases.

