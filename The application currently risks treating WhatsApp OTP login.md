PROJECT REQUIREMENT / ARCHITECTURE RULE
=======================================

ISSUE
-----
The application currently risks treating WhatsApp OTP login, catalog data,
old bills/invoices, orders, customer history, website data, and mobile-app
data as separate pieces of information.

This can cause problems such as:

1. User logs in with WhatsApp OTP but cannot see old bills.
2. Old bills disappear after logout/login.
3. Catalog shown on website differs from catalog shown in mobile app.
4. Product price changes accidentally modify historical bills.
5. User creates duplicate accounts when logging in again.
6. Data becomes disconnected because phone number is being used directly
   throughout the application instead of a permanent internal user ID.
7. Changes made in the app are not reflected on the website, or vice versa.
8. Future developers may create duplicate APIs/tables/data structures
   because there is no single source of truth.
9. Deleting or changing a product can break old invoices.
10. Authentication logic becomes mixed with business-data logic.


ROOT CAUSE
----------
Authentication and business data are being treated as the same thing.

WhatsApp OTP should ONLY prove that the person controls a phone number.

WhatsApp OTP must NOT be used as the database identity for orders,
invoices, catalog, customers, settings, etc.

The system must have:

    phone_number = authentication/login identifier

and

    user_id = permanent internal application identity


CORRECT ARCHITECTURE
--------------------

                    WHATSAPP
                       |
                       v
                 OTP SERVICE
                       |
                       v
               AUTHENTICATION
                       |
                 verify OTP
                       |
                       v
                PERMANENT USER
                   user_id
                       |
        +--------------+--------------+
        |              |              |
        v              v              v
     CATALOG         ORDERS         INVOICES
        |              |              |
        +--------------+--------------+
                       |
                       v
                 CENTRAL DATABASE
                       |
             +---------+---------+
             |                   |
             v                   v
         WEB APP            MOBILE APP

Both Web and Mobile MUST use the same backend APIs and the same database.

There must NOT be separate catalog, order, invoice, or customer databases
for Web and Mobile unless there is a specific architectural reason and
synchronization strategy.


IDENTITY MODEL
--------------

User table:

    user_id
    phone_number
    name
    email
    status
    created_at
    updated_at

Rules:

1. user_id must be immutable.
2. phone_number must be unique.
3. Never use phone_number as the primary key for business records.
4. Every business record must reference user_id.
5. OTP verification must locate the existing user using the verified
   phone number.
6. If the user already exists, login to the existing user.
7. Do NOT create a new user every time an OTP is verified.


LOGIN FLOW
----------

User enters phone number
        |
        v
Send WhatsApp OTP
        |
        v
User enters OTP
        |
        v
Verify OTP
        |
        v
Find user by verified phone number
        |
        +---------------------------+
        |                           |
      EXISTS                    DOES NOT EXIST
        |                           |
        v                           v
   Login existing user          Create user
        |                           |
        +-------------+-------------+
                      |
                      v
               Generate session
                      |
                      v
                 Dashboard
                      |
        +-------------+-------------+
        |             |             |
        v             v             v
     Catalog        Orders        Bills


DATA RELATIONSHIPS
------------------

Users
-----
user_id = U1001
phone_number = +XXXXXXXXXXX


Catalog
-------
catalog_id
user_id
product_id
product_name
category_id
selling_price
tax_rate
stock
status
created_at
updated_at


Orders
------
order_id
user_id
customer_id
order_date
subtotal
tax
discount
total
payment_status
status


Order Items
-----------
order_item_id
order_id
product_id
product_name_snapshot
quantity
unit_price_snapshot
tax_rate_snapshot
discount_snapshot
line_total


Invoices
--------
invoice_id
user_id
order_id
invoice_number
invoice_date
subtotal
tax
discount
total
payment_status


Invoice Items
-------------
invoice_item_id
invoice_id
product_id
product_name_snapshot
quantity
unit_price_snapshot
tax_rate_snapshot
discount_snapshot
line_total


IMPORTANT HISTORICAL DATA RULE
------------------------------

Historical invoices/bills MUST NOT depend on the current catalog price.

Example:

January:
    Product A = ₹100

March:
    Product A = ₹120

January invoice MUST continue showing:

    Product A
    Quantity = 2
    Price = ₹100
    Total = ₹200

Changing the catalog price to ₹120 must NOT change the January invoice.

Therefore invoice/order items must store a SNAPSHOT of:

    product_name
    quantity
    unit_price
    tax
    discount
    applicable charges

The current catalog should only be used when creating a NEW order/bill.


PRODUCT DELETION RULE
---------------------

Never physically delete a product if it is referenced by historical
orders/invoices.

Instead use:

    status = ACTIVE
    status = INACTIVE
    status = ARCHIVED

This allows the product to disappear from the active catalog while
preserving historical transactions.


CATALOG + WEBSITE + MOBILE APP
------------------------------

There must be ONE source of truth for catalog data.

Example:

Admin changes:

    Product A
    Price ₹100 -> ₹120

from the mobile app.

The backend updates the central catalog.

Then:

    Mobile App -> ₹120
    Website    -> ₹120

Similarly, if changed from the website:

    Website    -> ₹120
    Mobile App -> ₹120

Do NOT maintain independent product prices in the frontend.

Frontend applications must retrieve catalog data through the backend API.


SETTINGS
--------

Business settings should also be centralized.

Examples:

    business_name
    business_logo
    tax_settings
    invoice_prefix
    default_margin
    pricing_rules
    payment_settings
    catalog_settings

Both Web and Mobile must read/write these settings through the same
backend APIs.

Do NOT hard-code business settings separately in Web and Mobile.


PRICING / MARGIN RULE
---------------------

If the application supports:

    cost price
    margin %
    selling price
    discount
    tax

the calculation logic must live in ONE backend/service layer.

Do not implement one pricing formula in React/Web and another formula
in Mobile.

Example:

    Cost = ₹100
    Margin = 20%

Backend calculates the applicable selling price according to the
defined pricing rules.

Web and Mobile display the backend result.

If a pricing rule changes, historical invoices remain unchanged.


CUSTOMER HISTORY
----------------

Customer records should also have permanent IDs.

Customer:

    customer_id
    user_id
    name
    phone
    email
    address
    created_at
    updated_at

Orders and invoices reference:

    customer_id

Do not identify customers only by their phone number throughout the
database.


SECURITY
--------

WhatsApp OTP authentication must be separated from authorization.

After successful OTP verification:

    OTP
      |
      v
Authentication
      |
      v
Session / Access Token
      |
      v
API authorization
      |
      v
user_id

Every backend request must verify that the authenticated user is allowed
to access the requested resource.

Example:

User U1001 must NOT be able to request:

    /invoices/U2001

and receive another user's invoices.

Never trust user_id supplied directly by the frontend.

The backend must derive the authenticated user identity from the
verified session/token.


API DESIGN
----------

Use a consistent API structure.

Examples:

    POST   /auth/whatsapp/send-otp
    POST   /auth/whatsapp/verify-otp

    GET    /me

    GET    /catalog
    POST   /catalog/products
    PATCH  /catalog/products/:id

    GET    /orders
    POST   /orders

    GET    /invoices
    GET    /invoices/:id

    GET    /customers
    POST   /customers

    GET    /settings
    PATCH  /settings


IMPORTANT:
The API must determine the authenticated user from the session/token.

Avoid APIs such as:

    GET /users/{phone}/invoices

as the normal authenticated access pattern.

Prefer:

    GET /invoices

where the backend knows which user is requesting the data.


LOGOUT / LOGIN BEHAVIOR
-----------------------

Logout must ONLY terminate the current session.

It must NOT:

    delete the user
    delete catalog
    delete orders
    delete invoices
    delete customers
    reset settings

After logging in again using the same verified WhatsApp number:

    same user_id
        |
        +--> same catalog
        +--> same orders
        +--> same invoices
        +--> same customers
        +--> same settings


DATABASE RULES
--------------

Every important business table should have:

    id
    user_id
    created_at
    updated_at

Use:

    foreign keys
    unique constraints
    indexes
    transactions
    soft-delete/status fields where appropriate

Examples:

    UNIQUE(phone_number)

    FOREIGN KEY(order.user_id)
        REFERENCES users(user_id)

    FOREIGN KEY(invoice.user_id)
        REFERENCES users(user_id)


DATA CONSISTENCY
----------------

Creating an order/invoice should be transactional.

Example:

    Create Order
        |
        +--> Create Order Items
        |
        +--> Calculate totals
        |
        +--> Create Invoice
        |
        +--> Update required stock
        |
        v
    COMMIT

If something fails:

    ROLLBACK

Do not leave half-created invoices or orders.


FRONTEND RULES
--------------

Web and Mobile frontend should NOT own permanent business data.

Frontend responsibilities:

    display data
    collect input
    send API requests
    show validation errors
    cache data temporarily when appropriate

Backend responsibilities:

    authentication
    authorization
    business rules
    pricing
    tax calculation
    invoice creation
    data validation
    database writes
    audit history


CACHE RULE
----------

If catalog data is cached in Web or Mobile:

    Database
       |
       v
    Backend
       |
       v
    Cache
       |
       +--> Web
       +--> Mobile

When catalog data changes:

    update database
    invalidate/update cache

Never treat frontend cache as the permanent source of truth.


AUDIT LOG
---------

For important changes, maintain an audit log.

Example:

    audit_id
    user_id
    action
    entity_type
    entity_id
    old_value
    new_value
    created_at

Examples:

    PRODUCT_PRICE_CHANGED
    PRODUCT_ARCHIVED
    INVOICE_CREATED
    INVOICE_VOIDED
    SETTINGS_CHANGED


FUTURE DEVELOPMENT RULES
=========================

Before adding ANY new feature, developers must answer:

1. Who owns this data?
2. What is the permanent ID?
3. Which database table stores it?
4. Which user/business does it belong to?
5. Is the data historical or mutable?
6. Should old records change when the current data changes?
7. Is this business logic or UI logic?
8. Should Web and Mobile use the same API?
9. What happens after logout/login?
10. What happens if the user changes phone number?
11. What happens if the product is deleted?
12. What happens if the API request is repeated?
13. What happens if the request partially fails?
14. What authorization prevents another user accessing this data?
15. What tests prove that old data remains correct?


FEATURE DEVELOPMENT CHECKLIST
-----------------------------

Every new feature must follow:

    REQUIREMENT
        |
        v
    DATA MODEL
        |
        v
    API CONTRACT
        |
        v
    AUTHORIZATION
        |
        v
    BUSINESS LOGIC
        |
        v
    WEB UI
        |
        v
    MOBILE UI
        |
        v
    TESTS
        |
        v
    MIGRATION / BACKWARD COMPATIBILITY
        |
        v
    DEPLOYMENT


NON-NEGOTIABLE ARCHITECTURAL RULES
----------------------------------

RULE 1:
WhatsApp OTP is authentication only.

RULE 2:
Every user gets a permanent internal user_id.

RULE 3:
Phone number must be unique.

RULE 4:
Business data references user_id, not phone number.

RULE 5:
Web and Mobile use the same backend and source of truth.

RULE 6:
Catalog is mutable, historical invoices are immutable.

RULE 7:
Invoice/order items store price and product information snapshots.

RULE 8:
Do not physically delete products referenced by historical transactions.

RULE 9:
Business logic must not be duplicated between Web and Mobile.

RULE 10:
Frontend must never be trusted for authorization.

RULE 11:
Every API must enforce tenant/user ownership.

RULE 12:
Important multi-step operations must use database transactions.

RULE 13:
Every new feature must include automated tests.

RULE 14:
Database migrations must be backward-compatible where required.

RULE 15:
Before changing an existing data model, check all existing APIs,
Web screens, Mobile screens, reports, invoices, and integrations that
depend on it.

RULE 16:
Never change historical financial records merely because current
catalog/settings changed.

RULE 17:
All critical changes should be auditable.

RULE 18:
Do not create duplicate implementations of the same business rule.


TEST CASES THAT MUST ALWAYS PASS
================================

TEST 1:
User logs in with WhatsApp OTP for the first time.

Expected:
    New user created.

TEST 2:
Same user logs in again.

Expected:
    Existing user loaded.
    No duplicate user created.

TEST 3:
User logs out and logs in again.

Expected:
    Old catalog, orders, invoices and settings remain available.

TEST 4:
Product price changes.

Expected:
    New bills use new price.
    Old bills remain unchanged.

TEST 5:
Product is archived.

Expected:
    Product disappears from active catalog.
    Historical invoices remain accessible.

TEST 6:
Change catalog from Web.

Expected:
    Mobile shows same updated catalog.

TEST 7:
Change catalog from Mobile.

Expected:
    Web shows same updated catalog.

TEST 8:
User A tries to access User B's invoice.

Expected:
    HTTP 403/404.
    No User B data exposed.

TEST 9:
Invoice creation fails halfway.

Expected:
    Transaction rolls back.
    No corrupted/partial invoice.

TEST 10:
User refreshes the app or clears frontend cache.

Expected:
    Data can be reloaded from backend.

TEST 11:
Same invoice request is accidentally submitted twice.

Expected:
    System prevents accidental duplicate transaction using appropriate
    idempotency/business constraints.

TEST 12:
User changes phone number.

Expected:
    Existing user_id remains unchanged.
    Historical data remains connected.


FINAL TARGET ARCHITECTURE
=========================

                    WhatsApp OTP
                         |
                         v
                Authentication Layer
                         |
                         v
                    user_id
                         |
                         v
                 Backend API Layer
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
       Catalog         Orders        Invoices
          |              |              |
          +--------------+--------------+
                         |
                         v
                  Central Database
                         |
              +----------+----------+
              |                     |
              v                     v
           Website              Mobile App

The key principle is:

AUTHENTICATION IDENTIFIES THE USER.
USER_ID OWNS THE DATA.
BACKEND OWNS THE BUSINESS LOGIC.
DATABASE IS THE SOURCE OF TRUTH.
WEB AND MOBILE ARE CLIENTS OF THE SAME SYSTEM.
HISTORICAL FINANCIAL DATA IS IMMUTABLE.

This architecture should be treated as a permanent engineering rule for
future feature development, not just as a fix for the current issue.