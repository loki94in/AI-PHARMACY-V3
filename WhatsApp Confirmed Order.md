# IMPLEMENTATION PLAN
# WhatsApp Confirmed Order → Pharmarack Live Cart → Owner Human Review → Staged Customer Message
# IMPORTANT: EXTEND EXISTING WORKFLOW ONLY. DO NOT CREATE A SECOND WORKFLOW.

============================================================
1. OBJECTIVE
============================================================

Improve the existing WhatsApp ordering workflow so that:

1. Customer sends a medicine request through WhatsApp.
2. Existing WhatsApp intent/matching logic identifies the medicine.
3. If medicine/strength/formulation/quantity is incomplete or ambiguous,
   the EXISTING clarification workflow is used.
4. Customer explicitly confirms the exact medicine and quantity.
5. Only after customer confirmation, the EXISTING order/procurement workflow
   continues.
6. Bot searches Pharmarack using the EXISTING Pharmarack search implementation.
7. Bot applies the EXISTING stock/distributor selection logic.
8. Bot adds the confirmed medicine and quantity to the EXISTING Pharmarack
   Live Cart.
9. After successful cart addition, the EXISTING owner WhatsApp notification
   workflow sends a notification to the owner number already saved in
   application Settings.
10. The customer-facing confirmation message is NEVER automatically sent.
11. The customer-facing message is created/updated in the EXISTING
    Staged Messages workflow.
12. Staff/owner manually reviews the staged customer message and clicks the
    EXISTING Send action.
13. The customer receives the message only after the human manually sends it.
14. The existing morning schedule/refill workflow remains available so the
    owner can review today's tasks in the morning.
15. No frontend redesign is required.
16. No duplicate workflow, duplicate service, duplicate database structure,
    duplicate notification system, or parallel messaging system must be created.

CORE RULE:

    BOT CAN AUTOMATE INTERNAL ORDER PROCESSING.
    HUMAN MUST CONTROL CUSTOMER-FACING MESSAGES.

============================================================
2. CURRENT APPLICATION STRUCTURE TO PRESERVE
============================================================

The current workflow already contains these functional areas:

A. WhatsApp inbound handling
   Existing:
   src/services/whatsappIntentService.ts

   Responsibility:
   - Receive/process WhatsApp customer intent.
   - Identify existing/new customer.
   - Match medicine.
   - Handle ambiguous medicine names.
   - Handle strength/formulation/size clarification.
   - Wait for customer confirmation.

B. Pharmarack integration
   Existing:
   src/routes/pharmarack.ts

   Responsibility:
   - Search Pharmarack.
   - Process available stock.
   - Determine distributor availability.
   - Work with Live Cart.
   - Existing distributor/cart functionality must be reused.

C. Existing owner/admin WhatsApp notification logic
   Existing:
   src/services/waAdminEscalationService.ts

   Responsibility:
   - Owner/admin WhatsApp notifications.
   - Reuse this existing notification mechanism.
   - Do not create another owner notification service.

D. Existing refill/schedule logic
   Existing:
   src/services/refillService.ts

   Responsibility:
   - Refill schedule.
   - Existing morning schedule/notification behavior.
   - Extend only where required.
   - Do not create another scheduling system.

E. Existing order schedule logic
   Existing:
   src/services/orderScheduleService.ts

   Responsibility:
   - Existing order scheduling/cutoff/holiday logic.
   - Reuse existing implementation where applicable.

F. Existing store settings
   Existing:
   src/services/storeSettingsService.ts

   Responsibility:
   - Existing application/store configuration.
   - Owner WhatsApp number must be read from the existing settings
     implementation.
   - Do not create another owner-number configuration.

G. Existing staged customer messages
   Existing staged-message/Quick Assist implementation must be located
   and reused.

   IMPORTANT:
   Before changing anything, inspect the repository to identify the exact
   existing file(s) responsible for:
   - staged messages
   - message status
   - Quick Assist
   - manual Send
   - customer WhatsApp sending

   DO NOT create a new staged-message system if one already exists.

H. Existing orders page
   Existing:
   frontend/src/pages/WebsiteOrders/index.tsx

   Existing UI must remain unchanged.

I. Existing layout
   Existing:
   frontend/src/components/Layout.tsx

   Existing UI must remain unchanged unless a backend-only integration
   requires an existing notification/event hook.

============================================================
3. MANDATORY FIRST STEP FOR THE CODING AGENT
============================================================

BEFORE MODIFYING CODE:

Inspect the existing repository and trace the CURRENT workflow from:

    WhatsApp message
        ↓
    whatsappIntentService
        ↓
    customer confirmation
        ↓
    Pharmarack search
        ↓
    distributor selection
        ↓
    Live Cart
        ↓
    existing owner notification
        ↓
    existing staged message
        ↓
    existing manual Send

Identify the exact functions already responsible for each step.

DO NOT assume that a new function/service/table is required.

DO NOT rewrite working code unnecessarily.

DO NOT move existing functionality into new files.

DO NOT create a second implementation of an existing workflow.

The implementation must extend the existing functions/services wherever
possible.

============================================================
4. CURRENT BEHAVIOR
============================================================

CURRENT CUSTOMER FLOW:

Customer:
    "Pan 40"

Existing intent system determines whether:
    - medicine is exact
    - strength is known
    - formulation is known
    - quantity is known

If information is missing/ambiguous:
    Existing clarification workflow asks the customer.

Example:

    Customer:
    "Zifi"

    Existing bot:
    Shows matching variants/options.

Customer selects an option.

If quantity is missing:
    Existing bot asks for quantity.

Example:

    "How many strips do you need?"

Customer:
    "2"

The system must NOT treat this alone as final confirmation if the existing
workflow requires an explicit confirmation.

The customer must reach the existing confirmed-order state.

Example:

    "Please confirm Zifi 200mg Tablet × 2 strips."

Customer:
    "Yes"

Only at this point should procurement continue.

CURRENT PROCUREMENT:

    Confirmed medicine
        ↓
    Pharmarack search
        ↓
    Distributor selection
        ↓
    Live Cart

CURRENT HUMAN COMMUNICATION REQUIREMENT:

    Customer-facing message must remain staged.

    The system must NOT automatically send the customer-facing message
    merely because:
        - medicine was identified
        - quantity was identified
        - customer confirmed
        - distributor was selected
        - medicine was added to Live Cart

============================================================
5. EXPECTED BEHAVIOR
============================================================

EXPECTED FLOW:

    CUSTOMER WHATSAPP
           ↓
    Existing intent extraction
           ↓
    Existing medicine matching
           ↓
    Existing clarification if needed
           ↓
    Exact medicine + strength + formulation + quantity
           ↓
    Existing customer confirmation
           ↓
    CUSTOMER CONFIRMED
           ↓
    Existing Pharmarack search
           ↓
    Existing stock filtering
           ↓
    Existing distributor allocation
           ↓
    Existing Live Cart addition
           ↓
    VERIFY CART ADDITION SUCCESS
           ↓
    OWNER WHATSAPP NOTIFICATION
           ↓
    CUSTOMER MESSAGE CREATED/UPDATED AS STAGED
           ↓
    NO CUSTOMER AUTO-SEND
           ↓
    HUMAN OPENS STAGED MESSAGES
           ↓
    HUMAN REVIEWS/ADJUSTS IF REQUIRED
           ↓
    HUMAN CLICKS EXISTING SEND ACTION
           ↓
    CUSTOMER RECEIVES MESSAGE


============================================================
6. CUSTOMER MEDICINE CONFIRMATION
============================================================

Use the existing WhatsApp intent and clarification mechanism.

The system must confirm all required order information before procurement:

    medicine
    strength
    formulation
    packing/size when applicable
    quantity

Example:

Customer:
    "Zifi"

Bot:
    "I found:
     1. Zifi 100mg Tablet
     2. Zifi 200mg Tablet
     3. Zifi 200mg/5ml Syrup

     Please select 1, 2 or 3."

Customer:
    "2"

Bot:
    "Zifi 200mg Tablet selected.
     How many strips do you need?"

Customer:
    "1"

Bot:
    "Please confirm:
     Zifi 200mg Tablet × 1 strip

     Reply YES to confirm."

Customer:
    "Yes"

NOW:

    customer order = CONFIRMED

Only now call the existing procurement/Pharmarack workflow.

Do not bypass confirmation based only on AI confidence.

Do not automatically interpret an ambiguous medicine name as confirmed.

============================================================
7. QUANTITY HANDLING
============================================================

Quantity must be stored as part of the confirmed order.

Examples:

    Pan 40mg × 2 strips
    Zifi 200mg × 1 strip

If quantity changes:

Customer:
    "Actually make it 3."

Update the pending order using the existing pending clarification/order
mechanism.

Then request confirmation again:

    "Updated:
     Pan 40mg Tablet × 3 strips.

     Reply YES to confirm."

Only after the new confirmation continue to procurement.

Do not add the previous quantity to the Live Cart before the final
confirmation.

============================================================
8. PHARMARACK LIVE CART
============================================================

Reuse the existing:

    src/routes/pharmarack.ts
    src/services/whatsappIntentService.ts

and any existing helper/service already responsible for Pharmarack cart
operations.

Do not create a second Live Cart implementation.

Existing behavior to preserve:

    - 2–3 word sanitized search
    - stock validation
    - OOS distributor filtering
    - distributor selection
    - existing cart detection
    - existing quantity handling
    - existing common distributor logic
    - existing Pharmarack cart API behavior

After customer confirmation:

    Confirmed Order
        ↓
    Existing Pharmarack search
        ↓
    Existing distributor selection
        ↓
    Existing Live Cart add/update
        ↓
    Verify success

Only if the Live Cart operation is confirmed successful should the owner
notification be generated as a successful cart-added notification.

============================================================
9. CART QUANTITY / DUPLICATE PROTECTION
============================================================

Reuse existing cart logic.

Do not blindly add quantities again if the same WhatsApp event is processed
more than once.

Before modifying this area, inspect whether existing idempotency or duplicate
protection already exists.

If it exists:
    extend/reuse it.

If it does not exist:
    implement the smallest change inside the existing relevant file/function.

Do NOT create a new independent synchronization engine.

The system must prevent:

    Same WhatsApp event
        ↓
    processed twice
        ↓
    quantity added twice

Example:

    Intended: Pan × 2

    Incorrect:
        webhook #1 → +2
        webhook #2 → +2
        final cart = 4

    Correct:
        webhook #1 → +2
        webhook #2 → detected as duplicate
        final cart = 2

============================================================
10. OWNER WHATSAPP NOTIFICATION
============================================================

After successful Live Cart addition:

Reuse:

    src/services/waAdminEscalationService.ts

and existing settings retrieval.

Owner number must come from the existing application setting:

    Store Settings
        ↓
    Owner WhatsApp Number

Do NOT hardcode the owner number.

Do NOT create another owner number field.

Do NOT create another WhatsApp notification service.

Example notification:

    🛒 WhatsApp Order Added to Live Cart

    Customer: Rahul
    Order: WA-1048

    Medicines:
    • Pan 40mg × 2 → ABC Pharma
    • Zifi 200mg × 1 → XYZ Distributor

    Cart: ✅ Successfully Added

    📋 Customer message: STAGED
    🔒 Customer auto-send: OFF

    The order has been added to the Live Cart.
    Customer communication is waiting in Staged Messages
    for manual review and sending.

The owner notification is INTERNAL.

It is allowed to be automatic.

============================================================
11. HUMAN LOOP / STAGED MESSAGE
============================================================

IMPORTANT:

The Human Loop must NOT stop the bot from completing internal processing.

This is NOT:

    Bot adds cart
        ↓
    WAIT FOR HUMAN
        ↓
    Then create cart/order

Instead:

    Customer confirms
        ↓
    Bot processes order
        ↓
    Bot adds Live Cart
        ↓
    Bot notifies owner
        ↓
    Customer message is staged
        ↓
    Human reviews customer message

The human loop applies ONLY to customer-facing communication.

============================================================
12. CUSTOMER MESSAGE RULE
============================================================

After successful order/cart processing:

    Create or update the EXISTING staged customer message.

Example:

    Customer:
    Rahul

    Order:
    WA-1048

    Staged message:

    "Your order has been received and is being arranged.
     We will notify you when your medicines are ready."

Status:

    STAGED
    or the existing equivalent status already used by the application.

DO NOT automatically call the final customer WhatsApp send operation.

DO NOT mark the message as SENT.

DO NOT use an automated worker/cron to send it.

DO NOT bypass Quick Assist.

============================================================
13. CUSTOMER-FACING MESSAGE SEND
============================================================

The existing Quick Assist / Staged Messages workflow remains the only
customer-facing sending path.

Expected:

    Staged Message
         ↓
    Human reviews
         ↓
    Human can adjust if needed
         ↓
    Human clicks existing SEND
         ↓
    Existing WhatsApp send function
         ↓
    Message becomes SENT

If an existing "Send All" function exists, preserve it.

Do not modify its UI.

Ensure automatically generated WhatsApp-order messages are eligible for the
existing manual send workflow.

============================================================
14. HUMAN ADJUSTMENT
============================================================

The human must be able to review the existing order/message before sending.

Possible adjustments should use existing application functionality.

Examples:

    - Change quantity
    - Correct medicine
    - Correct customer information
    - Modify message text if existing functionality supports editing
    - Cancel/hold the message if existing workflow supports it

Do not introduce a new frontend editing screen.

Use the existing Staged Messages / Quick Assist UI and backend behavior.

If the current UI already supports these actions, only connect the new
WhatsApp order into that workflow.

============================================================
15. IMPORTANT SEPARATION OF STATUSES
============================================================

Do not use one status for everything.

The existing data model/status structure should be inspected first.

Conceptually, these are separate:

    CUSTOMER ORDER:
        CONFIRMED

    PROCUREMENT:
        CART_ADDED

    OWNER NOTIFICATION:
        SENT

    CUSTOMER MESSAGE:
        STAGED

    CUSTOMER MESSAGE:
        SENT only after human action

Therefore:

    CART_ADDED
        ≠
    CUSTOMER_MESSAGE_SENT

This distinction is mandatory.

Example:

    Order:
        CONFIRMED

    Pharmarack:
        CART_ADDED

    Owner:
        NOTIFIED

    Customer message:
        STAGED

This is a successful state.

The customer must NOT receive the message automatically.

============================================================
16. FAILURE HANDLING
============================================================

If Pharmarack Live Cart addition fails:

    Do NOT tell the customer that the order was successfully arranged.

Instead:

    Order remains in existing exception/pending state.

    Owner receives:

    ⚠️ WhatsApp Order Requires Attention

    Customer: Rahul
    Order: WA-1048
    Medicine: Pan 40mg × 2

    Pharmarack Cart:
    ❌ Add failed

    Action required in application.

Do not create a false successful customer message.

The customer message must remain staged/blocked according to the existing
workflow until the order state is valid.

Reuse existing exception/error handling where available.

============================================================
17. MORNING BOT / DAILY SCHEDULE
============================================================

Preserve the existing morning schedule/refill implementation.

Existing:

    src/services/refillService.ts
    src/services/orderScheduleService.ts

The morning process should provide the owner with today's operational
information using the existing notification mechanism.

Conceptually:

    DAILY MORNING SCAN
          ↓
    Today's refills
    Today's special orders
    WhatsApp orders
    Orders awaiting review
    Staged messages
    Distributor/cart issues
    Delivery/pickup tasks
          ↓
    Owner WhatsApp briefing

Do not create a second scheduler.

Do not create another cron system.

Extend the existing morning schedule only if required.

============================================================
18. MORNING BRIEFING CONTENT
============================================================

The owner should be able to understand the day's work from one briefing.

Example:

    🌅 TODAY'S PHARMACY SCHEDULE

    💬 WhatsApp Orders
    • 6 confirmed orders
    • 3 added to Live Cart
    • 2 awaiting clarification
    • 1 requires attention

    💊 Refills
    • 8 due today
    • 3 special requests

    📋 Staged Messages
    • 7 waiting for manual review/send

    🚚 Delivery / Pickup
    • Existing scheduled tasks

    ⚠️ Attention Required
    • Existing exceptions

The exact existing morning notification format should be preserved unless
the current implementation already has a structured format.

Do not create a new notification style unnecessarily.

============================================================
19. FILE SCOPE
============================================================

ONLY inspect and modify files directly related to the existing workflow.

PRIMARY EXPECTED FILES:

    src/services/whatsappIntentService.ts
    src/routes/pharmarack.ts
    src/services/waAdminEscalationService.ts
    src/services/refillService.ts
    src/services/orderScheduleService.ts
    src/services/storeSettingsService.ts

EXISTING STAGED MESSAGE / QUICK ASSIST FILES:

    MUST FIRST BE LOCATED IN THE EXISTING PROJECT.

    Modify only the exact existing file(s) that already implement:
    - staged messages
    - Quick Assist
    - manual Send
    - customer WhatsApp sending

ORDER PAGE FILES:

    frontend/src/pages/WebsiteOrders/index.tsx
    frontend/src/components/Layout.tsx

    DO NOT MODIFY these frontend files unless the existing backend-to-UI
    integration genuinely requires a minimal related change.

    NO UI redesign.
    NO new page.
    NO new tab.
    NO new component unless an existing component specifically requires
    a backend integration change.

============================================================
20. STRICT FILE MODIFICATION RULE
============================================================

The coding agent MUST NOT:

    - Modify unrelated files.
    - Refactor unrelated code.
    - Rename unrelated functions.
    - Move existing services.
    - Create duplicate services.
    - Create a second WhatsApp workflow.
    - Create a second Pharmarack workflow.
    - Create a second notification workflow.
    - Create a second staged-message workflow.
    - Create a second scheduler.
    - Redesign frontend UI.
    - Change existing page structure.
    - Replace working business logic unnecessarily.
    - Introduce dummy/fabricated business data.
    - Add hardcoded owner WhatsApp numbers.
    - Automatically send customer-facing messages.
    - Automatically send "order received" messages.
    - Automatically send "ready for pickup" messages.
    - bypass existing Quick Assist manual Send.

If a required function already exists:
    USE IT.

If a required status already exists:
    USE IT.

If a required database field already exists:
    USE IT.

If a required notification method already exists:
    USE IT.

If a required staged-message mechanism already exists:
    USE IT.

============================================================
21. NO DUPLICATE WORKFLOW RULE
============================================================

The final implementation MUST follow the existing application structure.

DO NOT build:

    New WhatsApp Order Engine
    + existing WhatsApp Order Engine

DO NOT build:

    New Cart Service
    + existing Pharmarack Cart Service

DO NOT build:

    New Staged Message Service
    + existing Staged Message Service

DO NOT build:

    New Morning Scheduler
    + existing Scheduler

There must be ONE workflow.

The new behavior must be inserted into the existing workflow at the correct
existing points.

============================================================
22. DATABASE / DATA MODEL RULE
============================================================

Before adding any database field:

    Search the existing schema/models/migrations.

If the required information already exists:
    reuse it.

Potential information required:

    order ID
    customer ID
    WhatsApp source
    customer phone
    medicine ID
    quantity
    distributor
    Pharmarack cart ID
    cart status
    staged message ID
    message status

Do not create duplicate columns/tables for information already available.

If a database change is genuinely required, modify only the existing
database structure/migration location that already owns this functionality.

Do not create a parallel data model.

============================================================
23. EVENT / FLOW ORDER
============================================================

The final execution order must be:

    1. Receive WhatsApp message
    2. Identify customer
    3. Extract medicine
    4. Resolve ambiguity
    5. Resolve strength/formulation/size
    6. Resolve quantity
    7. Ask customer for final confirmation
    8. Receive explicit customer confirmation
    9. Create/use existing confirmed order
   10. Search Pharmarack
   11. Filter unavailable stock
   12. Select distributor using existing logic
   13. Add/update Live Cart
   14. Verify Live Cart success
   15. Update existing order/procurement status
   16. Create/update customer-facing message as STAGED
   17. Notify owner WhatsApp using existing owner notification service
   18. Stop customer messaging automation
   19. Human reviews Staged Messages
   20. Human manually clicks SEND
   21. Existing WhatsApp send mechanism sends message
   22. Existing message status becomes SENT

============================================================
24. CUSTOMER AUTO-SEND HARD BLOCK
============================================================

Add/maintain a clear backend guard so that the automated Live Cart success
path cannot call the final customer send operation.

Conceptually:

    Live Cart Success
          ↓
    create staged message
          ↓
    RETURN

NOT:

    Live Cart Success
          ↓
    create staged message
          ↓
    sendCustomerWhatsApp()
          ↓
    CUSTOMER

The final customer send must only occur through the existing manual send
path.

The guard must work even if a worker/cron/background process is running.

============================================================
25. OWNER NOTIFICATION VS CUSTOMER NOTIFICATION
============================================================

These are two different communication paths.

OWNER:

    Cart successfully added
          ↓
    Automatic notification
          ↓
    Owner WhatsApp number from Settings

CUSTOMER:

    Cart successfully added
          ↓
    Staged Message
          ↓
    Human review
          ↓
    Manual Send
          ↓
    Customer WhatsApp

Never combine these two paths.

============================================================
26. TEST CASES
============================================================

TEST 1:
Customer:
    "Pan 40mg 2 strips"

Expected:
    Existing confirmation flow runs.
    Customer confirms.
    Cart receives exactly 2.
    Owner gets notification.
    Customer message = STAGED.
    Customer receives NOTHING automatically.

------------------------------------------------------------

TEST 2:
Customer:
    "Zifi"

Expected:
    Existing ambiguity flow shows top 2–3 relevant options.
    No cart addition yet.

------------------------------------------------------------

TEST 3:
Customer:
    Selects Zifi 200mg.
    Quantity = 1.

Expected:
    Bot asks final confirmation.
    No cart addition before confirmation.

------------------------------------------------------------

TEST 4:
Customer:
    "Yes"

Expected:
    Order becomes confirmed.
    Pharmarack search occurs.
    Distributor selected.
    Live Cart updated.
    Owner notified.
    Customer message staged.
    No customer auto-send.

------------------------------------------------------------

TEST 5:
Duplicate WhatsApp webhook

Expected:
    Existing/idempotent protection prevents duplicate cart quantity.

------------------------------------------------------------

TEST 6:
Pharmarack cart failure

Expected:
    Order does not become successful.
    Owner receives failure/attention notification.
    No false customer success message is sent.

------------------------------------------------------------

TEST 7:
Customer changes quantity before confirmation

Expected:
    Existing pending order is updated.
    Confirmation is requested again.
    Old quantity is not added to Live Cart.

------------------------------------------------------------

TEST 8:
Customer message exists in Staged Messages

Expected:
    Staff sees it using the existing Staged Messages/Quick Assist UI.
    Staff can manually send using existing Send action.

------------------------------------------------------------

TEST 9:
Background worker/cron runs

Expected:
    It MUST NOT automatically send the staged customer message.

------------------------------------------------------------

TEST 10:
Owner WhatsApp number changed in Settings

Expected:
    New configured owner number is used.
    No hardcoded number exists.

------------------------------------------------------------

TEST 11:
Morning schedule

Expected:
    Existing morning scheduler continues working.
    Owner receives today's existing schedule information.
    No second scheduler is created.

============================================================
27. ACCEPTANCE CRITERIA
============================================================

The implementation is complete only when ALL are true:

[ ] Customer medicine is not ordered before confirmation.

[ ] Medicine ambiguity continues to use the existing clarification workflow.

[ ] Quantity is confirmed before procurement.

[ ] Existing Pharmarack search is reused.

[ ] Existing stock filtering is preserved.

[ ] Existing distributor allocation is preserved.

[ ] Existing Live Cart logic is reused.

[ ] Successful Live Cart addition automatically notifies owner.

[ ] Owner number comes from existing Settings.

[ ] Customer-facing message is automatically CREATED/STAGED only.

[ ] Customer-facing message is NEVER automatically SENT.

[ ] Existing Quick Assist/Staged Messages remains the manual send point.

[ ] Human can review before customer communication.

[ ] Existing morning schedule continues to work.

[ ] No duplicate workflow exists.

[ ] No duplicate scheduler exists.

[ ] No duplicate notification service exists.

[ ] No duplicate staged-message system exists.

[ ] No dummy/fabricated business data is introduced.

[ ] No unrelated files are modified.

[ ] No frontend UI redesign is performed.

[ ] Existing workflow structure remains intact.

============================================================
28. IMPLEMENTATION METHOD
============================================================

The coding agent must work in this order:

STEP 1:
Inspect existing files.

STEP 2:
Trace existing WhatsApp confirmation → Pharmarack Live Cart flow.

STEP 3:
Trace existing owner WhatsApp notification flow.

STEP 4:
Trace existing Staged Messages → Quick Assist → manual Send flow.

STEP 5:
Trace existing morning schedule/refill notification flow.

STEP 6:
Identify the smallest existing functions where the new behavior belongs.

STEP 7:
Modify ONLY those existing functions/files.

STEP 8:
Do not rewrite unrelated logic.

STEP 9:
Run existing tests/guardrails.

STEP 10:
Perform the complete manual workflow test.

STEP 11:
Check that no customer-facing WhatsApp message is automatically sent
after Live Cart success.

STEP 12:
Check that owner notification is automatically sent.

STEP 13:
Check that the message appears in existing Staged Messages.

STEP 14:
Check that manual Send still sends the message normally.

============================================================
29. REQUIRED FINAL CODE-AGENT CROSS-CHECK
============================================================

AFTER IMPLEMENTATION, compare OLD vs NEW behavior.

OLD:

    Customer request
        ↓
    Existing medicine confirmation
        ↓
    Pharmarack
        ↓
    Live Cart
        ↓
    Existing notifications/messages

NEW:

    Customer request
        ↓
    Existing medicine confirmation
        ↓
    Existing quantity confirmation
        ↓
    Customer explicitly confirms
        ↓
    Existing Pharmarack search
        ↓
    Existing distributor logic
        ↓
    Existing Live Cart
        ↓
    Owner automatically notified
        ↓
    Customer message automatically STAGED
        ↓
    NO customer auto-send
        ↓
    Human reviews
        ↓
    Existing manual SEND
        ↓
    Customer receives message

The agent must verify that the NEW implementation is an extension of the
OLD workflow and not a replacement with a second workflow.

============================================================
30. FINAL OLD vs NEW BEHAVIOR SUMMARY
============================================================

OLD BEHAVIOR:

    Customer confirms
        ↓
    Existing procurement/cart workflow
        ↓
    Communication handling

NEW BEHAVIOR:

    Customer confirms
        ↓
    Same existing procurement/cart workflow
        ↓
    Live Cart success
        ↓
    AUTOMATIC owner WhatsApp notification
        ↓
    Customer message → STAGED
        ↓
    HUMAN REVIEW
        ↓
    MANUAL SEND
        ↓
    Customer receives message

MAIN CHANGE:

    Add the Human-in-the-Loop ONLY at the customer communication stage.

DO NOT put the human in the middle of the internal procurement process.

Therefore:

    BOT:
    - identify
    - clarify
    - confirm
    - search
    - select distributor
    - add to Live Cart
    - verify cart
    - notify owner
    - stage customer message

    HUMAN:
    - review staged message/order
    - make correction if necessary
    - manually send customer message

FINAL PRINCIPLE:

    INTERNAL AUTOMATION = AUTOMATIC

    CUSTOMER COMMUNICATION = HUMAN CONTROLLED

    EXISTING WORKFLOW = PRESERVED

    EXISTING FILE STRUCTURE = PRESERVED

    FRONTEND UI = UNCHANGED

    DUPLICATE WORKFLOW = NOT ALLOWED