# Comprehension Audit Report: design_draft.md

**Verdict:** PASS WITH FINDINGS

---

### Paraphrase

#### What this proposes
The document proposes unifying duplicated business logic across the AI Pharmacy application—specifically medicine name normalization/fuzzy matching, local time/expiry calculations, and cart line assembly—into centralized, authoritative backend utility modules. To eliminate `SQLITE_BUSY: database is locked` errors during peak counter hours, it introduces a prioritized write serialization lane where background jobs yield to foreground POS transactions, paired with an increased `busy_timeout` of 10,000ms. Furthermore, it deprecates artificial fallback values (such as guessed `pack_size = 1`, dummy customer names like `'Customer'`, and default 5% GST) in favor of strict write-time validation and non-persisted walk-in counter sales.

#### How the existing system works, per this document
Presently, client React modals and server Express routes maintain independent implementations of medicine fuzzy matching and date formatting, resulting in client-server validation drift and potential month-end medicine expiration discrepancies. Background automated workers (distributor catalog synchronization, token refresh loops, and WhatsApp messaging queues) concurrently attempt write transactions on a single SQLite WAL database alongside cashiers completing POS sales, triggering lock collisions and UI counter freezes. In addition, when medicine attributes or transaction metadata are omitted, the system silently injects synthetic defaults that cause severe stock ledger distortion (such as loose tablet sales over-depleting full boxes) and accumulate thousands of orphaned ghost records in the database.

---

### Top 3 Critical Points for Reviewers
1. **Ambiguous Concurrency / Preemption Mechanism (Lines 76–78, 142–143)**: The document specifies that background tasks acquire write locks with `yielding: true` and abort immediately upon `PRIORITY_INTERRUPT` when a POS sale occurs. However, SQLite and Node.js do not provide native cooperative transaction preemption; the document does not explain how in-flight database writes are aborted, rolled back, or resumed.
2. **Architectural Contradiction on Matcher Placement (Lines 139–141 vs. 151–154)**: Section 5 states that frontend client modules will import tokenizers and score metrics directly from the shared backend module (`src/utils/orderNameMatcher.ts`), yet Section 6 rejects a "Client-Side Standalone Heuristic Engine" because it creates drift, while also criticizing server roundtrips. A new engineer cannot tell whether this is isomorphic code sharing across Vite/Node or an HTTP endpoint.
3. **Unspecified Loose Dispensing vs. Single-Unit Packaging Rules (Lines 87–88)**: The mitigation specifies hard-rejecting loose sales if `pack_size` is missing, `NULL`, or `< 2`. It fails to define how non-divisible single-unit inventory (syrups, ointments, inhalers, drops where `pack_size = 1`) is differentiated from blister strips of tablets, risking false-positive sale rejections.

---

### Detailed Findings & Discrepancy Analysis

#### Finding 1: Vague "Yielding / Interrupt" Mechanism for SQLite Transactions
* **Severity**: Major
* **Affected Scope**: Section 4 (Lines 76–78), Section 5 (Lines 111–114, 142–143)
* **Discrepancy Description & Rationale**:
  The document states:
  > *"Route all background heavy mutations through `src/utils/heavyRestoreLane.ts` or an explicit Write Serialization Lane that yields immediately to high-priority counter transactions (`PRIORITY_INTERRUPT`)."* and *"must acquire the write lock with a non-blocking timeout (`yielding: true`), aborting immediately if a user-facing sale transaction requires the bus."*
  
  To a fresh engineer, this sounds like hardware bus arbitration rather than software SQLite semantics. SQLite in WAL mode allows only one active writer transaction across the process. Once `BEGIN IMMEDIATE` or an active write statement begins executing, SQLite cannot "pause" or "yield" mid-statement to an incoming POS query.
  - Is the serialization lane an in-memory Promise queue in Node.js?
  - If a background job is in the middle of a multi-statement batch transaction, does it execute `ROLLBACK` immediately upon a POS request signal?
  - How does the POS transaction signal the queue that it "requires the bus"?
  Without specifying the queue/abort mechanics, this is a hand-wavy explanation that cannot be deterministically implemented.

#### Finding 2: Unclear Frontend-to-Backend Module Boundary
* **Severity**: Major
* **Affected Scope**: Section 5 (Lines 139–141) & Section 6 (Lines 151–154)
* **Discrepancy Description & Rationale**:
  Section 5 states: *"Client modules import identical score metrics and tokenizers exported directly from the shared engine."* referencing `src/utils/orderNameMatcher.ts`.
  Section 6 (Alternative 1) rejects client-side matching because it *"Creates 'matcher drift'. Whenever medicine catalog token rules update... client and server fall out of sync, leading to broken cart additions."*
  In an Electron/Vite + Node/Express architecture:
  - If the client imports code from `src/utils/...`, Vite bundles that code into the client bundle at build time. That is still client-side execution. How does importing from `src/utils/` prevent matcher drift if the client bundle isn't updated or if backend dependencies are leaked?
  - Or does the client call an Express API endpoint `POST /api/match`? If it calls an API endpoint, Alternative 1's rationale ("avoid server roundtrips") contradicts this.
  The document must explicitly clarify the compilation/runtime boundary (isomorphic TypeScript library vs. RPC/HTTP endpoint).

#### Finding 3: Ambiguous Loose Dispensing Logic vs. Indivisible Unit Products
* **Severity**: Major
* **Affected Scope**: Section 4 (Lines 87–88)
* **Discrepancy Description & Rationale**:
  The rule states: *"Hard reject loose tablet sales if `pack_size` is missing, `NULL`, or `< 2`."*
  In retail pharmacy, many products have a pack size of 1 because they are discrete units that are never split (e.g., syrups, eye drops, ointments, insulin pens, suspension bottles).
  - How does the POS recognize whether an item being rung up is a "loose tablet" versus a single-unit bottle?
  - Does the POS line item carry a specific `is_loose: boolean` flag, or does it check `dosage_form` (e.g. tablet/capsule vs syrup)?
  If an item has `pack_size = 1` and a cashier adds 1 unit, does this trigger the hard-reject? The rule must define the exact trigger condition for loose validation.

#### Finding 4: Incomplete Schema Contract for "Walk-In Counter Sale"
* **Severity**: Major
* **Affected Scope**: Section 4 (Lines 93–97), Section 5 (Lines 144–146)
* **Discrepancy Description & Rationale**:
  The document states:
  > *"`POST /sales` refuses saves where `customer_name` or `phone` is empty unless explicitly marked as a 'Walk-In Counter Sale' without creating an artificial `customers` database row."*
  
  In relational schemas, the `sales` table typically has a foreign key `customer_id REFERENCES customers(id)`.
  - Is `sales.customer_id` nullable in `BACKEND SCHEMA SAFETY.md` / `src/database.ts`?
  - Does `sales.customer_name` store a literal string (e.g. `"Walk-In"`) directly on the sale record, or `NULL`?
  - Does the POS frontend send `customer_id: null` with an explicit flag `{ is_walk_in: true }`?
  Without specifying the payload contract and column nullability, an implementer might break foreign key constraints or reintroduce default strings.

#### Finding 5: Undefined Domain Acronyms and Technical Terms
* **Severity**: Nit
* **Affected Scope**: Throughout document (Lines 44, 47, 60, 153, 161)
* **Discrepancy Description & Rationale**:
  The document introduces several domain-specific acronyms and project systems without definition or inline documentation links:
  - Line 44: `syp` (Syrup dosage form indicator).
  - Line 47: `SR` (Sustained Release), `ER` (Extended Release).
  - Line 60: `Pharmarack` (B2B pharmaceutical ordering gateway).
  - Line 153: `PTR/MRP` (Price to Retailer / Maximum Retail Price).
  - Line 161: `SwiftShader` (Google's CPU software rasterizer used for GPU-less Electron rendering).
  While experienced developers in this shop may know them, a naive team member or fresh engineer needs a 1-sentence gloss or reference link for these terms.

#### Finding 6: Vague Performance Criteria Measurement Context
* **Severity**: Nit
* **Affected Scope**: Section 8 (Lines 178–179)
* **Discrepancy Description & Rationale**:
  Criteria 1 states: *"POS sale latency stays `< 120ms`"*.
  It does not define what layer this measures:
  - Is it Express HTTP request-to-response duration?
  - SQLite transaction commit time?
  - Or end-to-end client click-to-rendered-toast latency?
  Specifying the measurement probe (e.g. `POST /api/sales execution time recorded in server logs`) makes the acceptance criteria unambiguously testable.

