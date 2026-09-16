SINGLE IMPLEMENTATION PLAN
WEBSITE ORDER + REFILL → EXISTING PHARMACY ORDER WORKFLOW
AI-PHARMACY-V3

============================================================
1. OBJECTIVE
============================================================

Modify the EXISTING website-order and refill workflow so that
website orders and refill orders use the application's existing
order, inventory, payment, live-cart, POS and customer-history
architecture.

DO NOT create a second order system.
DO NOT create a second refill system.
DO NOT create duplicate inventory logic.
DO NOT create duplicate customer-history logic.
DO NOT redesign the frontend UI.
DO NOT change unrelated application behaviour.

The implementation must extend/fix the existing workflow in-place.

Existing intended chain:

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
POS
    ↓
CUSTOMER HISTORY
    ↓
FUTURE REFILL

The agent must preserve this architecture.

============================================================
2. CURRENT BEHAVIOUR TO PRESERVE
============================================================

The repository already defines the following business structure:

• Master product is the central product identity.
• Inventory contains actual stock/batches.
• Online catalog exposes products to customers.
• Website customer creates an order.
• Payment is recorded separately from final pharmacy confirmation.
• Paid orders move into the pharmacy's live order/live cart flow.
• Pharmacy verifies the actual product and inventory batch.
• Final confirmation happens after pharmacy verification.
• POS remains connected to the online order.
• Customer purchase history records the completed purchase.
• Future refill is based on the previous purchase/product identity.

IMPORTANT:

Payment = customer has paid.

Payment does NOT automatically mean:

Order = final confirmed sale.

The pharmacy still needs to verify actual stock/product/batch.

DO NOT remove this existing separation.

============================================================
3. REQUIRED WEBSITE ORDER FLOW
============================================================

The existing website order flow must remain:

CUSTOMER WEBSITE
    ↓
SELECT PHARMACY
    ↓
SELECT PRODUCT
    ↓
ADD TO CART
    ↓
CHECKOUT
    ↓
PAYMENT
    ↓
PAYMENT CONFIRMED
    ↓
PHARMACY LIVE ORDER
    ↓
PHARMACY VERIFICATION
    ↓
LIVE PHARMACY CART
    ↓
FINAL ORDER CONFIRMATION
    ↓
POS / FULFILMENT
    ↓
CUSTOMER HISTORY

The implementation must connect these existing stages correctly
rather than introducing a new workflow.

============================================================
4. REFILL FLOW
============================================================

A refill must start from the customer's existing purchase history.

CUSTOMER
    ↓
OPEN PREVIOUS PURCHASE
    ↓
CLICK REFILL
    ↓
CREATE NEW ORDER
    ↓
CHECK CURRENT PRODUCT STATUS
    ↓
CHECK CURRENT INVENTORY
    ↓
CHECK CURRENT PRICE
    ↓
CHECK CURRENT DISCOUNT
    ↓
CUSTOMER CONFIRMS
    ↓
PAYMENT
    ↓
PHARMACY LIVE ORDER
    ↓
PHARMACY VERIFICATION
    ↓
LIVE CART
    ↓
FINAL CONFIRMATION
    ↓
POS / FULFILMENT
    ↓
NEW CUSTOMER HISTORY ENTRY

IMPORTANT:

Refill creates a NEW order.

It must NOT modify the previous completed order.

============================================================
5. REFILL PRODUCT RULE
============================================================

The refill must preserve the original product identity.

Use:

product_id

from the previous purchase as the starting reference.

However, the refill MUST NOT blindly copy the old:

• price
• MRP
• discount
• batch
• stock quantity
• inventory record

Instead it must re-check current data.

Example:

OLD ORDER
Medicine A
Price = ₹100
Batch = ABC

REFILL REQUEST

System checks current state:

Medicine A
Current price = ₹120
Current stock = available
Current valid batch = XYZ

New refill order uses the CURRENT valid information.

Old order remains unchanged.

============================================================
6. INVENTORY VERIFICATION
============================================================

When website/refill order reaches pharmacy processing:

The existing inventory system must be used.

DO NOT create a separate website inventory table.

Pharmacy must verify:

• Product availability
• Requested quantity
• Actual available quantity
• Actual inventory batch
• MRP
• Selling price
• Product mapping
• Product replacement if required

If product is unavailable:

DO NOT silently replace it.

Existing controlled actions should be reused:

• Replace Product
• Modify Quantity
• Mark Unavailable
• Contact Customer
• Cancel / Refund

============================================================
7. LIVE CART CONNECTION
============================================================

After payment confirmation:

ORDER
    ↓
PHARMACY LIVE ORDER
    ↓
PHARMACY VERIFICATION
    ↓
LIVE CART

The live cart must continue using the existing order reference.

Do NOT create a second independent cart/order record merely
for website orders.

The live cart should maintain the relationship:

order_id
product_id
inventory_batch_id
quantity
price
discount
final_price

where these fields already exist in the current architecture.

If an equivalent existing structure already exists, REUSE IT.

Do not create duplicate fields/tables unless the existing
architecture genuinely requires them.

============================================================
8. POS CONNECTION
============================================================

After pharmacy verification/final confirmation:

ONLINE ORDER
    ↓
EXISTING POS WORKFLOW

The POS sale must remain linked to:

• customer_id
• order_id
• product_id
• batch_id
• quantity
• final price

The implementation must NOT create a separate "Website POS"
system.

Website orders should enter the existing POS workflow.

============================================================
9. CUSTOMER HISTORY
============================================================

After successful fulfilment/POS completion:

Existing customer history must receive the purchase.

The history should retain the relationship:

customer
    ↓
order
    ↓
product
    ↓
actual batch
    ↓
quantity
    ↓
price
    ↓
date
    ↓
pharmacy

The refill button must use this existing purchase history.

Do not create a separate "website purchase history".

============================================================
10. MULTI-STORE / PHARMACY SAFETY
============================================================

If the existing application supports multiple pharmacies/stores:

Every website order and refill must retain the selected pharmacy/store.

Example:

Customer selects:

STORE A

Order belongs to:

STORE A

Pharmacy staff from STORE B must NOT accidentally process
STORE A's order.

When a refill is initiated:

Use the pharmacy/store relationship already stored by the
existing customer/order architecture.

Do not create another store-selection architecture.

============================================================
11. PAYMENT RULES
============================================================

Preserve the existing payment state separation.

Possible states must continue to behave correctly:

PAYMENT FAILED
    → order remains unpaid

PAYMENT PENDING
    → do not finalize order

PAYMENT CONFIRMED
    → send order into pharmacy verification

PAYMENT CONFIRMED + PRODUCT UNAVAILABLE
    → pharmacy review / replacement / refund workflow

PAYMENT CONFIRMED + PRODUCT AVAILABLE
    → live cart → final confirmation → POS

Do not mark POS completed merely because payment succeeded.

============================================================
12. STOCK SAFETY
============================================================

Reuse the application's existing inventory reservation/deduction
mechanism.

Do not implement a second stock counter for website orders.

The workflow should remain:

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

when cancelled.

The implementation must not allow:

Available stock = 1

Customer A = 1
Customer B = 1

Inventory = -1

Use the existing transactional/reservation mechanism if already
implemented.

============================================================
13. FILE-SCOPE RULE
============================================================

BEFORE EDITING ANY CODE:

The coding agent MUST inspect the repository and identify the
EXACT existing files responsible for:

1. Website order creation
2. Website checkout
3. Payment state
4. Pharmacy live order/live cart
5. Inventory validation
6. POS integration
7. Customer purchase history
8. Refill creation
9. Multi-store/pharmacy relationship, if involved
10. Relevant tests

The agent must create an explicit internal list:

FILES TO MODIFY:
- only existing files directly responsible for this workflow

FILES NOT TO MODIFY:
- every unrelated file

============================================================
14. STRICT NO-NEW-ARCHITECTURE RULE
============================================================

The agent MUST NOT:

• create a second order model
• create a second refill model
• create a second inventory system
• create a second POS flow
• create a second customer-history system
• create duplicate APIs
• create duplicate state machines
• create duplicate product tables
• create duplicate pharmacy/store logic
• introduce unrelated UI changes
• refactor unrelated modules
• rename unrelated files
• reorganize the project
• change styling
• redesign existing screens

If an existing function already performs the required operation,
reuse it.

If an existing function needs a small modification, modify that
function instead of creating a parallel implementation.

============================================================
15. FRONTEND UI RULE
============================================================

DO NOT CHANGE THE EXISTING FRONTEND UI.

Preserve:

• existing screens
• existing layout
• existing buttons
• existing navigation
• existing styling
• existing component structure

Only modify frontend logic if absolutely required to connect the
existing UI to the corrected backend/business workflow.

No new visual design.

No new dashboard.

No new order page.

No duplicate refill page.

The user should experience the same existing interface, but the
underlying workflow must work correctly.

============================================================
16. DATABASE RULE
============================================================

Before changing database code, inspect existing schema/models.

Identify existing:

• product_id
• customer_id
• pharmacy/store ID
• order_id
• order_items
• payment records
• inventory batch ID
• POS sale ID
• purchase-history records
• refill references

Reuse existing relationships.

Do NOT create duplicate product/customer/order entities.

If a field already exists for the required relationship,
use that field.

Only add a field if the existing schema genuinely lacks the
required relationship and there is no existing equivalent.

============================================================
17. REFILL DATA RULE
============================================================

Previous order:

ORDER-1001
Product = MED-100
Old price = ₹100
Old batch = BATCH-A

Customer clicks:

REFILL

New order:

ORDER-1002
Product = MED-100

System re-checks:

Current stock
Current batch
Current MRP
Current selling price
Current discount
Current product status
Current pharmacy/store

Therefore:

OLD ORDER ≠ NEW REFILL ORDER

But:

OLD PRODUCT ID → NEW REFILL PRODUCT ID

============================================================
18. ERROR HANDLING
============================================================

The existing error/status system must be reused.

Handle:

• product unavailable
• insufficient quantity
• product mapping error
• payment failed
• payment pending
• payment confirmed
• pharmacy rejection
• replacement product
• quantity modification
• cancellation
• refund
• POS failure
• inventory reservation failure

No silent failure.

No silent product replacement.

No silent order completion.

============================================================
19. AUDIT REQUIREMENT
============================================================

Any existing audit mechanism must be reused.

If pharmacy changes:

• product
• batch
• quantity
• mapping
• availability
• replacement

the existing audit structure should record the change.

Do not create a second audit system.

============================================================
20. IMPLEMENTATION METHOD
============================================================

STEP 1
Inspect existing website order implementation.

STEP 2
Trace the complete call chain:

Website
→ API/service
→ order creation
→ payment
→ pharmacy order
→ live cart
→ inventory
→ POS
→ customer history

STEP 3
Trace the existing refill implementation.

STEP 4
Identify where the current refill disconnects from the existing
order workflow, if it does.

STEP 5
Modify ONLY the affected existing functions/files.

STEP 6
Reuse existing models, services, APIs and state/status values.

STEP 7
Connect refill to the existing order creation mechanism.

STEP 8
Ensure refill revalidates current inventory/pricing.

STEP 9
Ensure website and refill orders reach the same pharmacy
processing/live-cart/POS workflow.

STEP 10
Do not change UI unless required for functionality.

============================================================
21. CROSS-CHECK AFTER CODING
============================================================

After implementation, the coding agent MUST compare:

OLD BEHAVIOUR
vs
NEW BEHAVIOUR

For every modified file, verify:

• Why this file was modified
• Which existing function was changed
• What existing workflow it belongs to
• What behaviour existed before
• What behaviour exists now
• Whether existing API contracts remain compatible
• Whether existing database relationships remain intact
• Whether existing UI remains unchanged
• Whether duplicate workflow was introduced
• Whether unrelated files were touched

============================================================
22. REQUIRED END-TO-END TEST
============================================================

TEST A: NORMAL WEBSITE ORDER

Customer
→ Select pharmacy
→ Select product
→ Add cart
→ Payment
→ Payment confirmed
→ Pharmacy live order
→ Inventory verification
→ Live cart
→ Final confirmation
→ POS
→ Customer history

Verify every stage.

------------------------------------------------------------

TEST B: REFILL

Customer
→ Previous purchase
→ Refill
→ New order created
→ Current stock checked
→ Current price checked
→ Payment
→ Pharmacy live order
→ Verification
→ Live cart
→ POS
→ New customer-history entry

Verify old order remains unchanged.

------------------------------------------------------------

TEST C: PRODUCT UNAVAILABLE

Refill/order
→ product unavailable
→ no silent substitution
→ pharmacy receives appropriate action
→ replacement/remove/cancel/refund follows existing workflow

------------------------------------------------------------

TEST D: MULTI-STORE

Customer selects Store A
→ order belongs to Store A
→ Store A processes order
→ Store B does not process it

------------------------------------------------------------

TEST E: STOCK RACE

Stock = 1

Two orders attempt quantity = 1.

Verify existing reservation/transaction mechanism prevents
negative inventory.

============================================================
23. FILE CHANGE AUDIT
============================================================

At the end, produce:

MODIFIED FILES
---------------
[path]
Reason:
Existing responsibility:
Exact change:

[path]
Reason:
Existing responsibility:
Exact change:


UNCHANGED RELATED FILES
-----------------------
[path]
Reason it was inspected but not modified:


UNRELATED FILES
---------------
No changes allowed.

If an unrelated file was modified accidentally:
REVERT IT.

============================================================
24. FINAL OLD VS NEW CHECK
============================================================

OLD:

Website order
→ payment
→ separate/incorrect handling
→ possible workflow disconnect

Refill
→ previous purchase
→ may not fully reuse current order workflow


NEW:

Website order
→ existing order system
→ existing payment system
→ existing pharmacy live order
→ existing inventory verification
→ existing live cart
→ existing POS
→ existing customer history

Refill
→ existing customer history
→ existing product_id
→ NEW order
→ CURRENT inventory validation
→ CURRENT pricing
→ existing payment
→ existing pharmacy live order
→ existing live cart
→ existing POS
→ new customer-history record

============================================================
25. FINAL ACCEPTANCE CONDITION
============================================================

The implementation is COMPLETE only if:

[✓] Existing workflow is reused
[✓] Existing architecture is preserved
[✓] Existing database relationships are preserved
[✓] Website order reaches existing pharmacy workflow
[✓] Refill creates a new order
[✓] Refill uses current stock/pricing
[✓] Previous order remains unchanged
[✓] POS remains connected
[✓] Customer history remains connected
[✓] Multi-store relationship remains correct
[✓] No duplicate order workflow exists
[✓] No duplicate refill workflow exists
[✓] No duplicate inventory workflow exists
[✓] No duplicate POS workflow exists
[✓] No duplicate customer-history workflow exists
[✓] Existing frontend UI remains unchanged
[✓] Only directly related files are modified
[✓] Unrelated files are untouched
[✓] End-to-end tests pass
[✓] Old-vs-new behaviour has been cross-checked
[✓] Modified files have been individually reviewed
[✓] No dummy/fabricated business data is introduced

FINAL RULE:

DO NOT START THE FEATURE FROM SCRATCH.

FIRST FIND THE EXISTING IMPLEMENTATION.
THEN EXTEND OR CORRECT IT IN-PLACE.

ONE WORKFLOW.
ONE ORDER SYSTEM.
ONE INVENTORY SYSTEM.
ONE POS CONNECTION.
ONE CUSTOMER HISTORY.
ONE REFILL PATH.

NO DUPLICATE IMPLEMENTATION.