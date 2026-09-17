IMPLEMENTATION PLAN
AI-PHARMACY-V3
FEATURE: FIX WHATSAPP CONFIRMED ORDER → PHARMARACK LIVE CART → OWNER NOTIFICATION → EXISTING STAGED MESSAGE → HUMAN SEND

============================================================
1. OBJECTIVE
============================================================

Correct the EXISTING WhatsApp confirmed-order workflow so that the application
uses the workflow that already exists instead of creating a second workflow.

FINAL REQUIRED FLOW:

Customer WhatsApp
      ↓
Existing WhatsApp Intent Detection
      ↓
Existing Medicine Matching / Clarification
      ↓
Existing Quantity Collection
      ↓
Existing Explicit Customer Confirmation
      ↓
Existing Pharmarack Search
      ↓
Existing Stock / Distributor Selection
      ↓
Existing Pharmarack Live Cart
      ↓
VERIFY CART SUCCESS
      ↓
Existing Owner/Admin WhatsApp Notification
      ↓
Existing Customer Staged Message / Quick Assist
      ↓
STOP
      ↓
Human Reviews Existing Staged Message
      ↓
Human Uses Existing Manual SEND
      ↓
Customer Receives Message

IMPORTANT:

The customer-facing WhatsApp message MUST NOT be automatically sent after
the Live Cart operation.

The existing human-controlled customer messaging workflow must remain the
ONLY path for the final customer-facing message.

Do NOT create a new WhatsApp ordering workflow.

Do NOT create a second staging system.

Do NOT create a second Quick Assist system.

Do NOT create a second customer messaging service.

Do NOT redesign the frontend.

Do NOT change unrelated application behavior.

============================================================
2. EXISTING FILES / STRUCTURE TO PRESERVE
============================================================

The repository already contains the relevant workflow.

Primary existing files involved:

1. src/services/whatsappIntentService.ts

Existing responsibility:
- WhatsApp inbound message processing
- Customer identification
- Medicine parsing
- Medicine clarification
- Quantity handling
- Explicit confirmation
- Confirmed procurement flow
- Pharmarack search
- Live Cart operation
- Order creation
- Existing staged-message creation

2. src/routes/pharmarack.ts

Existing responsibility:
- Pharmarack search
- Distributor availability
- Stock filtering
- Distributor selection
- Live Cart functionality
- Existing Pharmarack integration

3. src/services/waAdminEscalationService.ts

Existing responsibility:
- Admin/owner WhatsApp escalation
- Owner WhatsApp number resolution
- Admin notification
- Live Cart success/failure notification

4. src/services/orderScheduleService.ts

Existing responsibility:
- Existing order scheduling
- Cutoff calculation
- Holiday/business-hour scheduling

5. src/services/refillService.ts

Existing responsibility:
- Existing refill workflow
- Existing refill scheduling/notification behavior

6. Existing Staged Messages / Quick Assist implementation

IMPORTANT:

Before changing anything, LOCATE the exact existing implementation that reads
automation_notifications / staged customer messages and provides the existing
manual SEND action.

Do NOT create a new staging table, new staging service, or new send mechanism.

The existing implementation must be reused.

============================================================
3. CURRENT BEHAVIOR
============================================================

CURRENT CUSTOMER CONFIRMATION FLOW:

Customer sends medicine request.

Example:

Customer:
"Zifi"

Existing system:
- Finds possible medicine matches
- Requests selection if ambiguous
- Requests quantity
- Stores pending clarification

Customer:
"2"

Existing system:
- Stores quantity
- Requests final confirmation

Customer:
"YES"

Existing system:
- Treats the medicine as confirmed
- Calls executeConfirmedProcurementFlow()

THIS PART IS ALREADY PRESENT AND MUST NOT BE REBUILT.

============================================================
4. CURRENT PROCUREMENT FLOW
============================================================

The current implementation already performs approximately:

Customer confirmation
      ↓
Pharmarack search
      ↓
Stock filtering
      ↓
Distributor selection
      ↓
Live Cart add
      ↓
special_orders record
      ↓
automation_notifications staged record
      ↓
Owner WhatsApp notification
      ↓
Customer WhatsApp queue

The first parts are already implemented.

DO NOT replace them.

Only correct the incorrect parts and strengthen the existing flow.

============================================================
5. CURRENT PROBLEM #1
============================================================

The current executeConfirmedProcurementFlow() creates a staged customer
message in automation_notifications.

The existing code creates:

status = 'staged'
needs_confirmation = 1

This is correct and MUST remain.

However, immediately afterward the current implementation also calls:

whatsappQueueWorker.enqueue(
    phone,
    custAckMsg,
    'customer_inquiry_confirmed',
    ...
)

This directly queues a customer-facing WhatsApp message.

This violates the required human-review workflow.

CURRENT:

Live Cart
   ↓
Create staged message
   ↓
Owner notification
   ↓
STAGED MESSAGE
   ↓
❌ Direct customer WhatsApp enqueue
   ↓
Customer automatically receives message

EXPECTED:

Live Cart
   ↓
Create/update existing staged message
   ↓
Owner notification
   ↓
STOP

Human later:
Staged Message
   ↓
Review
   ↓
Existing Manual Send
   ↓
Customer

============================================================
6. REQUIRED FIX #1
============================================================

Modify ONLY the existing confirmed procurement flow inside:

src/services/whatsappIntentService.ts

Remove the direct customer-facing automatic send that occurs AFTER the
staged message has been created.

Do NOT remove:
- customer clarification messages
- quantity questions
- medicine selection messages
- confirmation request messages
- cancellation messages
- other legitimate conversational WhatsApp messages required BEFORE
  procurement

Only remove the final customer-facing automatic acknowledgement that is
currently being sent after the confirmed procurement / Live Cart workflow.

The existing staged customer message must remain.

The human-controlled customer SEND mechanism must remain untouched.

============================================================
7. CURRENT PROBLEM #2
============================================================

The current code calls:

addItemsToPharmarackCart()

and receives:

cartResult

but the workflow can continue into order creation and customer staging even
when the cart operation is unsuccessful.

This can create an incorrect state.

Example of the dangerous behavior:

Live Cart attempt
      ↓
FAILED
      ↓
special_orders = Confirmed
      ↓
customer message = staged as successful order
      ↓
customer could later receive misleading message

This must NOT happen.

============================================================
8. REQUIRED FIX #2
============================================================

Inside the existing:

executeConfirmedProcurementFlow()

in:

src/services/whatsappIntentService.ts

use the existing cartResult.success result as a hard workflow gate.

REQUIRED:

if Live Cart succeeds:

    continue to:
    - schedule calculation
    - special_orders creation
    - staged customer message
    - owner success notification
    - UI event

if Live Cart fails:

    DO NOT create a successful customer staged message.

    DO NOT tell the customer that the order was successfully arranged.

    DO NOT mark the order as successfully processed.

    Use the existing owner/admin notification mechanism to report the failure.

The existing:

waAdminEscalationService.notifyAdminOfLiveCartAdd()

already supports success and failure messages.

Reuse it.

Do not create another failure notification service.

============================================================
9. CART SUCCESS RULE
============================================================

The authoritative sequence must become:

Confirmed Customer Order
      ↓
Existing Pharmarack Search
      ↓
Existing Distributor Selection
      ↓
Existing Live Cart Add
      ↓
cartResult.success === true ?
      │
      ├── NO
      │    ↓
      │   Existing Owner Failure Notification
      │    ↓
      │   STOP
      │
      └── YES
           ↓
        Existing Schedule Calculation
           ↓
        Existing special_orders record
           ↓
        Existing staged customer message
           ↓
        Existing Owner Success Notification
           ↓
        STOP
           ↓
        Human manually sends customer message later

============================================================
10. DUPLICATE ORDER / CART PROTECTION
============================================================

The existing application already contains duplicate/deduplication logic in
the WhatsApp/admin workflow.

Do NOT create a new synchronization engine.

Before modifying the cart flow:

1. Inspect the existing duplicate protection.
2. Determine whether the inbound WhatsApp msg.id is already used as an
   idempotency key.
3. Determine whether the existing special_orders record can be used to
   prevent duplicate processing.
4. Determine whether the existing Pharmarack cart helper already detects
   existing cart items.

Reuse the existing mechanisms.

Only if a genuine missing protection is found should the smallest possible
change be made in the existing relevant function.

Required behavior:

Same WhatsApp event processed twice:

First processing:
    Pan 40 × 2
    ↓
    Cart +2

Second processing of SAME EVENT:
    ↓
    Detect duplicate
    ↓
    DO NOT add another +2

Final:
    Pan 40 = 2

NOT:

First event → +2
Second event → +2
Final → 4

Do not build a new database or service just for this.

============================================================
11. EXISTING CUSTOMER CONFIRMATION MUST REMAIN
============================================================

The current clarification mechanism is already implemented.

Existing states include:

awaiting_selection
awaiting_qty
awaiting_confirmation

Do not replace this system.

Required behavior:

Customer:
"Zifi"

      ↓

Existing medicine matching

      ↓

If ambiguous:
Existing options

      ↓

Customer selects medicine

      ↓

Existing quantity handling

      ↓

Existing confirmation prompt

      ↓

Customer:
"YES"

      ↓

Only now:
executeConfirmedProcurementFlow()

AI confidence MUST NOT bypass explicit confirmation.

Do not change this behavior unless required for the above corrections.

============================================================
12. QUANTITY CHANGE RULE
============================================================

Existing quantity adjustment behavior must remain.

Example:

Customer:
"Actually make it 3"

Existing system:
- Updates pending quantity
- Changes state to awaiting_confirmation
- Requests confirmation again

Customer:
"YES"

Only the new confirmed quantity may be sent to Pharmarack.

Do not add the old quantity first.

Do not create a second quantity management system.

============================================================
13. PHARMARACK RULE
============================================================

Reuse:

src/routes/pharmarack.ts

and existing helpers.

Do NOT rewrite Pharmarack integration.

Preserve existing:

- sanitized medicine search
- stock checking
- out-of-stock filtering
- distributor matching
- common distributor selection
- frequent distributor selection
- existing cart detection
- existing cart quantity logic
- existing Pharmarack API behavior

Only modify this file if inspection proves that a specific required correction
cannot be completed inside the existing WhatsApp procurement flow.

Do not modify unrelated Pharmarack functionality.

============================================================
14. DISTRIBUTOR SELECTION
============================================================

The existing implementation already has:

resolveCommonOrFrequentDistributor()

and stock-aware candidate selection.

Preserve it.

Required sequence:

Pharmarack results
      ↓
Filter usable stock
      ↓
Existing common/frequent distributor logic
      ↓
Select distributor
      ↓
Add selected product to existing Live Cart

Do not create another distributor-selection algorithm.

============================================================
15. OWNER WHATSAPP NOTIFICATION
============================================================

Reuse:

src/services/waAdminEscalationService.ts

Existing owner-number resolution must remain.

The application already checks existing Settings keys, including the existing
owner/admin WhatsApp settings.

Do NOT hardcode a phone number.

Do NOT create another Settings field.

Do NOT create another admin WhatsApp service.

Successful cart:

Owner receives:

WhatsApp Order Added to Live Cart
Customer
Phone
Order reference
Medicine
Quantity
Distributor
PTR/MRP when available
Cart = Successfully Added
Customer message = STAGED
Customer auto-send = OFF

Failed cart:

Owner receives:

WhatsApp Order Requires Attention
Customer
Phone
Order reference
Medicine
Quantity
Cart = FAILED
Failure reason
Action required

The existing notification function must be reused.

============================================================
16. CUSTOMER STAGED MESSAGE
============================================================

After successful Live Cart addition:

Use the EXISTING staged customer message mechanism.

The current code already writes to:

automation_notifications

with:

status = 'staged'
needs_confirmation = 1

Preserve this behavior IF this is confirmed to be the existing Staged
Messages / Quick Assist source.

Before modifying this section:

TRACE:

automation_notifications
      ↓
existing backend/API
      ↓
existing Staged Messages data
      ↓
existing Quick Assist UI
      ↓
existing manual Send action
      ↓
customer WhatsApp

If this exact path exists:

REUSE IT.

Do not create anything new.

If another existing table/service is actually the authoritative source for
Staged Messages, modify the existing procurement flow to use that existing
source instead.

Do not maintain two staging systems.

============================================================
17. CUSTOMER AUTO-SEND RULE
============================================================

This is a HARD REQUIREMENT.

After procurement:

NO:

whatsappQueueWorker.enqueue(customerPhone, finalCustomerMessage...)

The final customer-facing message must NOT be directly queued from the
confirmed procurement flow.

The customer message must remain:

STAGED

until the existing human manually sends it.

Do not:
- call customer WhatsApp send
- mark message SENT
- create an automatic customer worker
- create a cron for this message
- create a second send service
- bypass Quick Assist

============================================================
18. IMPORTANT DISTINCTION
============================================================

Not every WhatsApp message in whatsappIntentService.ts is forbidden.

The following remain allowed because they are part of the existing
conversation/clarification workflow:

- "Please select medicine"
- "How many strips do you need?"
- "Please confirm"
- "Reply YES"
- "Reply NO"
- clarification messages
- cancellation messages
- other existing conversational responses

The ONLY message that must be removed from automatic sending is the
post-confirmation customer-facing fulfilment acknowledgement that should
instead remain in the existing Staged Messages workflow.

This prevents accidentally breaking the existing WhatsApp conversation engine.

============================================================
19. ORDER RECORD
============================================================

After successful Live Cart addition:

Use the existing special_orders structure.

Do NOT create another order table.

Preserve:

- store_id
- requester
- phone
- medicine_name
- product
- qty
- status
- date
- customer_order_source
- distributor
- rate
- MRP
- schedule fields
- cutoff fields
- timezone
- existing scheduling metadata

Only create the successful order record AFTER confirmed cart success.

============================================================
20. SCHEDULING
============================================================

Reuse:

src/services/orderScheduleService.ts

Do not create a new scheduling system.

Existing cutoff/business-hour/holiday logic must remain.

The confirmed WhatsApp order should continue through the existing schedule
calculation.

Do not modify schedule behavior unless required to prevent an incorrect
success state when the cart fails.

============================================================
21. FRONTEND REQUIREMENT
============================================================

NO FRONTEND UI REDESIGN.

Do not change:
- layout
- colors
- components
- navigation
- page design
- existing Quick Assist design
- Staged Messages UI
- Website Orders UI
- dashboard UI

Only make a frontend change if the existing backend contract absolutely
requires a minimal compatibility correction.

If no frontend modification is necessary:

DO NOT TOUCH THE FRONTEND.

============================================================
22. STRICT FILE-SCOPE RULE
============================================================

The coding agent is authorized to modify ONLY:

PRIMARY:

src/services/whatsappIntentService.ts

SECONDARY ONLY IF REQUIRED AFTER INSPECTION:

src/services/waAdminEscalationService.ts
src/routes/pharmarack.ts

TEST FILES directly related to this workflow may be modified/created only
when necessary to verify the behavior.

EXISTING FILES such as:

src/services/orderScheduleService.ts
src/services/refillService.ts

must NOT be modified unless the agent proves that the requested behavior
cannot work correctly without a change there.

The agent must NOT touch unrelated files.

DO NOT modify:
- unrelated frontend pages
- unrelated frontend components
- unrelated backend services
- unrelated database tables
- unrelated API routes
- package configuration
- deployment configuration
- Vercel configuration
- generated distribution artifacts
- unrelated tests
- unrelated features

Do not modify:

dist-pkg/server.cjs
dist-pkg/sea-prep.blob

for this feature.

Do not rebuild or restructure the project.

============================================================
23. NO DUPLICATE IMPLEMENTATION RULE
============================================================

Before writing code, inspect the repository.

Find the existing implementation for:

1. WhatsApp inbound handling
2. Customer clarification
3. Confirmation
4. Pharmarack search
5. Distributor selection
6. Live Cart
7. Order creation
8. Owner notification
9. automation_notifications
10. Staged Messages
11. Quick Assist
12. Manual Send

Then connect the existing functions.

Do NOT create:

newWhatsappOrderService.ts
newCustomerMessagingService.ts
newStagedMessageService.ts
newPharmarackCartService.ts
newOwnerNotificationService.ts
newOrderWorkflow.ts

unless a completely missing component is proven to be necessary.

The existing architecture must remain the architecture.

============================================================
24. REQUIRED TEST COVERAGE
============================================================

Add or update ONLY tests related to this workflow.

Minimum required tests:

TEST 1:
Customer cannot reach procurement without explicit confirmation.

TEST 2:
Customer quantity is preserved correctly.

TEST 3:
Customer quantity adjustment requires new confirmation.

TEST 4:
Confirmed order reaches existing Pharmarack procurement.

TEST 5:
Successful Live Cart addition creates the existing order record.

TEST 6:
Successful Live Cart addition creates the existing staged customer
message.

TEST 7:
Successful Live Cart addition sends owner notification.

TEST 8:
Successful Live Cart addition DOES NOT automatically send the final
customer-facing message.

TEST 9:
Failed Live Cart addition does NOT create a successful customer staged
fulfilment message.

TEST 10:
Failed Live Cart addition sends the existing owner failure notification.

TEST 11:
Same WhatsApp event cannot add the same cart quantity twice.

TEST 12:
Existing customer manual Staged Message Send path remains unaffected.

Do not create broad unrelated tests.

============================================================
25. CROSS-CHECK AFTER CODING
============================================================

After implementation, the coding agent MUST perform a complete old-vs-new
behavior audit.

DO NOT simply report "tests passed."

Check the actual source code and execution path.

OLD BEHAVIOR:

Customer confirms
      ↓
Pharmarack
      ↓
Live Cart
      ↓
Staged customer message
      ↓
❌ Customer queue send
      ↓
Customer receives automatically

NEW BEHAVIOR:

Customer confirms
      ↓
Pharmarack
      ↓
Live Cart
      ↓
SUCCESS CHECK
      ↓
Owner notification
      ↓
Existing staged customer message
      ↓
STOP
      ↓
Human manual Send
      ↓
Customer

The agent must confirm that there is NO remaining automatic customer send
inside the confirmed procurement flow.

============================================================
26. SECOND CROSS-CHECK: FAILURE PATH
============================================================

Verify:

OLD RISK:

Cart fails
      ↓
Workflow may continue
      ↓
Order/staged success state

NEW:

Cart fails
      ↓
NO successful customer fulfilment message
      ↓
NO false successful order state
      ↓
Existing owner/admin failure notification
      ↓
STOP

============================================================
27. THIRD CROSS-CHECK: DUPLICATE PATH
============================================================

Verify:

WhatsApp event #1
      ↓
Cart quantity added once

Same WhatsApp event #2
      ↓
Duplicate detected
      ↓
No second cart addition

Final quantity must remain the intended quantity.

============================================================
28. FOURTH CROSS-CHECK: EXISTING WORKFLOW
============================================================

Confirm that the following existing systems still work:

- WhatsApp intent
- medicine clarification
- quantity clarification
- explicit confirmation
- Pharmarack search
- stock filtering
- distributor selection
- Live Cart
- owner notification
- existing Staged Messages
- Quick Assist
- manual customer Send
- existing refill workflow
- existing order scheduling

Do not rewrite these systems.

Only verify that the corrected workflow connects them correctly.

============================================================
29. REQUIRED CODE REVIEW QUESTIONS
============================================================

Before declaring completion, the agent must answer YES/NO for each:

[ ] Did I reuse the existing WhatsApp intent workflow?
[ ] Did I reuse the existing confirmation state?
[ ] Did I reuse the existing Pharmarack search?
[ ] Did I reuse the existing distributor-selection logic?
[ ] Did I reuse the existing Live Cart implementation?
[ ] Did I reuse the existing order record?
[ ] Did I reuse the existing owner WhatsApp notification service?
[ ] Did I reuse the existing Staged Messages mechanism?
[ ] Did I reuse the existing Quick Assist/manual Send mechanism?
[ ] Did I remove only the unwanted automatic customer fulfilment send?
[ ] Does a failed cart prevent a successful customer fulfilment state?
[ ] Is duplicate processing protected?
[ ] Did I avoid creating a second workflow?
[ ] Did I avoid creating duplicate services?
[ ] Did I avoid creating duplicate database structures?
[ ] Did I avoid changing the frontend UI?
[ ] Did I avoid touching unrelated files?
[ ] Did I avoid modifying generated distribution artifacts?
[ ] Did I run the relevant tests?
[ ] Did I inspect the final code path manually after tests?

============================================================
30. FINAL REQUIRED RESULT
============================================================

The final application must behave as:

CUSTOMER:

"Zifi"

      ↓

Existing clarification

      ↓

"Zifi 200mg Tablet"

      ↓

Existing quantity collection

      ↓

"2 strips"

      ↓

Existing confirmation

      ↓

"YES"

      ↓

Existing Pharmarack search

      ↓

Existing distributor selection

      ↓

Existing Live Cart

      ↓

Cart SUCCESS

      ↓

Existing special_orders record

      ↓

Existing customer message = STAGED

      ↓

Existing owner WhatsApp notification

      ↓

STOP CUSTOMER AUTOMATION

      ↓

Human opens existing Staged Messages / Quick Assist

      ↓

Human reviews message

      ↓

Human clicks existing SEND

      ↓

Customer receives message

============================================================
31. COMPLETION REPORT REQUIRED FROM CODE AGENT
============================================================

After coding, provide a SHORT completion report containing exactly:

1. Files modified:
   - list only actual modified files

2. Files NOT modified:
   - confirm unrelated frontend/project files were untouched

3. Old behavior:
   - one short paragraph

4. New behavior:
   - one short paragraph

5. Customer auto-send:
   - confirm whether automatic final customer send is disabled

6. Cart failure:
   - confirm whether failed Live Cart prevents successful customer
     fulfilment staging

7. Duplicate protection:
   - explain which existing mechanism prevents duplicate processing

8. Existing workflow reused:
   - confirm which existing services/functions were reused

9. Tests:
   - list tests executed and result

10. Final verification:
   - confirm that no duplicate WhatsApp order workflow, staging workflow,
     notification workflow, or customer messaging workflow was introduced.

============================================================
FINAL AGENT RULE
============================================================

DO NOT START FROM THE BEGINNING.

DO NOT REBUILD THE FEATURE.

DO NOT CREATE A NEW ARCHITECTURE.

DO NOT CREATE A SECOND WORKFLOW.

THE EXISTING AI-PHARMACY-V3 WORKFLOW IS THE FOUNDATION.

ONLY CORRECT THE EXISTING IMPLEMENTATION WHERE THE CURRENT BEHAVIOR DIFFERS
FROM THE REQUIRED BEHAVIOR.

MINIMIZE FILE CHANGES.

MINIMIZE CODE CHANGES.

PRESERVE ALL EXISTING FUNCTIONALITY THAT IS ALREADY WORKING.

NO FRONTEND UI CHANGES.

NO UNRELATED FILE CHANGES.

NO GENERATED BUILD ARTIFACT CHANGES.

FINAL PRINCIPLE:

"EXTEND AND CORRECT THE EXISTING WORKFLOW, NEVER DUPLICATE IT."