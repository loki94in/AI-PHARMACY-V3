AI PHARMACY V3
PRODUCT IMAGE MISSING / WEBSITE ↔ APP SYNC
ISSUE + FIX + FUTURE-PROOF DEVELOPMENT STANDARD
==============================================================

1. THE ACTUAL ISSUE
-------------------

Some products exist correctly in the catalogue/website, but their
product images are missing, broken, stale, or not displayed in the APP.

Typical situation:

WEBSITE
Product exists
+
Valid product image exists
        ↓
APP
Product exists
+
Image missing / broken / old / invalid

This means the PRODUCT DATA and IMAGE DATA are not being kept in a
reliable, continuously verified relationship.

The problem is NOT simply:

"image is missing"

The real problem is:

SOURCE CATALOGUE
        ≠
IMAGE SOURCE
        ≠
DATABASE IMAGE RECORD
        ≠
IMAGE STORAGE
        ≠
API IMAGE RESPONSE
        ≠
APP IMAGE DISPLAY


2. ROOT CAUSES
--------------

Possible causes include:

A. Product imported without image.

B. Image URL was stored but later became unavailable.

C. Website image changed but APP still has old image.

D. Image was downloaded but file was not stored correctly.

E. Database contains an image reference that points to a missing file.

F. API returns an incorrect/broken image URL.

G. Frontend constructs image URLs differently from the backend.

H. Browser/app cache continues displaying an old/broken image.

I. Catalogue was re-imported and image association was lost.

J. Product matching used weak identifiers such as product name only.

K. Image was downloaded from a source but belonged to another product.

L. Image verification happened only once and was never rechecked.

M. A feature was implemented in frontend/backend without tracing the
   complete data lifecycle.

N. Existing image infrastructure was present but the new feature did
   not integrate with it correctly.


3. THE CORRECT ARCHITECTURE
---------------------------

There must be ONE product catalogue and ONE image-management system.

Do NOT create parallel systems.

Correct flow:

PRODUCT MASTER
      ↓
PRODUCT IDENTITY
      ↓
IMAGE SOURCE
      ↓
IMAGE CANDIDATE
      ↓
IMAGE DOWNLOAD
      ↓
IMAGE VALIDATION
      ↓
PRODUCT ↔ IMAGE MATCH
      ↓
CONFIDENCE SCORE
      ↓
VERIFICATION
      ↓
IMAGE RECORD
      ↓
ACTIVE IMAGE
      ↓
CANONICAL IMAGE API
      ↓
APP


4. PRODUCT IDENTITY MUST BE STABLE
-----------------------------------

Never identify a product only by display name.

Use the strongest available identity:

1. Product ID
2. SKU
3. Barcode
4. Manufacturer/product code
5. Company + normalized product name
6. Product name + strength
7. Product name + strength + pack size

Example:

BAD:

"Paracetamol"

GOOD:

Company
+
Product ID
+
SKU
+
Barcode
+
Product Name
+
Strength
+
Pack Size


5. SINGLE SOURCE OF TRUTH
-------------------------

The database must contain the canonical relationship:

PRODUCT
    ↓
ACTIVE IMAGE ID
    ↓
IMAGE RECORD

The APP must NOT maintain its own independent product-image mapping.

The WEBSITE must NOT become a second product database.

The image source is a SOURCE OF IMAGE DATA.

The product database remains the SOURCE OF PRODUCT IDENTITY.


6. IMAGE HEALTH STATUS
----------------------

Every product image should have a health/verification state.

Possible states:

HEALTHY
MISSING
BROKEN
INVALID
WRONG_PRODUCT
STALE
NEEDS_REVIEW
REPAIRED
REPAIR_FAILED
REJECTED
APPROVED

Example:

product_id = 12345

image_status = BROKEN

This tells the repair system exactly what needs to happen.


7. DETECT MISSING IMAGES
------------------------

An image is considered invalid/missing if:

- image field is NULL
- image field is empty
- URL is empty
- URL returns 404
- URL returns unusable 403
- URL returns 5xx
- image file does not exist
- image cannot be decoded
- invalid MIME type
- corrupted image
- invalid dimensions
- storage reference is broken
- API returns invalid image URL
- frontend cannot load image
- image belongs to another product

Do not assume:

DATABASE IMAGE URL EXISTS
=
IMAGE ACTUALLY WORKS


8. IMAGE REPAIR PIPELINE
------------------------

For every product:

CHECK CURRENT IMAGE
        ↓
VALID?
 ├── YES → KEEP
 │
 └── NO
       ↓
FIND WEBSITE/SOURCE IMAGE
       ↓
FETCH CANDIDATE
       ↓
VALIDATE IMAGE
       ↓
MATCH TO PRODUCT
       ↓
CALCULATE CONFIDENCE
       ↓
HIGH CONFIDENCE?
 ├── YES
 │    ↓
 │  SAVE IMAGE
 │    ↓
 │  ACTIVATE IMAGE
 │    ↓
 │  INVALIDATE CACHE
 │    ↓
 │  VERIFY APP
 │
 └── NO
      ↓
   MANUAL REVIEW


9. IMAGE VALIDATION
-------------------

Before an image becomes active, validate:

- HTTP response
- Content-Type
- File size
- Image decoding
- Width
- Height
- Image format
- Source URL
- Product identity
- Company
- SKU/barcode where available
- Manufacturer
- Strength
- Pack size
- Placeholder detection

Reject:

HTML returned as image
+
corrupted files
+
tracking pixels
+
generic placeholders
+
wrong product images
+
unrelated images


10. CONFIDENCE SYSTEM
---------------------

Every candidate receives a confidence score.

Signals include:

Exact Product ID
Exact SKU
Exact Barcode
Exact Manufacturer
Exact Company
Exact Product Name
Exact Strength
Exact Pack Size
Trusted Source
Image validation

Example policy:

99–100%
    AUTO-VERIFY

95–98%
    HIGH-CONFIDENCE REVIEW / CONFIGURABLE AUTO POLICY

80–94%
    MANUAL REVIEW

<80%
    REJECT


11. NEVER RANDOMLY SELECT IMAGES
--------------------------------

NEVER implement:

Product Name
    ↓
Image Search
    ↓
First Image
    ↓
Assign To Product

This can result in:

MEDICINE A
    ↓
IMAGE OF MEDICINE B
    ↓
INCORRECT CATALOGUE

The system must prefer correctness over finding an image.


12. PROTECT APPROVED IMAGES
---------------------------

If:

image_status = APPROVED

then automatic repair must NOT replace it.

Also protect:

VERIFIED
ACTIVE
MANUALLY APPROVED

images.

Automatic replacement is allowed only when:

- image is broken
- image is missing
- image is invalid
- image is explicitly marked stale
- user requests replacement
- policy explicitly permits replacement


13. IMAGE VERSIONING
--------------------

Never blindly overwrite image history.

Example:

PRODUCT 1001

IMAGE 001
    rejected

IMAGE 002
    broken

IMAGE 003
    verified

IMAGE 004
    active

Keep history.

Only one image should be ACTIVE.

This makes debugging possible.


14. IMAGE HASHING
-----------------

Calculate an image content hash where practical.

Example:

SHA-256(image)

Use it to detect:

- duplicate images
- repeated downloads
- unchanged images
- replaced images
- corrupted/replaced assets


15. CANONICAL IMAGE RESOLVER
----------------------------

Create ONE image resolver.

Example:

resolveProductImage(productId)

All application surfaces must use it:

Catalogue
POS
Search
Product Details
Billing
Orders
Dashboard
Admin
Website
Mobile/App

Do NOT allow every component to construct:

/images/product.jpg

independently.

Correct:

UI
 ↓
resolveProductImage()
 ↓
canonical API
 ↓
active image
 ↓
versioned URL


16. FRONTEND FAILURE HANDLING
----------------------------

Every image component must handle:

onLoad
onError

If an image fails:

1. Mark image failure.
2. Attempt controlled fallback.
3. Request revalidation/repair where appropriate.
4. Do not show an unrelated product image.
5. Do not retry forever.
6. Show controlled "Image unavailable" state if necessary.

Never create:

onError
 ↓
reload
 ↓
onError
 ↓
reload
 ↓
infinite loop


17. CACHE MANAGEMENT
--------------------

When a new image is activated:

1. Increment image version.
2. Invalidate server/API cache.
3. Invalidate application cache.
4. Use versioned URL where applicable.
5. Ensure frontend requests the new version.

Example:

/product-image/123?v=7

Old:

/product-image/123?v=6

New:

/product-image/123?v=7

This prevents stale cached images from surviving after repair.


18. BULK IMAGE REPAIR
---------------------

Provide:

RE-CHECK MISSING IMAGES

and:

RE-CHECK ALL IMAGES

Normal operation should process:

MISSING
BROKEN
INVALID
STALE
RETRY-DUE
MANUALLY REQUESTED

Do NOT repeatedly redownload healthy images.


19. WEBSITE ↔ APP AUDIT
------------------------

Create an audit process.

For every product:

PRODUCT
    ↓
WEBSITE IMAGE
    ↓
APP IMAGE
    ↓
STORAGE
    ↓
API
    ↓
FRONTEND

Report:

Product ID
Product Name
Company
SKU
Barcode
Website Image
App Image
Image Status
HTTP Status
Validation Status
Match Confidence
Repair Status
Last Checked
Last Repaired
Source URL
Image Version


20. REPAIR RETRY SYSTEM
-----------------------

Do not continuously hammer image sources.

Store:

last_checked_at
last_attempted_at
retry_count
next_retry_at
repair_status

Example:

Attempt 1
    immediate

Attempt 2
    delayed

Attempt 3
    delayed

Attempt 4
    manual review

After maximum retries:

REPAIR_FAILED

The product remains valid even if the image cannot be found.


21. CATALOGUE RE-IMPORT SAFETY
------------------------------

When catalogue is imported again:

DO NOT:

- duplicate products
- duplicate images
- reset approved images
- lose image history
- break product-image relationships

Instead:

IMPORT
  ↓
MATCH EXISTING PRODUCT
  ↓
PRESERVE PRODUCT ID
  ↓
PRESERVE ACTIVE IMAGE
  ↓
CHECK IMAGE HEALTH
  ↓
REPAIR ONLY IF REQUIRED


22. DATABASE SAFETY
-------------------

Any database modification must follow:

FEATURE
 ↓
DATABASE DESIGN
 ↓
SCHEMA
 ↓
MIGRATION
 ↓
INDEXES
 ↓
CONSTRAINTS
 ↓
SEEDS IF REQUIRED
 ↓
INITIALIZATION
 ↓
BACKEND
 ↓
API
 ↓
FRONTEND
 ↓
RUNTIME TEST
 ↓
REGRESSION TEST


Never assume:

TypeScript interface exists
=
Database table exists


Never assume:

SQL query exists
=
Database migration exists


Never fix:

"no such table"

by:

catch(error)
return []


Schema errors are BLOCKING defects.


23. FRESH DATABASE TEST
-----------------------

Every database-backed feature must work from:

EMPTY DATABASE
    ↓
APPLICATION START
    ↓
MIGRATION
    ↓
SCHEMA
    ↓
SEED/DEFAULT DATA
    ↓
FEATURE


24. EXISTING DATABASE TEST
--------------------------

Also test:

OLD DATABASE
    ↓
APPLICATION UPDATE
    ↓
MIGRATION
    ↓
NEW SCHEMA
    ↓
OLD DATA PRESERVED
    ↓
NEW FEATURE WORKS


This prevents the classic:

"works on my fresh database"

while the real production database quietly catches fire.


25. FEATURE DEVELOPMENT RULE
----------------------------

EVERY NEW FEATURE MUST FOLLOW:

REQUIREMENT
    ↓
IMPACT ANALYSIS
    ↓
EXISTING ARCHITECTURE AUDIT
    ↓
DATABASE IMPACT
    ↓
BACKEND IMPACT
    ↓
API IMPACT
    ↓
FRONTEND IMPACT
    ↓
CACHE IMPACT
    ↓
IMPORT/SYNC IMPACT
    ↓
MIGRATION
    ↓
IMPLEMENTATION
    ↓
TEST
    ↓
REGRESSION
    ↓
FINAL AUDIT


Do NOT implement only the visible UI requirement.


26. MANDATORY PRE-CODING CHECK
------------------------------

Before coding any feature, answer:

WHAT DATA DOES THIS FEATURE TOUCH?

WHERE IS THAT DATA STORED?

WHICH DATABASE TABLE?

WHICH COLUMNS?

WHICH INDEXES?

WHICH API?

WHICH SERVICE?

WHICH FRONTEND COMPONENT?

WHICH CACHE?

WHICH IMPORT/SYNC PROCESS?

WHICH EXISTING FEATURES CAN BE AFFECTED?

WHICH MIGRATION IS REQUIRED?

WHAT HAPPENS ON A FRESH DATABASE?

WHAT HAPPENS ON AN EXISTING DATABASE?

WHAT HAPPENS IF THE EXTERNAL SOURCE FAILS?

WHAT HAPPENS IF THE DATA IS PARTIALLY MISSING?

WHAT HAPPENS WHEN THE FEATURE IS USED AGAIN?


27. MANDATORY POST-CODING CHECK
--------------------------------

After implementation, DO NOT trust only source code.

Verify the actual runtime:

DATABASE
 ↓
TABLE EXISTS
 ↓
COLUMN EXISTS
 ↓
INDEX EXISTS
 ↓
DATA EXISTS
 ↓
API RETURNS DATA
 ↓
FRONTEND RECEIVES DATA
 ↓
UI DISPLAYS DATA
 ↓
REAL USER FLOW WORKS


28. CHANGE IMPACT RULE
----------------------

Before changing an existing component/service/table:

SEARCH ALL REFERENCES.

Example:

product_image

Search:

Database
Backend
API
Frontend
Import
Export
Cache
Tests
Admin
Website
Reports

Then determine whether the change affects existing functionality.

Never modify a shared component based only on the file currently being
worked on.


29. NO DUPLICATE SYSTEMS
------------------------

Before adding a new feature:

SEARCH FOR EXISTING:

- tables
- services
- APIs
- utilities
- components
- hooks
- repositories
- image handlers
- validation functions
- import functions
- cache handlers

If functionality already exists:

EXTEND IT.

Do not create:

ProductImageManagerV2
ProductImageManagerNew
ProductImageManagerFinal
ProductImageManagerFinal2

Humanity does not need four versions of the same service.


30. ATOMIC FEATURE RULE
-----------------------

A feature is NOT:

Frontend complete
+
Backend complete

A feature is:

FRONTEND
+
BACKEND
+
DATABASE
+
MIGRATION
+
API
+
CACHE
+
IMPORT/SYNC
+
ERROR HANDLING
+
TESTS
+
REGRESSION
+
RUNTIME VERIFICATION


31. IMAGE FEATURE DEFINITION OF DONE
------------------------------------

[ ] Existing image system audited
[ ] Existing catalogue system reused
[ ] Existing product system reused
[ ] Missing images detected
[ ] Broken images detected
[ ] Website/source cross-check implemented
[ ] Stable product identity implemented
[ ] Image candidate validation implemented
[ ] Product-image matching implemented
[ ] Confidence scoring implemented
[ ] High-confidence auto-repair implemented
[ ] Manual review implemented
[ ] Re-download implemented
[ ] Image history preserved
[ ] Approved images protected
[ ] Duplicate downloads prevented
[ ] Retry policy implemented
[ ] Cache invalidation implemented
[ ] Canonical image resolver implemented
[ ] Frontend error handling implemented
[ ] Bulk repair implemented
[ ] Audit report implemented
[ ] Catalogue re-import tested
[ ] Fresh DB tested
[ ] Existing DB tested
[ ] Existing data preserved
[ ] Existing images preserved
[ ] API tested
[ ] Frontend tested
[ ] Build passes
[ ] Type check passes
[ ] Tests pass
[ ] Regression tests pass
[ ] No unrelated refactoring
[ ] Final runtime audit completed


32. UNIVERSAL FEATURE DEVELOPMENT STANDARD
-------------------------------------------

For EVERY future AI PHARMACY V3 feature:

READ
 ↓
UNDERSTAND
 ↓
AUDIT EXISTING SYSTEM
 ↓
IDENTIFY DATA FLOW
 ↓
IDENTIFY DATABASE IMPACT
 ↓
IDENTIFY API IMPACT
 ↓
IDENTIFY FRONTEND IMPACT
 ↓
IDENTIFY CACHE/SYNC IMPACT
 ↓
PLAN MIGRATION
 ↓
IMPLEMENT
 ↓
TEST FRESH INSTALL
 ↓
TEST EXISTING INSTALL
 ↓
TEST REAL USER FLOW
 ↓
TEST FAILURE CASES
 ↓
TEST REGRESSION
 ↓
AUDIT ACTUAL DATABASE
 ↓
AUDIT ACTUAL API
 ↓
AUDIT ACTUAL UI
 ↓
CHECK GIT DIFF
 ↓
ONLY THEN MARK COMPLETE


33. CORE RULE TO ADD TO THE PROJECT
-----------------------------------

NO FEATURE IS COMPLETE WHEN THE CODE COMPILES.

A FEATURE IS COMPLETE ONLY WHEN:

REQUIREMENT
→ ARCHITECTURE
→ DATABASE
→ MIGRATION
→ BACKEND
→ API
→ FRONTEND
→ CACHE
→ EXTERNAL SOURCES
→ ERROR HANDLING
→ FRESH INSTALL
→ EXISTING INSTALL
→ REAL RUNTIME
→ REGRESSION
→ FINAL AUDIT

ALL PASS.


34. SPECIFIC FIX FOR THE CURRENT IMAGE ISSUE
---------------------------------------------

CURRENT PROBLEM:

Some website product images are not available in the APP.

IMPLEMENT:

IMAGE HEALTH AUDITOR
        ↓
SCAN ALL PRODUCTS
        ↓
FIND MISSING/BROKEN IMAGES
        ↓
CHECK WEBSITE/SOURCE
        ↓
FETCH CANDIDATE
        ↓
VALIDATE
        ↓
MATCH TO PRODUCT
        ↓
CONFIDENCE SCORE
        ↓
AUTO-REPAIR HIGH CONFIDENCE
        ↓
MANUAL REVIEW LOW CONFIDENCE
        ↓
STORE IMAGE
        ↓
ACTIVATE IMAGE
        ↓
VERSION IMAGE
        ↓
INVALIDATE CACHE
        ↓
VERIFY API
        ↓
VERIFY APP
        ↓
GENERATE AUDIT REPORT


35. FINAL PRINCIPLE
-------------------

DO NOT PATCH THE SYMPTOM.

BAD:

"Image missing → put an image there."

GOOD:

"Why did the product-image relationship fail?"

Then fix:

SOURCE
+
IDENTITY
+
FETCH
+
VALIDATION
+
MATCHING
+
STORAGE
+
DATABASE
+
API
+
CACHE
+
FRONTEND
+
MONITORING
+
REPAIR


This converts the current problem from a manual image-fixing task into
a reliable catalogue-image lifecycle.

The same development principle must be applied to every future feature:

TRACE THE ENTIRE DATA LIFECYCLE BEFORE DECLARING THE FEATURE COMPLETE.