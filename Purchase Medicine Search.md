SINGLE IMPLEMENTATION PLAN
FEATURE: Purchase Medicine Search + Existing Medicine Database Structure Optimization
PROJECT: AI-PHARMACY-V3

============================================================
1. PRIMARY OBJECTIVE
============================================================

Optimize the existing Purchase-page medicine search so that the current
>600ms search/load problem is reduced substantially, while preserving the
existing application workflow, database relationships, medicine identity,
Purchase workflow, Inventory workflow, POS restrictions, existing cache,
and frontend UI.

The application already has an existing medicines database/table, existing
Purchase search API, existing Master Database, existing inventory/history
relationships, existing FTS5 search capability, and existing Purchase-side
search/cache behavior.

DO NOT create a second medicine workflow.

DO NOT rebuild the medicine system from the beginning.

DO NOT create a duplicate search architecture.

DO NOT create a duplicate cache.

DO NOT create a new medicine table unless the existing code inspection proves
that it is absolutely required. It is not expected to be required.

The uploaded medicines.csv is to be treated as a reference for the existing
old medicine database structure. Do NOT assume that every CSV column needs
to become part of the application's active search/build structure.


============================================================
2. CURRENT APPLICATION STRUCTURE THAT MUST BE PRESERVED
============================================================

The existing application already contains these relevant structures:

BACKEND:
- src/routes/inventory.ts
  - Existing GET /inventory/catalog-search endpoint.
  - This is the main backend search implementation that must be optimized.

DATABASE:
- src/database.ts
  - Existing medicines table/schema.
  - Existing medicine indexes.
  - Existing purchase/inventory relationships.
  - Existing medicine aliases.
  - Existing FTS5 medicines search structure.
  - Existing denormalized medicine fields such as stock and purchase
    information.

FRONTEND:
- frontend/src/services/api.ts
  - Existing catalogSearch API method.
- frontend/src/pages/Purchases/index.tsx
  - Existing Purchase-page medicine search/selection workflow.
  - Preserve its existing UI and workflow.
- frontend/src/services/dataFetchControl.ts
  - Existing application fetch-control/cache architecture.
  - Do not introduce another fetch/cache system.

EXISTING DATABASE INDEXES ALREADY PRESENT:
- idx_purchase_items_med_batch
- idx_purchase_items_history_lookup
- idx_purchases_id_date_dist
- idx_medicine_aliases_lookup
- idx_medicines_name_nocase
- idx_medicine_aliases_nocase
- idx_inventory_master_store

EXISTING SEARCH:
- medicines name search
- medicine_aliases search
- medicines_fts FTS5 search
- numeric/MRP/strength fallback
- acronym fallback
- JavaScript deduplication/sorting

EXISTING MEDICINE DATA:
The medicines table already contains important precomputed/denormalized
fields used by catalog search, including:
- total_stock
- total_loose_stock
- last_purchase_ptr
- last_distributor_name
- last_purchase_date
- lowest_purchase_ptr
- lowest_distributor_name

These existing fields and relationships must be reused.


============================================================
3. CURRENT BEHAVIOR
============================================================

The current Purchase medicine search calls:

GET /inventory/catalog-search?q=<query>

The backend currently performs multiple search passes.

PASS 1:
Search medicines by name prefix using the existing medicines table.

PASS 1B:
If the first result set is insufficient, search medicine_aliases separately.

PASS 2:
If still insufficient, attempt medicines_fts FTS5 search.

PASS 2 FALLBACK:
If FTS5 cannot provide results, perform broader LIKE-based searching.

PASS 2B:
If still insufficient, perform numeric/MRP/strength or acronym searching.

After these database operations:
- rows are hydrated
- medicine names are normalized
- duplicate medicines are removed
- results are sorted
- results are returned to the frontend

The problem is that one user search can therefore execute several sequential
database operations before the final response is returned.

This is a major contributor to the current >600ms search/load behavior.

The existing FTS5 system is already present, but it is currently used as a
later fallback rather than being used efficiently as part of the primary
fast-search path.

The frontend already has search/cancellation/debounce/cache-related behavior.
That existing workflow must be preserved rather than replaced.


============================================================
4. MEDICINE DATASET REQUIREMENT
============================================================

The Purchase medicine search must continue to provide the complete medicine
selection set required by the existing Purchase workflow.

The searchable Purchase dataset must logically cover:

A. Medicines currently available in inventory

B. Medicines previously purchased by this pharmacy, even when:
   - current stock = 0
   - all existing batches are expired
   - medicine is no longer currently available in stock

C. Medicines present in the Master Database but never previously purchased
   by this pharmacy

These must resolve to the EXISTING medicine identity/medicine_id.

Do not create duplicate medicine records simply because the same medicine
appears through:
- Master Database
- inventory
- purchase history
- aliases
- CSV/import data

Deduplicate using the existing medicine identity/ID and existing application
relationships.

The Purchase workflow must be able to select a Master Database medicine that
has never previously been purchased and continue using the existing Purchase
workflow.

Only a genuinely new medicine that cannot be resolved through the existing
Master Database/medicine structure should use the application's existing
new-medicine creation workflow.


============================================================
5. CSV / OLD DATABASE STRUCTURE RULE
============================================================

The uploaded medicines.csv represents the old medicine data structure that
already exists in the application context.

The agent MUST NOT blindly map all CSV columns into the new build/search
logic.

Before changing any database/schema/import code:

1. Inspect the actual medicines table/schema in src/database.ts.
2. Inspect all existing references to the relevant medicine columns.
3. Inspect Purchase search.
4. Inspect Master Database usage.
5. Inspect Inventory usage.
6. Inspect POS medicine search.
7. Inspect purchase-history queries.
8. Inspect medicine aliases.
9. Inspect FTS5 configuration.
10. Determine which CSV columns are actually required by existing workflows.

Classify CSV columns into:

- REQUIRED BY EXISTING APPLICATION
- REQUIRED BY PURCHASE/MEDICINE SEARCH
- REQUIRED BY DATABASE RELATIONSHIPS
- LEGACY/UNUSED
- NOT REQUIRED FOR SEARCH PAYLOAD

Only the required fields should participate in the optimized search/build
logic.

IMPORTANT:

Do NOT remove live database columns merely because they are not required for
search.

Removing a column from the database can break existing workflows elsewhere.

The safe optimization is to stop unnecessary columns from being selected,
hydrated, transferred, indexed, or processed by the Purchase search where
they are not actually required.

The existing database schema remains the source of truth.


============================================================
6. EXPECTED BEHAVIOR
============================================================

When the user searches a medicine on the Purchase page:

1. Existing Purchase search UI remains exactly as it is.

2. Existing search input/debounce/cancellation behavior remains.

3. Existing Purchase cache must continue to be used.

4. Search should reach the fastest relevant existing search mechanism first,
   rather than unnecessarily executing multiple sequential fallback queries.

5. The backend should retrieve only the fields actually required by the
   existing Purchase workflow.

6. FTS5 should be utilized efficiently where appropriate because it already
   exists in the application.

7. Existing name/prefix search must continue to work.

8. Existing alias search must continue to work.

9. Existing numeric/MRP/strength search behavior must continue to work where
   required.

10. Existing acronym/search normalization behavior must continue to work.

11. Results must remain deduplicated.

12. Existing medicine_id must remain the medicine identity.

13. Master Database medicines must remain searchable for Purchase even if
    they have never been purchased.

14. Historical medicines must remain searchable even when stock is zero or
    batches are expired.

15. Current inventory medicines must remain searchable.

16. POS behavior must NOT change.

17. POS must NOT suddenly display all Master Database medicines merely because
    Purchase search has been broadened.

18. Existing expired/out-of-stock restrictions in POS must remain exactly as
    currently implemented.

19. Existing Inventory behavior must remain unchanged except where the same
    shared backend code is directly required and the change is proven safe.

20. Frontend UI, layout, dropdown design, buttons, labels, styling and
    workflow must remain unchanged.


============================================================
7. PERFORMANCE OPTIMIZATION STRATEGY
============================================================

The primary performance problem is the backend search path.

Optimize src/routes/inventory.ts first.

The agent must inspect the actual execution plan before changing the query.

The goal is to reduce unnecessary sequential database work.

IMPLEMENTATION:

A. PRIMARY SEARCH PATH

Use the fastest existing indexed/FTS search mechanism appropriate for the
query instead of always starting with multiple independent searches.

Do not blindly remove prefix/alias/numeric behavior.

Combine or prioritize existing search mechanisms where SQLite can safely
perform the work in fewer round trips.

The final implementation must preserve the existing search semantics.

B. REDUCE DATABASE ROUND TRIPS

Avoid this pattern where possible:

query database
→ query database again
→ query database again
→ query database again
→ JS merge
→ JS deduplicate
→ JS sort

Prefer an efficient search path that obtains the required result set with
the minimum necessary database operations.

Fallback queries should execute only when actually required.

C. RESULT LIMIT

Keep the existing practical result limit behavior.

Do not return the entire medicines table for every keystroke.

Only return the number of results required by the existing Purchase UI.

D. SELECT ONLY REQUIRED FIELDS

Do not use:

SELECT *

The search query should return only the fields that the existing Purchase
search result/selection workflow actually consumes.

Do not transfer unused CSV/database columns to the frontend.

E. REUSE EXISTING DENORMALIZED DATA

Reuse existing:
- total_stock
- total_loose_stock
- last_purchase_ptr
- last_distributor_name
- last_purchase_date
- lowest_purchase_ptr
- lowest_distributor_name

Do not introduce a second statistics table or duplicate calculation unless
the current architecture absolutely requires it.

F. EXISTING INDEXES

Inspect existing indexes before adding anything.

The following indexes already exist and must not be duplicated:

idx_medicines_name_nocase
idx_medicine_aliases_nocase
idx_medicine_aliases_lookup
idx_purchase_items_med_batch
idx_purchase_items_history_lookup
idx_purchases_id_date_dist
idx_inventory_master_store

Only add a new index if EXPLAIN QUERY PLAN proves that an existing index
cannot support the required optimized query.

Any new index must belong directly to this search optimization and must be
documented.

G. FTS5

The existing medicines_fts system must be inspected and reused.

Determine:
- what columns it indexes
- how it is populated
- whether it supports the required matching
- whether it can safely become the first search path
- whether aliases need to remain a separate lookup
- whether prefix/infix/numeric search requires a controlled fallback

Do not create a second FTS system.

Do not create a second search index.

H. JAVASCRIPT PROCESSING

Reduce unnecessary JavaScript processing after the database returns results.

The database should do as much filtering, limiting and deduplication as is
safe using existing IDs/relationships.

Do not move business logic into a new utility architecture merely for this
optimization.

I. COLD START

Inspect whether the first Purchase search is competing with or waiting for
background/compact inventory cache hydration.

The first authoritative medicine search must not be unnecessarily blocked by
background cache initialization.

Existing cache architecture must remain.

Do not create a new cache.


============================================================
8. PURCHASE FRONTEND BEHAVIOR
============================================================

Inspect:

frontend/src/pages/Purchases/index.tsx

before modifying anything.

Preserve:
- existing search UI
- existing debounce
- existing AbortController/request cancellation
- existing local result narrowing
- existing Purchase cache
- existing selection workflow
- existing new-medicine workflow
- existing batch/purchase loading
- existing error handling

Only modify the frontend if the existing search implementation contains a
specific performance issue directly related to this feature.

Do NOT redesign the Purchase page.

Do NOT replace the current search component.

Do NOT create a second search hook.

Do NOT create a second cache.

Do NOT introduce a new state-management system.


============================================================
9. API FILE
============================================================

Inspect:

frontend/src/services/api.ts

The existing:

catalogSearch(q, signal)

must remain the API entry point unless inspection proves a modification is
necessary.

Do not create another catalog-search API for the same purpose.

If no API change is required, DO NOT modify this file.

If modification is required, make only the smallest change necessary.


============================================================
10. FETCH CONTROL / CACHE
============================================================

Inspect:

frontend/src/services/dataFetchControl.ts

The application already has a fetch-control architecture.

Do not create another cache or another fetch registry.

If the existing Purchase catalog search needs to be integrated into the
existing fetch-control mechanism, modify only the relevant existing entry.

Otherwise, leave this file untouched.

The existing Purchase search cache must be reused.


============================================================
11. DATABASE FILE
============================================================

Inspect:

src/database.ts

Only modify this file if required for:

- correcting an existing search index
- adding a proven missing index
- improving FTS5 configuration/population
- correcting a medicine-search-related schema issue

Do NOT rebuild the medicines table.

Do NOT migrate the entire old database.

Do NOT create duplicate medicine tables.

Do NOT create duplicate FTS tables.

Do NOT remove live columns solely because they are unused by Purchase search.

Do not alter unrelated database tables.


============================================================
12. EXACT FILE-SCOPE RULE
============================================================

The coding agent is STRICTLY LIMITED to these existing files:

PRIMARY:
1. src/routes/inventory.ts

ONLY IF REQUIRED:
2. src/database.ts
3. frontend/src/pages/Purchases/index.tsx
4. frontend/src/services/api.ts
5. frontend/src/services/dataFetchControl.ts

The agent must NOT modify any other file.

The agent must NOT:
- create a new search system
- create a new cache
- create a new medicine table
- create a new API endpoint for the same search
- create a new frontend component
- redesign UI
- modify POS search
- modify unrelated Inventory behavior
- modify unrelated Master Database behavior
- modify authentication
- modify billing
- modify distributor workflow
- modify WhatsApp workflow
- modify unrelated database tables
- modify package dependencies unless absolutely unavoidable

If the agent believes another file is required, it MUST NOT modify it
automatically.

Instead, stop and report the dependency and why it is required.

The objective is controlled modification, not project-wide refactoring.


============================================================
13. NO DUPLICATE WORKFLOW RULE
============================================================

The existing application workflow is the source of truth.

Before writing code, the agent must trace:

Purchase UI
    ↓
existing Purchase search logic
    ↓
frontend catalogSearch()
    ↓
GET /inventory/catalog-search
    ↓
existing medicines / aliases / FTS / inventory / history relationships
    ↓
existing medicine_id
    ↓
existing Purchase selection workflow

The optimization must modify this existing chain.

It must NOT create:

Purchase UI
    ↓
NEW search system
    ↓
NEW API
    ↓
NEW medicine table
    ↓
NEW cache

That would create two competing implementations and eventually produce the
usual software archaeology disaster where nobody knows which system is
authoritative.


============================================================
14. VALIDATION REQUIREMENTS
============================================================

Before declaring completion, the agent must compare OLD behavior vs NEW
behavior.

TEST 1:
Normal medicine-name search.

OLD:
Current >600ms behavior where applicable.

NEW:
Search should return materially faster with the same expected results.

TEST 2:
Prefix search.

Example:
PAN

Verify expected matching medicines remain available.

TEST 3:
Multi-word medicine search.

Verify normalization and existing matching behavior remain unchanged.

TEST 4:
Alias search.

Verify existing medicine_aliases behavior remains.

TEST 5:
MRP/numeric search.

Verify existing numeric search behavior remains.

TEST 6:
Strength search.

Verify existing strength-related matching remains.

TEST 7:
Master Database-only medicine.

Medicine exists in Master Database but has never been purchased.

Verify it is available in Purchase search.

TEST 8:
Historical medicine.

Medicine was purchased previously but current stock = 0.

Verify it remains searchable.

TEST 9:
Expired medicine.

Medicine exists historically but all current batches are expired.

Verify it remains searchable in Purchase where existing workflow requires it.

TEST 10:
Current inventory medicine.

Verify normal inventory medicines continue to appear.

TEST 11:
Duplicate source.

The same medicine exists through:
- Master Database
- inventory
- purchase history
- alias

Verify only one logical medicine result is returned using the existing
medicine identity.

TEST 12:
POS regression.

Verify the Purchase search optimization does NOT cause POS to show:
- Master-only medicines
- zero-stock medicines
- expired medicines

unless the existing POS rules already permit them.

TEST 13:
UI regression.

Verify there is no change to:
- Purchase UI
- search box
- dropdown
- buttons
- styling
- layout
- selection behavior

TEST 14:
Cold-start performance.

Test the first search after application/database startup.

Do not measure only repeated warm-cache searches.

TEST 15:
Warm-cache performance.

Run repeated searches and compare latency.

TEST 16:
Large medicine dataset.

Test against the real/representative existing database size.

Do not validate only against a tiny development database.


============================================================
15. PERFORMANCE MEASUREMENT
============================================================

Add only minimal performance measurement where necessary to determine:

- frontend debounce time
- network/API time
- backend route time
- SQLite query time
- number of database search passes
- post-query processing time
- total catalog-search response time

Do not create a permanent logging framework.

Do not add unnecessary production logging.

The measurement should allow comparison:

OLD:
Request
→ Query 1
→ Query 2
→ Query 3
→ Query 4
→ JS processing
→ Response

NEW:
Request
→ optimized search path
→ minimal processing
→ Response

Acceptance target:

NORMAL SEARCH:
Preferably approximately 200–300ms or lower end-to-end under normal
conditions.

P95:
Target below 600ms for normal Purchase medicine searches.

The exact result depends on database size, machine, disk and cold-start state,
so performance must be measured rather than fabricated.


============================================================
16. OLD VS NEW CODE CROSS-CHECK
============================================================

After implementation, the coding agent MUST perform a direct old-vs-new
behavior cross-check.

For every modified section:

1. Identify what the old code did.
2. Identify what the new code does.
3. Confirm the new code still performs the same required business function.
4. Confirm only the performance path changed where possible.
5. Confirm no UI workflow changed.
6. Confirm no medicine identity changed.
7. Confirm no Purchase workflow was duplicated.
8. Confirm no POS visibility rule changed.
9. Confirm no unrelated file was touched.
10. Confirm no unnecessary CSV/database columns were introduced into the
    search payload.
11. Confirm existing cache was reused.
12. Confirm existing FTS5/indexes were reused where appropriate.
13. Confirm fallback search still exists where required.
14. Confirm Master-only and historical medicines remain available to Purchase.


============================================================
17. FINAL FILE AUDIT
============================================================

Before completion, run a final modification audit.

Expected modified files should be ONLY:

- src/routes/inventory.ts

and, ONLY IF PROVEN NECESSARY:

- src/database.ts
- frontend/src/pages/Purchases/index.tsx
- frontend/src/services/api.ts
- frontend/src/services/dataFetchControl.ts

No other project files may be changed.

If a file was not necessary, leave it unchanged.

The final report must explicitly list:

MODIFIED:
- exact file path
- exact reason it was modified

NOT MODIFIED:
- important related files inspected but intentionally left unchanged

This proves the agent did not perform an unnecessary project-wide refactor.


============================================================
18. FINAL ACCEPTANCE CRITERIA
============================================================

The implementation is complete only when ALL are true:

[ ] Current Purchase search >600ms problem is materially improved.

[ ] Existing Purchase medicine search workflow is preserved.

[ ] Existing Purchase UI is unchanged.

[ ] Existing Purchase cache is reused.

[ ] Existing medicines table remains the source of truth.

[ ] Existing medicine_id remains the medicine identity.

[ ] Master Database-only medicines are searchable in Purchase.

[ ] Historical zero-stock medicines remain searchable in Purchase.

[ ] Expired historical medicines remain searchable in Purchase where required.

[ ] Current inventory medicines remain searchable.

[ ] Duplicate medicine records are not created.

[ ] Existing aliases continue working.

[ ] Existing numeric/MRP/strength behavior continues working.

[ ] Existing FTS5 infrastructure is reused.

[ ] Existing useful indexes are reused.

[ ] No duplicate index is created without proof.

[ ] No unnecessary CSV columns are introduced into the search/build payload.

[ ] No live database column is removed merely for this optimization.

[ ] POS behavior remains unchanged.

[ ] Expired/zero-stock POS restrictions remain unchanged.

[ ] No new duplicate API is created.

[ ] No new duplicate cache is created.

[ ] No new duplicate medicine table is created.

[ ] No unrelated files are modified.

[ ] Cold-start search is tested.

[ ] Warm-cache search is tested.

[ ] Old vs new behavior is cross-checked.

[ ] Final changed-file audit is completed.


============================================================
19. FINAL IMPLEMENTATION PRINCIPLE
============================================================

DO NOT START FROM ZERO.

The existing application already has the required medicine architecture.

The task is:

UNDERSTAND EXISTING STRUCTURE
        ↓
KEEP EXISTING DATABASE / IDENTITY / WORKFLOW
        ↓
REMOVE UNNECESSARY DATA FROM SEARCH PROCESSING
        ↓
OPTIMIZE EXISTING CATALOG-SEARCH QUERY PATH
        ↓
REUSE EXISTING FTS5 + INDEXES + CACHE
        ↓
PRESERVE EXISTING PURCHASE WORKFLOW
        ↓
PRESERVE POS RESTRICTIONS
        ↓
KEEP FRONTEND UI UNCHANGED
        ↓
TEST OLD VS NEW
        ↓
MODIFY ONLY THE MINIMUM REQUIRED FILES

The result must be an optimization of the application's existing medicine
search system, NOT a second implementation of the same business workflow.