FEATURE:
Multi-Store Pharmacy Owner Management from Website

GOAL:
Allow one pharmacy owner/user to log into the website from anywhere,
see all pharmacies/stores linked to their account, switch between stores,
and manage that selected store's website operations remotely.

The same website should act as:
1. Customer ordering website
2. Pharmacy/store management portal for authorized owners/users

IMPORTANT:
Do NOT redesign the existing frontend.
Do NOT change unrelated screens.
Do NOT duplicate the application.
Do NOT create dummy stores, dummy medicines, dummy orders, or fabricated business data.
Only extend the existing store, catalog, order, website, authentication,
notification/WhatsApp and related backend logic.

--------------------------------------------------
1. CURRENT BEHAVIOR
--------------------------------------------------

The website/application currently works around the pharmacy/store and
centralized catalog/booking concepts, but store management is not designed
as a single owner controlling multiple independent pharmacy locations.

The repository already contains:
- centralized catalog/booking functionality
- pickup workflow documentation
- backend route/service/database separation
- existing website/order related logic

Relevant architecture exists under the repository's backend structure,
including src/routes, src/services and database-related files. 
Do not create a parallel architecture unnecessarily.

--------------------------------------------------
2. EXPECTED BEHAVIOR
--------------------------------------------------

A. ONE USER -> MULTIPLE STORES

A single authenticated owner account can have:

Owner Account
   |
   +-- Store A
   |
   +-- Store B
   |
   +-- Store C

Each store remains logically independent for:
- orders
- inventory availability
- website catalogue availability
- store contact information
- store-specific notifications
- store-specific operational status
- store-specific WhatsApp automation
- store-specific manual messages

The owner does NOT need separate logins for every shop.

--------------------------------------------------
3. STORE SELECTOR / STORE SWITCHER
--------------------------------------------------

After login, the website should know which stores the user is authorized
to manage.

Add a store switcher using the existing UI pattern/components wherever
possible.

Example:

Current Store: [ Store A ▼ ]

Dropdown:
- Store A
- Store B
- Store C

The selected store becomes the ACTIVE STORE.

IMPORTANT:
Store switching should NOT log the user out.

Switching stores should change the management context only.

Example:

User opens website from another city
        ↓
Login
        ↓
Select "Store B"
        ↓
All management operations now apply to Store B
        ↓
Switch to "Store C"
        ↓
Operations now apply to Store C

--------------------------------------------------
4. ACTIVE STORE CONTEXT
--------------------------------------------------

Create one authoritative active-store context/state.

Every store-dependent operation must resolve:

authenticatedUser
        +
authorizedStore
        +
activeStoreId

before executing.

Never trust a store ID supplied only by the browser.

Backend must validate:

USER -> HAS ACCESS TO STORE?

If NO:
    reject request

If YES:
    perform operation for that store only

This prevents Store A data from accidentally appearing in Store B.

--------------------------------------------------
5. WEBSITE CATALOG MANAGEMENT
--------------------------------------------------

From the website management area, the owner should be able to manage the
selected store's catalogue without being physically present.

For ACTIVE STORE:

- view catalogue
- search medicines
- add product to store catalogue
- remove product from store catalogue
- enable/disable product availability
- update store-specific availability
- review product information
- control whether product is visible on website

IMPORTANT:

Centralized master catalogue remains the source for shared medicine data.

Do NOT duplicate the master product record for every store.

Use a store-product relationship where required.

Conceptually:

Master Product
       |
       +-- Store A availability
       +-- Store B availability
       +-- Store C availability

This allows one master medicine record to serve multiple pharmacies.

--------------------------------------------------
6. WEBSITE ORDER MANAGEMENT
--------------------------------------------------

For the ACTIVE STORE, owner can remotely:

- see new orders
- open order details
- add order items where the existing business flow permits
- remove order items where permitted
- update order status
- accept/process order
- mark ready for pickup
- cancel/reject order according to existing rules
- view order history

Every order must carry/store:

storeId

Therefore:

Store A owner view -> only Store A orders
Store B owner view -> only Store B orders

No cross-store mixing.

--------------------------------------------------
7. CUSTOMER ORDER ROUTING
--------------------------------------------------

When a customer selects a pharmacy/store on the website:

Customer
   ↓
Select Store
   ↓
Browse that store's website catalogue
   ↓
Create Order
   ↓
Order permanently assigned to Store ID
   ↓
Store receives order
   ↓
Store processes order

The store selected at order creation must remain part of the order record.

Do NOT determine the store later using the owner's currently active store.

The owner's active store is for management context only.

--------------------------------------------------
8. REMOTE ORDER MANAGEMENT
--------------------------------------------------

Owner can be physically in:

Pune
Doha
Mumbai
another city/country

and still open:

Website
   ↓
Login
   ↓
Select Store
   ↓
Manage that store's orders

The physical location of the user must have no impact on authorization.

Internet access + valid authentication + store permission = management access.

--------------------------------------------------
9. CATALOGUE UPDATE FROM WEBSITE
--------------------------------------------------

Provide the owner/admin functionality to manage website catalogue for the
selected store.

Possible controls:

Product
   - Website Visible
   - Available
   - Temporarily Unavailable
   - Out of Stock

When changed:

STORE A -> Product unavailable

Only Store A website availability changes.

STORE B and STORE C remain unchanged.

This is extremely important because three pharmacies sharing a master
catalogue must not accidentally share stock availability.

--------------------------------------------------
10. MESSAGE / REMINDER MANAGEMENT
--------------------------------------------------

The website management portal should also allow the authorized user to
manage store communication functions for the ACTIVE STORE.

For example:

Orders
   ↓
Send customer message

Supported message actions should integrate with existing notification/
WhatsApp functionality instead of creating a second messaging system.

Examples:

- Order received message
- Order ready message
- Pickup reminder
- Refill reminder
- Manual customer message
- Order status notification
- Other existing pharmacy reminders

Every outbound message must contain the correct:

storeId
customer/order reference
message type
timestamp
delivery status

Therefore Store B's message can never accidentally originate from Store A's
communication configuration.

--------------------------------------------------
11. MANUAL MESSAGE
--------------------------------------------------

For authorized staff/owner:

Active Store
   ↓
Customer/Order
   ↓
Send Message

Message can be manually triggered when the current business rules allow it.

The system should record:

- store
- customer
- order
- message type
- sent time
- delivery result
- failure reason if applicable

--------------------------------------------------
12. AUTOMATED MESSAGE
--------------------------------------------------

Existing automated reminders should become STORE-AWARE.

Example:

Store A:
Customer 123 -> refill reminder

Store B:
Customer 456 -> refill reminder

Each event must use the communication configuration belonging to that
store.

Do NOT use the currently selected store at execution time for background
jobs.

Instead:

automation event -> stored storeId -> execute for that store

This prevents background automation from sending a Store B notification
using Store A settings.

--------------------------------------------------
13. STORE-SPECIFIC CONFIGURATION
--------------------------------------------------

Where existing features support configuration, make configuration
store-scoped where required.

Examples:

- WhatsApp connection
- message templates
- store contact information
- pickup information
- website visibility
- payment configuration
- notification configuration

Shared global configuration must remain global only when it is genuinely
shared.

Do not duplicate global settings unnecessarily.

--------------------------------------------------
14. SECURITY / PERMISSION MODEL
--------------------------------------------------

Introduce/extend store membership logic:

User
Store
UserStoreAccess

Possible access levels:

OWNER
MANAGER
STAFF

Example:

Owner
 -> Store A OWNER
 -> Store B OWNER
 -> Store C OWNER

Manager
 -> Store A MANAGER

Staff
 -> Store B STAFF

Backend checks permissions on every store-scoped operation.

Frontend hiding a button is NOT security.

The backend must enforce authorization.

--------------------------------------------------
15. DATA ISOLATION
--------------------------------------------------

Every store-dependent table/entity must use a reliable store relationship
where the business entity is actually store-specific.

At minimum this must be reviewed for:

- orders
- website order records
- store catalogue mappings
- availability
- customer/order operational data where applicable
- notifications
- WhatsApp automation events
- message history
- store configuration

Do not add storeId blindly to globally shared master data.

Use the existing schema model and only introduce relationships where the
business data genuinely belongs to a store.

--------------------------------------------------
16. STORE SWITCHING BEHAVIOR
--------------------------------------------------

When user changes store:

1. update activeStoreId
2. reload only store-dependent data
3. clear stale store-dependent cached data
4. reload orders
5. reload catalogue availability
6. reload store-specific configuration/status
7. reload notification/WhatsApp status where applicable

Do not reload the entire application unnecessarily.

This also helps preserve the existing performance work.

--------------------------------------------------
17. URL / DEEP-LINK SUPPORT
--------------------------------------------------

Website management URLs should be capable of resolving the store context,
for example conceptually:

/manage?store=<store-id>

or an existing route convention.

But the backend must still validate that the logged-in user can access that
store.

A URL containing another store ID must NEVER grant access.

--------------------------------------------------
18. WEBSITE CUSTOMER FLOW
--------------------------------------------------

Customer side remains simple:

Website
   ↓
Choose Pharmacy
   ↓
Choose Store
   ↓
View that store's catalogue
   ↓
Add/remove products
   ↓
Place Order
   ↓
Select/confirm pickup
   ↓
Order assigned to selected store

The customer should not see another store's operational data.

--------------------------------------------------
19. OWNER MANAGEMENT FLOW
--------------------------------------------------

Owner side:

Website
   ↓
Login
   ↓
Store Selector
   ↓
Select Store
   ↓
Store Management Context

Then:

Orders
Catalogue
Messages
Reminders
Store Notifications
Relevant existing management functions

All operate against the selected store.

--------------------------------------------------
20. FAILURE SAFETY
--------------------------------------------------

If active store is:
- missing
- inactive
- unauthorized
- deleted
- inaccessible

DO NOT silently fall back to another store.

Return a controlled authorization/state response and require the system
to resolve a valid authorized store.

This prevents accidental cross-store operations.

--------------------------------------------------
21. FILE SCOPE RULE
--------------------------------------------------

AGENT MUST NOT modify unrelated files.

First inspect the repository and identify the exact existing files responsible
for:

- authentication/session
- store/pharmacy entity
- website/customer portal
- catalogue
- orders
- notifications/WhatsApp
- database schema
- relevant API routes/services

Only those files should be modified.

DO NOT:
- redesign frontend
- replace existing components unnecessarily
- create duplicate catalogue logic
- create duplicate order logic
- create a second authentication system
- modify unrelated modules
- modify unrelated UI
- introduce dummy data
- change existing business rules unless required for store isolation

If a new file is genuinely required, create it only inside the relevant
feature/module area.

--------------------------------------------------
22. FRONTEND UI RULE
--------------------------------------------------

KEEP THE EXISTING FRONTEND UI.

Only add the minimum required store-selection/control behavior using the
existing design language/components.

No complete page redesign.

No new visual system.

No unnecessary cards, dashboards, animations, or decorative components.

The feature should feel native to the existing application.

--------------------------------------------------
23. BACKEND ARCHITECTURE RULE
--------------------------------------------------

Reuse:

existing routes
existing services
existing database layer
existing authentication
existing order services
existing notification/WhatsApp services

Do not create parallel implementations when an existing service can be
extended safely.

--------------------------------------------------
24. AUDIT REQUIREMENT
--------------------------------------------------

Before implementation:

Identify every current location where store/pharmacy is already known.

Build a dependency map:

Store
  ↓
Catalogue
  ↓
Website
  ↓
Order
  ↓
Notification
  ↓
WhatsApp
  ↓
Automation

Then implement store context only where needed.

--------------------------------------------------
25. TEST SCENARIOS
--------------------------------------------------

TEST 1:
User owns Store A + Store B.
Select Store A.
Only Store A orders appear.

TEST 2:
Switch to Store B.
Only Store B orders appear.

TEST 3:
Disable medicine in Store A.
Store B remains unaffected.

TEST 4:
Create customer order for Store A.
Store B owner view does not show it.

TEST 5:
Send Store A message.
Store B communication configuration is not used.

TEST 6:
User manually enters Store B ID while lacking permission.
Backend rejects request.

TEST 7:
Background refill/reminder executes.
It uses the storeId stored with the event, not current browser store.

TEST 8:
User changes stores quickly.
Old store data must not remain visible after switch.

TEST 9:
Refresh browser.
Authorized active store is restored safely.

TEST 10:
Logout/login again.
Only authorized stores are available.

--------------------------------------------------
26. ACCEPTANCE CRITERIA
--------------------------------------------------

FEATURE IS COMPLETE ONLY WHEN:

[✓] One user can manage multiple stores
[✓] User can switch stores without logging out
[✓] Store context is enforced server-side
[✓] Orders are isolated by store
[✓] Store catalogue availability is isolated
[✓] Customer orders are permanently linked to selected store
[✓] Manual messages use correct store context
[✓] Automated reminders use stored store context
[✓] Store-specific configuration is respected
[✓] Unauthorized store access is blocked
[✓] No cross-store data leakage
[✓] Existing frontend design remains intact
[✓] No dummy/fabricated business data
[✓] No unrelated files modified
[✓] Existing order/catalogue/WhatsApp functionality continues working
[✓] Performance is not degraded by loading every store's data at once

--------------------------------------------------
27. IMPORTANT IMPLEMENTATION PRINCIPLE
--------------------------------------------------

The core model should be:

AUTHENTICATED USER
        +
AUTHORIZED STORE
        +
ACTIVE STORE CONTEXT
        ↓
STORE-SCOPED OPERATIONS

NOT:

AUTHENTICATED USER
        ↓
LOAD ALL STORE DATA
        ↓
FILTER IT IN FRONTEND

Store isolation must happen in backend/database queries first.

--------------------------------------------------
FINAL AGENT INSTRUCTION
--------------------------------------------------

Treat this as an EXISTING APPLICATION EXTENSION.

Do not rebuild the website.

Do not redesign the UI.

Do not rewrite unrelated architecture.

Do not add dummy data.

Do not touch files unrelated to this feature.

First locate the existing implementations for authentication, pharmacy/store,
catalogue, website ordering, orders and WhatsApp/notification functionality.
Then modify only those specific files/services/routes/database definitions
required to introduce a secure multi-store context.

Every changed file must have a direct dependency on this feature.

At the end, report:
1. exact files changed
2. why each file was changed
3. database/schema changes
4. API changes
5. authorization changes
6. frontend changes
7. tests executed
8. confirmation that unrelated files/UI were not changed