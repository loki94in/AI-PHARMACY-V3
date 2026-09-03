AGENTS.md RULE — DATABASE / BACKEND SCHEMA SAFETY
================================================

ISSUE:
A backend feature can be implemented in application code while the required SQLite database table, column, index, constraint, or migration is missing.

Example:

Feature:
Customer Portal Login

Backend code:
SELECT ... FROM customer_portal_accounts

Actual SQLite database:
customer_portal_accounts table does not exist

Result:
SQLITE_ERROR: no such table: customer_portal_accounts
Error code: 1

This is a DATABASE SCHEMA / APPLICATION CODE MISMATCH.

It can also appear as:

- no such table
- no such column
- no such index
- missing constraint
- missing foreign key
- migration not applied
- schema version mismatch
- database initialization mismatch
- fresh-install database mismatch
- existing-database migration failure

================================================
MANDATORY RULE FOR EVERY NEW FEATURE
================================================

Whenever an agent creates or modifies a feature that uses persistent data, the agent MUST treat the following as ONE complete implementation:

FEATURE
→ BACKEND CODE
→ DATABASE SCHEMA
→ MIGRATION
→ INDEXES
→ CONSTRAINTS
→ SEED/DEFAULT DATA IF REQUIRED
→ DATABASE INITIALIZATION
→ RUNTIME VERIFICATION
→ TESTS

The feature is NOT complete until every part of this chain is verified.

================================================
1. BEFORE WRITING BACKEND CODE
================================================

The agent MUST first inspect:

- Current database engine
- Current database file/location
- Current schema
- Current migration system
- Current schema version
- Existing tables
- Existing columns
- Existing indexes
- Existing foreign keys
- Existing initialization code
- Existing database tests

The agent MUST NOT assume that a table or column exists because a TypeScript/JavaScript interface, model, query, or route references it.

CODE REFERENCE ≠ DATABASE EXISTENCE.

================================================
2. WHEN A NEW DATABASE ENTITY IS REQUIRED
================================================

If a feature requires a new table:

Example:

customer_portal_accounts

the agent MUST create the corresponding database migration/schema change.

The agent must verify:

- table exists
- required columns exist
- primary key exists
- foreign keys exist where required
- unique constraints exist where required
- indexes exist where required
- default values exist where required
- nullable/non-nullable rules are correct

Do not create only the backend query.

================================================
3. WHEN AN EXISTING TABLE IS MODIFIED
================================================

If the feature requires:

- new column
- changed column
- new index
- new constraint
- new relationship

the agent MUST create the appropriate migration using the project's existing migration mechanism.

Do NOT simply change application code and assume the existing production database will magically update itself.

Humans have invented databases, then somehow decided databases should guess what humans meant. They do not.

================================================
4. MIGRATION RULE
================================================

Never bypass the existing migration system.

Use the project's existing:

- schema versioning
- migration numbering
- migration runner
- database initialization
- upgrade mechanism

The migration must be:

- deterministic
- repeatable/safely guarded according to the project's migration architecture
- compatible with existing data
- tested
- committed together with the feature code

================================================
5. NEW DATABASE MUST BE TESTED
================================================

Every feature requiring database changes MUST be tested against a FRESH DATABASE.

Test:

NEW DATABASE
→ APPLICATION START
→ MIGRATION/INITIALIZATION
→ REQUIRED TABLES CREATED
→ REQUIRED COLUMNS CREATED
→ REQUIRED INDEXES CREATED
→ FEATURE EXECUTES

The feature must work from an empty/fresh installation.

================================================
6. EXISTING DATABASE MUST BE TESTED
================================================

Every database-changing feature MUST also be tested against an EXISTING DATABASE.

Test:

OLD DATABASE
→ APPLICATION UPDATE
→ MIGRATION
→ NEW SCHEMA
→ EXISTING DATA PRESERVED
→ NEW FEATURE WORKS

Verify:

- no data loss
- no duplicate records
- no broken tables
- no broken indexes
- no broken foreign keys
- no broken existing queries
- no broken existing features

================================================
7. PRODUCTION-LIKE VERIFICATION
================================================

Before declaring completion, the agent MUST test the feature against a database configuration that matches the application's real runtime environment as closely as possible.

Do not test only against:

- mocked database
- temporary in-memory database
- development-only database

If the application uses SQLite in production, test against the actual SQLite schema/database initialization path used by the application.

If the application has separate development and production database initialization, test both where relevant.

================================================
8. BACKEND ↔ DATABASE VERIFICATION
================================================

For every new backend feature, the agent MUST trace:

FRONTEND
→ API/ROUTE
→ SERVICE
→ DATABASE QUERY
→ TABLE
→ COLUMN
→ INDEX/CONSTRAINT
→ RESULT

Every referenced database object must be verified.

For example:

POST /customer-portal/login
→ authentication service
→ customer_portal_accounts
→ email column
→ password/authentication fields
→ indexes/constraints
→ account result

The agent must confirm that every referenced database object actually exists.

================================================
9. INDEXING RULE
================================================

Whenever a feature introduces a database query that will search/filter/sort/join data frequently, the agent MUST evaluate whether an index is required.

The agent must not:

- forget required indexes
- create unnecessary indexes
- assume an index exists
- add indexes blindly

For each important query, determine:

- What columns are searched?
- What columns are filtered?
- What columns are joined?
- What columns are unique?
- Does an existing index already cover the query?
- Is a new index actually required?

If a new index is required, include it in the migration.

================================================
10. FOREIGN KEY / RELATIONSHIP RULE
================================================

Whenever new data relates to an existing entity, verify the relationship.

Example:

customer_portal_accounts
→ customer
→ store
→ order

The agent must determine whether:

- foreign key is required
- cascading behaviour is required
- deletion behaviour is safe
- orphan records are possible

Do not create relationships only in application code while leaving the database without the required structure.

================================================
11. DEFAULT / SEED DATA RULE
================================================

If a new feature requires default records/configuration:

the agent MUST determine how the existing project handles seed/default data.

Examples:

- default store
- default configuration
- system settings
- status definitions

If required, include the initialization/migration logic.

Do not assume the application will automatically have required default records.

================================================
12. DATABASE INITIALIZATION RULE
================================================

A new feature must work when the application starts for the first time.

Verify:

APPLICATION START
→ DATABASE OPEN
→ DATABASE INITIALIZATION
→ MIGRATIONS
→ REQUIRED SCHEMA
→ FEATURE AVAILABLE

The application must not start successfully while silently leaving required database objects missing.

================================================
13. RUNTIME SCHEMA CHECK
================================================

For important database-dependent features, the agent should verify the required schema at runtime through the existing database initialization/validation architecture where appropriate.

If a required table is missing:

FAIL CLEARLY.

Do not silently ignore the error.

Do not return fake data.

Do not disable the feature without reporting the real problem.

================================================
14. NO "NO SUCH TABLE" ACCEPTANCE
================================================

The following errors are BLOCKING ERRORS:

SQLITE_ERROR: no such table
SQLITE_ERROR: no such column
SQLITE_ERROR: no such index

Also treat equivalent PostgreSQL/MySQL/database errors as blocking schema errors.

An agent MUST NOT declare the feature complete while any of these occur in the intended supported environment.

================================================
15. NO SILENT DATABASE FALLBACK
================================================

Do NOT "fix" a missing database table by:

- catching the error and returning []
- returning fake data
- skipping the database operation
- silently creating incomplete data
- disabling the feature
- hiding the error from the user
- changing the query to avoid the missing table

The correct solution is to fix the schema/migration/initialization problem.

================================================
16. FEATURE COMPLETION CHECKLIST
================================================

Before declaring ANY database-backed feature complete:

[ ] Backend code implemented
[ ] Required tables identified
[ ] Required columns identified
[ ] Required indexes identified
[ ] Required constraints identified
[ ] Required relationships identified
[ ] Migration created/updated
[ ] Migration registered with existing migration system
[ ] Migration executed successfully
[ ] Fresh database tested
[ ] Existing database tested
[ ] Existing data verified
[ ] Backend queries verified
[ ] Runtime database path verified
[ ] API tested
[ ] Frontend flow tested
[ ] Error handling tested
[ ] Build passed
[ ] Type check passed
[ ] Tests passed
[ ] Production-like database tested
[ ] Database schema rechecked after implementation
[ ] Git diff checked
[ ] No unrelated files modified

================================================
17. MANDATORY POST-IMPLEMENTATION DATABASE AUDIT
================================================

After implementation, the agent MUST re-check the actual database.

Do not rely only on source code.

Verify:

TABLES
→ exist

COLUMNS
→ exist

INDEXES
→ exist

CONSTRAINTS
→ exist

FOREIGN KEYS
→ exist where required

MIGRATION VERSION
→ correct

DATA
→ preserved

FEATURE
→ works

================================================
18. COMPLETE FEATURE LOOP
================================================

Every database-backed feature must be verified as:

REQUIREMENT
↓
DATABASE DESIGN
↓
MIGRATION
↓
DATABASE INITIALIZATION
↓
BACKEND
↓
API
↓
FRONTEND
↓
RUNTIME DATABASE
↓
REAL FEATURE TEST
↓
EXISTING FEATURE REGRESSION
↓
FINAL DATABASE AUDIT

The agent must not stop at:

REQUIREMENT
↓
BACKEND CODE

================================================
19. REGRESSION PROTECTION
================================================

A new database migration must not break existing systems.

After every database change, test relevant existing functionality.

For AI Pharmacy V3 this includes, where affected:

- Medicine Master
- Medicine Search
- POS
- Billing
- Purchase
- Inventory
- Orders
- Distributor data
- Pharmarack
- WhatsApp
- Quick Access
- Existing migrations
- Existing application startup
- Existing catalogue
- Existing customer functionality

================================================
20. FILE-SCOPE RULE
================================================

Database safety does NOT mean the agent can modify every database file.

Only modify:

- directly related backend files
- directly related database files
- required migration files
- directly related frontend files
- directly related tests

Do not perform unrelated refactoring.

Do not change unrelated database tables.

Do not change unrelated migrations.

Do not rewrite the database architecture.

================================================
21. ATOMIC FEATURE RULE
================================================

A feature must be implemented as one complete unit.

BAD:

Backend code
✓

Frontend
✓

Migration
✗

Database:
Missing table

GOOD:

Backend
✓
Frontend
✓
Migration
✓
Schema
✓
Indexes
✓
Initialization
✓
Runtime verification
✓
Fresh database test
✓
Existing database test
✓
Regression test
✓

Only the second state is COMPLETE.

================================================
22. CUSTOMER PORTAL EXAMPLE
================================================

For a feature such as:

CUSTOMER PORTAL ACCOUNT / LOGIN

The agent must verify the complete chain:

CUSTOMER PORTAL UI
↓
LOGIN API
↓
ACCOUNT SERVICE
↓
customer_portal_accounts TABLE
↓
required columns
↓
required indexes/constraints
↓
migration
↓
database initialization
↓
actual SQLite database
↓
CREATE ACCOUNT
↓
LOGIN
↓
SESSION/AUTH FLOW
↓
LOGOUT
↓
RE-LOGIN

If the application produces:

"no such table: customer_portal_accounts"

the feature is NOT COMPLETE.

The agent must stop completion reporting and fix the missing schema/migration/initialization issue.

================================================
23. FINAL AGENT RULE
================================================

NO BACKEND FEATURE IS COMPLETE UNTIL ITS DATABASE DEPENDENCIES ARE VERIFIED IN THE ACTUAL DATABASE.

Every agent must ask internally:

"Did I create the code?"

AND:

"Did I create the database structure?"

AND:

"Did I create/register the migration?"

AND:

"Did the migration actually run?"

AND:

"Does the actual runtime database contain the required table/column/index?"

AND:

"Did I test it with a fresh database?"

AND:

"Did I test it with an existing database?"

AND:

"Did I verify that existing functionality still works?"

If any answer is NO:

THE FEATURE IS NOT COMPLETE.

================================================
24. FINAL MANDATORY REPORT
================================================

Every database-backed feature must finish with:

DATABASE CHANGES:
- Tables:
- Columns:
- Indexes:
- Constraints:
- Foreign keys:
- Migration:
- Schema version:

VERIFICATION:
- Fresh database: PASS/FAIL
- Existing database migration: PASS/FAIL
- Runtime database: PASS/FAIL
- Backend API: PASS/FAIL
- Frontend flow: PASS/FAIL
- Existing feature regression: PASS/FAIL

SCHEMA ERRORS:
- no such table: NONE
- no such column: NONE
- no such index: NONE
- migration errors: NONE

FILE SCOPE:
- Modified files:
- New files:
- Unrelated files modified: MUST BE NONE

================================================
FINAL RULE
================================================

"CODE COMPLETE" DOES NOT MEAN "FEATURE COMPLETE".

The feature is complete only when:

CODE
+
DATABASE
+
MIGRATION
+
INDEXES
+
INITIALIZATION
+
RUNTIME
+
TESTING
+
REGRESSION VERIFICATION

are ALL complete and verified.

Never allow a backend feature to be merged/deployed when its required database schema has not been created and verified in the actual application database.