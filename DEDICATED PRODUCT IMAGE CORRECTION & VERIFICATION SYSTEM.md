FEATURE: DEDICATED PRODUCT IMAGE CORRECTION & VERIFICATION SYSTEM
===============================================================

OBJECTIVE
---------
Create a dedicated authenticated section in the website/admin panel where an authorised
user/agent can manually verify product images.

The system must show ONLY images that still require verification/correction.

Once an image is verified as CORRECT, it must never appear again in the Correction Queue.

If an image is INCORRECT, the agent must be able to:
1. Review the product name/details.
2. Search/rescan the internet for the correct product image.
3. Select/refresh the correct image.
4. Preview the new image.
5. Save the corrected image.
6. Mark the image as VERIFIED/CORRECT.
7. Remove the item from the correction queue.

This is intended to dramatically reduce repetitive manual work.


===============================================================
1. CURRENT ISSUE
===============================================================

The current image/catalog workflow has no reliable human verification state.

Problems:

- The system may automatically assign an incorrect product image.
- Product name and image can mismatch.
- There is no dedicated human-review queue.
- Correct images may continue appearing for manual checking.
- Agents may repeatedly review the same product.
- There is no persistent image verification status.
- There is no clear distinction between:
    PENDING
    CORRECT
    INCORRECT
    CORRECTED
    SKIPPED
- There is no proper audit history of who corrected an image.
- Manual correction requires unnecessary navigation.
- The system cannot efficiently identify only products that still need attention.
- Re-scanning the internet can produce another incorrect image without human confirmation.


===============================================================
2. REQUIRED SOLUTION
===============================================================

Create:

    ADMIN / IMAGE CORRECTION

Dedicated route example:

    /admin/image-correction

OR:

    /admin/catalog/image-review


Access:

- Login required.
- Only authorised admin/agent users can access.
- Normal customers/users must NOT see this section.
- Use the existing website authentication system.
- Do NOT create a separate authentication system unless absolutely required.


===============================================================
3. IMAGE VERIFICATION STATES
===============================================================

Every product image must have a persistent verification status.

Recommended enum:

    IMAGE_REVIEW_STATUS

    PENDING
    CORRECT
    INCORRECT
    CORRECTED
    SKIPPED

Recommended interpretation:

PENDING
-------
Image has never been manually verified.

CORRECT
-------
Human agent confirmed that the current image matches the product.

INCORRECT
---------
Human agent confirmed that the image is wrong.

CORRECTED
---------
Agent replaced the image with a manually selected/rescanned image.

SKIPPED
-------
Agent temporarily skips the product without declaring the image correct.

IMPORTANT:

For the Correction Queue:

    SHOW:
        PENDING
        INCORRECT

    DO NOT SHOW:
        CORRECT
        CORRECTED
        SKIPPED

However, SKIPPED should have a configurable retry policy.

Example:

    skipped_at
    skip_reason
    next_review_at

This prevents permanently hiding an unresolved image accidentally.


===============================================================
4. DATABASE DESIGN
===============================================================

Do NOT simply add a boolean:

    image_correct = true/false

That design will become a problem later.

Use explicit state + metadata.

Example:

ProductImage

    id
    product_id

    image_url
    thumbnail_url

    source
    source_url

    review_status

    reviewed_by
    reviewed_at

    correction_reason

    corrected_by
    corrected_at

    previous_image_url

    verification_version

    created_at
    updated_at


Recommended:

    review_status ENUM(
        'PENDING',
        'CORRECT',
        'INCORRECT',
        'CORRECTED',
        'SKIPPED'
    )


For audit/history, create a separate table:

ImageReviewHistory

    id
    product_image_id
    product_id

    previous_status
    new_status

    previous_image_url
    new_image_url

    action

    reason

    performed_by
    performed_at

    metadata JSON


This is important because the system must NEVER lose the history
when an image is replaced.


===============================================================
5. CORRECTION QUEUE
===============================================================

The Image Correction page must load only unresolved images.

Backend query:

    WHERE review_status IN ('PENDING', 'INCORRECT')

Do NOT fetch every product and filter everything in the frontend.

Bad:

    GET all products
    -> frontend filters images

Good:

    GET /api/admin/image-correction/queue

Backend directly returns:

    PENDING + INCORRECT


This makes the system faster and scalable.


===============================================================
6. UI DESIGN
===============================================================

Page:

    IMAGE CORRECTION CENTER

Top summary:

    Pending       1,240
    Incorrect       186
    Corrected       934
    Verified       8,432

Filters:

    Category
    Sub-category
    Brand
    Status
    Search product
    Date added
    Image source

Main display:

    ┌─────────────────────────────────────────────┐
    │ Product Name                                │
    │ SKU / Product ID                            │
    │ Category                                    │
    │                                             │
    │          CURRENT PRODUCT IMAGE              │
    │                                             │
    │ [ CORRECT ] [ INCORRECT ] [ SKIP ]         │
    └─────────────────────────────────────────────┘


For incorrect image:

    ┌─────────────────────────────────────────────┐
    │ Product: Paracetamol 500mg                  │
    │                                             │
    │ Current Image                               │
    │                                             │
    │ [Search Internet]                           │
    │                                             │
    │ Search results                              │
    │                                             │
    │ [Image 1] [Image 2] [Image 3] [Image 4]   │
    │                                             │
    │ [Use Selected Image]                        │
    └─────────────────────────────────────────────┘


===============================================================
7. CORRECT ACTION
===============================================================

When agent clicks:

    CORRECT

Backend must:

    review_status = CORRECT
    reviewed_by = current_user.id
    reviewed_at = NOW()

Create history record:

    action = "MARK_CORRECT"

Then immediately remove the item from the queue.

Frontend:

    Do NOT reload the entire page.

Simply remove that card from the current queue.

Result:

    Product disappears immediately.

This prevents the same image from being shown again.


===============================================================
8. INCORRECT ACTION
===============================================================

When agent clicks:

    INCORRECT

Set:

    review_status = INCORRECT

Store:

    correction_reason
    reviewed_by
    reviewed_at

Then open:

    IMAGE CORRECTION MODE


Agent can:

    1. Review product name.
    2. Review SKU.
    3. Review manufacturer/brand.
    4. Search internet.
    5. View candidate images.
    6. Select correct image.
    7. Preview.
    8. Save.


===============================================================
9. INTERNET IMAGE SEARCH
===============================================================

Do NOT allow uncontrolled scraping of random websites.

Create a dedicated backend service:

    ImageSearchService

Example:

    POST /api/admin/image-correction/search

Input:

    product_name
    brand
    SKU
    manufacturer
    category

Backend generates search queries.

Example:

    "Paracetamol 500mg ABC Pharma"

Then return candidate images:

    image_url
    source
    source_url
    title
    confidence_score


IMPORTANT:

The AI/search service may SUGGEST an image.

It must NOT automatically mark it as correct.

Human confirmation is required.

Correct workflow:

    Internet Search
          ↓
    Candidate Images
          ↓
    Human Selection
          ↓
    Preview
          ↓
    Save
          ↓
    Mark VERIFIED


===============================================================
10. IMAGE REPLACEMENT
===============================================================

When agent selects an image:

Do NOT immediately destroy the previous image.

Perform:

    OLD IMAGE
        ↓
    Store previous image reference
        ↓
    Save NEW IMAGE
        ↓
    Create history
        ↓
    review_status = CORRECTED
        ↓
    verified_by = current_user
        ↓
    verified_at = NOW()


Keep the previous image available for rollback/audit.

Example:

    previous_image_url
    current_image_url


===============================================================
11. PRODUCT NAME RECHECK
===============================================================

If image is wrong because product identification itself is wrong,
agent must be able to verify:

    Product Name
    Brand
    Strength
    Pack Size
    Manufacturer
    SKU
    Category

Do NOT let image correction silently modify the product master data.

If product information needs correction:

    Use separate Product Correction workflow.

Example:

    Image Correction
         |
         +--> Image only
         |
         +--> Product information needs correction
                    |
                    +--> Product Correction Queue


This separation prevents accidental catalog corruption.


===============================================================
12. CATEGORY VIEW
===============================================================

All categories must be available.

Example:

    Medicines
    OTC
    Personal Care
    Baby Care
    Vitamins
    Medical Devices
    Cosmetics
    Surgical
    etc.


Category counters:

    Medicines        245 pending
    OTC               83 pending
    Personal Care     41 pending
    Cosmetics         17 pending


Clicking a category should show only unresolved images
inside that category.


===============================================================
13. BULK REVIEW
===============================================================

Support fast manual processing.

Actions:

    CORRECT
    INCORRECT
    SKIP

Keyboard shortcuts:

    C = Correct
    X = Incorrect
    S = Skip
    N = Next

After action:

    automatically move to next unresolved image.

Example:

    Image 1
      ↓
    C
      ↓
    Image 2
      ↓
    X
      ↓
    Correction screen
      ↓
    Save
      ↓
    Image 3


This dramatically reduces agent workload.


===============================================================
14. QUEUE LOGIC
===============================================================

Primary queue:

    PENDING
    INCORRECT

After:

    CORRECT
        -> remove from queue

    CORRECTED
        -> remove from queue

    SKIPPED
        -> temporarily remove

    INCORRECT
        -> remain in queue

Important:

Do not use frontend-only state.

The database must be the source of truth.


===============================================================
15. SKIP LOGIC
===============================================================

Skip should NOT mean "ignore forever".

Store:

    skipped_at
    skipped_by
    skip_reason
    next_review_at

Example:

    SKIP

System can show it again after:

    24 hours
    3 days
    7 days

depending on configuration.

Admin setting:

    Image Skip Retry:
        1 day
        3 days
        7 days
        Never


===============================================================
16. API DESIGN
===============================================================

GET

    /api/admin/image-correction/queue

Returns unresolved images.


GET

    /api/admin/image-correction/stats

Returns:

    pending
    incorrect
    corrected
    verified
    skipped


POST

    /api/admin/image-correction/{id}/correct

Marks image verified.


POST

    /api/admin/image-correction/{id}/incorrect

Marks image incorrect.


POST

    /api/admin/image-correction/{id}/skip

Skips image.


POST

    /api/admin/image-correction/{id}/search

Searches candidate images.


POST

    /api/admin/image-correction/{id}/replace

Replaces image with selected candidate.


GET

    /api/admin/image-correction/{id}/history

Returns complete review history.


===============================================================
17. CONCURRENCY PROTECTION
===============================================================

Important for multiple agents.

Problem:

Agent A opens Image X.

Agent B opens Image X.

Both modify it.

Solution:

Add:

    locked_by
    locked_at

When agent opens an image:

    lock image for 5-10 minutes.

Or use optimistic locking:

    verification_version

Example:

Agent receives:

    version = 5

Another agent updates:

    version = 6

Agent A tries to save version 5.

Backend rejects:

    IMAGE_ALREADY_UPDATED

Frontend displays:

    "This image was already reviewed by another agent."


Do NOT silently overwrite another agent's work.


===============================================================
18. AUDIT LOG
===============================================================

Every important action must be logged.

Examples:

    IMAGE_VIEWED
    MARK_CORRECT
    MARK_INCORRECT
    IMAGE_SEARCHED
    IMAGE_SELECTED
    IMAGE_REPLACED
    IMAGE_SKIPPED
    IMAGE_REOPENED

Store:

    user
    timestamp
    product
    old value
    new value
    source
    reason


This makes debugging possible when someone inevitably clicks the
wrong button at 4:57 PM on a Friday.


===============================================================
19. IMAGE SOURCE PRIORITY
===============================================================

Define source priority.

Example:

    1. Manufacturer official image
    2. Official brand website
    3. Approved supplier/catalog
    4. Trusted pharmacy/product source
    5. Other search result

AI should rank candidates according to source quality.

Do NOT blindly select:

    first Google/Bing image

Search result ≠ verified product image.


===============================================================
20. IMAGE VALIDATION
===============================================================

Before accepting an image:

Check:

    image loads successfully
    valid MIME type
    valid dimensions
    not broken
    not placeholder
    not unrelated
    acceptable resolution

Optional AI validation:

    Product name ↔ Image similarity

Return:

    confidence_score

Example:

    96% likely match

But:

    AI confidence MUST NOT equal human verification.

Human confirmation remains the final authority.


===============================================================
21. PERFORMANCE
===============================================================

Use pagination/cursor pagination.

Example:

    GET /queue?limit=30

Do NOT load thousands of images simultaneously.

Use:

    thumbnails in queue
    full-resolution image only when opened


Use database indexes:

    index(review_status)
    index(category_id, review_status)
    index(reviewed_at)
    index(next_review_at)


===============================================================
22. FRONTEND STATE MANAGEMENT
===============================================================

The frontend should maintain:

    currentQueue
    currentItem
    selectedCategory
    selectedCandidate
    loading
    error

When user clicks CORRECT:

    API request
       ↓
    successful response
       ↓
    remove item locally
       ↓
    display next item


Do not:

    reload entire browser page.


===============================================================
23. ERROR HANDLING
===============================================================

If image replacement fails:

    DO NOT mark image CORRECT.

Keep:

    INCORRECT

Show:

    "Image replacement failed. Please retry."


If internet search fails:

    Keep product in queue.

If candidate image cannot be downloaded:

    Reject candidate.

If database update fails:

    Do not remove item from queue.


Database state must always be authoritative.


===============================================================
24. SECURITY / ACCESS CONTROL
===============================================================

Use existing website authentication.

Roles:

    ADMIN
    IMAGE_AGENT
    CATALOG_MANAGER

Permissions:

    image.review
    image.correct
    image.replace
    image.search
    image.history

Do not expose correction APIs to normal customers.


===============================================================
25. IMPORTANT BUSINESS RULE
===============================================================

Once an image is marked:

    CORRECT

it must NEVER appear in the default Image Correction Queue again.

Once an image is:

    CORRECTED

it must NEVER appear in the default Image Correction Queue again.

The queue should be based on persistent database state,
not browser state.


===============================================================
26. REOPEN / QUALITY CONTROL
===============================================================

Admin must have an option:

    REOPEN FOR REVIEW

Example:

    CORRECT
       ↓
    later found incorrect
       ↓
    REOPEN
       ↓
    PENDING

This allows future quality-control processes without destroying history.


===============================================================
27. DASHBOARD
===============================================================

Create a small Image Quality Dashboard:

    Total Images
    ─────────────
    Verified
    Pending
    Incorrect
    Corrected
    Skipped

Quality percentage:

    Verified Images / Total Images × 100

Agent productivity:

    Images verified today
    Images corrected today
    Average correction time


Category quality:

    Category
    Total
    Verified
    Pending
    Incorrect
    Accuracy %


===============================================================
28. FUTURE AI AUTOMATION
===============================================================

Architecture should allow future AI automation.

Future pipeline:

    Product Created
          ↓
    AI Image Search
          ↓
    AI Candidate Ranking
          ↓
    Confidence Score
          ↓
    ┌───────────────────────┐
    │ Confidence >= 98%     │
    │                       │
    │ Optional auto-pass    │
    └───────────────────────┘
          ↓
    Human Review
          ↓
    Verified


But initially:

    100% HUMAN CONFIRMATION


Later, once sufficient review data exists,
high-confidence images can be automatically suggested/passed
according to admin-configured rules.


===============================================================
29. WHY THE ORIGINAL APPROACH CAUSES THE PROBLEM
===============================================================

Bad architecture:

    Product
       |
       └── image_url

There is no knowledge of:

    Was this image checked?
    Who checked it?
    When?
    Was it correct?
    Was it replaced?
    Why was it replaced?


Therefore the application has no memory of human verification.


Correct architecture:

    Product
       |
       └── ProductImage
              |
              ├── image_url
              ├── source
              ├── review_status
              ├── reviewed_by
              ├── reviewed_at
              ├── correction_reason
              └── history


The system therefore remembers the complete lifecycle.


===============================================================
30. HOW TO AVOID THIS TYPE OF ISSUE IN FUTURE DEVELOPMENT
===============================================================

MANDATORY DEVELOPMENT RULES:

1. Every AI-generated catalog field must have a lifecycle state.

2. Never use only true/false for workflow states.

3. Separate:
       DATA
       STATE
       AUDIT HISTORY

4. Every human correction must be persistent.

5. Never depend on frontend state for business rules.

6. Backend/database must be the source of truth.

7. Every automated AI result must have:
       source
       confidence
       timestamp
       version

8. Human approval must be explicitly recorded.

9. Never overwrite important historical data.

10. Every workflow must support:
        retry
        correction
        rollback
        audit

11. Build queue-based workflows for manual operations.

12. Add indexes for every field used for queue filtering.

13. Design APIs around business actions instead of generic
    "update product" endpoints.

14. Use optimistic locking/concurrency protection.

15. Keep product correction and image correction separate.

16. Add automated tests for every state transition.

17. Add integration tests for:
        PENDING -> CORRECT
        PENDING -> INCORRECT
        INCORRECT -> CORRECTED
        PENDING -> SKIPPED
        CORRECT -> REOPENED

18. Never allow an item that is already CORRECT/CORRECTED
    to return to the default queue accidentally.

19. Add database constraints wherever possible.

20. Before developing a new feature, define:

        STATE MACHINE
        DATABASE MODEL
        API CONTRACT
        PERMISSIONS
        ERROR STATES
        AUDIT REQUIREMENTS
        ROLLBACK STRATEGY


===============================================================
31. RECOMMENDED STATE MACHINE
===============================================================

                 ┌─────────────┐
                 │   PENDING   │
                 └──────┬──────┘
                        │
             ┌──────────┴──────────┐
             │                     │
          CORRECT               INCORRECT
             │                     │
             ▼                     ▼
        ┌──────────┐         ┌────────────┐
        │  CORRECT │         │ INCORRECT  │
        └──────────┘         └──────┬─────┘
                                    │
                              Replace Image
                                    │
                                    ▼
                              ┌───────────┐
                              │ CORRECTED │
                              └───────────┘


PENDING
   |
   └── SKIP
         |
         └── next_review_at
                  |
                  └── PENDING again


CORRECT
   |
   └── ADMIN REOPEN
           |
           └── PENDING


===============================================================
32. ACCEPTANCE CRITERIA
===============================================================

Feature is considered COMPLETE only when:

[ ] User can login through existing website authentication.

[ ] Authorised user can open Image Correction Center.

[ ] Only unresolved images appear.

[ ] Categories can be filtered.

[ ] Product name/details are visible.

[ ] Current image is clearly visible.

[ ] User can mark image CORRECT.

[ ] Correct image immediately disappears from queue.

[ ] User can mark image INCORRECT.

[ ] User can search internet for candidate images.

[ ] Candidate images can be previewed.

[ ] User can select a candidate image.

[ ] User can replace the current image.

[ ] Previous image is preserved in history.

[ ] Corrected image is automatically considered verified.

[ ] Corrected image disappears from queue.

[ ] User can SKIP.

[ ] Skip does not permanently destroy unresolved work.

[ ] Multiple agents cannot accidentally overwrite each other.

[ ] Every correction is audited.

[ ] Dashboard shows accurate counts.

[ ] Queue is database-driven.

[ ] Pagination is implemented.

[ ] API permissions are enforced.

[ ] Error handling prevents incorrect state transitions.

[ ] Tests cover all state transitions.

[ ] Existing catalog functionality is not broken.


===============================================================
33. IMPLEMENTATION ORDER
===============================================================

PHASE 1
-------
Database migration
    ↓
ProductImage verification fields
    ↓
ImageReviewHistory
    ↓
Indexes


PHASE 2
-------
Backend state machine
    ↓
Queue API
    ↓
Correct API
    ↓
Incorrect API
    ↓
Skip API
    ↓
Replace API
    ↓
History API


PHASE 3
-------
Admin authentication/permissions
    ↓
Image Correction Center
    ↓
Category filters
    ↓
Queue UI
    ↓
Keyboard shortcuts


PHASE 4
-------
Internet image search
    ↓
Candidate ranking
    ↓
Image preview
    ↓
Image replacement


PHASE 5
-------
Dashboard
    ↓
Audit
    ↓
Concurrency protection
    ↓
Testing
    ↓
Performance optimisation


===============================================================
34. FINAL ARCHITECTURE
===============================================================

                PRODUCT CATALOG
                       │
                       ▼
                 ProductImage
                       │
             ┌─────────┴─────────┐
             │                   │
        AI IMAGE SYSTEM     HUMAN REVIEW
             │                   │
             ▼                   ▼
       Candidate Image      Correction Queue
             │                   │
             └─────────┬─────────┘
                       ▼
                 VERIFICATION
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       CORRECT      CORRECTED     SKIPPED
          │            │            │
          └──────┬─────┘            │
                 ▼                  ▼
             REMOVED           RETRY LATER
              FROM QUEUE


SOURCE OF TRUTH:

    DATABASE

NOT:

    Browser
    React state
    Cache
    AI response
    Search result


===============================================================
KEY PRINCIPLE
===============================================================

DO NOT BUILD THIS AS:

    "A PAGE WHERE WE CHECK IMAGES."

BUILD IT AS:

    "A PERSISTENT IMAGE VERIFICATION WORKFLOW."

Every image has:

    identity
    source
    verification state
    reviewer
    timestamp
    correction history
    version
    audit trail


That is what prevents the same work from being repeated and makes
the catalog/image system scalable for future AI automation.