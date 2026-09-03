AI PHARMACY V3 — SINGLE IMPLEMENTATION PLAN
CATALOGUE IMAGE CONNECTION + AI MATCHING + HUMAN VERIFICATION + AUTO-CORRECTION

MASTER INSTRUCTION:
Treat this entire document as ONE implementation plan and execute it completely in ONE implementation run.

Do not skip any task.
Do not assume anything is complete.
Do not stop after coding.
Do not declare success after compilation only.
Do not modify unrelated files.
Do not redesign the frontend.
Do not create duplicate systems.
Do not break existing functionality.

============================================================
1. OBJECTIVE
============================================================

Implement a complete catalogue-image management system inside the existing AI Pharmacy V3 application.

The purpose is to ensure that every downloaded medicine/product image is connected to the correct medicine/product record.

The system must:

1. Import/use the existing company catalogue.
2. Identify the correct company.
3. Identify the correct medicine/product.
4. Download or connect the relevant product image.
5. Verify that the image belongs to that exact product.
6. Calculate a confidence score.
7. Automatically separate 99%–100% confidence matches.
8. Send lower-confidence matches to manual review.
9. Allow the user to visually inspect the image directly from the existing PC application.
10. Allow the user to APPROVE.
11. Allow the user to REJECT.
12. Allow the user to REMOVE.
13. Allow the user to REPLACE.
14. Allow the user to RE-DOWNLOAD.
15. Automatically re-check rejected images.
16. Avoid repeatedly selecting previously rejected images.
17. Preserve image history.
18. Preserve correct medicine/product naming.
19. Preserve correct company/product relationships.
20. Never silently replace a user-approved image.
21. Never allow an incorrect image to become the final active catalogue image.
22. Keep the medicine/product valid even if no image can be found.

The feature must be integrated into the existing application.

THIS IS NOT A PROJECT REWRITE.

============================================================
2. STRICT FILE-SCOPE RULE
============================================================

ONLY modify files that are directly required for this feature.

Before modifying any file, inspect it and determine:

- What the file currently does.
- Why this feature requires a change there.
- What exact change is required.
- What existing functionality could be affected.

The agent must maintain an exact file-change list.

Do not modify a file simply because it is nearby or convenient.

Do not perform unrelated cleanup.

Do not perform unrelated refactoring.

Do not rename unrelated files.

Do not move unrelated files.

Do not change unrelated CSS.

Do not change unrelated business logic.

Do not add unrelated dependencies.

If an existing function/service/component can be reused, reuse it.

If a new file is genuinely required, create only that file and explain why.

============================================================
3. FRONTEND RULE
============================================================

DO NOT REDESIGN THE EXISTING FRONTEND.

The agent must inspect the current frontend and find the existing location where this feature naturally belongs.

Use the existing:

- layout
- navigation
- catalogue screen
- medicine screen
- management screen
- Quick Access Panel
- table components
- cards
- dialogs/modals
- buttons
- existing styling
- existing state management
- existing API communication

Only add the minimum controls required.

Do not create a completely new dashboard.

Do not create a second catalogue system.

Do not create a second medicine-management system.

Do not create a second image-management system.

The new functionality must look and behave like part of the existing application.

============================================================
4. TASK 1 — REPOSITORY AUDIT
============================================================

Before changing code, inspect the actual repository.

Trace:

A. COMPANY/CATALOGUE

- Company master
- Company IDs
- Catalogue import
- Catalogue parsing
- Product creation
- Medicine creation
- Duplicate handling
- Catalogue re-import

B. MEDICINE MASTER

- Medicine ID
- Product ID
- Company relationship
- Medicine name
- Composition/API
- Strength
- Dosage form
- Pack size
- Product code
- Barcode
- MRP

C. IMAGE SYSTEM

- Existing image tables
- Existing image fields
- Image download logic
- Image storage
- Image URLs
- Image cache
- Image display
- Existing image validation
- Existing image replacement

D. FRONTEND

- Catalogue UI
- Medicine UI
- Image UI
- Existing Quick Access Panel
- Existing admin/management UI

E. BACKEND

- Catalogue routes
- Medicine routes
- Image routes
- Download services
- Matching services
- Background jobs
- Error handling

F. DATABASE

- Current schema
- Migration mechanism
- Existing tables
- Existing indexes
- Existing relationships
- Existing constraints

G. TESTING

- Unit tests
- Integration tests
- Database tests
- Frontend tests
- Existing build/type-check/lint commands

DO NOT IMPLEMENT ANYTHING UNTIL THIS AUDIT IS COMPLETE.

============================================================
5. CURRENT BEHAVIOUR
============================================================

The agent must determine and document the ACTUAL current behaviour from the repository.

Do not invent it.

Document:

CURRENT CATALOGUE FLOW:
Catalogue
→ actual import process
→ actual database structure
→ actual product/medicine record

CURRENT IMAGE FLOW:
Product/Medicine
→ actual image search
→ actual image download
→ actual image storage
→ actual image display

CURRENT MATCHING:
Actual existing matching logic.

CURRENT USER CONTROL:
Actual existing approval/rejection/replacement behaviour.

CURRENT RE-IMPORT:
Actual behaviour when the same catalogue is imported again.

CURRENT PUBLIC IMAGE:
Actual behaviour for website/public catalogue images.

This information must be included in the final completion report.

============================================================
6. TASK 2 — EXACT FILE PLAN
============================================================

After the repository audit, identify exact files.

Report internally:

FRONTEND:
Existing related files:
[number]

Files requiring modification:
[path + reason]

New frontend files:
[path + reason]

BACKEND:
Existing related files:
[number]

Files requiring modification:
[path + reason]

New backend files:
[path + reason]

DATABASE:
Existing related files:
[number]

Files requiring modification:
[path + reason]

New migrations:
[path + reason]

TESTS:
Existing related files:
[number]

Files requiring modification:
[path + reason]

New tests:
[path + reason]

DO NOT invent the number of files.

DO NOT modify more files than necessary.

============================================================
7. TASK 3 — STABLE PRODUCT IDENTITY
============================================================

Images must be connected using stable identifiers.

Preferred relationship:

COMPANY ID
+
PRODUCT ID / MEDICINE ID
+
IMAGE ID

Do not rely only on:

- filename
- array position
- row number
- catalogue order
- fuzzy name

Example:

CM001
→ Company

PRD000001
→ Product

MED000001
→ Medicine

IMG000001
→ Image

The image must remain connected to the same product even if the catalogue is imported again.

============================================================
8. TASK 4 — MEDICINE/IMAGE MATCHING
============================================================

The system must NOT assume that similar names mean the same product.

Example:

Dytor20.jpg

must not automatically be considered correct for:

Dytor 20

The matching process should use all reliable information available.

Possible signals:

- Company
- Brand name
- Normalized name
- Composition/API
- Strength
- Dosage form
- Pack size
- Product code
- Barcode
- Catalogue information
- Filename
- Source metadata
- OCR text where appropriate
- Existing medicine-master information

The existing medicine master remains the source of truth for medicine/product identity.

Do not create another medicine identity system.

============================================================
9. TASK 5 — NAME NORMALIZATION
============================================================

Normalize names where appropriate.

Examples:

Dytor20
Dytor 20
DYTOR-20
Dytor 20 mg

may be normalized for comparison.

BUT:

Do not merge different products incorrectly.

These must remain distinguishable:

10 mg
20 mg
40 mg

Tablet
Capsule
Injection
Syrup
Cream

10 tablets
15 tablets
30 tablets

Different composition.

Different company.

Different dosage form.

Different pack.

A fuzzy name match alone must never be sufficient when important medicine attributes conflict.

============================================================
10. TASK 6 — IMAGE CONFIDENCE SCORE
============================================================

Each image candidate must receive a confidence score.

The score should be based on multiple signals.

Conceptual scoring:

COMPANY MATCH
+
PRODUCT NAME MATCH
+
COMPOSITION MATCH
+
STRENGTH MATCH
+
DOSAGE FORM MATCH
+
PACK SIZE MATCH
+
PRODUCT CODE/BARCODE
+
IMAGE/OCR EVIDENCE
+
SOURCE INFORMATION

The exact implementation must be based on the actual repository architecture.

If an existing matching system exists, extend it instead of creating another independent matching system.

============================================================
11. TASK 7 — HIGH-CONFIDENCE CATALOGUE
============================================================

If confidence is:

99%–100%

the system may place the image into:

HIGH-CONFIDENCE / AUTO-VERIFIED

This exists to avoid unnecessary manual checking.

However:

HIGH-CONFIDENCE DOES NOT MEAN PERMANENTLY TRUSTED.

The user must still be able to inspect and override it.

Store enough information to determine:

- confidence score
- matching method
- company ID
- product/medicine ID
- image ID
- source
- source URL where available
- timestamp
- verification state

============================================================
12. TASK 8 — MANUAL REVIEW CATALOGUE
============================================================

Images below the high-confidence threshold must go to:

IMAGE REVIEW / MANUAL VERIFICATION

The existing PC application must allow the user to visually inspect the image.

Display, where available:

Company
Medicine/Product Name
Composition
Strength
Dosage Form
Pack Size
Product Code
Confidence %
Image
Image Source
Current Status

The image must be large enough for visual verification.

The user must not need to manually open folders or external websites just to inspect downloaded images.

============================================================
13. TASK 9 — USER APPROVAL
============================================================

APPROVE means:

"This image is correct for this product."

After approval:

Image Status:
APPROVED

The image becomes the active catalogue image.

The following identities remain unchanged:

Company ID
Product ID
Medicine ID

Approval must not change:

- medicine name
- composition
- strength
- pack
- product code
- MRP

unless another existing process independently handles those values.

============================================================
14. TASK 10 — USER REJECTION
============================================================

REJECT means:

"This image is incorrect for this product."

After rejection:

Image Status:
REJECTED

The image must no longer be the active image.

The product itself remains valid.

IMPORTANT:

WRONG IMAGE
does NOT mean
WRONG MEDICINE.

The system should retain rejection history where useful.

============================================================
15. TASK 11 — USER REPLACE
============================================================

If the user chooses REPLACE:

The replacement image must remain connected to the same:

Company ID
Product ID
Medicine ID

Example:

Dytor 20
Image A
↓
REPLACE
↓
Image B

Result:

Dytor 20
Image B

The medicine identity must not change.

============================================================
16. TASK 12 — USER REMOVE
============================================================

If the user chooses REMOVE:

The image is removed from active catalogue usage.

The product remains valid.

Do not delete:

- medicine
- product
- company
- purchase history
- POS history
- inventory history
- order history

If the existing architecture supports image history, preserve the old image record as historical data.

============================================================
17. TASK 13 — AUTOMATIC RE-DOWNLOAD
============================================================

When an image is rejected:

REJECT
↓
SEARCH FOR NEW CANDIDATE
↓
EXCLUDE PREVIOUSLY REJECTED CANDIDATES
↓
DOWNLOAD
↓
VALIDATE
↓
MATCH
↓
CALCULATE CONFIDENCE
↓
99%–100%
→ HIGH CONFIDENCE

OR

Below 99%
→ MANUAL REVIEW

Do not automatically replace an approved image without passing the appropriate verification rule.

Do not create an infinite retry loop.

Use a controlled retry limit.

============================================================
18. TASK 14 — PREVENT REPEATED WRONG IMAGES
============================================================

If the user rejects:

Image A

for:

Product X

the system must remember the relationship sufficiently to prevent Image A from repeatedly being selected for Product X.

This must also work across retries and catalogue reprocessing where appropriate.

The same incorrect image must not repeatedly return to the user.

============================================================
19. TASK 15 — IMAGE HISTORY/VERSIONING
============================================================

Where required, support image history.

Example:

Dytor 20

Image V1
→ REJECTED

Image V2
→ REJECTED

Image V3
→ APPROVED

Active image:
V3

The application must be able to determine:

- previous image
- replacement image
- approval
- rejection
- timestamp
- confidence
- source

Do not silently destroy important history.

============================================================
20. TASK 16 — CATALOGUE RE-IMPORT
============================================================

When the same catalogue is imported again:

Do not unnecessarily create duplicate products.

Do not create duplicate medicines.

Do not destroy approved images.

Do not silently replace approved images.

Use stable identifiers.

If a new image is found:

Treat it as a candidate according to the verification workflow.

Existing approved images must be protected from silent replacement.

============================================================
21. TASK 17 — IMAGE DUPLICATION
============================================================

Where technically practical:

detect duplicate image assets.

Do not use filename alone.

Use a suitable image/content hash where appropriate.

However, never merge two product relationships incorrectly just because the images are identical.

One image asset may technically be identical while still being associated with different records according to the existing application architecture.

============================================================
22. TASK 18 — IMAGE STORAGE
============================================================

Inspect the existing image-storage mechanism.

If the application already has:

- local image directory
- media storage
- asset storage
- upload system
- cache
- cloud/object storage
- image references

reuse it.

Do not create a second storage system.

Prefer storing image metadata/reference in the database rather than unnecessarily storing large image binaries in SQLite.

Do not break existing image display.

============================================================
23. TASK 19 — EXISTING UI INTEGRATION
============================================================

Find the existing screen where this functionality belongs.

Use that screen.

Possible locations include:

- existing catalogue screen
- existing medicine management
- existing Quick Access Panel
- existing administration/management screen

The actual repository determines the correct location.

Do not create a completely new application section unless there is genuinely no existing appropriate location.

Minimal controls:

Approve
Reject
Replace
Remove
Re-download
Next
Previous

Only implement controls that are necessary and compatible with the existing UI.

============================================================
24. TASK 20 — QUICK ACCESS INTEGRATION
============================================================

If the existing Quick Access Panel is the correct operational location:

extend it.

DO NOT create a second Quick Access Panel.

Potential entries:

High-Confidence Images
Images Needing Review
Rejected Images
Image Download Failed

Only add what is necessary.

Existing Quick Access functions must remain unchanged.

============================================================
25. TASK 21 — PUBLIC/WEBSITE IMAGE RULE
============================================================

An image with:

PENDING_REVIEW
REJECTED
FAILED
REMOVED

must not become the active public image.

Only:

APPROVED

or the explicitly configured:

HIGH-CONFIDENCE

state may be used as the public catalogue image.

If no image is available:

the medicine/product remains valid.

Do not reject a medicine merely because its image is missing.

============================================================
26. TASK 22 — DATABASE CHANGES
============================================================

Before modifying the database:

inspect the existing schema and migration mechanism.

Do not bypass the migration system.

Do not modify unrelated tables.

Do not duplicate existing columns.

Only introduce the minimum required image-verification data.

Potential conceptual information:

image_id
company_id
product_id
medicine_id
image_path
image_source
source_url
image_hash
confidence_score
matching_method
verification_status
verification_reason
verified_by
verified_at
replaced_from_image_id
created_at
updated_at

These are conceptual only.

Use existing fields when available.

Do not blindly create all of them.

============================================================
27. TASK 23 — MIGRATION SAFETY
============================================================

The existing database must remain safe.

Test:

CURRENT DATABASE
↓
MIGRATION
↓
NEW SCHEMA

Also test:

FRESH DATABASE
↓
NEW SCHEMA

Verify:

- existing medicines
- existing products
- existing catalogue
- existing POS
- existing purchase
- existing inventory
- existing orders
- existing distributor data
- existing Quick Access
- existing WhatsApp configuration

remain functional.

No data loss.

No broken indexes.

No broken relationships.

No broken FTS/search.

============================================================
28. TASK 24 — POS PROTECTION
============================================================

The image system must not alter POS business logic unnecessarily.

Test:

- medicine search
- add medicine
- quantity
- price
- MRP
- billing
- payment
- transaction completion

Image approval/rejection/replacement must not change stock or billing values.

============================================================
29. TASK 25 — PURCHASE PROTECTION
============================================================

Test:

- distributor
- purchase
- quantity
- rate
- purchase history
- inventory update

Image operations must not modify purchase calculations.

============================================================
30. TASK 26 — INVENTORY PROTECTION
============================================================

Image operations must NEVER directly:

- increase stock
- decrease stock
- modify stock valuation
- create purchase entries
- create sales entries

Inventory remains independent from image verification.

============================================================
31. TASK 27 — MEDICINE SEARCH PROTECTION
============================================================

The existing medicine search must remain functional.

Do not rebuild the existing FTS/search architecture unnecessarily.

Do not remove existing indexes.

Do not alter unrelated search ranking.

The image must attach to the existing medicine/product identity.

============================================================
32. TASK 28 — PHARMARACK PROTECTION
============================================================

Existing Pharmarack functionality must remain functional.

Do not rewrite it.

Do not change authentication/session logic unless directly required.

Image processing must not interfere with distributor availability.

============================================================
33. TASK 29 — WHATSAPP PROTECTION
============================================================

Existing WhatsApp functionality must remain unchanged.

Do not modify:

- login
- session management
- background login
- messaging
- launch utilities

unless the image feature has a proven direct dependency.

============================================================
34. TASK 30 — OFFLINE SAFETY
============================================================

The pharmacy application must not stop functioning merely because an image cannot be downloaded.

If internet is unavailable:

- existing local pharmacy functions continue.
- image download can remain pending.
- failure is recorded.
- user can retry later.

Do not make normal pharmacy operation dependent on image download availability.

============================================================
35. TASK 31 — ERROR HANDLING
============================================================

Handle:

- timeout
- invalid image URL
- unavailable source
- corrupted image
- unsupported format
- failed OCR
- failed matching
- failed database operation
- duplicate image
- missing medicine
- missing company
- failed replacement
- failed deletion
- failed download
- retry failure

No silent failures.

No application crash.

Use existing error handling where possible.

============================================================
36. TASK 32 — BACKGROUND PROCESSING
============================================================

If the application already has a background job/worker system:

reuse it.

Do not block the main UI while processing a large catalogue.

Conceptual flow:

QUEUE
→ DOWNLOAD
→ VALIDATE
→ MATCH
→ SCORE
→ STORE
→ HIGH-CONFIDENCE / REVIEW

Do not create uncontrolled parallel requests.

============================================================
37. TASK 33 — REQUIRED TEST CASES
============================================================

Test all of the following:

1. Correct image at 100%.
2. Correct image at 99.x%.
3. Image below 99%.
4. Wrong image.
5. User rejects wrong image.
6. Automatic re-download.
7. New candidate is matched.
8. New candidate is approved.
9. Manual replacement.
10. Manual removal.
11. No image found.
12. Download failure.
13. Duplicate image.
14. Duplicate catalogue import.
15. Similar medicine names.
16. Different medicine strengths.
17. Different pack sizes.
18. Different dosage forms.
19. Same/similar brand names from different companies.
20. Previously rejected image.
21. Existing approved image during catalogue re-import.
22. Image history.
23. Image status transitions.
24. Existing medicine search.
25. Existing POS.
26. Existing purchase.
27. Existing inventory.
28. Existing migration.
29. Existing Pharmarack.
30. Existing WhatsApp.
31. Existing Quick Access.
32. Existing application startup.

============================================================
38. TASK 34 — COMPLETE IMAGE FLOW TEST
============================================================

Test:

CATALOGUE
→ PRODUCT
→ MEDICINE
→ IMAGE DOWNLOAD
→ MATCH
→ SCORE
→ HIGH CONFIDENCE / REVIEW
→ USER APPROVAL
→ ACTIVE IMAGE

Then:

WRONG IMAGE
→ REJECT
→ NEW SEARCH
→ NEW DOWNLOAD
→ NEW MATCH
→ NEW SCORE
→ REVIEW
→ APPROVE
→ ACTIVE IMAGE

Then:

ACTIVE IMAGE
→ USER REPLACE
→ SAME PRODUCT
→ SAME MEDICINE
→ NEW ACTIVE IMAGE

Then:

ACTIVE IMAGE
→ USER REMOVE
→ NO ACTIVE IMAGE
→ PRODUCT STILL VALID

============================================================
39. TASK 35 — COMPLETE CATALOGUE FLOW
============================================================

Test:

COMPANY
→ CATALOGUE
→ PRODUCT
→ MEDICINE
→ IMAGE
→ VERIFICATION
→ APPROVAL
→ ACTIVE CATALOGUE

Then re-import the same catalogue.

Expected:

No unnecessary duplicate product.

No unnecessary duplicate medicine.

No destruction of approved image.

No broken relationships.

============================================================
40. TASK 36 — REGRESSION TEST
============================================================

After the feature works, run the entire relevant existing application test flow.

MEDICINE:
PASS/FAIL

POS:
PASS/FAIL

PURCHASE:
PASS/FAIL

INVENTORY:
PASS/FAIL

MIGRATION:
PASS/FAIL

PHARMARACK:
PASS/FAIL

WHATSAPP:
PASS/FAIL

QUICK ACCESS:
PASS/FAIL

APPLICATION STARTUP:
PASS/FAIL

EXISTING FRONTEND:
PASS/FAIL

No feature is complete if an existing protected system is broken.

============================================================
41. TASK 37 — BUILD/TYPE/LINT
============================================================

Run all project-supported checks:

- type checking
- lint
- unit tests
- integration tests
- build
- application startup
- affected feature tests

Use the project's actual commands discovered during the repository audit.

Do not invent commands if the project already defines them.

============================================================
42. TASK 38 — GIT DIFF AUDIT
============================================================

At the end, inspect the COMPLETE Git diff.

List:

MODIFIED FILES
NEW FILES
DELETED FILES

For every file:

FILE:
[path]

WHY:
[exact reason]

FEATURE:
[feature requiring modification]

CHANGE:
[what was changed]

IMPACT:
[why existing functionality remains safe]

Any unrelated modification MUST be reverted.

Final requirement:

UNRELATED FILES MODIFIED:
NONE

============================================================
43. TASK 39 — SECOND VERIFICATION
============================================================

After all tests pass, perform another complete verification.

Do not simply trust the first test run.

Verify again:

1. Requirements.
2. File scope.
3. Catalogue.
4. Product identity.
5. Medicine identity.
6. Image matching.
7. Confidence score.
8. 99%–100% high-confidence flow.
9. Manual review.
10. Approve.
11. Reject.
12. Replace.
13. Remove.
14. Re-download.
15. Re-check.
16. Rejected-image exclusion.
17. Image history.
18. Catalogue re-import.
19. Database migration.
20. POS.
21. Purchase.
22. Inventory.
23. Medicine search.
24. Pharmarack.
25. WhatsApp.
26. Quick Access.
27. Existing frontend.
28. Error handling.
29. Build.
30. Complete Git diff.

Then run the critical flows again.

============================================================
44. FINAL OLD VS NEW COMPARISON
============================================================

The agent MUST provide this after implementation.

OLD BEHAVIOUR:

- Existing catalogue import behaviour.
- Existing image download behaviour.
- Existing image/product association.
- Existing image verification capability.
- Existing replacement capability.
- Existing public image behaviour.

NEW BEHAVIOUR:

- Catalogue remains connected to stable product/medicine IDs.
- Images are matched against product information.
- Images receive confidence scores.
- 99%–100% confidence images can be separated into a high-confidence catalogue.
- Lower-confidence images enter manual review.
- User can inspect images directly on the PC.
- User can approve.
- User can reject.
- User can replace.
- User can remove.
- Rejected images trigger controlled re-download/re-check.
- Previously rejected images are not unnecessarily reused.
- Approved images become the active image.
- Approved images are not silently overwritten.
- Medicine/product identity remains unchanged when an image changes.
- Catalogue re-import does not unnecessarily duplicate products.
- Missing images do not invalidate products.
- Existing POS remains functional.
- Existing purchase remains functional.
- Existing inventory remains functional.
- Existing migration remains functional.
- Existing medicine search remains functional.
- Existing Pharmarack remains functional.
- Existing WhatsApp remains functional.
- Existing Quick Access remains functional.
- Existing frontend remains visually intact.

============================================================
45. FINAL COMPLETION REPORT
============================================================

The coding agent must provide:

IMPLEMENTATION STATUS

Frontend files modified:
[number]

Backend files modified:
[number]

Database/migration files modified:
[number]

Test files modified:
[number]

New files:
[number]

Deleted files:
[number]

------------------------------------------------------------
MODIFIED FILES
------------------------------------------------------------

[path]
Reason:
Change:
Feature relationship:

[path]
Reason:
Change:
Feature relationship:

------------------------------------------------------------
CURRENT BEHAVIOUR
------------------------------------------------------------

[Actual verified behaviour before implementation]

------------------------------------------------------------
NEW BEHAVIOUR
------------------------------------------------------------

[Actual verified behaviour after implementation]

------------------------------------------------------------
IMAGE MATCHING
------------------------------------------------------------

[Actual implemented matching logic]

------------------------------------------------------------
CONFIDENCE SYSTEM
------------------------------------------------------------

[Actual implemented confidence logic]

------------------------------------------------------------
99%–100% FLOW
------------------------------------------------------------

[Actual verified result]

------------------------------------------------------------
MANUAL REVIEW
------------------------------------------------------------

[Actual verified result]

------------------------------------------------------------
REJECT → RE-DOWNLOAD → RECHECK
------------------------------------------------------------

[Actual verified result]

------------------------------------------------------------
REPLACE / REMOVE
------------------------------------------------------------

[Actual verified result]

------------------------------------------------------------
CATALOGUE RE-IMPORT
------------------------------------------------------------

[Actual verified result]

------------------------------------------------------------
REGRESSION
------------------------------------------------------------

POS:
PASS/FAIL

Purchase:
PASS/FAIL

Inventory:
PASS/FAIL

Migration:
PASS/FAIL

Medicine Search:
PASS/FAIL

Pharmarack:
PASS/FAIL

WhatsApp:
PASS/FAIL

Quick Access:
PASS/FAIL

Frontend:
PASS/FAIL

Application Startup:
PASS/FAIL

------------------------------------------------------------
GIT DIFF
------------------------------------------------------------

Only directly related files modified:
YES/NO

Unrelated files modified:
MUST BE NONE

============================================================
46. ABSOLUTE FINAL SUCCESS CONDITION
============================================================

The implementation is NOT complete simply because:

- the code compiles
- the application starts
- images download
- the review screen opens

The implementation is complete ONLY when:

NEW FEATURE WORKS

AND

EXISTING APPLICATION STILL WORKS.

The final verified state must be:

Catalogue works.
Company relationship works.
Product identity works.
Medicine identity works.
Image download works.
Image matching works.
Confidence scoring works.
99%–100% high-confidence flow works.
Manual review works.
Approve works.
Reject works.
Replace works.
Remove works.
Re-download works.
Re-check works.
Rejected-image exclusion works.
Image history works where required.
Catalogue re-import works.
Medicine search works.
POS works.
Purchase works.
Inventory works.
Migration works.
Pharmarack works.
WhatsApp works.
Quick Access works.
Existing frontend remains intact.
No data is lost.
No unrelated files are modified.

============================================================
47. ABSOLUTE INSTRUCTION TO THE CODING AGENT
============================================================

FIRST:
Inspect the real repository.

SECOND:
Understand the existing catalogue, medicine, image, database and frontend architecture.

THIRD:
Identify the exact files required.

FOURTH:
Create the minimum implementation changes.

FIFTH:
Modify ONLY directly related files.

SIXTH:
Execute every task in this document sequentially.

SEVENTH:
Test every affected function.

EIGHTH:
Run the complete image/catalogue flow.

NINTH:
Run complete regression testing.

TENTH:
Inspect the complete Git diff.

ELEVENTH:
Revert every unrelated change.

TWELFTH:
Perform a second independent verification.

THIRTEENTH:
Provide the exact file list and old-vs-new comparison.

DO NOT SKIP ANY STEP.

DO NOT ASSUME ANYTHING.

DO NOT DECLARE COMPLETION WITHOUT VERIFICATION.

DO NOT REDESIGN THE FRONTEND.

DO NOT REWRITE EXISTING SYSTEMS.

DO NOT BREAK POS.

DO NOT BREAK PURCHASE.

DO NOT BREAK INVENTORY.

DO NOT BREAK MIGRATION.

DO NOT BREAK MEDICINE SEARCH.

DO NOT BREAK PHARMARACK.

DO NOT BREAK WHATSAPP.

DO NOT BREAK QUICK ACCESS.

DO NOT CREATE DUPLICATE CATALOGUE/MEDICINE/IMAGE SYSTEMS.

DO NOT TOUCH UNRELATED FILES.

The desired outcome is a reliable catalogue image verification system integrated into the existing AI Pharmacy V3 architecture with the smallest possible controlled change.

END OF SINGLE IMPLEMENTATION PLAN.