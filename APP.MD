AI PHARMACY V3
PRO ARCHITECTURE + LOGIN/OTP + CUSTOMER PORTAL + CATALOG + WEBSITE/APP
IMPLEMENTATION SPECIFICATION

STATUS:
- SECURITY HARDENING: SKIP FOR NOW
- CORE FUNCTIONALITY: PROCEED
- LOGIN/OTP: PROCEED
- CUSTOMER PORTAL: PROCEED
- WEBSITE + APP + CATALOG SYNC: PROCEED
- WHATSAPP: PROCEED
- REFILL/ORDER WORKFLOW: PROCEED
- SETTINGS / MANAGEMENT: PROCEED
- ARCHITECTURE REFACTOR: PROCEED
- FUTURE FEATURE DEVELOPMENT WORKFLOW: PROCEED


============================================================
1. PRIMARY OBJECTIVE
============================================================

Build AI Pharmacy V3 as one connected pharmacy platform:

PHARMACY DESKTOP APP
        |
        +---- Pharmacy Database
        |
        +---- Catalog
        |
        +---- Inventory
        |
        +---- Billing
        |
        +---- Customer Management
        |
        +---- WhatsApp
        |
        +---- Website
        |
        +---- Customer Portal
        |
        +---- Reports
        |
        +---- Settings
        |
        +---- Background Workers


The same core pharmacy data should power:

1. Pharmacy App
2. Customer Website
3. Customer Portal
4. WhatsApp
5. Catalog
6. Orders
7. Refills
8. Customer Bills
9. Inventory availability
10. Pricing configuration


============================================================
2. LOGIN / OTP ARCHITECTURE
============================================================

Proceed with the planned customer login system.

SUPPORTED LOGIN METHODS:

A. Login ID + PIN

B. Mobile Number + OTP

C. Existing customer account recovery through OTP

D. PIN change/reset through OTP


CUSTOMER LOGIN FLOW:

Customer
   |
   v
Website / Customer Portal
   |
   +--> Login with Mobile
   |
   +--> Request OTP
   |
   v
Backend
   |
   +--> Generate OTP
   |
   +--> Store OTP
   |
   +--> Send through WhatsApp/SMS provider
   |
   v
Customer enters OTP
   |
   v
Verify OTP
   |
   v
Customer session
   |
   v
Customer Dashboard


OTP FLOW:

POST /api/customer-portal/auth/request-otp

INPUT:
{
    phone
}

PROCESS:
1. Normalize phone number
2. Find customer account
3. Generate OTP
4. Store OTP
5. Set expiry
6. Send OTP
7. Return success


POST /api/customer-portal/auth/verify-otp

INPUT:
{
    phone,
    otp
}

PROCESS:
1. Validate OTP
2. Mark OTP used
3. Find customer account
4. Create login session
5. Return customer dashboard information


LOGIN RESPONSE SHOULD PROVIDE:

{
    customer: {
        id,
        name,
        phone
    },

    stores: [],

    features: {
        bills: true,
        refills: true,
        orders: true,
        catalog: true,
        prescriptions: true
    }
}


============================================================
3. CUSTOMER PORTAL
============================================================

Customer dashboard:

CUSTOMER DASHBOARD
--------------------------------
Welcome, Customer

Quick Actions:

[Order Medicine]
[Repeat Previous Order]
[View Bills]
[View Refills]
[Track Orders]
[Browse Catalog]

Recent Orders
Recent Bills
Pending Refills
--------------------------------


CUSTOMER PORTAL MODULES:

/customer-portal/login
/customer-portal/dashboard
/customer-portal/catalog
/customer-portal/orders
/customer-portal/orders/:id
/customer-portal/refills
/customer-portal/bills
/customer-portal/history
/customer-portal/profile
/customer-portal/settings


============================================================
4. CATALOG ARCHITECTURE
============================================================

Catalog must become a CENTRAL DATA SOURCE.

Catalog data:

Product
- product_id
- medicine name
- generic name
- brand
- strength
- dosage form
- pack size
- category
- manufacturer
- MRP
- selling price
- stock
- prescription requirement
- image
- active status


CATALOG SHOULD BE AVAILABLE THROUGH:

Pharmacy App
      |
      +--> Website
      |
      +--> Customer Portal
      |
      +--> WhatsApp
      |
      +--> POS
      |
      +--> Reports


Do NOT maintain separate independent catalogs.

Use:

CORE CATALOG
      |
      +--> APP VIEW
      +--> WEBSITE VIEW
      +--> WHATSAPP VIEW
      +--> POS VIEW


============================================================
5. CATALOG MANAGEMENT FROM APP
============================================================

Pharmacy staff should be able to manage the customer-facing catalog directly from:

APP
 |
 v
Settings
 |
 +--> Catalog Management
 |
 +--> Website Settings
 |
 +--> WhatsApp Catalog
 |
 +--> Pricing
 |
 +--> Product Images
 |
 +--> Customer Portal


CATALOG MANAGEMENT:

[Products]

Search product

Product:
    Name
    Generic
    Manufacturer
    MRP
    Selling Price
    Stock
    Image
    Website visibility
    WhatsApp visibility
    Customer portal visibility

Actions:

[Edit]
[Hide]
[Show]
[Upload Image]
[Change Price]


============================================================
6. PRICING MANAGEMENT
============================================================

Create centralized pricing configuration.

SETTINGS
   |
   +--> Pricing Rules
        |
        +--> Default margin
        +--> Category margin
        +--> Product override
        +--> Store override


Example:

DEFAULT MARGIN = 20%

Category:
Antibiotics = 18%
OTC = 25%
Personal Care = 30%

Product override:
Paracetamol = custom price


CALCULATION:

MRP
 |
 +--> Pricing Rule
 |
 +--> Discount
 |
 v
SELLING PRICE


The same pricing engine should be used by:

POS
Website
Customer Portal
Refill
WhatsApp


============================================================
7. WEBSITE + APP SYNCHRONIZATION
============================================================

Website should not maintain a completely separate catalog.

Architecture:

PHARMACY DATABASE
       |
       v
CATALOG SERVICE
       |
       +----------------+
       |                |
       v                v
PHARMACY APP        CUSTOMER WEBSITE
       |                |
       v                v
CUSTOMER PORTAL      WEB ORDERS


Changes from App:

Edit product
Change price
Upload image
Enable/disable product
Change visibility
Change stock

should automatically reflect on:

Website
Customer Portal
WhatsApp


============================================================
8. WEBSITE ORDER FLOW
============================================================

Customer:

Browse Website
     |
     v
Select Medicine
     |
     v
Add to Cart
     |
     v
Checkout
     |
     v
Select:
- Pickup
- Delivery
- Payment
     |
     v
Place Order
     |
     v
Pharmacy App
     |
     v
New Customer Order


PHARMACY APP:

Orders
 |
 +--> New
 +--> Confirmed
 +--> Preparing
 +--> Ready
 +--> Out for Delivery
 +--> Completed
 +--> Cancelled


Customer sees:

Order Placed
      |
      v
Confirmed
      |
      v
Preparing
      |
      v
Ready / Out for Delivery
      |
      v
Completed


============================================================
9. REFILL WORKFLOW
============================================================

Customer opens:

Previous Orders
       |
       v
Select previous invoice
       |
       v
[Order Again]
       |
       v
System loads previous medicines
       |
       v
Check current catalog
       |
       v
Show current availability/pricing
       |
       v
Customer confirms
       |
       v
New refill order


IMPORTANT:

Previous invoice is HISTORY.

New refill is a NEW ORDER.

Do not reuse old prices automatically.

Use current catalog/pricing.


============================================================
10. BILL HISTORY
============================================================

Customer Portal:

My Bills

Invoice #10021
Date
Amount
Store

[View]
[Download]
[Order Again]


Invoice detail:

Products
Quantity
Price
Tax
Discount
Total

Do not mix internal pharmacy accounting information into customer-facing bills.


============================================================
11. WHATSAPP WORKFLOW
============================================================

WhatsApp should become another customer interface.

CUSTOMER
   |
   v
WhatsApp
   |
   +--> Login
   +--> Catalog
   +--> Search Medicine
   +--> Refill
   +--> Order
   +--> Order Status
   +--> Bill
   +--> Support


Example:

Customer:
"Show my previous medicines"

WhatsApp
   |
   v
Customer identification
   |
   v
Previous orders
   |
   v
[Order Again]


WhatsApp should use the SAME:

Catalog Service
Pricing Service
Customer Service
Order Service
Refill Service


Do NOT build separate business logic for WhatsApp.


============================================================
12. CORE SERVICES
============================================================

Create clear service boundaries:

src/services/

catalog/
    catalogService.ts
    catalogPricing.ts
    catalogImages.ts

customer/
    customerService.ts
    customerPortalService.ts

auth/
    customerAuthService.ts
    otpService.ts
    pinService.ts

orders/
    orderService.ts
    orderStatusService.ts

refills/
    refillService.ts

billing/
    billingService.ts

inventory/
    inventoryService.ts

whatsapp/
    whatsappService.ts

website/
    websiteService.ts

notifications/
    notificationService.ts


Routes should call services.

Example:

Route
  |
  v
Controller
  |
  v
Service
  |
  v
Repository / Database


Do not put all business logic inside route files.


============================================================
13. API STRUCTURE
============================================================

Use consistent API naming.

CUSTOMER:

/api/customer/auth/login
/api/customer/auth/request-otp
/api/customer/auth/verify-otp
/api/customer/auth/change-pin

/api/customer/profile

/api/customer/catalog

/api/customer/orders
/api/customer/orders/:id

/api/customer/refills
/api/customer/refills/:id

/api/customer/bills
/api/customer/bills/:id

/api/customer/history


ADMIN:

/api/admin/customers
/api/admin/customer-accounts

/api/admin/catalog
/api/admin/catalog/:id

/api/admin/pricing
/api/admin/orders

/api/admin/website
/api/admin/whatsapp


============================================================
14. DATABASE ARCHITECTURE
============================================================

Use normalized core entities.

CUSTOMERS
CUSTOMER_ACCOUNTS
CUSTOMER_SESSIONS
CUSTOMER_PORTAL_OTPS

PRODUCTS
PRODUCT_IMAGES
PRODUCT_PRICING
PRODUCT_VISIBILITY

INVENTORY
INVENTORY_TRANSACTIONS

SALES
SALE_ITEMS

ORDERS
ORDER_ITEMS
ORDER_STATUS_HISTORY

REFILL_ORDERS
REFILL_ITEMS

STORES

WHATSAPP_MESSAGES
NOTIFICATIONS

SETTINGS


Relationships:

CUSTOMER
   |
   +--> CUSTOMER_ACCOUNT
   |
   +--> SALES
   |
   +--> ORDERS
   |
   +--> REFILLS


PRODUCT
   |
   +--> PRICING
   +--> IMAGES
   +--> INVENTORY
   +--> SALE_ITEMS
   +--> ORDER_ITEMS


============================================================
15. STORE / MULTI-STORE ARCHITECTURE
============================================================

Support multiple pharmacy stores from the beginning.

STORE
 |
 +--> Inventory
 +--> Pricing
 +--> Orders
 +--> Customers
 +--> Billing
 +--> Catalog


Customer can have:

Preferred Store

or

Multiple accessible stores.


Website:

Select Store
      |
      v
Show:
- availability
- price
- delivery
- pickup


============================================================
16. APP SETTINGS ARCHITECTURE
============================================================

Create:

Settings
--------------------------------

Business
  - Pharmacy Details
  - GST
  - Address
  - Invoice Settings

Catalog
  - Product Visibility
  - Images
  - Categories

Pricing
  - Default Margin
  - Category Margin
  - Product Pricing

Website
  - Enable Website
  - Store Selection
  - Delivery
  - Payment

Customer Portal
  - Enable Login
  - OTP
  - PIN
  - Registration

WhatsApp
  - Connection
  - Notifications
  - Auto Replies

Orders
  - Delivery
  - Pickup
  - Status Workflow

Notifications
  - WhatsApp
  - SMS
  - Email


============================================================
17. IMAGE MANAGEMENT
============================================================

Product image workflow:

Product
   |
   v
Image Upload
   |
   v
Image Verification
   |
   v
Approved Image
   |
   +--> Catalog
   +--> Website
   +--> Customer Portal
   +--> WhatsApp


Maintain image metadata:

product_id
image_path
source
verification_status
verification_score
created_at
updated_at


Customer-facing systems should use APPROVED images only.


============================================================
18. BACKGROUND WORKERS
============================================================

Continue the current worker architecture.

Workers:

CATALOG WORKER
EMAIL WORKER
WHATSAPP WORKER
NOTIFICATION WORKER
IMAGE WORKER
ORDER WORKER


Workers must be isolated from the main server where practical.

Use:

WORKER_ROLE=catalog
WORKER_ROLE=email
WORKER_ROLE=whatsapp
WORKER_ROLE=notification


Main server should remain responsive.


============================================================
19. FRONTEND ARCHITECTURE
============================================================

Use feature-based structure.

frontend/src/

features/

auth/
catalog/
customers/
orders/
refills/
billing/
inventory/
website/
whatsapp/
settings/
reports/


shared/

components/
hooks/
api/
utils/
types/


Avoid:

one giant component
one giant API file
one giant context
duplicated catalog logic


============================================================
20. STATE MANAGEMENT
============================================================

Frontend should separate:

SERVER DATA
UI STATE
SESSION STATE


SERVER DATA:

catalog
orders
bills
customers
inventory


UI STATE:

modal
filters
sidebar
selected product


SESSION STATE:

logged-in user
customer
store
permissions


Do not duplicate server data unnecessarily.


============================================================
21. API CLIENT
============================================================

Create centralized API client:

src/api/client.ts

Then:

catalogApi.ts
customerApi.ts
orderApi.ts
refillApi.ts
billingApi.ts
authApi.ts
settingsApi.ts


Frontend components should NOT directly construct random fetch/axios requests everywhere.


============================================================
22. NOTIFICATION ARCHITECTURE
============================================================

Central notification service:

NotificationService

Channels:

WhatsApp
SMS
Email
In-app


Events:

CUSTOMER_REGISTERED
OTP_REQUESTED
ORDER_CREATED
ORDER_CONFIRMED
ORDER_READY
ORDER_OUT_FOR_DELIVERY
ORDER_COMPLETED
REFILL_CREATED
BILL_GENERATED


Example:

Order Created
     |
     v
Event
     |
     v
Notification Service
     |
     +--> WhatsApp
     +--> SMS
     +--> Email
     +--> Portal


============================================================
23. EVENT-DRIVEN WORKFLOW
============================================================

Use internal domain events where useful.

Examples:

product.updated
product.price.changed
product.image.approved

order.created
order.confirmed
order.status.changed

customer.created
customer.login
customer.otp.requested

invoice.created
refill.created


This allows future features without rewriting existing modules.


============================================================
24. CACHING
============================================================

Cache read-heavy information:

Catalog
Product images
Website configuration
Store information


Invalidate cache when:

Product changes
Price changes
Visibility changes
Stock changes


Do not cache data indefinitely.


============================================================
25. PERFORMANCE ARCHITECTURE
============================================================

Continue the current:

lazy route loading
lazy frontend loading
idle prefetch
background workers
schema readiness
tiered loading


Additional rule:

HEAVY OPERATIONS:

OCR
image processing
large reports
catalog rebuild
PDF generation
large exports

should not block normal POS/API operations.


============================================================
26. ERROR HANDLING
============================================================

Central error middleware.

All API errors should return consistent structure:

{
    success: false,
    error: {
        code,
        message
    }
}


Success:

{
    success: true,
    data: {}
}


Never make every route invent its own response format.


============================================================
27. LOGGING
============================================================

Central logger.

Levels:

DEBUG
INFO
WARN
ERROR


Include:

request ID
module
operation
timestamp
duration


Avoid dumping entire request bodies into logs.


============================================================
28. AUDIT / BUSINESS HISTORY
============================================================

Maintain business history for:

Product changes
Price changes
Catalog visibility
Order status
Customer account changes
Website configuration
WhatsApp configuration


This is for operational traceability, not the security-hardening phase.


============================================================
29. TEST ARCHITECTURE
============================================================

Every major feature gets:

Unit tests
Integration tests
API tests
UI tests where useful


Minimum critical workflows:

LOGIN
OTP
CUSTOMER PORTAL
CATALOG
PRICE
ORDER
REFILL
BILL
WHATSAPP


Core workflow test:

Customer
 -> Login
 -> Catalog
 -> Add product
 -> Order
 -> Pharmacy receives order
 -> Confirm
 -> Status update
 -> Customer sees status


Refill test:

Customer
 -> History
 -> Previous invoice
 -> Order Again
 -> Current catalog
 -> New order


============================================================
30. CI/CD
============================================================

Every feature branch / PR should run:

npm ci

npm run typecheck
npm run test
npm run build
npm run build:client

plus existing:

guardrails
drill
watchdog

Frontend:

npm ci
npm run build


A feature should not be considered complete until CI passes.


============================================================
31. PRO FEATURE DEVELOPMENT WORKFLOW
============================================================

EVERY NEW FEATURE MUST FOLLOW:

STEP 1
Define business problem.

STEP 2
Define user workflow.

STEP 3
Define database changes.

STEP 4
Define API contract.

STEP 5
Define service/business logic.

STEP 6
Define frontend UI.

STEP 7
Define integrations.

STEP 8
Define background jobs if required.

STEP 9
Write tests.

STEP 10
Run existing regression tests.

STEP 11
Run build.

STEP 12
Run application smoke test.

STEP 13
Review performance.

STEP 14
Merge.


============================================================
32. FEATURE DESIGN TEMPLATE
============================================================

Every future feature should document:

FEATURE:
<name>

USER:
<who uses it>

PROBLEM:
<problem>

WORKFLOW:
<step-by-step>

DATABASE:
<tables>

API:
<endpoints>

SERVICE:
<business logic>

FRONTEND:
<screens/components>

INTEGRATIONS:
<WhatsApp/Website/etc>

BACKGROUND:
<workers/jobs>

TESTS:
<tests>

DONE WHEN:
<acceptance criteria>


============================================================
33. GOLDEN ARCHITECTURE RULES
============================================================

RULE 1:

One source of truth for business data.


RULE 2:

Do not duplicate business logic between:

App
Website
WhatsApp
Customer Portal.


RULE 3:

All business logic belongs in services/domain modules.


RULE 4:

Routes should remain thin.


RULE 5:

Frontend should consume APIs, not implement business rules.


RULE 6:

Pricing comes from one pricing engine.


RULE 7:

Catalog comes from one catalog system.


RULE 8:

Orders use one order service.


RULE 9:

Refills use one refill service.


RULE 10:

Notifications use one notification service.


RULE 11:

Heavy operations run asynchronously.


RULE 12:

Every major feature must have regression tests.


RULE 13:

Do not break existing POS/billing/inventory workflows when adding customer-facing features.


RULE 14:

Every new feature must define its effect on:

POS
Inventory
Catalog
Customer
Website
WhatsApp
Reports


============================================================
34. IMPLEMENTATION PRIORITY
============================================================

PHASE 1
CORE ARCHITECTURE

- service layer
- API organization
- database organization
- centralized catalog
- centralized pricing
- API client
- error handling
- logging


PHASE 2
CUSTOMER LOGIN

- login ID + PIN
- OTP
- session
- PIN reset
- customer portal


PHASE 3
CUSTOMER PORTAL

- dashboard
- catalog
- bills
- history
- refills
- orders


PHASE 4
WEBSITE

- catalog
- customer login
- cart
- checkout
- orders
- tracking


PHASE 5
WHATSAPP

- customer identification
- OTP
- catalog
- refill
- order
- status
- bill


PHASE 6
CATALOG MANAGEMENT

- app management
- pricing
- images
- visibility
- website sync
- WhatsApp sync


PHASE 7
MULTI-STORE

- stores
- store inventory
- store pricing
- store orders
- store selection


PHASE 8
PERFORMANCE

- caching
- workers
- lazy loading
- background processing
- monitoring


============================================================
35. CURRENT REPOSITORY DIRECTION
============================================================

The current repository already contains important foundations:

- customer portal
- customer authentication routes
- OTP workflow
- refill management
- order tracking
- catalog image workflow
- website routes
- WhatsApp integration
- lazy route loading
- background workers
- schema readiness
- Node SEA packaging


DO NOT THROW THESE AWAY.

Refactor them toward the architecture above.

Prefer:

REFACTOR
over
REWRITE


Reuse existing working functionality wherever possible.


============================================================
36. IMPORTANT: LOGIN + OLD DATA CONTINUITY
============================================================

Customer login must connect the customer to their EXISTING pharmacy data.

After login:

CUSTOMER ACCOUNT
       |
       +--> Existing Customer ID
       |
       +--> Previous Bills
       |
       +--> Previous Medicines
       |
       +--> Previous Refills
       |
       +--> Previous Orders
       |
       +--> Customer Profile


Do NOT create a new customer record every time the customer logs in with OTP.

The identity mapping should remain stable.


============================================================
37. WEBSITE / APP / WHATSAPP DATA FLOW
============================================================

                  CORE DATABASE
                       |
                 DOMAIN SERVICES
                       |
        +--------------+--------------+
        |              |              |
        v              v              v
     APP            WEBSITE       WHATSAPP
        |              |              |
        +--------------+--------------+
                       |
                CUSTOMER PORTAL


Catalog:
ONE SOURCE

Pricing:
ONE SOURCE

Customer:
ONE SOURCE

Orders:
ONE SOURCE

Refills:
ONE SOURCE

Bills:
ONE SOURCE


============================================================
38. DEFINITION OF DONE
============================================================

A feature is DONE only when:

[ ] Business workflow works
[ ] Database migration works
[ ] API works
[ ] Service layer implemented
[ ] Frontend implemented
[ ] Existing features still work
[ ] Website integration checked
[ ] WhatsApp integration checked where applicable
[ ] Tests added
[ ] Existing tests pass
[ ] TypeScript passes
[ ] Build passes
[ ] Packaged application works
[ ] No duplicate business logic introduced
[ ] Documentation updated


============================================================
39. SECURITY SCOPE FOR THIS PHASE
============================================================

SECURITY HARDENING IS EXPLICITLY DEFERRED.

Do NOT block the current architecture implementation because of:

- IDOR hardening
- advanced session security
- stronger password/PIN KDF
- OTP cryptographic hardening
- advanced authorization
- rate-limit hardening


However:

Do not intentionally introduce new security weaknesses where avoidable.

Build the architecture so these protections can be added later without rewriting the system.


============================================================
40. FINAL ARCHITECTURE
============================================================

                  AI PHARMACY V3
                         |
              +----------+----------+
              |                     |
          CORE DOMAIN          INFRASTRUCTURE
              |                     |
      +-------+-------+       +-----+------+
      |       |       |       |            |
   Catalog Customer Orders  Database     Workers
      |       |       |
   Pricing  Auth     Refills
      |       |       |
      +-------+-------+
              |
        Notification
              |
      +-------+--------+
      |       |        |
    WhatsApp Website  Portal
              |
             App


The goal is:

ONE PHARMACY SYSTEM
ONE CORE DATA MODEL
ONE CATALOG
ONE PRICING ENGINE
ONE CUSTOMER RECORD
ONE ORDER ENGINE
ONE REFILL ENGINE
ONE NOTIFICATION ENGINE

with multiple interfaces:

PHARMACY APP
WEBSITE
CUSTOMER PORTAL
WHATSAPP


IMPLEMENTATION PRINCIPLE:

"BUILD THE BUSINESS LOGIC ONCE.
EXPOSE IT THROUGH MULTIPLE CHANNELS."

Security hardening remains a later phase and must not prevent completion of the functional architecture described above.