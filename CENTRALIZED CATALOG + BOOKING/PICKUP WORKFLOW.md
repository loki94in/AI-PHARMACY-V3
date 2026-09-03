CENTRALIZED CATALOG + BOOKING/PICKUP WORKFLOW
==============================================

1. CURRENT PROBLEM / ISSUES
----------------------------
A. Old database and imported product images may have different names/IDs.
B. The same medicine/product can appear multiple times under different names.
C. Historical orders may not be reliably connected to the current catalog.
D. Image filename, product name, inventory record, and order item can become
   disconnected.
E. Search may return inconsistent products because it depends on uploaded
   image names or old database records.
F. Website, application, admin panel, and inventory can accidentally maintain
   separate product information.
G. Address/delivery UI is not required today, but completely removing it would
   force an architecture redesign when home delivery is introduced later.
H. Payment QR handling needs to be consistent with the exact order and amount.
I. A payment should never be considered successful merely because the user
   clicked "I HAVE PAID". Pharmacy/admin verification is required.


2. CORE ARCHITECTURE
--------------------
Create ONE CENTRALIZED CATALOG as the SINGLE SOURCE OF TRUTH.

                    CENTRAL CATALOG
                          |
          +---------------+---------------+
          |               |               |
       WEBSITE          APP          ADMIN PANEL
          |               |               |
          +---------------+---------------+
                          |
                      INVENTORY
                          |
                       ORDERS
                          |
                  HISTORICAL ORDERS

Every product must have ONE permanent internal product_id.

Example:

product_id: MED-00001234
name: Paracetamol 500mg Tablet
normalized_name: paracetamol 500mg tablet
manufacturer: XYZ
strength: 500mg
form: Tablet
images: [image_1, image_2]
inventory_quantity: 120
price: 25
status: ACTIVE


3. IMPORTANT RULE
-----------------
NEVER use the image filename as the permanent product identity.

Imported image:
    "IMG_8493_final_new.jpg"

Must become:

    product_id = MED-00001234

The image is an asset belonging to the product.

PRODUCT ID = IDENTITY
IMAGE = ASSET
INVENTORY = CURRENT STATE
ORDER ITEM = HISTORICAL REFERENCE


4. IMAGE RESTORATION / IMPORT WORKFLOW
---------------------------------------
Restore all valid product images from the previous workflow.

Do NOT blindly import them as new products.

Import pipeline:

OLD IMAGES
    |
    v
IMAGE VALIDATION
    |
    v
IMAGE NORMALIZATION
    |
    v
PRODUCT NAME EXTRACTION
    |
    v
MATCH AGAINST CENTRAL CATALOG
    |
    +---- MATCH FOUND ----> attach image to existing product_id
    |
    +---- NO MATCH -------> create review item
                              |
                              v
                         AGENT REVIEW
                              |
                              v
                       CREATE/ASSIGN PRODUCT ID

This prevents duplicate products.


5. FRESH DATABASE MIGRATION
----------------------------
Do not continue depending on the old product database.

Create a clean catalog database/schema.

Keep historical order data where required, but migrate its product references
to the new permanent product_id.

Example:

OLD ORDER
---------
Order #5001
"Paracetmol 500"

        |
        v

CATALOG MATCH

        |
        v

product_id = MED-00001234

        |
        v

NEW ORDER REFERENCE
-------------------
order_item.product_id = MED-00001234


IMPORTANT:
Historical orders must NOT be rewritten as if they were new orders.

Preserve:
- original order date
- original quantity
- original selling price
- original product description/snapshot
- original order ID

Also store the central product_id when a reliable mapping exists.


6. PRODUCT DATA MODEL
---------------------
Use separate entities instead of putting everything into one product table.

PRODUCT
-------
product_id
canonical_name
normalized_name
generic_name
brand_name
manufacturer
strength
dosage_form
pack_size
sku
barcode
status
created_at
updated_at

PRODUCT_IMAGE
-------------
image_id
product_id
image_url
image_type
source
is_primary
verified
created_at

INVENTORY
---------
inventory_id
product_id
pharmacy_id
quantity
reserved_quantity
available_quantity
reorder_level
updated_at

PRICE
-----
price_id
product_id
selling_price
mrp
margin
effective_from
updated_at

ORDER
-----
order_id
user_id
pharmacy_id
payment_status
order_status
total_amount
pickup_or_delivery
created_at

ORDER_ITEM
----------
order_item_id
order_id
product_id
product_name_snapshot
price_snapshot
quantity
subtotal

The snapshot fields are important because product information or pricing can
change after an old order has been completed.


7. SEARCH SYSTEM
----------------
User searches the centralized catalog.

SEARCH INPUT
    |
    v
NORMALIZE
    |
    v
SEARCH CENTRAL CATALOG
    |
    v
MATCH PRODUCT
    |
    v
GET product_id
    |
    v
CHECK INVENTORY
    |
    v
DISPLAY AVAILABILITY

For the current requirement:

USER ENTERS FIRST 3 WORDS
        |
        v
NORMALIZED SEARCH
        |
        v
CENTRAL CATALOG MATCH
        |
        v
PRODUCT ID
        |
        v
INVENTORY CHECK

Search should NOT depend directly on image filenames.

Support:
- spelling normalization
- punctuation normalization
- whitespace normalization
- brand name
- generic name
- strength
- dosage form
- aliases/search keywords

But always return the canonical product_id.


8. INVENTORY CHECK
------------------
When the user searches:

"Paracetamol 500"

System:

SEARCH -> product_id
        |
        v
INVENTORY
        |
        +-- available > 0 --> AVAILABLE
        |
        +-- available = 0 --> OUT OF STOCK

The product can remain visible even when unavailable.

This allows the same centralized product to be referenced by:
- current inventory
- website
- app
- previous orders
- future orders
- analytics
- admin


9. ADMIN / CATALOG MANAGEMENT
-----------------------------
Admin panel should become the control centre.

Admin can:
- add product
- edit product
- upload/replace images
- verify images
- merge duplicate products
- disable product
- change price
- configure margin
- update inventory
- assign pharmacy
- view historical orders
- search product history
- see where a product was previously sold
- correct product mappings

CRITICAL:

DO NOT DELETE A PRODUCT JUST BECAUSE IT IS CURRENTLY OUT OF STOCK.

Use:

status = ACTIVE
quantity = 0

or:

status = INACTIVE

depending on the reason.


10. DUPLICATE PRODUCT PROTECTION
--------------------------------
Before creating a new product, check:

1. barcode
2. normalized product name
3. manufacturer
4. strength
5. dosage form
6. pack size
7. approved alias/mapping

If a probable duplicate is found:

DO NOT AUTOMATICALLY CREATE.

Show:

"Possible existing product found"

Then allow:
- Use existing product
- Create new product
- Merge
- Send for review

This prevents catalog duplication.


11. IMAGE VERIFICATION
----------------------
Imported images should have a verification status:

PENDING
VERIFIED
REJECTED

Workflow:

IMAGE IMPORT
     |
     v
PENDING
     |
     v
AGENT REVIEWS
     |
 +---+---+
 |       |
 v       v
VALID   INVALID
 |       |
 v       v
VERIFIED REJECTED

If invalid:
- agent can rescan/re-fetch image
- attach replacement image
- keep same product_id

NEVER create a new product merely because the image was wrong.


12. BOOKING / PICKUP WORKFLOW
-----------------------------
USER
 |
 v
WEBSITE
 |
 v
SELECT PRODUCTS
 |
 v
ADD TO CART
 |
 v
CHECKOUT
 |
 v
SELECT PHARMACY
 |
 v
SHOW TOTAL AMOUNT
 |
 v
PAYMENT SECTION
 |
 v
SYSTEM SELECTS ONE OF 3 QR CODES
 |
 v
DISPLAY QR
 |
 v
USER PAYS
 |
 v
USER CLICKS "I HAVE PAID"
 |
 v
PAYMENT STATUS = PENDING_VERIFICATION
 |
 v
PHARMACY/ADMIN VERIFIES PAYMENT
 |
 +---- FAILED/NOT FOUND ---> PAYMENT_FAILED
 |
 +---- CONFIRMED ----------> PAYMENT_CONFIRMED
                                |
                                v
                         ORDER_READY_FOR_PICKUP
                                |
                                v
                         USER COLLECTS MEDICINES


13. THREE QR CODE SYSTEM
-------------------------
Store three QR configurations in SETTINGS.

QR_1
QR_2
QR_3

For every new order:

available_qrs = [QR_1, QR_2, QR_3]

Randomly select one.

RULE:

selected_qr != previous_order_qr

Therefore:

Order 1 -> QR_2
Order 2 -> QR_1
Order 3 -> QR_3
Order 4 -> QR_2

QR selection must be stored against the order:

order.payment_qr_id

This is important because the QR displayed to the user must remain
associated with that specific order.


14. WHATSAPP PAYMENT MESSAGE
----------------------------
After checkout, send:

Order ID
Pharmacy
Amount
Payment instructions
Selected UPI QR
Payment reference/instructions

The SAME QR associated with the order must be used.

Do not generate a different QR when sending the WhatsApp message.

Website QR
     |
     +---- SAME QR ----> WhatsApp


15. ADDRESS / DELIVERY ARCHITECTURE
-----------------------------------
DO NOT DELETE ADDRESS FUNCTIONALITY.

Current UI:

delivery_enabled = FALSE

Therefore:

Checkout
    |
    +-- delivery_enabled = FALSE
    |       |
    |       v
    |   HIDE ADDRESS SECTION
    |
    +-- delivery_enabled = TRUE
            |
            v
        SHOW ADDRESS

Current business model:

PICKUP ONLY

Future:

PICKUP + HOME DELIVERY

This requires a configuration change rather than rebuilding the application.

Use a feature/configuration flag:

delivery_enabled = false

Keep the underlying:
- address model
- address API
- delivery order type
- address validation
- delivery fields

available but disabled.


16. ORDER TYPE
--------------
Use an extensible order type:

order_type:

PICKUP
DELIVERY

Current:

order_type = PICKUP

Future:

order_type = DELIVERY

Do not create a separate checkout architecture for delivery later.


17. PHARMACY SELECTION
----------------------
Because there is no home delivery currently, the user must identify the
pharmacy where they will collect the order.

Order should contain:

pharmacy_id

NOT just:

pharmacy_name

Example:

order.pharmacy_id = PHARM-001

This lets inventory be checked against the correct pharmacy.


18. SINGLE SOURCE OF TRUTH RULES
--------------------------------
Website:
    READS catalog

Mobile App:
    READS catalog

Admin:
    MANAGES catalog

Inventory:
    REFERENCES product_id

Orders:
    REFERENCES product_id

Historical orders:
    MAP TO product_id where possible

Images:
    BELONG TO product_id

Prices:
    BELONG TO product_id

Search:
    SEARCHES centralized catalog

NO independent product databases.


19. FEATURE DEVELOPMENT RULES
------------------------------
To avoid this problem in future:

RULE 1:
Every new feature must identify its source of truth.

RULE 2:
Never duplicate product identity in another module.

RULE 3:
Every product reference must use product_id.

RULE 4:
Images must never become product identity.

RULE 5:
Historical orders must preserve snapshots.

RULE 6:
UI visibility must be controlled by feature flags when a feature may return.

RULE 7:
Business configuration should live in settings/configuration,
not hardcoded inside frontend components.

RULE 8:
Inventory must reference catalog products.

RULE 9:
Payment state must be separate from order state.

RULE 10:
Never use user confirmation alone as proof of payment.

RULE 11:
Every imported record must pass validation and duplicate detection.

RULE 12:
Before adding a new database table, determine whether the information
already belongs to an existing central entity.

RULE 13:
Every feature must define:
- data owner
- unique ID
- API contract
- database relationship
- migration strategy
- rollback strategy
- feature flag
- audit history


20. FEATURE DEVELOPMENT CHECKLIST
---------------------------------
Before coding any new feature:

[ ] What is the single source of truth?
[ ] Does an existing product/entity already represent this data?
[ ] Is a permanent ID required?
[ ] Can this create duplicate records?
[ ] Does this affect historical orders?
[ ] Does this require migration?
[ ] Can this feature be enabled/disabled using configuration?
[ ] Does the API expose the same data to web and mobile?
[ ] Is inventory linked through product_id?
[ ] Are images linked through product_id?
[ ] Are prices separated from product identity?
[ ] Are old orders preserved?
[ ] Is an audit trail required?
[ ] What happens if the feature is disabled?
[ ] What happens if the feature is enabled later?
[ ] Can the feature be removed without breaking existing orders?


21. RECOMMENDED SYSTEM STRUCTURE
--------------------------------

                    ADMIN / SETTINGS
                           |
                           v
                  CENTRAL CATALOG
                           |
          +----------------+----------------+
          |                |                |
       PRODUCTS          IMAGES          PRICES
          |
          v
       INVENTORY
          |
          +----------------+
          |                |
          v                v
       WEBSITE            APP
          |                |
          +--------+-------+
                   |
                   v
                 CART
                   |
                   v
                ORDER
                   |
          +--------+---------+
          |                  |
       PAYMENT             PHARMACY
          |                  |
       QR CONFIG          PICKUP
          |
       VERIFICATION


22. FINAL ARCHITECTURAL PRINCIPLE
---------------------------------
Build the system around stable entities, not screens.

PRODUCT
   -> permanent product_id

IMAGE
   -> product_id

INVENTORY
   -> product_id + pharmacy_id

PRICE
   -> product_id

ORDER ITEM
   -> product_id + historical snapshot

PAYMENT
   -> order_id + selected_qr_id

PHARMACY
   -> pharmacy_id

ADDRESS
   -> user/address_id, currently hidden

DELIVERY
   -> feature-flagged OFF

This means future development becomes:

ADD FEATURE
    |
    v
CONNECT TO EXISTING CENTRAL ENTITY
    |
    v
ADD API / UI
    |
    v
ENABLE FEATURE FLAG
    |
    v
NO ARCHITECTURAL REBUILD

The biggest issue to avoid is creating "another small database" for every
new feature. That innocent little shortcut is how applications eventually
grow six versions of the same product, three definitions of inventory, and
one developer quietly wondering why Order #482 says "Paracetmol" while the
catalog says "Paracetamol 500 mg". One centralized identity model prevents
that entire mess.