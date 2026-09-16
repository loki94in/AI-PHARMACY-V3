============================================================
1. PRIMARY OBJECTIVE
============================================================

Improve the existing database-save behavior for operations such as:

- Saving a bill/invoice
- Saving distributor information
- Saving distributor phone number
- Saving customer information related to a transaction
- Updating inventory as part of a bill/purchase
- Updating related transaction information

The objective is NOT to redesign the application.

The objective is to improve the EXISTING save workflow so that:

1. Existing application workflow remains unchanged.
2. Existing frontend UI remains unchanged.
3. Existing database structure is reused wherever possible.
4. Existing routes/services/repositories/database helpers are reused.
5. No duplicate save system is created.
6. No second parallel implementation is introduced.
7. Only the files directly responsible for the existing save operation are modified.
8. No unrelated files are touched.
9. No dummy/fabricated business data is introduced.
10. Existing functionality must continue working exactly as before, except for the intended reliability/performance improvement.


============================================================
2. IMPORTANT PROJECT ARCHITECTURE TO PRESERVE
============================================================

The existing project is a Node.js + Express + TypeScript backend with:

- SQLite / better-sqlite3 database
- React + Vite frontend
- Backend routes
- Backend services
- Existing database/business logic
- Existing POS/Billing workflow
- Existing distributor/supplier workflow

The repository documentation identifies:

src/
    bootstrap.ts
    server.ts
    routes/
    services/

frontend/
    src/
        pages/

data/
uploads/
dist/

There is also an existing mobile application and website in the repository.

DO NOT modify mobile, website, installer, packaging, unrelated frontend pages,
or unrelated services unless code inspection proves that the specific existing
save workflow actually depends on that file.

The existing backend + frontend architecture must remain the source of truth.

DO NOT create a second database layer merely because a new feature is being added.


============================================================
3. FIRST STEP REQUIRED: CODEBASE DISCOVERY
============================================================

BEFORE WRITING OR MODIFYING CODE:

Trace the CURRENT save workflow from beginning to end.

For BILL SAVE, identify:

Frontend save action
    ↓
Existing API call
    ↓
Existing backend route
    ↓
Existing service/business logic
    ↓
Existing database helper/repository
    ↓
SQLite transaction/write
    ↓
Response
    ↓
Existing frontend state refresh/update

For DISTRIBUTOR PHONE SAVE, identify:

Existing distributor UI/action
    ↓
Existing API call
    ↓
Existing distributor route
    ↓
Existing distributor service/database logic
    ↓
Existing SQLite update
    ↓
Response
    ↓
Existing UI update/refresh

Do NOT assume filenames.

Search the repository and determine the actual files currently responsible for
these operations.

Create an internal dependency map before changing anything.

Only files that participate directly in these workflows may be modified.


============================================================
4. CURRENT BEHAVIOR TO PRESERVE
============================================================

The current application already has an operational billing/POS workflow and
database-backed business data.

The existing workflow must NOT be replaced.

Do not create:

- New billing workflow
- New distributor workflow
- New database architecture
- New POS page
- New save button
- New UI
- New duplicate API
- New duplicate service
- New duplicate database tables unless absolutely required by the existing
  schema and proven necessary

The existing save operation should remain the same from the user's perspective.


============================================================
5. EXPECTED NEW BEHAVIOR
============================================================

The expected behavior is an INTERNAL improvement to the existing workflow.

When the user saves data:

USER
 ↓
EXISTING FRONTEND SAVE ACTION
 ↓
EXISTING API
 ↓
EXISTING BACKEND LOGIC
 ↓
ATOMIC DATABASE OPERATION
 ↓
SUCCESS RESPONSE
 ↓
UPDATE ONLY NECESSARY FRONTEND STATE


The user should NOT experience a different workflow.

The application should simply become:

- Faster
- More reliable
- More consistent
- Less likely to partially save data
- Less likely to perform unnecessary reloads
- Less likely to duplicate database writes
- Less likely to reload unrelated application data


============================================================
6. BILL SAVE IMPLEMENTATION
============================================================

Inspect the existing bill-saving implementation first.

If the current code already uses a transaction, KEEP IT and improve only where
necessary.

If the current bill save performs multiple independent writes, consolidate those
writes into the EXISTING database transaction mechanism where appropriate.

A complete bill save should conceptually behave as one atomic operation:

BEGIN TRANSACTION

    Existing bill creation/update
    Existing bill-item creation/update
    Existing inventory update
    Existing customer/credit update
    Existing payment update
    Existing audit/history update if already part of the workflow

COMMIT

If any required operation fails:

ROLLBACK

The implementation must use the existing tables, fields, business rules and
database helpers wherever possible.

DO NOT duplicate existing database logic into another service.


============================================================
7. DISTRIBUTOR PHONE SAVE
============================================================

Trace the existing distributor save/update workflow.

If distributor information already has a master table/entity, use the existing
distributor record.

The phone number should be saved against the existing distributor master record.

Expected behavior:

User changes distributor phone number
        ↓
Existing distributor save/update function
        ↓
Validate/normalize phone according to existing application rules
        ↓
Existing distributor database update
        ↓
Commit
        ↓
Return updated distributor data
        ↓
Update existing frontend state

DO NOT create another distributor-phone table or duplicate distributor record
unless inspection proves the existing schema genuinely requires it.


============================================================
8. HISTORICAL TRANSACTION DATA
============================================================

Before modifying bill/purchase schemas, inspect how the current application
stores distributor/customer information in historical transactions.

If the existing transaction already stores the required historical information,
reuse it.

If it currently references only the master distributor record, DO NOT introduce
a snapshot field automatically.

Only add a snapshot field if:

1. Existing invoice/PDF/history behavior genuinely requires historical
   distributor information, AND
2. The current schema cannot provide that information reliably, AND
3. The change can be made without breaking existing records.

If a schema change is genuinely required, modify only the database migration/
initialization/schema file already responsible for that table.

Do not create a second schema-management system.


============================================================
9. DATABASE CONNECTION HANDLING
============================================================

Inspect the current SQLite initialization and connection management.

If the application already maintains a shared database connection, keep it.

If database connections are repeatedly initialized for every save operation,
correct that behavior in the existing database initialization/helper file.

Do NOT introduce a second database connection manager.

Use the existing better-sqlite3 implementation.

Keep database initialization centralized.

Existing database configuration, paths and production behavior must remain
unchanged.


============================================================
10. PREPARED STATEMENTS
============================================================

Inspect existing INSERT/UPDATE/SELECT statements.

Where the same operation is repeatedly executed, reuse prepared statements
through the existing database abstraction.

Do not rewrite every SQL query in the application.

Only optimize queries directly involved in:

- Bill save
- Bill item save
- Inventory update triggered by bill save
- Distributor update
- Distributor phone update

Do not touch unrelated queries.


============================================================
11. FRONTEND BEHAVIOR
============================================================

NO UI CHANGE.

Do not modify:

- Layout
- Colors
- Buttons
- Forms
- Page structure
- Navigation
- Existing labels
- Existing visual design
- Existing user workflow

Only modify frontend code if it is directly responsible for unnecessary
post-save reloading or incorrect state handling.

After successful save:

DO NOT automatically reload the entire page.

DO NOT reload unrelated modules.

DO NOT refetch the entire database.

DO NOT recreate the complete application state.

Instead, use the existing state-management pattern already present in the
specific page/component.

Example:

Existing distributor:
{
    id,
    name,
    phone
}

After save:

Update only the distributor object already displayed by the existing UI.

Do not introduce a new global state-management system.


============================================================
12. REMOVE UNNECESSARY POST-SAVE REFRESH
============================================================

Inspect what happens after:

- Bill save
- Distributor save
- Distributor phone save

If the existing implementation does:

SAVE
 ↓
FULL PAGE REFRESH
 ↓
RELOAD ALL DATA
 ↓
RENDER EVERYTHING AGAIN

replace ONLY that unnecessary refresh behavior with the smallest possible
targeted update.

For example:

SAVE
 ↓
API returns saved record / ID
 ↓
Update affected state
 ↓
Continue existing workflow

Do not change any other refresh behavior that is required for correctness.


============================================================
13. API RESPONSE
============================================================

Inspect the existing API response structure.

If the current response already contains sufficient information for the
frontend to update itself, reuse it.

Do NOT create a new API response format unnecessarily.

If the response does not provide a required identifier or updated record,
make the smallest compatible change to the EXISTING endpoint response.

Backward compatibility must be maintained for existing callers.

Do not create a duplicate endpoint such as:

/save-bill-v2
/save-distributor-v2

unless there is an unavoidable compatibility reason.

The existing endpoint should be improved.


============================================================
14. ERROR HANDLING
============================================================

Improve only the existing error handling around the affected operations.

Expected behavior:

Database succeeds:
    Return existing success response.

Database fails:
    Roll back the transaction.
    Return existing compatible error response.
    Do not leave partially written business data.

Frontend receives failure:
    Keep the existing user-visible error mechanism.

DO NOT introduce a new notification framework or new UI component.


============================================================
15. DUPLICATE SAVE PROTECTION
============================================================

Inspect whether the current bill-save workflow can accidentally execute twice
because of:

- Double-click
- Multiple API requests
- Retry behavior
- Component re-render
- Network retry
- Event handler duplication

If duplicate execution is possible, fix it only in the existing save path.

Prefer an existing bill/invoice identifier, transaction identifier, or existing
unique database constraint if one already exists.

Do not create an unrelated duplicate-detection system.


============================================================
16. DATABASE CONSISTENCY
============================================================

For every affected save operation, verify:

- Bill exists after successful save.
- Bill items exist.
- Inventory reflects the transaction.
- Customer credit/payment information remains consistent.
- Distributor information is updated correctly.
- Existing history/audit information remains correct.
- Failed transactions do not leave partial records.

The implementation must preserve all existing pharmacy business rules.


============================================================
17. PERFORMANCE REQUIREMENT
============================================================

Do not optimize by removing required business operations.

Optimize unnecessary work.

The preferred sequence is:

Database operation
    ↓
Commit
    ↓
Return response
    ↓
Targeted frontend update

Avoid:

Database operation
    ↓
Commit
    ↓
Reload entire database
    ↓
Reload every page/module
    ↓
Render everything

The exact performance should be measured before and after the change.

Do not claim a performance improvement without measuring it.


============================================================
18. FILE MODIFICATION RESTRICTION
============================================================

THIS IS A HARD REQUIREMENT.

The coding agent MUST NOT modify files outside the directly affected
implementation path.

Before editing, identify the exact files.

The expected categories are:

1. Existing bill/POS route file
2. Existing bill/POS service/business-logic file
3. Existing database/repository/helper file used by bill save
4. Existing distributor route file
5. Existing distributor service/database file
6. Existing frontend component/page only if required for targeted state update
7. Existing schema/migration file ONLY if a schema change is proven necessary

These are categories, NOT permission to create arbitrary files.

The agent must determine the actual filenames from the repository.

DO NOT modify unrelated files.

DO NOT modify:

- Other frontend pages
- Mobile app
- Website
- Installer
- Electron leftovers
- Build scripts
- Packaging
- Catalog system
- OCR
- WhatsApp
- Email
- AI services
- Authentication
- Unrelated database tables
- Unrelated routes
- Unrelated services
- Unrelated UI

unless code inspection proves that the specific save workflow directly depends
on that file.


============================================================
19. NO NEW DUPLICATE ARCHITECTURE
============================================================

The following are explicitly prohibited:

NEW billing service parallel to existing billing service
NEW distributor service parallel to existing distributor service
NEW database wrapper parallel to existing database wrapper
NEW repository system if an existing repository/data-access layer already exists
NEW API endpoint for functionality already provided by an existing endpoint
NEW frontend state-management system
NEW UI workflow
NEW duplicate tables
NEW duplicate save functions

The existing implementation must be extended/refactored in place.


============================================================
20. NO FRONTEND UI REDESIGN
============================================================

The frontend appearance and workflow must remain exactly as currently available.

The coding agent must not:

- Redesign pages
- Move controls
- Rename buttons
- Add new panels
- Add new modals
- Change CSS
- Change Tailwind classes unnecessarily
- Change navigation
- Change forms

Frontend modifications are permitted ONLY if technically required to stop
unnecessary full refreshes or correctly consume the existing save response.


============================================================
21. TESTING
============================================================

After implementation, test ONLY the affected workflows first.

Test:

A. Distributor phone save

1. Open existing distributor.
2. Change phone number.
3. Save.
4. Confirm database contains new number.
5. Confirm UI displays new number.
6. Refresh application.
7. Confirm number remains correct.

B. Bill save

1. Create normal bill using existing workflow.
2. Save.
3. Confirm bill is created.
4. Confirm bill items are correct.
5. Confirm inventory is correct.
6. Confirm customer/credit information is correct where applicable.
7. Confirm existing invoice/PDF workflow still works.
8. Confirm no duplicate bill is created.

C. Failure test

Force a controlled database/business failure in development only.

Confirm:

- Transaction rolls back.
- No partial bill remains.
- Inventory is not partially modified.
- Existing error handling still works.

D. Regression test

Confirm existing:

- POS
- Inventory
- Purchases
- Distributor management
- Customer/CRM
- Billing history

continue to work.

Do not modify unrelated functionality simply because it was discovered during
testing unless it is directly caused by this change.


============================================================
22. BEFORE/AFTER CROSS-CHECK
============================================================

After completing the code, the coding agent MUST perform a direct old-vs-new
comparison.

For each modified file, document internally:

FILE:
    <actual path>

OLD BEHAVIOR:
    <what the existing code did>

NEW BEHAVIOR:
    <what changed>

WHY:
    <specific reason for the change>

UNCHANGED:
    <what existing workflow remains untouched>

DEPENDENCIES:
    <which directly related files interact with this change>


Example:

OLD:
    Bill save writes multiple related records and then triggers a complete
    data refresh.

NEW:
    Existing bill save performs the related writes atomically and returns the
    existing save response, while the frontend updates only the affected state.

UNCHANGED:
    POS UI, bill workflow, pricing, discount logic, tax logic and invoice
    generation remain unchanged.


============================================================
23. FINAL FILE AUDIT
============================================================

Before finishing, run a final modified-file check.

The agent must list:

MODIFIED FILES:
    <only directly related files>

NEW FILES:
    <preferably none>

DELETED FILES:
    <preferably none>

For every modified file, explain why it was required.

If an unrelated file was accidentally modified, revert that modification before
completion.

The final implementation must leave the repository with only the minimum
necessary changes.


============================================================
24. FINAL FUNCTIONAL COMPARISON
============================================================

The coding agent must verify the following:

                    OLD                         NEW

Bill Save           Existing workflow          Same workflow
Database            Existing DB                 Same DB
Tables              Existing tables             Same tables where possible
API                 Existing API                Existing API improved
Distributor         Existing distributor       Same distributor
Phone Save          Existing save              Existing save improved
UI                  Existing UI                 UNCHANGED
POS                  Existing POS               UNCHANGED
Inventory            Existing logic             UNCHANGED business rules
Customer/CRM         Existing logic             UNCHANGED
Invoice/PDF          Existing workflow          UNCHANGED
Refresh              Existing refresh           Targeted only where safe
Transaction          Existing behavior          Atomic where required
Error handling       Existing mechanism         Preserved/improved
Architecture         Existing architecture      SAME architecture
Files                Existing files             ONLY related files modified


============================================================
25. FINAL ACCEPTANCE CRITERIA
============================================================

Implementation is complete ONLY when:

[ ] Existing bill workflow still works.
[ ] Existing distributor workflow still works.
[ ] Distributor phone saves correctly.
[ ] Bill saves atomically where multiple related writes are required.
[ ] No partial bill data is left after a failed transaction.
[ ] Inventory remains consistent.
[ ] Existing customer/credit behavior remains correct.
[ ] Existing invoice/PDF behavior remains correct.
[ ] No unnecessary full-page reload occurs after the affected save operations.
[ ] No unnecessary full-database refresh occurs.
[ ] No duplicate API/workflow was created.
[ ] No duplicate database architecture was created.
[ ] No frontend UI redesign occurred.
[ ] No dummy/fabricated business data was introduced.
[ ] Existing database is reused.
[ ] Existing tables are reused wherever possible.
[ ] Existing API endpoints are reused.
[ ] Existing services are reused.
[ ] Only directly related files were modified.
[ ] All unrelated modifications are reverted.
[ ] Old-vs-new behavior was cross-checked.
[ ] Final modified-file audit was completed.


============================================================
26. MOST IMPORTANT AGENT RULE
============================================================

DO NOT START FROM SCRATCH.

DO NOT BUILD A NEW SYSTEM BESIDE THE EXISTING SYSTEM.

FIRST UNDERSTAND THE CURRENT CODE.

FIND THE EXISTING BILL SAVE PATH.
FIND THE EXISTING DISTRIBUTOR SAVE PATH.
FIND THE EXISTING DATABASE ACCESS PATH.
FIND THE EXISTING FRONTEND REFRESH/STATE UPDATE PATH.

THEN MODIFY ONLY THOSE EXISTING FILES AND FUNCTIONS REQUIRED TO ACHIEVE
THE DESIRED BEHAVIOR.

The desired outcome is:

EXISTING WORKFLOW
        +
MINIMUM TARGETED CODE IMPROVEMENT
        =
FASTER + SAFER SAVE OPERATION

NOT:

EXISTING WORKFLOW
        +
NEW WORKFLOW
        +
NEW DATABASE SYSTEM
        +
NEW UI
        =
DUPLICATED APPLICATION LOGIC

The existing application structure is the source of truth. Preserve it.
Reuse it. Improve it in place.