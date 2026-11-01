# Hostile Design Critic Audit Report: `design_draft.md`

**Verdict:** **FAIL**

---

### Executive Summary & Top 3 Critical Points

1. **Fictitious Concurrency Mechanics & SQLite Lock Inversion (Blocker)**:
   The document proposes a "Write Priority Lane" where background workers acquire write locks with `yielding: true` and execute `PRIORITY_INTERRUPT` when a POS sale arrives. SQLite WAL mode provides no native transaction preemption or pausing. An in-flight SQLite transaction can only commit or `ROLLBACK`. Aborting background jobs mid-batch during busy counter hours will trigger perpetual transaction livelock/starvation, corrupt batch states, or leave zombie locks. Furthermore, proposing `PRAGMA busy_timeout = 10000;` actively degrades the existing production setting (`30000ms`), increasing rather than reducing `SQLITE_BUSY` crashes.

2. **Architectural Contradiction & Build-Time Boundary Breach (Blocker)**:
   Section 5 mandates that Vite client components directly import backend tokenizers from `src/utils/orderNameMatcher.ts`, while Section 6 simultaneously rejects client-side matching because it creates "matcher drift". This is physically incompatible with the project's build architecture (`frontend/` is an isolated Vite SPA with its own `tsconfig.app.json`). Vite cannot directly import root Node backend modules without leaking Node runtime dependencies or breaking bundling. If the utility is bundled into the client, it is by definition client-side execution, completely invalidating the author's rejection rationale.

3. **Catastrophic Checkout Blockers via Blind Pack-Size Gates (Blocker)**:
   The document mandates hard-rejecting loose sales where `pack_size is missing, NULL, or < 2`. In real Indian retail pharmacies, thousands of inventory items (syrups, inhalers, eye drops, ointments, single vials, insulin pens) legitimately have `pack_size = 1` or unpopulated strip counts. The specification defines no discriminator for dosage form (tablet/capsule vs liquid/topical), meaning ringing up single units of syrups or surgicals will hard-crash checkout. During rush hour, cashiers will be paralyzed by blocking validation modals, violating the core uptime mandate of the POS.

---

### Detailed Hostile Review Findings

#### Finding 1: Imaginary Cooperative Transaction Preemption (`yielding: true` / `PRIORITY_INTERRUPT`)
* **Severity**: Blocker
* **Affected Scope**: Section 4 (lines 70–79), Section 5 (lines 111–114, 131–136, 142–143)
* **Finding**:
  The document invents hardware bus arbitration concepts for an embedded SQLite database:
  > *"Any background task performing database modifications must acquire the write lock with a non-blocking timeout (`yielding: true`), aborting immediately if a user-facing sale transaction requires the bus."*
  
  SQLite has strictly **one writer** at any time. SQLite C-level transactions cannot "pause", "yield", or "step aside" while in the middle of writing B-tree pages. The only way to yield is an explicit `ROLLBACK`.
  - If a background catalog sync is updating 1,000 distributor SKUs and is interrupted at record 450, does it rollback the entire batch?
  - If a busy pharmacy has a POS sale every 15–30 seconds, background sync will be repeatedly aborted and will NEVER complete (perpetual starvation).
  - If the transaction is NOT rolled back, POS writes must wait behind it anyway, rendering `PRIORITY_INTERRUPT` an illusion.
* **Recommendation**:
  Acknowledge existing repo architecture. `src/database/connection.ts` already implements a software mutex (`dbManager.runWithPriority('VIP' | 'NORMAL' | 'BACKGROUND')`). Background jobs must be queued in micro-transactions (chunks of 10–25 rows) that commit quickly, releasing the lock naturally between chunks so waiting `VIP` transactions (POS sales) acquire the write lock within < 50ms without dirty rollbacks.

---

#### Finding 2: `busy_timeout` Regression from 30s to 10s
* **Severity**: Blocker
* **Affected Scope**: Section 4 (line 78), Section 5 (line 113)
* **Finding**:
  The author states: *"Set PRAGMA busy_timeout = 10000; on all database connections in src/database.ts."*
  In production, `src/database/connection.ts` already configures `PRAGMA busy_timeout = 30000;` (30 seconds). Reducing this timeout by 66% (to 10s) will cause SQLite to abort transactions under load three times faster, dramatically increasing the frequency of `SQLITE_BUSY: database is locked` exceptions during heavy background I/O.
* **Recommendation**:
  Delete this proposal. Retain `busy_timeout = 30000;` and enforce small transaction boundaries in background workers.

---

#### Finding 3: Cross-Boundary Import Violation & Contradictory Architecture
* **Severity**: Blocker
* **Affected Scope**: Section 5 (lines 140–141), Section 6 (lines 151–154)
* **Finding**:
  Section 5 states that frontend React components import tokenizers directly from `src/utils/orderNameMatcher.ts`. 
  Section 6 (Alternative 1) rejects client-side matching because it *"Creates 'matcher drift'. Whenever medicine catalog token rules update... client and server fall out of sync."*
  This is a fatal technical contradiction:
  1. `frontend/` is an independent Vite project with its own TypeScript config (`tsconfig.app.json` roots inside `frontend/src`). Importing backend files from `../src/utils/` breaks module resolution, risks bundling Node.js core libraries (like `fs` or `path`), and triggers Vite build failures.
  2. If the file is imported into Vite, it compiles into the client SPA bundle at build time. That IS client-side matching! If the backend changes its scoring algorithm on disk, the client bundle still retains its old compiled logic until rebuilt, meaning "matcher drift" is NOT solved.
* **Recommendation**:
  Choose one honest architectural pattern:
  - **Option A (Pure API)**: Expose `POST /api/orders/match` where all scoring occurs server-side.
  - **Option B (Isomorphic Shared Code)**: Extract tokenization into a pure-TS leaf package or shared directory (`packages/shared` or mirrored files) with automated parity unit tests, accepting client-side execution.

---

#### Finding 4: Unmitigated Power Loss & Crash Scenarios Mid-Transaction
* **Severity**: Major
* **Affected Scope**: Section 4 & Section 5 (Lifecycle & Failure Modes)
* **Finding**:
  The document is completely silent on system failure modes during mid-transaction crashes, sudden workstation power cuts, or OS force-kills:
  - When selling loose tablets, stock is decremented from `inventory_master.loose_quantity` and recorded in `sale_items`. If power is lost after SQLite commit but before receipt printing or cash drawer ejection, what is the recovery path?
  - If a background Pharmarack cart sync is aborted or crashed mid-flight, how are orphan pending requests in `refill_cart_items` reconciled against live Pharmarack remote carts?
  - There is zero consideration of WAL file bloat. Under continuous write interruption and concurrent read load, SQLite checkpoints are deferred, causing `database.sqlite-wal` to balloon past hundreds of megabytes, severely degrading read latency on spinning HDDs or cheap SATA SSDs.
* **Recommendation**:
  Add a dedicated "Failure Modes & Crash Recovery" section specifying:
  - WAL checkpoint strategy (`PRAGMA wal_autocheckpoint` and idle checkpoint scheduler).
  - Two-phase state flags for Pharmarack dispatch (`PENDING_SUBMIT` -> `SUBMITTED`).
  - POS offline transaction recovery journal.

---

#### Finding 5: Blind Pack-Size Hard-Gate Halts Legitimate Dispensing
* **Severity**: Major
* **Affected Scope**: Section 4 (lines 87–88), Section 7 (line 169)
* **Finding**:
  The rule: *"Hard reject loose tablet sales if pack_size is missing, NULL, or < 2"* is dangerously oversimplified:
  - Non-divisible items (Syrups, Ointments, Drops, Powders, Inhalers) are legally sold as 1 single bottle/tube. If their `pack_size` is recorded as `1`, any cashier dispensing 1 unit will be blocked if the POS considers single units as "loose".
  - If the POS checks `quantity < pack_size` to identify loose sales, an item with `pack_size = 1` cannot ever be sold as loose, but if `pack_size` is missing (`NULL`), the sale is rejected entirely.
  - Indian retail pharmacy databases are notorious for dirty vendor master records where older medicines lack pack sizes. Hard-blocking checkout during customer rush creates immediate store friction.
* **Recommendation**:
  Scope loose validation strictly to oral solid dosage forms (`dosage_form IN ('TABLET', 'CAPSULE', 'STRIP')`). For non-strip SKUs, bypass loose math. If `pack_size` is missing on a strip at the POS, allow an inline cashier override with audit logging, rather than hard-rejecting the sale.

---

#### Finding 6: Incomplete Schema Contract for "Walk-In Counter Sale"
* **Severity**: Major
* **Affected Scope**: Section 4 (lines 92–98), Section 5 (lines 144–146)
* **Finding**:
  The document states:
  > *"`POST /sales` refuses saves where `customer_name` or `phone` is empty unless explicitly marked as a 'Walk-In Counter Sale' without creating an artificial `customers` database row."*
  
  This leaves the database schema contract undefined:
  - Is `sales.customer_id` nullable in SQLite DDL? If it is `NOT NULL`, omitting a customer row violates foreign key integrity.
  - If `customer_id` is `NULL`, how do daily GST B2C summary reports aggregate sales?
  - Does the POS UI automatically toggle `is_walk_in: true` when inputs are cleared, or does it require cashier button presses?
* **Recommendation**:
  Explicitly detail the schema migration in accordance with `BACKEND SCHEMA SAFETY.md`: verify `ALTER TABLE sales ALTER COLUMN customer_id DROP NOT NULL` (or SQLite table recreate), set `sales.customer_id = NULL`, and record `sales.customer_name = 'Walk-In Customer'` on the sale record without inserting into `customers`.

---

#### Finding 7: Strawman Alternatives Analysis
* **Severity**: Major
* **Affected Scope**: Section 6 (lines 150–164)
* **Finding**:
  The document fails the mandatory Alternatives Rule of `feature-spec-standard.md`. The three listed alternatives are strawmen designed to be knocked down rather than genuine architectural trade-offs:
  - **Alternative 1 (Client-Side Standalone Heuristic Engine)**: Claimed to be rejected to avoid drift, yet the blueprint proposes importing the exact same code into the client bundle!
  - **Alternative 2 (Secondary SQLite Database `sync.db`)**: Dismissed due to lack of cross-db WAL atomicity. No senior architect would suggest cross-file foreign keys in SQLite for catalog sync.
  - **Alternative 3 (Worker Threads)**: Dismissed as "rapidly exceeding 4-core, 8 GB host resource constraints". Node.js worker threads use ~30 MB RAM. Meanwhile, the application runs two full headless Chromium instances (~800 MB RAM) for WhatsApp and Pharmarack! Calling worker threads too heavy is technically untenable.
  - **Omitted Real Alternatives**:
    1. Using SQLite FTS5 (Full-Text Search) with BM25 ranking for unified server-side medicine lookup.
    2. Shared monorepo npm package (`@pharmacy/matcher`) with deterministic cross-compilation.
    3. Retaining existing `VIP`/`BACKGROUND` SQLite lanes in `src/database/connection.ts`.
* **Recommendation**:
  Rewrite Section 6 to evaluate real, viable alternatives (e.g. SQLite FTS5 index vs in-memory Levenshtein matching, Monorepo shared package vs REST search endpoint).

---

#### Finding 8: Misattributed Utilities & Domain Conflation
* **Severity**: Nit
* **Affected Scope**: Section 4 (line 77), Section 3 (lines 49–57)
* **Finding**:
  - Line 77 suggests routing DB writes through `src/utils/heavyRestoreLane.ts`. That file was created specifically for Bug P2-105 to throttle **Chromium headless browser processes** to protect system memory, not for SQLite query queues.
  - Section 3 frames local timestamp handling (`localTime.ts`) as a new consolidation task, whereas Guardrail B4 already strictly enforces IST timestamp generation project-wide.
* **Recommendation**:
  Remove references to `heavyRestoreLane.ts` from database write queues and reference `src/database/connection.ts`.

