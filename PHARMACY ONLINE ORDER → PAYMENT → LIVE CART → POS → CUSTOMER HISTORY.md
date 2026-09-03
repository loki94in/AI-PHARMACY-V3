# PHARMACY ONLINE ORDER → PAYMENT → LIVE CART → POS → CUSTOMER HISTORY
# FINAL WORKFLOW & DATA INTEGRITY RULES

## 1. CORE PRINCIPLE

The system must maintain ONE connected product ecosystem:

    MASTER PRODUCT
          ↓
    INVENTORY
          ↓
    ONLINE CATALOG
          ↓
    CUSTOMER ORDER
          ↓
    PAYMENT
          ↓
    PHARMACY LIVE CART
          ↓
    FINAL PRODUCT CONFIRMATION
          ↓
    POS SALE
          ↓
    CUSTOMER HISTORY
          ↓
    FUTURE REFILL

The same product must remain traceable across every stage.

DO NOT create disconnected product records for:

    Inventory
    Online Catalog
    Pharmacy Cart
    POS
    Customer History
    Refills

Use a stable internal product_id.

---

# 2. IMPORTANT: PAYMENT DOES NOT MEAN FINAL SALE

Payment confirmation means:

    CUSTOMER HAS PAID

It does NOT automatically mean:

    PHARMACY HAS CONFIRMED THE ACTUAL PRODUCT

Therefore the order lifecycle must be:

    ONLINE ORDER
        ↓
    PAYMENT
        ↓
    PAYMENT CONFIRMED
        ↓
    PHARMACY PRODUCT VERIFICATION
        ↓
    LIVE PHARMACY CART
        ↓
    FINAL ORDER CONFIRMATION
        ↓
    POS SALE / FULFILMENT

This prevents a customer from paying for a product that is
actually unavailable in the pharmacy.

---

# 3. PHARMACY LIVE CART

After successful payment confirmation, the order must appear
inside the pharmacy's LIVE ORDER / LIVE CART interface.

Example:

    Customer:
    Rahul

    Order:
    ORD-10025

    Product:
    Medicine A

    Requested Quantity:
    2

    Payment:
    CONFIRMED

    Pharmacy Action:
    [Add to Live Cart]
    [Replace Product]
    [Unavailable]
    [Modify Quantity]

The pharmacy can then physically verify the medicine.

---

# 4. ACTUAL PRODUCT VERIFICATION

The pharmacy must be able to confirm:

    Product available
    Product unavailable
    Quantity available
    Different batch available
    Different MRP batch available
    Alternative matching product
    Wrong catalog mapping

Example:

Customer requested:

    Product ID: MED-1001

Pharmacy finds:

    Batch A
    Quantity: 2
    MRP: ₹100

System can confirm the actual inventory product.

If the requested product is unavailable:

    DO NOT silently substitute another product.

Pharmacy must explicitly choose:

    Replace
    Remove
    Modify quantity
    Contact customer
    Cancel/refund

---

# 5. ADD PRODUCT TO LIVE CART

Once pharmacy verifies the physical product:

    Payment Confirmed
          ↓
    Verify Inventory
          ↓
    Select Actual Batch/Product
          ↓
    Add to Pharmacy Live Cart
          ↓
    Lock/Reserve Stock
          ↓
    Finalize Order

The live cart should reference:

    order_id
    product_id
    inventory_batch_id
    quantity
    MRP
    selling_price
    discount
    final_price

This provides complete traceability.

---

# 6. FINAL ORDER CONFIRMATION

Final confirmation should happen only after pharmacy verification.

Example:

    Customer requested:
    2 × Medicine A

    Pharmacy confirms:
    2 × Medicine A
    Batch: ABC123
    MRP: ₹120
    Discount: ₹12
    Final: ₹108

Then:

    ORDER_STATUS = CONFIRMED
    PAYMENT_STATUS = PAID
    INVENTORY_STATUS = RESERVED/DEDUCTED
    POS_STATUS = PENDING

Only now should the system consider the order
ready for actual fulfilment/POS processing.

---

# 7. IF PHARMACY FINDS A DIFFERENT PRODUCT

The pharmacy must have a controlled "Change Product" function.

Example:

    Requested Online Product
             ↓
    Pharmacy cannot find exact product
             ↓
    Search Inventory
             ↓
    Select Correct Product
             ↓
    System displays:

        Requested Product
        Actual Product
        Manufacturer
        Pack Size
        MRP
        Selling Price
        Batch
        Quantity

Pharmacy confirms the mapping.

DO NOT silently change product_id.

Store both:

    requested_product_id
    actual_product_id

This preserves history.

---

# 8. PRODUCT/CATALOG MAPPING CORRECTION

Human pharmacy staff must be able to correct a wrong mapping.

Example:

    Online Catalog Product:
    MED-1001

Incorrectly connected to:

    Inventory Product:
    MED-9001

Pharmacy can:

    Disconnect
          ↓
    Search correct inventory product
          ↓
    Select MED-1001
          ↓
    Confirm mapping
          ↓
    Save

After correction:

    Online Catalog
         ↕
    Master Product
         ↕
    Inventory
         ↕
    POS

must all point to the correct product.

The correction must NOT create a duplicate product unless
the products are genuinely different.

---

# 9. MULTIPLE DISTRIBUTORS

A product can have multiple distributors.

Example:

    Product:
    Paracetamol 500mg

    Distributor A
    Distributor B
    Distributor C

Distributor data should be stored separately from the product.

Recommended structure:

    products
        product_id

    distributors
        distributor_id
        name

    inventory_batches
        batch_id
        product_id
        distributor_id
        batch_number
        expiry_date
        quantity
        mrp
        purchase_price

The product remains the same.

Only the supply/distributor information changes.

---

# 10. DISTRIBUTOR-SPECIFIC MANAGEMENT

Pharmacy staff must be able to see:

    Product
    Distributor
    Batch
    Quantity
    Purchase Price
    MRP
    Expiry
    Stock Location

Example:

    Medicine A

    Distributor 1
       Batch X
       Qty 20

    Distributor 2
       Batch Y
       Qty 10

Do NOT create:

    Medicine A - Distributor 1
    Medicine A - Distributor 2

as separate customer-facing products.

They are inventory/supply records of the same master product.

---

# 11. HIGHEST VALID MRP

If multiple valid batches exist:

    Batch A → MRP ₹100
    Batch B → MRP ₹120

Customer-facing catalog:

    MRP = ₹120

But preserve both batch records internally.

The system must NEVER merge batches.

The customer-facing MRP is a derived value.

The actual POS sale must use the selected valid batch.

---

# 12. CUSTOMER RECORD

Every completed POS sale should be attached to the customer record.

Example:

    Customer
       ↓
    Purchase History
       ↓
    Order
       ↓
    Products
       ↓
    Actual Product
       ↓
    Batch
       ↓
    Pharmacy
       ↓
    Date
       ↓
    Quantity
       ↓
    Price

This creates a complete customer purchase history.

---

# 13. CUSTOMER CAN SEE PURCHASE HISTORY

Customer portal/app should show:

    Previous Orders
    Purchased Medicines
    Quantity
    Date
    Pharmacy
    Order Status
    Refill Eligibility

The customer should NOT necessarily see sensitive internal
information such as:

    Distributor purchase price
    Supplier margin
    Internal inventory cost
    Internal procurement information

---

# 14. REFILL SYSTEM

A completed purchase can become a future refill.

Example:

    Customer previously purchased:

    Medicine A
    Quantity: 30

Customer clicks:

    [Refill]

System creates a NEW order based on the previous
product identity.

IMPORTANT:

The refill must fetch CURRENT:

    Availability
    MRP
    Discount
    Pharmacy stock
    Product status

It must NOT blindly reuse the old price.

Old order:

    ₹100

Current product:

    ₹120

New refill should use the current valid pricing rules.

---

# 15. NEW CUSTOMER WORKFLOW

The same workflow must work for every new customer.

    New Customer
         ↓
    Select Pharmacy
         ↓
    Browse Master Online Catalog
         ↓
    Select Product
         ↓
    Add Cart
         ↓
    Final Price
         ↓
    Payment
         ↓
    Pharmacy Verification
         ↓
    Live Cart
         ↓
    Final Confirmation
         ↓
    POS
         ↓
    Customer Record Created/Updated
         ↓
    Purchase History
         ↓
    Future Refill

No separate manual workflow should be required for new customers.

---

# 16. CUSTOMER + PRODUCT RELATIONSHIP

Do NOT permanently attach a product to a customer merely
because they purchased it once.

Store the purchase relationship:

    customer_id
    order_id
    product_id
    quantity
    date

This allows the same master catalog to serve:

    Existing customers
    New customers
    Refills
    Online orders
    POS customers

---

# 17. INVENTORY AVAILABILITY CONFIRMATION

The online system should show an estimated/current availability.

However, the pharmacy confirmation is the final operational
confirmation.

Example:

    Online:
    "In Stock"

Customer orders.

Then pharmacy checks physical inventory.

If physical stock differs:

    Pharmacy can mark:

    AVAILABLE
    PARTIAL
    UNAVAILABLE

The system must record the reason when applicable.

This handles stock discrepancies safely.

---

# 18. RESERVATION / STOCK RACE CONDITION

Multiple customers may order the same product simultaneously.

Example:

    Actual stock = 1

Customer A orders → 1
Customer B orders → 1

The system must NOT allow:

    Customer A → 1
    Customer B → 1
    Inventory → -1

Use transactional stock reservation.

Example:

    AVAILABLE
        ↓
    RESERVED
        ↓
    CONFIRMED
        ↓
    SOLD

or:

    AVAILABLE
        ↓
    RESERVED
        ↓
    RELEASED

if the order is cancelled.

---

# 19. POS CONNECTION

When the pharmacy sells the product through POS:

    POS Sale
       ↓
    customer_id
       ↓
    order_id (if online)
       ↓
    product_id
       ↓
    batch_id
       ↓
    quantity
       ↓
    final price

This creates a single traceable chain.

Online Order and POS Sale must NOT become unrelated records.

---

# 20. MANUAL HUMAN CORRECTION

The application must allow authorized pharmacy staff to correct:

    Wrong product mapping
    Wrong image
    Wrong catalog connection
    Wrong batch selection
    Incorrect quantity
    Product availability
    Product replacement

BUT every manual correction should create an audit record.

Example:

    Changed by:
    Staff User

    Old Product:
    MED-1001

    New Product:
    MED-1055

    Reason:
    Incorrect catalog mapping

    Date:
    Timestamp

Never silently overwrite important operational history.

---

# 21. PRODUCT IMAGE MANAGEMENT

Each product can contain:

    FRONT
    BACK
    SIDE
    OTHER

Images are attached to product_id.

Customer sees:

    [Front]
    [Back]
    [Side]
    [More]

Pharmacy can manage images directly from the application.

A wrong image can be replaced/deactivated without changing
the product identity.

---

# 22. ONLINE CATALOG AUTO UPDATE

The Online Catalog must automatically reflect:

    Product activation
    Product deactivation
    Stock
    Highest valid MRP
    Current selling price
    Discount
    Product images
    Correct product mapping

No duplicate manual catalog update should be required.

Architecture:

    MASTER PRODUCT
          ↓
    INVENTORY
          ↓
    EVENT / SYNC
          ↓
    ONLINE CATALOG

---

# 23. INFINITE SCROLL

Customer catalog UI should support infinite scrolling.

Frontend:

    Load products
        ↓
    Scroll
        ↓
    Fetch next cursor
        ↓
    Append products
        ↓
    Continue

Backend must still use pagination/cursor-based loading.

NEVER load the entire medicine database into the browser.

---

# 24. PAYMENT + ORDER FAILURE CASES

The system must explicitly handle:

    Payment successful + product available
        → Continue

    Payment successful + product unavailable
        → Pharmacy review / replacement / refund

    Payment failed
        → Order remains unpaid

    Payment pending
        → Do not finalize

    Pharmacy rejects order
        → Refund workflow

    WhatsApp fails
        → Order remains valid

    Catalog sync fails
        → Retry + log

    POS integration fails
        → Do not silently mark POS sale completed

---

# 25. DATABASE DESIGN RULE

Recommended entities:

    pharmacies
    customers
    products
    product_images
    distributors
    inventory_batches
    inventory_movements
    catalog_mappings
    carts
    orders
    order_items
    payments
    pos_sales
    pos_sale_items
    customer_purchase_history
    audit_logs

Do not create duplicate product tables for every module.

---

# 26. MASTER PRODUCT ID RULE

Every system must use:

    product_id

as the primary product reference.

Barcode can be an additional identifier.

Product name is NOT a reliable unique identifier.

Example:

    "Paracetamol 500"

can exist from multiple manufacturers.

Therefore matching must consider appropriate identifiers such as:

    manufacturer
    composition
    strength
    pack size
    barcode
    internal product_id

Never automatically merge products solely because names are similar.

---

# 27. CATALOG MAPPING SAFETY

When importing/syncing products:

    DO NOT automatically connect uncertain products.

If confidence is low:

    FLAG FOR HUMAN REVIEW

Example:

    Possible Match:
    72%

Then:

    [Review Mapping]

Human selects the correct product.

This is critical for pharmacy systems.

A wrong automatic medicine mapping can create serious
operational and safety problems.

---

# 28. AI AGENT RULE

Before modifying any product/catalog/inventory/order/payment code,
the AI coding agent MUST:

    1. Inspect existing database schema.
    2. Search for existing product models.
    3. Search for inventory models.
    4. Search for catalog models.
    5. Search for POS integration.
    6. Search for customer records.
    7. Search for payment implementation.
    8. Search for WhatsApp integration.
    9. Search for existing indexes.
    10. Identify all dependencies.

The agent must REUSE existing architecture whenever possible.

DO NOT create a second implementation simply because the
existing implementation is not visible in the current UI.

---

# 29. REQUIRED END-TO-END TEST

Before feature completion, test this exact scenario:

    1. Create/select pharmacy.
    2. Create/select customer.
    3. Product exists in inventory.
    4. Product is mapped to online catalog.
    5. Product has front/back/side images.
    6. Multiple batches exist.
    7. Different MRPs exist.
    8. Highest valid MRP appears online.
    9. Customer sees current availability.
    10. Customer adds product to cart.
    11. System calculates final price.
    12. Customer submits order.
    13. Customer pays.
    14. Payment becomes CONFIRMED.
    15. Order appears in pharmacy Live Orders.
    16. Pharmacy checks physical inventory.
    17. Pharmacy selects actual batch/product.
    18. Product is added to Live Pharmacy Cart.
    19. Pharmacy finalizes order.
    20. POS sale is created/linked.
    21. Stock is correctly deducted.
    22. Customer purchase history is updated.
    23. Customer can see the purchase.
    24. Customer can initiate a refill.
    25. Refill uses current availability and pricing.
    26. No negative inventory occurs.
    27. Correct product mapping remains intact.
    28. Audit log records manual changes.

---

# 30. DEFINITION OF DONE

The feature is NOT COMPLETE until:

    [ ] Inventory and Online Catalog share master product identity
    [ ] Automatic inventory/catalog synchronization works
    [ ] Highest valid MRP is displayed
    [ ] Negative stock is impossible
    [ ] Multiple product images work
    [ ] Pharmacy can manage images
    [ ] Infinite scrolling works
    [ ] Online cart works
    [ ] Payment QR works per pharmacy
    [ ] Payment status is independently tracked
    [ ] Paid orders enter Pharmacy Live Orders
    [ ] Pharmacy verifies actual stock
    [ ] Pharmacy can select actual batch
    [ ] Pharmacy can correct wrong product mapping
    [ ] Multiple distributors are supported
    [ ] Distributor data remains separate from product identity
    [ ] POS sale links to online order
    [ ] Customer history is updated
    [ ] Refill uses current pricing/availability
    [ ] New customers follow the same workflow
    [ ] Manual corrections are audited
    [ ] Sync failures are retryable
    [ ] Database indexes are verified
    [ ] Production-like end-to-end testing passes

---

# FINAL SYSTEM FLOW

CUSTOMER
   ↓
ONLINE WEBSITE / APP
   ↓
MASTER ONLINE CATALOG
   ↓
SELECT PHARMACY
   ↓
SELECT PRODUCT
   ↓
ONLINE CART
   ↓
CURRENT MRP + DISCOUNT + FINAL PRICE
   ↓
ORDER
   ↓
PAYMENT / PHARMACY QR
   ↓
PAYMENT CONFIRMED
   ↓
PHARMACY LIVE ORDER
   ↓
PHARMACY CHECKS ACTUAL PHYSICAL STOCK
   ↓
SELECT ACTUAL PRODUCT + BATCH
   ↓
ADD TO PHARMACY LIVE CART
   ↓
FINALIZE ORDER
   ↓
POS
   ↓
ACTUAL SALE
   ↓
INVENTORY DEDUCTION
   ↓
CUSTOMER PURCHASE HISTORY
   ↓
CUSTOMER CAN SEE PURCHASE
   ↓
FUTURE REFILL
   ↓
CURRENT MASTER CATALOG
   ↓
CURRENT PRICE + CURRENT AVAILABILITY

MASTER CATALOG remains the central product identity.

INVENTORY controls actual availability.

PHARMACY confirms physical availability.

PAYMENT confirms money received.

POS confirms the actual pharmacy sale.

CUSTOMER HISTORY preserves what was actually purchased.

REFILL creates a NEW order using the CURRENT catalog/inventory