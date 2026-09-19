
IMPLEMENTATION PLAN
FEATURE: WhatsApp Medicine Request → Pharmarack → Owner Confirmation → ₹50 Booking Payment → Special Order → Existing Live Cart

REPOSITORY:
loki94in/AI-PHARMACY-V3

PRIMARY RULE:
DO NOT BUILD THIS WORKFLOW FROM SCRATCH.

The existing application already contains WhatsApp automation, medicine/customer handling, Pharmarack integration, Special Order/order handling, payment/UPI settings, and Live Cart functionality or related structures.

The implementation agent MUST first inspect the existing codebase and identify the CURRENT files, functions, services, database models, APIs, handlers, and workflow/state structures responsible for each part.

The agent must reuse the existing implementation wherever possible.

DO NOT create a second implementation of:
- WhatsApp messaging
- customer identification
- medicine search
- Pharmarack search
- Special Orders
- payment/UPI
- Live Cart
- owner WhatsApp notification

Only extend/fix the existing workflow.

==================================================
1. CURRENT BEHAVIOR TO INSPECT FIRST
==================================================

Before changing anything, inspect the repository and document internally:

A. Existing WhatsApp workflow
- Incoming WhatsApp webhook/message handler
- Existing conversation/session state
- Existing bot reply logic
- Existing customer identification using WhatsApp number
- Existing message sending service
- Existing owner WhatsApp notification logic

B. Existing medicine search
- Existing Master Database medicine search
- Existing medicine-name normalization/matching
- Existing Pharmarack medicine search
- Existing stock/availability filtering
- Existing medicine IDs and Pharmarack IDs

C. Existing Special Order workflow
- Existing Special Order model/table/schema
- Existing Special Order creation service/API
- Existing Special Order ID generation
- Existing customer association
- Existing status handling

D. Existing payment workflow
- Existing UPI IDs saved in Settings
- Existing QR-code generation/selection logic
- Existing payment screenshot handling/storage
- Existing owner notification for payment screenshots
- Existing payment verification/status logic

E. Existing Live Cart
- Existing customer Live Cart model/table
- Existing add-to-cart service/API
- Existing medicine/product identification
- Existing quantity handling

IMPORTANT:
The agent must identify the exact existing files before editing.

If a required capability already exists, modify that capability instead of creating another service/file.

==================================================
2. REQUIRED NEW WORKFLOW
==================================================

The existing WhatsApp workflow must be extended to follow this exact sequence:

CUSTOMER
  ↓
Sends "Hi" or any initial message
  ↓
BOT GREETING + WORKFLOW EXPLANATION
  ↓
BOT ASKS ONLY FOR MEDICINE NAME
  ↓
CUSTOMER SENDS MEDICINE NAME
  ↓
SEARCH EXISTING MASTER DB + PHARMARACK MEDICINE NAMES
  ↓
COMBINE/MERGE SIMILAR MEDICINE NAMES
  ↓
BOT CONFIRMS THE MEDICINE NAME
  ↓
CUSTOMER CONFIRMS MEDICINE
  ↓
BOT ASKS QUANTITY
  ↓
CUSTOMER PROVIDES QUANTITY
  ↓
BOT CONFIRMS MEDICINE + QUANTITY
  ↓
CUSTOMER CONFIRMS
  ↓
APP SEARCHES PHARMARACK
  ↓
REMOVE ALL OUT-OF-STOCK RESULTS
  ↓
CREATE SPECIAL ORDER
  ↓
OWNER RECEIVES COMPLETE PHARMARACK RESULTS
  ↓
OWNER SELECTS PHARMARACK RESULT USING SPECIAL ORDER ID + RESULT NUMBER
  ↓
APP SAVES OWNER'S SELECTED PHARMARACK ITEM
  ↓
APP REQUESTS ₹50 BOOKING PAYMENT FROM CUSTOMER
  ↓
CUSTOMER RECEIVES EXISTING/SELECTED UPI QR
  ↓
CUSTOMER PAYS ₹50
  ↓
CUSTOMER SENDS PAYMENT SCREENSHOT
  ↓
SCREENSHOT IS STORED AGAINST SPECIAL ORDER
  ↓
SCREENSHOT IS FORWARDED TO OWNER
  ↓
OWNER VERIFIES PAYMENT
  ↓
SPECIAL ORDER PAYMENT STATUS = VERIFIED
  ↓
MEDICINE + CUSTOMER REQUESTED QUANTITY ADDED TO EXISTING LIVE CART
  ↓
CUSTOMER RECEIVES FINAL CONFIRMATION

==================================================
3. FIRST CUSTOMER MESSAGE & NAME ONBOARDING
==================================================

Use the EXISTING WhatsApp message/reply mechanism.

Case A — Unsaved / Unknown Customer sends "Hi" or initial greeting:
The bot welcomes them and asks for their name before starting:

"👋 Hello! Welcome to [Pharmacy Name].

Before we begin, *may I please know your name?*"

Customer replies with their name (e.g. "Rahul Sharma"):
1. The app sanitizes, capitalizes, and saves the customer in the `customers` database and local chat cache.
2. The bot replies with personal welcome + 6-step workflow:

"🙏 Namaste *Rahul Sharma* ji! Welcome to [Pharmacy Name].

I can help you place a medicine request through WhatsApp.

How it works:
1️⃣ Send the medicine name
2️⃣ Confirm the medicine
3️⃣ Enter the quantity
4️⃣ Confirm your request
5️⃣ Pay the ₹50 booking amount
6️⃣ Send the payment screenshot

After payment verification, your medicine will be added to your Live Cart.

Please enter the medicine name you need."

Case B — Known Customer (name already in DB) sends "Hi":
The bot directly greets them by name without asking again:

"👋 Hello *[Customer Name]*! Welcome back to [Pharmacy Name].

I can help you place a medicine request through WhatsApp.

How it works:
1️⃣ Send the medicine name
2️⃣ Confirm the medicine
3️⃣ Enter the quantity
4️⃣ Confirm your request
5️⃣ Pay the ₹50 booking amount
6️⃣ Send the payment screenshot

After payment verification, your medicine will be added to your Live Cart.

Please enter the medicine name you need."

Case C — Unsaved Customer direct-orders a medicine without greeting:
Medicine search, selection, and quantity proceed seamlessly. At step 4 (Order Confirmation), the bot prompts for their name before creating the Special Order and forwarding to the owner:
"Before we confirm your request for *[Medicine]* × [Qty], *may I please know your name?*"
Once provided, the Special Order, owner notification, payment screenshot forwarding, and Live Cart staged message all reflect their real name.

==================================================
4. MEDICINE SEARCH
==================================================

When the customer sends a medicine name:

Example:
"R B Tone"

The application must search BOTH existing sources:

1. Existing Master Database
2. Existing Pharmarack medicine catalogue/search data

The results must be combined into one customer-facing medicine list.

IMPORTANT:
The customer should NOT see Pharmarack distributor information at this stage.

Customer-facing results contain ONLY medicine names.

Example:

"🔎 I found these medicine options:

1️⃣ R B TONE CAP
2️⃣ R B TONE TAB
3️⃣ R B TONE FORTE CAP

Please reply with the number of the medicine you need."

Use existing medicine matching/normalization logic if available.

Do not create duplicate medicine records.

Similar names must be merged where they represent the same medicine.

Example:

Master DB:
R B TONE CAP

Pharmarack:
R B Tone Capsule
R-B Tone Cap
RB Tone Capsule

Customer should see one logical medicine option:

1️⃣ R B TONE CAP

The underlying Pharmarack references must remain available internally.

Maximum customer-facing options:
15 per page.

If more than 15 relevant results exist, the bot presents the first 15 options followed by:
"👉 Reply *MORE* to see more options."
Replying "MORE" displays the next batch of 15 options, allowing customers to easily select higher numbers (e.g. 16 to 30) or any number on the list.

==================================================
5. MEDICINE CONFIRMATION
==================================================

Before asking quantity, the bot must confirm the selected medicine.

Example:

"💊 Medicine selected:
R B TONE CAP

Is this the medicine you need?

Reply YES to confirm or NO to search again."

Do not proceed to quantity until medicine confirmation is received.

Use the existing conversation/session state.

==================================================
6. QUANTITY
==================================================

After medicine confirmation:

"✅ Medicine confirmed: R B TONE CAP

📦 Please enter the quantity you need."

Customer:
"2"

The existing workflow must validate the quantity.

Then:

"Please confirm your request:

💊 Medicine: R B TONE CAP
📦 Quantity: 2

Reply YES to confirm."

Only after customer confirmation should the Pharmarack supplier search start.

==================================================
7. PHARMARACK SEARCH
==================================================

After medicine + quantity confirmation:

Use the EXISTING Pharmarack search implementation.

Do NOT create a new Pharmarack integration.

Search for the confirmed medicine.

Remove every out-of-stock result before sending results to the owner.

The customer does NOT select the supplier.

The OWNER selects the supplier.

==================================================
8. SPECIAL ORDER CREATION
==================================================

When the Pharmarack results are ready, create/use the EXISTING Special Order workflow.

Do not create a duplicate Special Order model if one already exists.

Create a unique Special Order ID.

Example:

SO-10452

Store/link:

- Special Order ID
- Customer ID
- Customer WhatsApp number
- Customer name if already available
- Confirmed medicine
- Customer requested quantity
- Original WhatsApp conversation/session reference
- Pharmarack search results
- Current Special Order status
- Owner selection status
- Payment status
- Live Cart status

The Special Order ID must remain the permanent reference throughout this workflow.

==================================================
9. OWNER WHATSAPP MESSAGE
==================================================

Use the existing owner WhatsApp notification mechanism.

Owner must receive the complete Pharmarack search results.

Example:

"🔔 New Special Order Request

🆔 Special Order ID: SO-10452

👤 Customer: Rahul
📱 WhatsApp: +91 XXXXXXXX

💊 R B TONE CAP
📦 Quantity: 2

🔎 Pharmarack Search Results

1️⃣ Distributor A | Available | ₹XX
2️⃣ Distributor B | Available | ₹XX
3️⃣ Distributor C | Available | ₹XX

Please reply with:
SO-10452 2"

IMPORTANT:

The owner receives Pharmarack details.

The customer does NOT receive these Pharmarack supplier results.

==================================================
10. OWNER RESPONSE
==================================================

Owner response example:

SO-10452 2

The application must parse:

Special Order ID = SO-10452
Selected Pharmarack result = 2

Then validate:

- Owner WhatsApp number
- Special Order ID exists
- Special Order belongs to the referenced customer/request
- Result number exists
- Result is not out-of-stock
- Special Order is still awaiting owner selection
- Result has not already been finalized

Then save the selected Pharmarack product/distributor against the existing Special Order.

Do NOT use only "2" as the permanent identifier.

The Special Order ID MUST be part of owner confirmation.

==================================================
11. ₹50 BOOKING PAYMENT
==================================================

After owner selects the Pharmarack result:

Use the EXISTING payment/UPI settings.

The application already has UPI IDs configured in Settings.

Do not create another UPI settings system.

Booking amount:

₹50

Default booking amount must be ₹50.

If the existing Settings architecture supports configurable payment amounts, use that structure with ₹50 as the default.

Generate/show the payment QR using one of the existing active UPI configurations.

Customer message:

"✅ Medicine & supplier confirmed

🆔 Special Order: SO-10452

💊 Medicine: R B TONE CAP
📦 Quantity: 2

🔐 Booking Amount: ₹50

Please pay the ₹50 booking amount using the QR code below.

[₹50 UPI QR CODE]

After payment, please send the payment screenshot in this chat."

Do not ask the customer to select a distributor.

==================================================
12. PAYMENT SCREENSHOT
==================================================

When the customer sends the payment screenshot:

Use the EXISTING WhatsApp media/file handling if available.

Do not create a separate unrelated upload system.

Store the screenshot against:

Special Order ID = SO-10452

Also store:

- Customer
- WhatsApp number
- Payment amount = ₹50
- Payment status = SCREENSHOT_RECEIVED
- Screenshot reference/path/media ID
- Timestamp

Then forward the screenshot to the existing owner WhatsApp number.

Owner message:

"💰 Payment Verification Required

🆔 Special Order: SO-10452

👤 Customer: Rahul
📱 +91 XXXXXXXX

💊 R B TONE CAP
📦 Quantity: 2

💵 Booking Amount: ₹50

📸 Customer Payment Screenshot:
[image]

Please reply:
CONFIRM SO-10452"

==================================================
13. PAYMENT VERIFICATION
==================================================

Owner replies:

CONFIRM SO-10452

Validate:

- Owner identity/WhatsApp number
- Special Order ID
- Payment screenshot exists
- Special Order is awaiting payment verification

Then update:

Payment Status = VERIFIED

Special Order Status = CONFIRMED

Do NOT mark payment verified merely because the customer uploaded an image.

Do NOT add the medicine to Live Cart merely because the screenshot was received.

Owner verification is required in the current requested workflow.

==================================================
14. LIVE CART
==================================================

After owner payment verification:

Use the EXISTING Live Cart add-item functionality.

DO NOT create a second cart.

Add:

Medicine = confirmed medicine
Quantity = customer's confirmed requested quantity

Example:

R B TONE CAP × 2

The Pharmarack-selected item/reference should remain linked to the Special Order.

The ₹50 booking payment should remain linked to the Special Order/payment record.

Then:

Live Cart Status = ADDED

Special Order Status = CONFIRMED

==================================================
15. FINAL CUSTOMER MESSAGE
==================================================

After successful Live Cart addition:

"🎉 Your medicine request is confirmed!

🆔 Special Order ID: SO-10452

💊 R B TONE CAP
📦 Quantity: 2

💰 Booking Amount Paid: ₹50

🛒 Your medicine has been added to your Live Cart."

Use the existing WhatsApp sending mechanism.

==================================================
16. CONVERSATION STATE REQUIREMENT
==================================================

The existing WhatsApp conversation/session mechanism MUST be reused.

The workflow must maintain the current state, for example:

INITIAL
→ WAITING_FOR_MEDICINE
→ MEDICINE_CONFIRMATION
→ WAITING_FOR_QUANTITY
→ QUANTITY_CONFIRMATION
→ PHARMARACK_SEARCH
→ WAITING_FOR_OWNER_SELECTION
→ WAITING_FOR_PAYMENT
→ PAYMENT_SCREENSHOT_RECEIVED
→ WAITING_FOR_OWNER_PAYMENT_CONFIRMATION
→ PAYMENT_VERIFIED
→ ADDED_TO_LIVE_CART
→ COMPLETED

Do not introduce a second independent state machine if the project already has one.

Extend the existing state structure.

Each pending workflow must be tied to the customer WhatsApp number/customer ID and Special Order ID.

This prevents replies such as "1", "2", "YES", or "CONFIRM SO-10452" from being applied to the wrong request.

==================================================
17. MULTIPLE MEDICINE REQUESTS
==================================================

The workflow must support multiple medicines without mixing states.

Example:

SO-10452
R B TONE CAP
Qty 2

SO-10453
DOLO 650 TAB
Qty 3

Each Special Order must maintain its own:

- Medicine
- Quantity
- Pharmarack results
- Owner selection
- Payment
- Screenshot
- Status
- Live Cart relationship

Never identify an order only by the reply number.

==================================================
18. CUSTOMER VS OWNER INFORMATION
==================================================

CUSTOMER SEES:

- Greeting
- Workflow explanation
- Medicine names
- Medicine selection
- Quantity
- Medicine + quantity confirmation
- ₹50 booking payment
- QR code
- Payment screenshot request
- Final confirmation
- Special Order ID

CUSTOMER DOES NOT SEE:

- Pharmarack distributor search results
- Internal distributor IDs
- Supplier selection details
- Internal Pharmarack data
- Owner internal workflow information

OWNER SEES:

- Special Order ID
- Customer identity
- WhatsApp number
- Confirmed medicine
- Requested quantity
- Complete available Pharmarack results
- Supplier/distributor details
- Customer payment screenshot
- Payment verification action

==================================================
19. FILE MODIFICATION RESTRICTION
==================================================

STRICT FILE-SCOPE RULE:

The agent MUST NOT modify unrelated files.

Before coding:

1. Search the repository.
2. Locate the existing WhatsApp workflow files.
3. Locate the existing medicine search/matching files.
4. Locate the existing Pharmarack integration files.
5. Locate the existing Special Order files.
6. Locate the existing UPI/payment files.
7. Locate the existing Live Cart files.
8. Locate existing database/schema files only if required for the workflow.
9. Identify the smallest set of existing files required.

ONLY those related files may be modified.

DO NOT:

- Redesign frontend UI
- Change existing frontend layouts
- Create a new frontend page
- Create duplicate WhatsApp services
- Create duplicate Pharmarack services
- Create duplicate cart services
- Create duplicate Special Order systems
- Create duplicate customer systems
- Change unrelated business logic
- Refactor unrelated code
- Rename unrelated files
- Upgrade dependencies unnecessarily
- Change project architecture unnecessarily
- Delete existing workflow code
- Create dummy/fabricated business data
- Add test/demo distributor data to production logic

If a new file is absolutely required, it must be created ONLY when no existing related file can safely contain the functionality, and the agent must explain why that new file is necessary.

==================================================
20. FRONTEND RULE
==================================================

NO FRONTEND UI REDESIGN.

This implementation is primarily a backend/workflow/WhatsApp integration change.

Existing UI, components, layouts, styling, routes, navigation and screens must remain unchanged unless an existing related screen already requires a minimal data/status update for the workflow.

Do not modify frontend files simply because they are available.

==================================================
21. NO DUPLICATE WORKFLOW RULE
==================================================

Before implementation, compare the requested workflow with the existing workflow.

If an existing function already does something required:

REUSE IT.

If it is incomplete:

EXTEND IT.

If it has a bug:

FIX IT.

Do not create:

old WhatsApp workflow
+
new WhatsApp workflow

Instead:

EXISTING WHATSAPP WORKFLOW
        +
REQUIRED STATE/LOGIC CHANGES
        =
ONE FINAL WORKFLOW

The same principle applies to Pharmarack, Special Orders, Payment and Live Cart.

==================================================
22. VALIDATION REQUIREMENTS
==================================================

After implementation, cross-check the complete workflow from beginning to end.

Test at minimum:

1. Customer sends Hi
2. Greeting appears
3. Bot asks medicine name
4. Customer sends medicine name
5. Master DB + Pharmarack names are searched
6. Similar medicine names are combined
7. Maximum 5 customer-facing choices are shown
8. Customer selects medicine
9. Medicine is confirmed
10. Bot asks quantity
11. Customer enters quantity
12. Quantity confirmation appears
13. Customer confirms
14. Pharmarack search runs
15. Out-of-stock results are removed
16. Special Order is created
17. Special Order ID is generated
18. Owner receives complete Pharmarack results
19. Owner replies using Special Order ID + result number
20. Correct Pharmarack result is saved
21. ₹50 booking payment is generated using existing UPI Settings
22. Customer receives QR
23. Customer sends screenshot
24. Screenshot is stored against the correct Special Order
25. Screenshot is forwarded to owner
26. Owner confirms payment using Special Order ID
27. Payment status becomes VERIFIED
28. Correct medicine and customer-requested quantity are added to existing Live Cart
29. Customer receives final confirmation
30. Special Order, payment and Live Cart remain correctly linked

==================================================
23. EDGE CASES
==================================================

Handle using the existing error/retry patterns where available:

- Medicine not found
- Multiple similar medicines
- Customer sends invalid medicine selection number
- Customer sends invalid quantity
- Customer sends YES at the wrong stage
- Pharmarack returns no available stock
- Pharmarack result becomes unavailable
- Owner selects invalid result number
- Owner uses wrong Special Order ID
- Duplicate owner reply
- Duplicate payment screenshot
- Payment screenshot received for an already completed order
- Owner tries to confirm an already verified payment
- Customer sends another medicine while the previous request is pending
- Multiple Special Orders for the same customer
- WhatsApp message arrives after workflow completion

Never silently attach a response to another order.

==================================================
24. DATA INTEGRITY
==================================================

The following relationship must remain intact:

CUSTOMER WHATSAPP NUMBER
        ↓
CUSTOMER RECORD
        ↓
WHATSAPP SESSION
        ↓
SPECIAL ORDER ID
        ↓
MEDICINE
        ↓
CUSTOMER REQUESTED QUANTITY
        ↓
PHARMARACK SEARCH RESULTS
        ↓
OWNER SELECTED RESULT
        ↓
₹50 PAYMENT
        ↓
PAYMENT SCREENSHOT
        ↓
OWNER PAYMENT VERIFICATION
        ↓
EXISTING LIVE CART ITEM

No stage should lose the Special Order ID or customer association.

==================================================
25. FINAL CODE-AGENT REQUIREMENT
==================================================

Before modifying any file, provide/maintain an internal file-impact list:

MODIFY:
- [EXACT EXISTING FILE PATH]
  Reason: [specific workflow responsibility]

- [EXACT EXISTING FILE PATH]
  Reason: [specific workflow responsibility]

DO NOT MODIFY:
- All unrelated files.

The agent must not guess file names.

The agent must inspect the repository and use the actual existing paths.

==================================================
26. REQUIRED OLD VS NEW CROSS-CHECK AFTER CODING
==================================================

After implementation, perform a final comparison:

OLD BEHAVIOR:
- What the existing WhatsApp bot did
- How medicine search worked
- How Pharmarack was handled
- How Special Orders were handled
- How payment was handled
- How Live Cart was handled

NEW BEHAVIOR:
- Greeting + workflow explanation
- Medicine name collection
- Combined Master DB + Pharmarack medicine-name search
- Customer medicine confirmation
- Quantity collection + confirmation
- Pharmarack search
- Out-of-stock removal
- Special Order creation
- Owner receives Pharmarack results
- Owner confirms using Special Order ID + result number
- ₹50 booking payment
- Existing UPI QR
- Payment screenshot forwarding
- Owner payment verification
- Existing Live Cart addition
- Final customer confirmation

Then verify:

1. No duplicate workflow was created.
2. Existing workflow was extended instead of replaced unnecessarily.
3. Existing services/functions/models were reused.
4. Only directly related files were modified.
5. No frontend UI was changed unnecessarily.
6. No dummy/fabricated business data was introduced.
7. Customer and owner workflows are correctly separated.
8. Special Order ID is used as the workflow reference.
9. Customer-requested quantity is preserved through the entire flow.
10. ₹50 booking payment is linked to the correct Special Order.
11. Payment screenshot is linked and forwarded correctly.
12. Only after owner payment verification is the medicine added to Live Cart.
13. Existing Live Cart logic is reused.
14. Existing Pharmarack logic is reused.
15. Existing WhatsApp messaging logic is reused.

FINAL IMPLEMENTATION PRINCIPLE:

DO NOT START THE APPLICATION FROM ZERO.

FIND THE EXISTING WORKFLOW.
UNDERSTAND ITS CURRENT STRUCTURE.
MODIFY ONLY THE EXISTING RELATED FILES.
EXTEND THE EXISTING WORKFLOW.
KEEP ONE WhatsApp → Pharmarack → Special Order → Payment → Live Cart FLOW.
DO NOT CREATE A SECOND VERSION OF THE SAME WORKFLOW.
DO NOT CHANGE THE FRONTEND UI.
DO NOT TOUCH UNRELATED FILES.
DO NOT INTRODUCE DUMMY DATA.