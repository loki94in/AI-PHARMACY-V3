SINGLE IMPLEMENTATION PLAN
FEATURE: ONE UNIVERSAL MEDICINE CATALOG USING THE EXISTING CATALOG + BOTH CSV DATASETS

========================================================
1. OBJECTIVE
========================================================

Build one Universal Catalog for the entire AI Pharmacy application by
combining the useful medicine information from the two provided datasets
without creating duplicate medicine records or a second catalog.

The Universal Catalog must remain the single medicine master used by:

- POS
- Inventory
- Purchase
- Refill
- Special Order
- Request Medicine
- Website / Online Catalog
- Customer ordering
- Medicine image/search workflows

DO NOT rebuild these workflows.

Reuse the existing application's database, catalog services, APIs,
medicine IDs, search logic, image handling, POS/refill/special-order
workflows and website catalog wherever they already exist.

The objective is to CONNECT AND ENRICH the existing system, not create
another parallel implementation.


========================================================
2. CURRENT APPLICATION BEHAVIOR
========================================================

The application already has an existing Universal/medicine catalog
structure and existing medicine-related workflows.

Existing application areas that must be preserved include:

- Existing catalog/database
- Existing catalog API
- Existing catalog image functionality
- Existing POS
- Existing inventory
- Existing purchase
- Existing refill workflow
- Existing Special Order workflow
- Existing Request Medicine workflow
- Existing customer portal
- Existing online catalog / website
- Existing customer authentication
- Existing store/tenant selection
- Existing pharmacy-specific inventory data

The application already has related files/services such as:

- frontend/src/pages/CustomerPortal/PublicCatalogView.tsx
- frontend/src/pages/CustomerPortal/index.tsx
- frontend/src/api/catalogApi.ts
- src/routes/catalog.ts
- src/routes/catalogImages.ts
- src/routes/customerPortal.ts
- src/services/storeContextService.ts

These existing files are examples of the current architecture and must
be reused where the requested behavior belongs.

Do not create another catalog system beside the existing catalog.

Do not create separate medicine master tables for:

- Website
- Refill
- Special Order
- Request Medicine
- POS

All of those workflows must reference the same Universal Catalog medicine
identity.


========================================================
3. TWO DATASETS TO BE INTEGRATED
========================================================

The user has provided:

A. medicine_data.csv

B. medicines.csv

The implementation must first inspect the actual column structure and
existing database mapping before writing the import/merge logic.

DO NOT assume that every CSV column should become a database column.

DO NOT blindly append medicine_data.csv to medicines.csv.

Instead:

    Existing Universal Catalog
             +
    medicines.csv
             +
    medicine_data.csv
             ↓
       Matching / Deduplication
             ↓
       Existing medicine record
             OR
       New validated medicine record
             ↓
       ONE Universal Catalog


========================================================
4. PRIMARY RULE: ONE MEDICINE = ONE CATALOG ID
========================================================

Every medicine must have ONE canonical Universal Catalog identity.

All other workflows reference that identity.

Example:

    Universal Catalog
        medicine_id = ABC123
        Medicine = Paracetamol 500 mg

Then:

    POS
       → medicine_id ABC123

    Refill
       → medicine_id ABC123

    Special Order
       → medicine_id ABC123

    Request Medicine
       → medicine_id ABC123

    Website
       → medicine_id ABC123

NEVER create another medicine record simply because the medicine came
from a different workflow.


========================================================
5. DUPLICATE DETECTION / MERGE RULE
========================================================

The import process must NOT use only medicine name matching.

Use a controlled matching hierarchy.

Priority:

1. Existing unique medicine ID
2. Existing MDM ID
3. Existing UCode
4. Barcode
5. Strong combination of normalized:
   - medicine name
   - manufacturer
   - strength
   - composition
   - packaging
6. Controlled fuzzy matching only where appropriate

Normalize before matching:

- uppercase/lowercase differences
- extra spaces
- punctuation
- common formatting differences
- tablet/capsule/strip terminology
- strength formatting
- packaging formatting

Example:

    "PARACETAMOL 500 MG TAB"
    "Paracetamol 500mg Tablet"

may represent the same medicine if the other identifying information
also confirms the match.

BUT:

    Paracetamol 500 mg
    Paracetamol 650 mg

must remain separate.

Similarly:

    Brand A 10 Tablets
    Brand A 15 Tablets

must not automatically be merged if packaging represents a different
catalog product.

Never perform a destructive fuzzy merge.

If the system is uncertain, mark the record for review instead of
merging it automatically.


========================================================
6. DATA PRIORITY
========================================================

Existing operational pharmacy data must have priority over imported
reference information.

Do NOT overwrite existing live pharmacy data blindly.

The import must distinguish between:

A. MASTER / REFERENCE DATA

Examples:

- medicine name
- generic/salt
- strength
- manufacturer
- description
- composition
- side effects
- drug information
- images
- packaging information

and:

B. PHARMACY OPERATIONAL DATA

Examples:

- current stock
- purchase price
- selling price
- pharmacy-specific MRP
- inventory quantity
- batch
- expiry
- store availability
- live status
- pharmacy-specific settings

Imported reference data must not accidentally replace operational
pharmacy information.


========================================================
7. UNIVERSAL CATALOG DATA MODEL
========================================================

Reuse the existing medicine/catalog schema wherever possible.

Only add a database field if an existing field cannot represent the
required behavior.

Potential logical groups:

IDENTITY

- medicine_id
- MDM ID
- UCode
- barcode
- canonical medicine name

PRODUCT INFORMATION

- generic/salt
- strength
- dosage/form
- manufacturer
- packaging
- category

REFERENCE INFORMATION

- description
- indications
- side effects
- interactions
- other existing reference fields

IMAGE INFORMATION

- existing image fields
- existing image URLs
- image validation/status

ONLINE CONTROLS

- online visibility
- special-order availability
- online searchable status

Do not add duplicate columns if the existing database already has an
equivalent field.


========================================================
8. ONLINE MEDICINE VISIBILITY
========================================================

The website must NOT have a separate medicine catalog.

The website must consume the Universal Catalog.

A pharmacy can explicitly select a medicine from the Universal Catalog
and mark it:

    Show Online = ON

That medicine becomes available on the website for that pharmacy,
subject to the existing store/online rules.

The pharmacy must not need to recreate the medicine in another catalog.


========================================================
9. SPECIAL ORDER BEHAVIOR
========================================================

Existing Special Order functionality must continue to use the same
Universal Catalog.

If a medicine is already present in the Universal Catalog and a customer
creates a Special Order:

    Special Order
          ↓
    existing medicine_id

DO NOT create another medicine.

Where the existing application's Special Order rules permit it,
Special Order medicines should be discoverable/searchable online.

The website can therefore allow another customer to search for and
request/order the same medicine.

The website must never expose:

- previous customer's name
- previous customer's phone number
- previous customer's prescription
- previous customer's refill information
- previous customer's order information

Only the public medicine/catalog information may be exposed.


========================================================
10. REQUEST MEDICINE WORKFLOW
========================================================

Reuse the existing Request Medicine workflow.

Do NOT create another medicine-request system.

The customer can currently/requested behavior:

- Search medicine by name
- Upload medicine photograph
- Upload prescription/photo
- Enter medicine name manually

The system should first search the Universal Catalog.

Example:

    Customer enters:
    "Medicine XYZ"

             ↓

    Universal Catalog Search

             ↓

       Match found?
        /       \
      YES       NO
       |         |
       ↓         ↓
 existing     Existing
 medicine_id  request workflow


If a match is found:

    use existing medicine_id

Do NOT create a duplicate medicine.

If no match is found:

    retain the request in the existing Request Medicine/Special Order
    workflow according to the current application behavior.

A new catalog medicine should only be created after the existing
application's appropriate validation/approval process.


========================================================
11. MEDICINE PHOTO SEARCH
========================================================

Reuse the existing AI Camera / Request Medicine functionality.

The image uploaded by the customer should be used to improve medicine
identification/search.

The target flow is:

    Medicine Photo
          +
    Optional prescription
          +
    Optional typed medicine name
          ↓
    Existing AI extraction/search
          ↓
    Universal Catalog matching
          ↓
    Existing medicine_id
          ↓
    Existing order/request workflow

Do not create a second AI medicine database just for camera extraction.

The AI should identify/search against the Universal Catalog.


========================================================
12. REFILL WORKFLOW
========================================================

Refill must continue using the existing refill/customer data structure.

The medicine itself comes from:

    Universal Catalog

Customer-specific information remains separate:

    Customer
       ↓
    Refill record
       ↓
    medicine_id
       ↓
    Universal Catalog

Do not put customer refill information into the public catalog.

Do not create a separate refill medicine catalog.


========================================================
13. WEBSITE WORKFLOW
========================================================

Website:

    Customer
       ↓
    Select Pharmacy
       ↓
    Universal Catalog filtered by selected pharmacy
       ↓
    Online-enabled / Special Order medicines
       ↓
    Search medicine
       ↓
    Select existing medicine
       ↓
    Existing order / Special Order / Refill workflow


The website must respect the selected pharmacy/store.

Do not expose the entire local pharmacy database publicly.

Only the required public catalog information should be exposed.


========================================================
14. STORE / MULTI-PHARMACY RULE
========================================================

Reuse the existing store/tenant architecture.

Existing concepts such as:

- stores
- activeStore
- accessibleStores
- store context
- tenant authorization

must remain the source of truth.

Online visibility should be pharmacy/store-specific where required.

Example:

    Universal Medicine
          │
          ├── Pharmacy A → Online ON
          ├── Pharmacy B → Online OFF
          └── Pharmacy C → Online ON

Do not duplicate the medicine itself for each pharmacy.

Only store-specific availability/settings should vary.


========================================================
15. IMAGE HANDLING
========================================================

Reuse the application's existing catalog image architecture.

Do not store duplicate image copies for:

- POS
- Refill
- Special Order
- Website

One catalog medicine should reference its appropriate image information.

If external/object storage is already supported, use the existing
implementation.

If an image-storage change is genuinely required, modify only the
existing image/catalog-related files.

Do not introduce a new image system unless the current system cannot
support the required website behavior.


========================================================
16. IMPORT / MIGRATION IMPLEMENTATION
========================================================

Create the import/merge logic only in the existing database/catalog
migration/import area.

Before importing:

1. Inspect existing catalog schema.
2. Inspect both CSV schemas.
3. Map CSV fields to existing catalog fields.
4. Identify duplicate keys.
5. Normalize values.
6. Run duplicate detection.
7. Produce match categories:

   - EXACT MATCH
   - STRONG MATCH
   - POSSIBLE MATCH
   - NEW RECORD

8. Automatically merge only safe matches.
9. Do not automatically merge POSSIBLE MATCH records.
10. Preserve existing operational values.
11. Log every merge/create decision.
12. Make the operation safe to rerun.

The import must be idempotent.

Running it twice must NOT create duplicate medicine records.


========================================================
17. IMPORTANT: NO DATABASE RESET
========================================================

DO NOT:

- drop existing medicine tables
- delete existing catalog data
- recreate the whole database
- reset pharmacy data
- recreate existing workflows
- replace existing medicine IDs unnecessarily

The implementation must be incremental.

Existing data must remain available.


========================================================
18. FILE SCOPE CONTROL
========================================================

STRICT FILE-SCOPE RULE:

Before editing anything, inspect the repository and identify the exact
existing files responsible for:

1. Universal Catalog/database model
2. Catalog API/backend
3. Catalog search
4. Catalog image handling
5. Special Order
6. Request Medicine
7. Refill medicine references
8. Website/Online Catalog medicine loading
9. Existing CSV/import/migration functionality, if present

ONLY modify files directly responsible for this feature.

Expected existing areas may include:

    src/routes/catalog.ts
    src/routes/catalogImages.ts
    src/routes/customerPortal.ts
    frontend/src/api/catalogApi.ts
    frontend/src/pages/CustomerPortal/PublicCatalogView.tsx

BUT DO NOT assume these are the only files.

First inspect the repository and determine the actual dependency chain.

Do not modify a file merely because it is nearby.

Do not modify:

- unrelated POS files
- unrelated billing files
- unrelated authentication
- unrelated dashboard files
- unrelated UI components
- unrelated styling
- unrelated routing
- unrelated performance code
- unrelated database tables

unless the existing implementation proves that the file is directly
required for this feature.

If a new file is genuinely required, create ONLY that directly related
file and document why it is required.


========================================================
19. FRONTEND UI RULE
========================================================

DO NOT redesign the existing frontend.

DO NOT change:

- layout
- colors
- typography
- navigation
- existing cards
- existing page structure
- existing workflows
- existing user interactions

Only connect the new Universal Catalog behavior to the existing UI.

If an existing UI already has an appropriate:

- online toggle
- medicine search
- Special Order button
- Request Medicine flow
- catalog listing

reuse it.

Do not create a second button or second interface for the same action
unless absolutely required.


========================================================
20. SEARCH BEHAVIOR
========================================================

All medicine searches should ultimately resolve against the Universal
Catalog.

Search should support the application's existing search behavior and
improve it only where required.

Support appropriate matching of:

- medicine name
- generic/salt
- strength
- manufacturer
- barcode
- UCode
- MDM ID
- existing searchable fields

The search should return the canonical medicine record.

Do not create separate search indexes containing duplicate medicine
records unless the existing architecture specifically requires a search
index/cache.


========================================================
21. DUPLICATE PREVENTION RULES
========================================================

Add protection against future duplicate creation.

Whenever a new medicine enters through:

- CSV import
- Request Medicine
- Special Order
- Website search
- AI Camera
- manual catalog creation

the system should attempt to resolve it to an existing Universal
Catalog medicine first.

Conceptually:

    INPUT
      ↓
    Normalize
      ↓
    Identify existing medicine
      ↓
    MATCH → use existing medicine_id
      ↓
    NO MATCH → existing approved creation workflow


Never:

    Request Medicine → create new medicine
    Special Order → create new medicine
    Website → create new medicine

without first checking the Universal Catalog.


========================================================
22. DATA SAFETY
========================================================

Do not expose sensitive customer/patient data through the public catalog.

Public catalog:

- medicine information
- image
- manufacturer
- strength
- packaging
- approved public information
- online availability

Private authenticated data:

- customer
- patient
- refill
- prescription
- order history
- phone number
- customer-specific requests


========================================================
23. TESTING REQUIREMENTS
========================================================

After implementation, test only the directly affected workflows.

Test:

A. Existing medicine remains unchanged.

B. Duplicate CSV record maps to existing medicine.

C. Same medicine with formatting differences maps correctly.

D. Different strength does NOT merge.

E. Different packaging does NOT incorrectly merge.

F. Existing barcode/MDM/UCode matching works.

G. Re-running import creates no duplicates.

H. Existing POS still finds the medicine.

I. Existing inventory still references the medicine.

J. Existing refill still references the medicine.

K. Existing Special Order still references the medicine.

L. Request Medicine finds an existing Universal Catalog medicine.

M. Website can display online-enabled medicines.

N. Special Order medicines can be discovered according to the defined
   online rules.

O. Pharmacy-specific visibility works.

P. Customer A cannot see Customer B's refill/request/prescription data.

Q. Existing frontend layout remains unchanged.


========================================================
24. REQUIRED FINAL CROSS-CHECK BY THE CODING AGENT
========================================================

After completing the implementation, DO NOT immediately declare it
complete.

Perform a final OLD BEHAVIOR vs NEW BEHAVIOR audit.

For every modified file, verify:

    FILE
    ↓
    What did this file do before?
    ↓
    What was changed?
    ↓
    Why was the change required?
    ↓
    What existing workflow depends on it?
    ↓
    Does the old workflow still work?
    ↓
    Does the new Universal Catalog behavior work?
    ↓
    Was any unrelated behavior changed?

Then verify the complete chain:

    Universal Catalog
          ↓
    POS
          ↓
    Inventory
          ↓
    Refill
          ↓
    Special Order
          ↓
    Request Medicine
          ↓
    Website


========================================================
25. MODIFIED FILE AUDIT
========================================================

At the end, produce a concise internal implementation report containing:

1. Files inspected
2. Files modified
3. Files newly created, if any
4. Why each modified file was required
5. Database/schema changes
6. Import/migration changes
7. Duplicate-detection logic
8. Existing workflows reused
9. Existing workflows confirmed unchanged
10. Frontend UI changes, which should be NONE unless strictly required
11. Tests performed
12. Old behavior vs new behavior result

IMPORTANT:

If a file was not directly required, DO NOT MODIFY IT.

If an existing function already performs the required behavior,
EXTEND/REUSE it instead of creating another implementation.


========================================================
26. FINAL ACCEPTANCE CRITERIA
========================================================

The feature is considered complete only when:

[ ] One Universal Catalog exists as the medicine master.

[ ] Both provided datasets are incorporated through controlled
    matching/merging.

[ ] Duplicate medicine records are not created.

[ ] Existing catalog records are preserved.

[ ] Existing medicine IDs are preserved wherever possible.

[ ] Existing POS workflow continues to work.

[ ] Existing Inventory workflow continues to work.

[ ] Existing Refill workflow continues to work.

[ ] Existing Special Order workflow continues to work.

[ ] Existing Request Medicine workflow continues to work.

[ ] AI/photo medicine search uses the Universal Catalog.

[ ] Website uses the Universal Catalog.

[ ] Pharmacy can control which medicines are shown online.

[ ] Special Order medicines can be discoverable online according to
    the defined rules.

[ ] Users can search existing medicines instead of creating duplicates.

[ ] Customer/patient/refill/prescription data remains private.

[ ] No second medicine catalog has been introduced.

[ ] No duplicate medicine workflow has been introduced.

[ ] No unrelated frontend UI has been redesigned.

[ ] No unrelated files have been modified.

[ ] No database reset has been performed.

[ ] Import is safe to rerun.

[ ] Old behavior vs new behavior has been cross-checked.

[ ] Only the minimum necessary files have been touched.


========================================================
CORE PRINCIPLE
========================================================

DO NOT START THE APPLICATION FROM SCRATCH.

DO NOT BUILD A NEW CATALOG.

DO NOT BUILD A NEW SPECIAL ORDER SYSTEM.

DO NOT BUILD A NEW REQUEST MEDICINE SYSTEM.

DO NOT BUILD A NEW REFILL SYSTEM.

DO NOT BUILD A NEW WEBSITE MEDICINE DATABASE.

USE THE EXISTING APPLICATION STRUCTURE.

MERGE AND DEDUPLICATE THE TWO DATASETS INTO THE EXISTING UNIVERSAL
CATALOG.

THEN MAKE POS, INVENTORY, REFILL, SPECIAL ORDER, REQUEST MEDICINE AND
WEBSITE REFERENCE THAT SAME UNIVERSAL CATALOG MEDICINE ID.

THE REQUIRED CHANGE IS INTEGRATION + DEDUPLICATION + REUSE,
NOT REBUILDING THE APPLICATION.