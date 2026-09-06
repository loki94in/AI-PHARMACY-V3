# AI-PHARMACY — MULTI-PHARMACY + UNIFIED CUSTOMER ARCHITECTURE
# SINGLE SOURCE OF TRUTH / FEATURE DEVELOPMENT CONTRACT

## 1. CORE PROBLEM

The application is currently designed primarily around a single pharmacy/business context.

Future expansion requires the SAME application/website to support:

- Multiple independent pharmacies
- Multiple distributors
- One customer using multiple pharmacies
- One unified customer profile
- Pharmacy-isolated business data
- Customer-owned purchase history across pharmacies
- Single unified medicine catalogue
- Distributor-specific availability, price, margin, credit and delivery speed
- WhatsApp-aware customer communication
- Pharmacy-controlled distributor selection
- Future commercial deployment to many independent pharmacies

The biggest risk is DATA MIXING.

A pharmacy must NEVER be able to access another pharmacy's:
- Sales
- Bills
- Inventory
- Purchase records
- Distributor transactions
- Internal margins
- Credit information
- Internal business data
- Other pharmacy customers' private information

At the same time, a customer must be able to see THEIR OWN purchases made from multiple participating pharmacies.

Therefore the system MUST separate:

1. CUSTOMER IDENTITY
2. PHARMACY/TENANT IDENTITY
3. BUSINESS DATA
4. CUSTOMER-OWNED CROSS-PHARMACY DATA

--------------------------------------------------
## 2. FUNDAMENTAL ARCHITECTURE

Use two logically independent identity layers.

### CUSTOMER IDENTITY

Primary customer identifier:

    customer_id
    ↓
    verified mobile number

Customer profile may contain:

- Mobile number
- Customer name
- Optional profile information
- WhatsApp availability/status where technically supported

The customer profile is GLOBAL.

The customer does NOT get a separate account for every pharmacy.

Example:

    Customer: 9876543210

Can purchase from:

    Pharmacy A
    Pharmacy B
    Pharmacy C

All purchases can be associated with the SAME customer identity.

--------------------------------------------------
## 3. PHARMACY / TENANT IDENTITY

Every pharmacy must have an immutable unique:

    pharmacy_id / tenant_id

Every pharmacy-owned record MUST be associated with its pharmacy_id.

Examples:

    Sale
    Bill
    Inventory
    Purchase
    Supplier transaction
    Distributor transaction
    Pharmacy settings
    Pharmacy pricing
    Pharmacy margin
    Pharmacy credit
    Pharmacy staff
    Pharmacy reports

Conceptually:

    pharmacy_id
          ↓
    pharmacy-owned data

NEVER assume that the logged-in user alone determines data ownership.

Every protected API/database operation MUST enforce pharmacy/tenant scope.

--------------------------------------------------
## 4. CUSTOMER + PHARMACY RELATIONSHIP

A customer can be associated with multiple pharmacies.

DO NOT duplicate the global customer identity.

Instead:

    Customer
       |
       +---- Pharmacy A relationship
       |
       +---- Pharmacy B relationship
       |
       +---- Pharmacy C relationship

The relationship may contain pharmacy-specific information if required.

Example:

    customer_id = C123
    pharmacy_id = P001

This does NOT create a new customer identity.

It creates a relationship between the customer and pharmacy.

--------------------------------------------------
## 5. OLD BILLS MUST NEVER CHANGE

This is mandatory.

When a bill is generated, customer information required for legal/accounting/history purposes MUST be stored as a snapshot on that bill.

Example:

    Customer profile name:
        Rahul Patil

Bill created:

    Bill #1001
    Customer name snapshot:
        Rahul Patil

Later customer changes profile name:

    Rohan Patil

Bill #1001 MUST STILL SHOW:

    Rahul Patil

Never dynamically render historical bill identity from the current customer profile.

Historical bills are immutable.

--------------------------------------------------
## 6. NEW BILLS

When POS receives a verified customer mobile number:

    Search customer identity
            ↓
    Find customer profile
            ↓
    Load current profile name
            ↓
    Pre-fill POS customer information
            ↓
    Create new bill
            ↓
    Store current name as bill snapshot

Therefore:

OLD BILL
    → never changes

NEW BILL
    → uses latest customer profile information

--------------------------------------------------
## 7. CUSTOMER PURCHASE HISTORY

Customer can see:

    My Purchases

This may contain:

    Pharmacy A
        Bill #1001
        Medicine X
        Date
        Quantity

    Pharmacy B
        Bill #5502
        Medicine Y
        Date
        Quantity

    Pharmacy C
        Bill #9201
        Medicine Z
        Date
        Quantity

This is a CUSTOMER VIEW.

A pharmacy does NOT receive permission to see purchases made at other pharmacies.

--------------------------------------------------
## 8. PHARMACY DATA ISOLATION

Pharmacy A:

    CAN SEE:
        Pharmacy A customers/transactions
        Pharmacy A bills
        Pharmacy A inventory
        Pharmacy A orders
        Pharmacy A distributors
        Pharmacy A margins
        Pharmacy A credit
        Pharmacy A reports

    CANNOT SEE:
        Pharmacy B bills
        Pharmacy B inventory
        Pharmacy B internal margins
        Pharmacy B distributor transactions
        Pharmacy B private business data

Same rule applies to every pharmacy.

This MUST be enforced at the backend/database authorization layer.

UI hiding is NOT sufficient.

--------------------------------------------------
## 9. SINGLE PUBLIC WEBSITE

Use one common commercial website/application.

Example:

    app.example.com

Customer opens the same website.

Customer logs in using:

    Mobile Number
         ↓
       OTP
         ↓
    Customer Identity

If customer is associated with one pharmacy:

    Automatically select pharmacy

If associated with multiple pharmacies:

    Show pharmacy selection

Optional:

    Nearby pharmacy
         ↓
    Location permission
         ↓
    Suggest nearby participating pharmacy

The customer should not need a different website for every pharmacy.

--------------------------------------------------
## 10. PHARMACY SELECTION

Customer may have:

    Pharmacy A
    Pharmacy B
    Pharmacy C

Customer selects:

    Pharmacy B

The current order context becomes:

    pharmacy_id = Pharmacy B

The customer identity remains:

    customer_id = same customer

Changing pharmacy MUST NOT create a new customer.

Changing pharmacy MUST NOT expose another pharmacy's business data.

--------------------------------------------------
## 11. SINGLE MEDICINE CATALOGUE

Do NOT create duplicate customer-facing medicines for every distributor.

Use a normalized Master Medicine identity.

Example:

    MASTER MEDICINE
        |
        +---- Distributor A naming
        +---- Distributor B naming
        +---- Distributor C naming
        +---- Pharmacy-specific stock
        +---- Distributor-specific availability

Example:

Distributor A:

    "Paracetamol 500mg Tab"

Distributor B:

    "PCM 500 Tablet"

Distributor C:

    "Paracetamol Tablets 500 MG"

These may refer to the SAME master medicine.

The system should map them to:

    master_medicine_id = M123

The customer sees:

    Paracetamol 500 mg

Not three duplicate medicines.

--------------------------------------------------
## 12. DISTRIBUTOR LAYER

Distributor information MUST remain separate from the Master Medicine.

For example:

    Master Medicine
          |
          +---- Distributor A
          |       stock
          |       price
          |       delivery ETA
          |       margin
          |       credit
          |
          +---- Distributor B
          |       stock
          |       price
          |       delivery ETA
          |       margin
          |       credit
          |
          +---- Distributor C
                  stock
                  price
                  delivery ETA
                  margin
                  credit

The customer generally does NOT need to see these internal distributor decisions.

--------------------------------------------------
## 13. CUSTOMER ORDER FLOW

Customer:

    Select medicine
        ↓
    Select quantity
        ↓
    Add to cart
        ↓
    Place order/request
        ↓
    Send order to selected pharmacy

The customer should see ONE unified medicine.

The pharmacy receives:

    Customer
    Medicine
    Quantity
    Order details

--------------------------------------------------
## 14. PHARMACY DISTRIBUTOR DECISION

After receiving an order:

    Pharmacy checks local inventory

If pharmacy has sufficient stock:

    Use pharmacy stock

If pharmacy does NOT have sufficient stock:

    Check eligible distributors

Distributor selection can consider:

    1. Availability
    2. Delivery speed
    3. Distance
    4. Distributor reliability
    5. Pharmacy margin
    6. Pharmacy credit availability
    7. Distributor price
    8. Minimum order quantity
    9. Expected delivery time

The pharmacy remains in control of the final distributor selection.

The system can RECOMMEND the best distributor but must not silently make business decisions unless the pharmacy explicitly enables automatic selection.

--------------------------------------------------
## 15. DISTRIBUTOR AVAILABILITY

If distributors provide structured availability information:

    distributor_stock
    distributor_price
    estimated_dispatch_time
    estimated_delivery_time
    service_status

The application can calculate:

    Best Available Distributor

Example:

    Distributor A
        Stock: YES
        Dispatch: 10 min
        Credit: YES

    Distributor B
        Stock: YES
        Dispatch: 45 min
        Credit: YES

    Distributor C
        Stock: NO

System recommendation:

    Distributor A

Pharmacy can accept or change the selection.

--------------------------------------------------
## 16. WHATSAPP NUMBER CHECK

In POS/customer entry:

    Pharmacy enters customer mobile number

The system should NOT unnecessarily perform multiple API calls.

Use a controlled background check.

Conceptually:

    Number entered
         ↓
    Validate format
         ↓
    Debounce
         ↓
    Check local/customer data first
         ↓
    If required, check WhatsApp capability
         ↓
    Cache result with timestamp
         ↓
    Update UI status

Possible UI states:

    Checking...

    WhatsApp Available

    WhatsApp Not Available

    Unable to Verify

IMPORTANT:

Do NOT claim WhatsApp availability unless the configured WhatsApp integration/API actually supports that verification.

Never repeatedly call the WhatsApp service for the same number while typing.

--------------------------------------------------
## 17. WHATSAPP ORDER / UPDATE FLOW

After customer is added to an order/cart:

    Customer mobile
        ↓
    Verified WhatsApp capability
        ↓
    If available:
        send permitted WhatsApp communication

If unavailable:

    Show:
        "WhatsApp unavailable / unable to verify"

Then pharmacy can ask customer for a valid WhatsApp number if required.

WhatsApp messaging must remain asynchronous.

It MUST NOT block:

    POS
    Billing
    Inventory
    Checkout

--------------------------------------------------
## 18. PHARMACY AND CUSTOMER IDENTITIES MUST NEVER BE MIXED

DO NOT use:

    mobile_number

as the only authorization mechanism.

Mobile number identifies the customer.

It does NOT grant pharmacy access.

Authorization must additionally validate:

    authenticated_user
    +
    role
    +
    pharmacy_id/tenant_id
    +
    requested_resource
    +
    permission

Example:

    Customer ID = C123
    Pharmacy ID = P001

Customer can access:

    C123's permitted data

Pharmacy P001 can access:

    P001's permitted business data

Pharmacy P002 cannot access:

    P001's private business data

--------------------------------------------------
## 19. FINE-GRAINED PERMISSIONS

Do not create only:

    Admin
    User

Instead support permissions such as:

    view_sales
    create_sale
    edit_sale
    cancel_sale
    view_inventory
    edit_inventory
    view_customers
    view_reports
    manage_distributors
    manage_settings
    manage_staff
    manage_catalog
    manage_orders

Example:

    Pharmacist:
        billing
        inventory
        customer lookup

    Manager:
        pharmacist permissions
        reports
        distributor management

    Owner:
        full pharmacy permissions

Permissions MUST be pharmacy-scoped.

--------------------------------------------------
## 20. CATALOG MANAGEMENT

Existing catalogue upload functionality must remain supported.

The future system should allow:

    Pharmacy catalogue upload
          ↓
    Medicine normalization
          ↓
    Match against Master Medicine
          ↓
    Create mapping when matched
          ↓
    Flag uncertain matches for review

DO NOT automatically merge medicines based only on similar names.

Medicine matching should consider relevant attributes such as:

    Generic composition
    Strength
    Dosage form
    Pack size
    Manufacturer
    Product identifiers where available

Potential duplicate:

    "Medicine A 500"

and

    "Medicine A 250"

MUST NOT be merged.

--------------------------------------------------
## 21. CATALOG PROVIDER FLEXIBILITY

The architecture should allow future catalog sources.

Possible sources:

    Pharmacy uploaded catalogue
    Official supplier/catalogue feed
    Distributor catalogue
    Licensed external catalogue/API

But all sources must eventually map into:

    Master Medicine

Do not make the frontend directly dependent on one external provider.

Use a provider/adapter layer.

This allows changing providers later without rewriting the customer-facing application.

--------------------------------------------------
## 22. DATA OWNERSHIP RULE

Every piece of data MUST have an explicit owner/context.

Before adding a new table/entity/field ask:

    Who owns this data?

Possible answers:

    GLOBAL
    CUSTOMER
    PHARMACY
    DISTRIBUTOR
    ORDER
    BILL
    SYSTEM

If the answer is unclear:

    STOP FEATURE IMPLEMENTATION

and define ownership first.

--------------------------------------------------
## 23. API RULE

Every pharmacy-sensitive API MUST validate tenant scope.

BAD:

    GET /api/bills

GOOD CONCEPT:

    Authenticated pharmacy context
          ↓
    pharmacy_id
          ↓
    query only records belonging to pharmacy_id

Never rely on:

    frontend pharmacy_id

alone.

The backend must derive/validate the authorized pharmacy context.

--------------------------------------------------
## 24. CUSTOMER CROSS-PHARMACY DATA

Cross-pharmacy customer history must be intentionally designed.

Customer can see:

    their own purchase history

But a pharmacy sees:

    only its own transactions

Cross-pharmacy aggregation MUST NOT become a backdoor for pharmacy-to-pharmacy data access.

--------------------------------------------------
## 25. SECURITY PRINCIPLE

NEVER solve data isolation using frontend filtering alone.

This is NOT sufficient:

    frontend:
        filter pharmacy_id

Instead:

    Authentication
        ↓
    Authorization
        ↓
    Tenant validation
        ↓
    Database query restriction
        ↓
    Response filtering

All four layers must cooperate.

--------------------------------------------------
## 26. PERFORMANCE PRINCIPLES

The architecture must remain lightweight.

Do not introduce unnecessary:

    API calls
    polling
    database queries
    WhatsApp calls
    distributor calls
    catalogue synchronization
    frontend re-renders

Use:

    caching
    debouncing
    batching
    background workers
    event-driven updates
    incremental synchronization

POS and billing remain priority operations.

Heavy tasks such as:

    OCR
    WhatsApp processing
    catalogue imports
    distributor synchronization
    notifications

must run outside the critical POS request path.

--------------------------------------------------
## 27. FEATURE DEVELOPMENT SAFETY CONTRACT

Before implementing ANY new feature, the developer/agent MUST answer:

### A. What existing module owns this feature?

### B. Is this feature:
    Customer-level?
    Pharmacy-level?
    Distributor-level?
    Global?

### C. Which existing APIs are affected?

### D. Which existing database entities are affected?

### E. Does this introduce cross-pharmacy data access?

### F. Does this add API calls?

### G. Does this add background processing?

### H. Can this block POS/billing?

### I. Can this modify historical records?

### J. Can this change existing UI behaviour?

If any answer is unclear:

    DO NOT IMPLEMENT YET.

--------------------------------------------------
## 28. IMMUTABLE HISTORICAL DATA RULE

Never retroactively modify:

    completed bills
    completed payments
    finalized sales
    historical invoices
    audit records

If correction is required:

    create correction/adjustment record

rather than silently rewriting history.

--------------------------------------------------
## 29. AUDIT TRAIL

Sensitive pharmacy actions should be auditable.

Track:

    who
    what
    when
    pharmacy
    affected record
    previous value where appropriate
    new value where appropriate

Examples:

    Bill cancelled
    Inventory adjusted
    Distributor changed
    Price changed
    Customer information updated
    Permission changed

--------------------------------------------------
## 30. SOFT DELETE

For important business entities:

Prefer:

    active/inactive

or:

    soft delete

instead of immediately destroying historical records.

Historical references must remain valid.

--------------------------------------------------
## 31. MULTI-PHARMACY CUSTOMER SWITCHING

When customer switches:

    Pharmacy A
        ↓
    Pharmacy B

ONLY the active pharmacy context changes.

DO NOT change:

    customer_id

DO NOT merge:

    Pharmacy A business data
    with
    Pharmacy B business data

The customer's global profile remains the same.

--------------------------------------------------
## 32. FUTURE COMMERCIAL MODEL

The architecture should support:

    One application
        ↓
    Many pharmacies
        ↓
    Many customers
        ↓
    Many distributors
        ↓
    One normalized medicine catalogue

Each pharmacy behaves as an independent business.

The platform behaves as a shared technology platform.

--------------------------------------------------
## 33. GOLDEN DATA MODEL

Conceptually:

    CUSTOMER
       |
       +---- CUSTOMER_PHARMACY_RELATIONSHIP
       |             |
       |             +---- PHARMACY A
       |             +---- PHARMACY B
       |             +---- PHARMACY C
       |
       +---- CUSTOMER PURCHASE HISTORY
                     |
                     +---- Pharmacy A sale
                     +---- Pharmacy B sale
                     +---- Pharmacy C sale


    MASTER MEDICINE
       |
       +---- Distributor A offer
       +---- Distributor B offer
       +---- Distributor C offer
       |
       +---- Pharmacy A stock
       +---- Pharmacy B stock
       +---- Pharmacy C stock

This separation is fundamental.

--------------------------------------------------
## 34. "DO NOT BREAK EXISTING APPLICATION" RULE

When implementing this architecture into the existing application:

DO NOT:

    rewrite unrelated modules
    change unrelated frontend UI
    replace working APIs without necessity
    change existing billing behaviour unnecessarily
    change existing database connection architecture unnecessarily
    duplicate existing worker systems
    introduce another state-management system without reason
    introduce another catalogue system without migration planning

First:

    inspect existing implementation

Then:

    identify the smallest affected area

Then:

    modify only related files/modules

Then:

    test existing functionality

Then:

    test new functionality

--------------------------------------------------
## 35. REGRESSION PROTECTION

Every new feature must verify:

    Existing POS works
    Existing billing works
    Existing inventory works
    Existing customer lookup works
    Existing catalogue works
    Existing WhatsApp workflow works
    Existing distributor workflow works
    Existing reports work
    Existing authentication works

New functionality MUST NOT silently change existing behaviour.

--------------------------------------------------
## 36. FEATURE IMPLEMENTATION CHECKLIST

Before merge:

[ ] Tenant isolation tested
[ ] Customer identity tested
[ ] Pharmacy switching tested
[ ] Cross-pharmacy access denied
[ ] Customer cross-pharmacy history works
[ ] Old bills remain unchanged
[ ] New bills use latest customer profile
[ ] Medicine normalization tested
[ ] Duplicate medicines handled safely
[ ] Distributor mapping tested
[ ] POS remains responsive
[ ] WhatsApp calls are controlled
[ ] API call count reviewed
[ ] Database queries reviewed
[ ] Permissions tested
[ ] Audit behaviour tested
[ ] Existing features regression-tested

--------------------------------------------------
## 37. MOST IMPORTANT RULE

The application must always follow:

    ONE CUSTOMER IDENTITY
             +
    MANY INDEPENDENT PHARMACIES
             +
    STRICT PHARMACY DATA ISOLATION
             +
    ONE MASTER MEDICINE CATALOGUE
             +
    MANY DISTRIBUTOR SOURCES
             +
    PHARMACY-CONTROLLED PROCUREMENT
             +
    IMMUTABLE HISTORICAL BILLS
             +
    BACKGROUND PROCESSING FOR HEAVY TASKS
             +
    EXPLICIT AUTHORIZATION
             +
    REGRESSION VALIDATION

--------------------------------------------------
## 38. FINAL ARCHITECTURAL PRINCIPLE

"SHARED PLATFORM DOES NOT MEAN SHARED BUSINESS DATA."

The platform is shared.

The customer identity can be shared.

The master medicine catalogue can be shared.

But:

    Pharmacy business data = PRIVATE
    Pharmacy inventory = PRIVATE
    Pharmacy sales = PRIVATE
    Pharmacy margins = PRIVATE
    Pharmacy distributor relationships = PRIVATE

Customer:

    sees their own permitted history across pharmacies.

Pharmacy:

    sees only its own business data.

This principle must be treated as a permanent architecture rule for ALL future feature development.