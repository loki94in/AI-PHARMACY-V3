============================================================
AI PHARMACY V3
IMPLEMENTATION PLAN
BUSINESS / PROMOTIONAL MESSAGE FILTERING
============================================================

FEATURE:
Incoming Message Relevance + Promotional Message Filtering

OBJECTIVE:
Improve the EXISTING email/WhatsApp incoming-message workflow so
the application processes only relevant business/customer messages
and ignores promotional/commercial messages.

IMPORTANT:
DO NOT REWRITE THE EXISTING MESSAGE INGESTION SYSTEM.

DO NOT CREATE A SECOND MESSAGE PROCESSING WORKFLOW.

DO NOT CREATE DUPLICATE EMAIL/WHATSAPP PROCESSING LOGIC.

DO NOT CHANGE THE FRONTEND UI.

DO NOT CHANGE EXISTING POS, INVENTORY, CUSTOMER, DISTRIBUTOR,
ORDER, BILLING, CATALOG OR OTHER BUSINESS WORKFLOWS.

ONLY MODIFY THE EXISTING FILES DIRECTLY RESPONSIBLE FOR:
1. Incoming email/message ingestion
2. Incoming WhatsApp message ingestion, if applicable
3. Message classification/filtering
4. Existing message persistence/processing decision
5. Existing related tests

NO OTHER FILES MAY BE MODIFIED.


============================================================
1. CURRENT APPLICATION BEHAVIOR
============================================================

FIRST STEP FOR THE CODE AGENT:

Before writing code, inspect the repository and identify the
EXACT EXISTING implementation responsible for incoming messages.

Find the currently used:

- Email worker
- WhatsApp worker, if incoming messages are processed there
- Message ingestion function
- Message normalization/parsing function
- Existing message classification logic, if any
- Existing customer identification
- Existing distributor/supplier identification
- Existing message database persistence
- Existing notification/message processing service
- Existing tests for these workflows

DO NOT ASSUME FILE NAMES.

DO NOT CREATE NEW FILES UNTIL THE EXISTING STRUCTURE HAS BEEN
INSPECTED.

The repository architecture already defines an EMAIL WORKER,
WHATSAPP WORKER, NOTIFICATION WORKER and service-based processing
architecture. Reuse the existing architecture instead of building
another processing pipeline.


CURRENT BEHAVIOR TO PRESERVE:

Incoming message
        ↓
Existing Message Worker
        ↓
Existing Message Parsing
        ↓
Existing Business Processing
        ↓
Existing Database / Workflow


The current workflow must remain intact.

The new functionality must only add a filtering/classification
decision at the appropriate existing processing point.


============================================================
2. EXPECTED NEW BEHAVIOR
============================================================

Change the existing flow to:

Incoming Message
        ↓
Existing Message Worker
        ↓
Existing Message Normalization
        ↓
NEW RELEVANCE CHECK
        ↓
 ┌─────────────────────────────┐
 │                             │
RELEVANT                    PROMOTIONAL
 │                             │
 ↓                             ↓
Existing Processing        Ignore Processing
 │                         for Pharmacy Workflow
 ↓
Existing Database /
Business Workflow


IMPORTANT:

The application must NOT delete the original email/message from
the external provider.

"Ignore" means:

- Do not process it as a pharmacy business message.
- Do not create a customer/order/distributor transaction from it.
- Do not trigger pharmacy business automation from it.
- Do not pollute operational message tables where those tables are
  intended only for actionable business messages.

If the existing architecture already has an ignored/rejected/
classified message state, REUSE IT.

Do not create a second duplicate storage system just for this feature.


============================================================
3. MESSAGE CATEGORIES
============================================================

The classifier should distinguish at minimum:

A. CUSTOMER MESSAGE

Examples:

- Customer asking about medicine availability
- Customer placing an order
- Customer asking for refill
- Customer asking about bill
- Customer asking about delivery/pickup
- Customer sending a prescription/order-related message
- Customer replying to an existing pharmacy conversation

ACTION:
PROCESS USING THE EXISTING CUSTOMER WORKFLOW.


B. DISTRIBUTOR / SUPPLIER BUSINESS MESSAGE

Examples:

- Purchase order
- Invoice
- Dispatch notification
- Delivery information
- Stock availability
- Shortage information
- Credit statement
- Payment-related communication
- Actual supplier transaction communication

ACTION:
PROCESS USING THE EXISTING DISTRIBUTOR/SUPPLIER WORKFLOW.


C. PROMOTIONAL / MARKETING MESSAGE

Examples:

- Promotional offers
- Discount campaigns
- Sales campaigns
- Marketing newsletters
- Coupon offers
- "Buy now" marketing
- Product promotion
- Distributor marketing broadcast
- Generic commercial advertisements
- Bulk promotional campaigns
- Marketing platform messages
- Messages containing obvious unsubscribe/marketing
  characteristics

ACTION:
DO NOT PROCESS AS A BUSINESS MESSAGE.


D. UNKNOWN / UNCERTAIN MESSAGE

If the classifier cannot confidently determine whether the
message is promotional or business-relevant:

DO NOT aggressively discard it.

Use the safest existing behavior available in the repository.

Prefer:
UNKNOWN / REVIEW / EXISTING FALLBACK

over incorrectly deleting a potentially important business message.

The classifier must be conservative.


============================================================
4. IMPORTANT RULE:
KNOWN SENDER DOES NOT AUTOMATICALLY MEAN BUSINESS MESSAGE
============================================================

Do NOT implement:

Known distributor = always process.

This would be incorrect.

Example:

Known Distributor
    ↓
"Special 30% Discount This Week"
    ↓
PROMOTIONAL
    ↓
IGNORE


But:

Known Distributor
    ↓
"Invoice #12345 dispatched"
    ↓
BUSINESS
    ↓
PROCESS


Therefore classification must consider:

1. Sender identity
2. Known customer/distributor relationship
3. Subject
4. Message body
5. Message structure
6. Existing business context
7. Promotional indicators


============================================================
5. CUSTOMER IDENTIFICATION
============================================================

REUSE the application's existing customer identification logic.

Do NOT create another customer lookup system.

If sender/contact already maps to an existing customer:

Existing Customer
        ↓
Existing Customer Identification
        ↓
Message Relevance Check
        ↓
Existing Customer Workflow


Do not create a duplicate customer record.

Do not modify customer identity logic unless the existing
implementation specifically requires a minimal integration point
for classification.


============================================================
6. DISTRIBUTOR / SUPPLIER IDENTIFICATION
============================================================

REUSE the application's existing distributor/supplier identification
logic.

Do NOT create another distributor database.

If the sender belongs to a known distributor/supplier:

Known Distributor
        ↓
Existing Distributor Identification
        ↓
Message Relevance Check
        ↓
Business OR Promotional


The same distributor can send both:

Business messages
and
Promotional messages.

Therefore sender identity alone must never determine the final
classification.


============================================================
7. PROMOTIONAL DETECTION
============================================================

Implement the filtering inside the EXISTING message-processing
pipeline.

Use multiple signals.

PROMOTIONAL SIGNALS MAY INCLUDE:

- promotional language
- discount language
- sale/offer language
- coupon language
- campaign language
- marketing CTA
- newsletter indicators
- unsubscribe text
- bulk-mail indicators
- advertising links
- promotional HTML structure
- generic commercial announcements
- marketing templates

Examples of terms/signals:

offer
discount
sale
promotion
campaign
special offer
limited time
coupon
cashback
deal
buy now
exclusive offer
subscribe
unsubscribe
marketing
newsletter


IMPORTANT:

Do NOT use a simple keyword-only rule.

For example:

"Distributor has sent an invoice with a 10% discount"

must NOT automatically become promotional.

The classifier must consider the complete message context.


============================================================
8. BUSINESS MESSAGE SIGNALS
============================================================

Business relevance signals may include:

order
purchase order
PO
invoice
invoice number
dispatch
delivery
shipment
stock
availability
shortage
credit
payment
statement
purchase
quantity
batch
medicine
product
customer order
refill
bill
prescription
delivery status


Again:

Do not classify based on one keyword alone.

Example:

"20% discount on today's order"

could be part of a genuine transaction.

Therefore combine multiple signals and context.


============================================================
9. CLASSIFICATION RESULT
============================================================

The classifier should return a normalized internal result using
the application's EXISTING message model/type structure whenever
possible.

Conceptually:

classification:

CUSTOMER
DISTRIBUTOR_BUSINESS
PROMOTIONAL
UNKNOWN


Optional internal metadata, ONLY if the existing architecture
supports it:

reason
confidence
signals


Do NOT introduce unnecessary database columns.

Do NOT create a new database table unless inspection proves that
the existing schema has no suitable location and a persistent
classification state is genuinely required.

Prefer existing fields/models.


============================================================
10. PROCESSING DECISION
============================================================

The final decision should happen BEFORE the message enters the
existing pharmacy business workflow.

Pseudo-flow:

message
  ↓
normalize existing message
  ↓
identify existing sender/customer/distributor
  ↓
classify message
  ↓
if promotional:
      stop pharmacy processing
  else:
      continue EXISTING workflow


Do NOT duplicate:

- customer creation
- distributor creation
- order creation
- invoice processing
- notification processing
- WhatsApp processing
- email processing


The existing workflow must remain the single source of processing.


============================================================
11. EMAIL WORKER
============================================================

If the repository already has an email worker:

MODIFY ONLY THAT EXISTING EMAIL WORKER OR ITS EXISTING SERVICE
DEPENDENCY where the classification decision naturally belongs.

Do NOT create:

new-email-worker
second-email-worker
marketing-worker
promotion-worker

The existing worker should become:

Fetch Email
    ↓
Existing Parse/Normalize
    ↓
Relevance Classification
    ↓
PROMOTIONAL?
    ├── YES → Stop pharmacy processing
    └── NO  → Existing processing continues


Historical email handling already present in the application must
remain unchanged unless it is directly part of this filtering
function.


============================================================
12. WHATSAPP
============================================================

If incoming WhatsApp messages are processed by an existing
WhatsApp worker/service:

Integrate the same classification concept into the EXISTING
WhatsApp processing path.

Do NOT create a completely separate WhatsApp filtering architecture.

Use the same business classification principle:

Customer
Distributor Business
Promotional
Unknown


The existing WhatsApp customer conversation/order workflow must
continue unchanged for relevant messages.


============================================================
13. EXTERNAL COMMERCIAL PLATFORMS
============================================================

The application may receive messages from:

- distributors
- supplier systems
- commercial platforms
- marketplaces
- automated services

Do NOT automatically ignore an entire platform/domain.

A platform may send both:

PROMOTIONAL MESSAGE

and

REAL TRANSACTIONAL MESSAGE.


Example:

Platform:
"Festival Sale: Buy medicines at 25% discount"

→ PROMOTIONAL
→ Ignore for pharmacy workflow


Same platform:
"Purchase Order #4521 has been dispatched"

→ BUSINESS
→ Existing workflow processes it


Therefore filtering must operate at MESSAGE LEVEL,
not simply DOMAIN LEVEL.


============================================================
14. DO NOT BREAK EXISTING DATA FLOW
============================================================

Existing:

Email
 ↓
Worker
 ↓
Existing processing
 ↓
Existing DB/workflow


New:

Email
 ↓
Worker
 ↓
Existing processing
 ↓
Relevance Check
 ↓
Existing DB/workflow


The existing business processing code must remain reused.

Do not rewrite it into a new architecture.


============================================================
15. DATABASE SAFETY
============================================================

FIRST inspect the current schema.

Determine whether the application already has:

- message status
- message type
- processing status
- ignored status
- rejected status
- source
- sender
- metadata
- classification
- processing error/reason fields

If suitable existing fields exist:

REUSE THEM.

Do not add duplicate columns.

Do not add a duplicate messages table.

Do not migrate unrelated tables.


If a schema modification is absolutely necessary, modify ONLY
the directly related existing schema/migration file.

Document exactly why it is required before changing it.


============================================================
16. FRONTEND
============================================================

NO FRONTEND UI CHANGES.

Do not modify:

- layouts
- pages
- components
- CSS
- navigation
- dashboard
- settings UI
- WhatsApp UI
- email UI

unless an existing frontend file is directly required by an
already-existing message status mechanism.

Default rule:

FRONTEND FILES = DO NOT TOUCH.


============================================================
17. LOGGING
============================================================

Use the EXISTING logger.

For ignored promotional messages, record a concise internal
classification reason if the current logging architecture supports
it.

Example:

MESSAGE_FILTERED
classification=PROMOTIONAL
reason=marketing indicators detected


Do NOT log complete message bodies unnecessarily.

Do NOT expose sensitive customer information in logs.


============================================================
18. ERROR HANDLING
============================================================

If classification fails:

DO NOT crash the email/WhatsApp worker.

Use the existing error-handling/fallback mechanism.

Preferred behavior:

classification failure
        ↓
UNKNOWN
        ↓
existing safe fallback processing


Do not silently lose potentially important customer/distributor
messages because the classifier encountered an error.


============================================================
19. PERFORMANCE
============================================================

The classifier must not unnecessarily slow the existing message
worker.

Reuse existing parsing/normalization.

Do not fetch the same email/message multiple times.

Do not perform duplicate customer/distributor database queries.

Do not introduce expensive processing for every message unless
necessary.

If an existing worker architecture supports asynchronous processing,
use that existing mechanism.


============================================================
20. TESTING
============================================================

Modify ONLY existing relevant test files OR add a test file only
if the repository's existing test structure requires a new file.

Tests must cover at least:

TEST 1:
Customer order message
→ PROCESS


TEST 2:
Customer refill message
→ PROCESS


TEST 3:
Distributor invoice
→ PROCESS


TEST 4:
Distributor dispatch message
→ PROCESS


TEST 5:
Distributor promotional offer
→ IGNORE


TEST 6:
Commercial platform advertisement
→ IGNORE


TEST 7:
Commercial platform transactional invoice
→ PROCESS


TEST 8:
Newsletter with unsubscribe
→ IGNORE


TEST 9:
Unknown sender with business-looking message
→ SAFE FALLBACK / UNKNOWN


TEST 10:
Message containing both promotion and genuine transaction
→ Verify contextual classification does not blindly discard it.


TEST 11:
Existing historical-email behavior
→ MUST REMAIN UNCHANGED.


TEST 12:
Existing customer/distributor workflow
→ MUST REMAIN UNCHANGED.


============================================================
21. REGRESSION TESTING
============================================================

After implementation, verify:

- Email ingestion still works
- WhatsApp ingestion still works
- Customer identification still works
- Distributor identification still works
- Orders still work
- Refill workflow still works
- Existing message persistence still works
- Existing notifications still work
- Existing workers still start
- Existing database operations still work

Do not modify unrelated code to make tests pass.

If an unrelated test fails:

STOP.

Identify whether the failure existed before the feature.

Do not repair unrelated systems as part of this task.


============================================================
22. FILE-SCOPE LOCK
============================================================

BEFORE MODIFYING ANY FILE:

The code agent must create an internal list:

FILES TO INSPECT:
- ...
- ...
- ...


FILES ALLOWED TO MODIFY:
- ...
- ...
- ...


FILES FORBIDDEN TO MODIFY:
EVERY OTHER FILE.


Only files directly connected to the existing incoming-message
workflow may be changed.

The agent must NOT:

- refactor unrelated code
- rename unrelated files
- reorganize directories
- redesign frontend
- replace existing workers
- create duplicate services
- rewrite existing business logic
- upgrade unrelated dependencies
- change database architecture unnecessarily
- clean up unrelated code
- modify formatting in unrelated files


============================================================
23. REUSE-FIRST RULE
============================================================

MANDATORY:

Before creating any new function/service/file, search the repository
for an existing implementation that already performs the same or
similar responsibility.

Reuse:

Existing email worker
Existing WhatsApp worker
Existing message parser
Existing customer resolver
Existing distributor resolver
Existing logger
Existing database repository
Existing message model
Existing tests
Existing error handling


PRINCIPLE:

REUSE > EXTEND > MODIFY > CREATE


Creating a new implementation is allowed ONLY when the existing
architecture genuinely has no suitable location.


============================================================
24. NO DUPLICATE WORKFLOW
============================================================

There must be ONLY ONE incoming-message workflow.

NOT:

Email Workflow A
Email Workflow B

or:

WhatsApp Workflow A
WhatsApp Workflow B


Instead:

EXISTING WORKFLOW
      ↓
NEW FILTER DECISION
      ↓
EXISTING WORKFLOW CONTINUES


The feature is an extension of the existing workflow.


============================================================
25. ACCEPTANCE CRITERIA
============================================================

The implementation is complete only when:

[ ] Existing email ingestion still works

[ ] Existing WhatsApp ingestion still works where applicable

[ ] Customer messages continue through existing workflow

[ ] Distributor transactional messages continue through existing
    workflow

[ ] Promotional messages are prevented from entering the pharmacy
    business workflow

[ ] Commercial-platform promotional messages are ignored

[ ] Commercial-platform transactional messages are still processed

[ ] Known distributors are NOT blindly trusted

[ ] Unknown messages are handled conservatively

[ ] Original external emails/messages are NOT deleted

[ ] No duplicate customer records are created

[ ] No duplicate distributor records are created

[ ] No duplicate message-processing workflow exists

[ ] No frontend UI is changed

[ ] No unrelated database table is changed

[ ] No unrelated file is changed

[ ] Existing historical-email behavior remains intact

[ ] Existing workers remain intact

[ ] Existing business workflows remain intact

[ ] Relevant tests pass

[ ] Typecheck passes

[ ] Existing build passes


============================================================
26. MANDATORY BEFORE/AFTER CROSS-CHECK
============================================================

AFTER CODE IMPLEMENTATION:

The agent MUST perform a direct OLD vs NEW behavior comparison.

Create a concise implementation verification report in the
relevant existing project documentation location ONLY if such
documentation already exists for this feature.

DO NOT create unrelated documentation files.


CROSS-CHECK FORMAT:

OLD BEHAVIOR:
Incoming message
→ Existing worker
→ Existing processing

NEW BEHAVIOR:
Incoming message
→ Existing worker
→ Existing normalization
→ Relevance classification
→ Promotional = stop
→ Relevant = existing processing


THEN VERIFY:

1. What existing file handled ingestion?
2. Is the SAME file still handling ingestion?
3. What existing function handled processing?
4. Is the SAME function still being reused?
5. Where was the filter inserted?
6. Were any unrelated files modified?
7. Was any duplicate workflow created?
8. Was frontend changed?
9. Was database structure changed unnecessarily?
10. Do customer messages still follow the original path?
11. Do distributor business messages still follow the original path?
12. Are promotional messages stopped before business processing?
13. Are uncertain messages handled safely?
14. Does historical email behavior remain unchanged?
15. Do existing tests/build still pass?


============================================================
27. FINAL FILE AUDIT
============================================================

Before completion, run a final changed-file audit.

The agent must list:

MODIFIED FILES:
1. <exact path>
2. <exact path>

For EACH modified file explain:

FILE:
<path>

WHY THIS FILE:
<why this file belongs to the existing message workflow>

CHANGE:
<what was changed>

WHY REQUIRED:
<why required for promotional filtering>

NOT CHANGED:
<what existing behavior remains untouched>


Then verify:

NO OTHER FILES WERE MODIFIED.


============================================================
28. FINAL RESULT
============================================================

The desired final architecture is:

                    INCOMING MESSAGE
                           ↓
                  EXISTING WORKER
                           ↓
                 EXISTING NORMALIZER
                           ↓
                 MESSAGE RELEVANCE CHECK
                           ↓
              ┌────────────┴────────────┐
              ↓                         ↓
          RELEVANT                  PROMOTIONAL
              ↓                         ↓
    EXISTING WORKFLOW              STOP / IGNORE
              ↓
      EXISTING DATABASE /
       BUSINESS PROCESS


CUSTOMER:
        → Continue existing workflow

DISTRIBUTOR BUSINESS:
        → Continue existing workflow

PROMOTIONAL:
        → Ignore for pharmacy processing

UNKNOWN:
        → Safe existing fallback


CORE RULE:

DO NOT BUILD THE FEATURE FROM ZERO.

FIND THE EXISTING WORKFLOW.

INSERT THE FILTER INTO THAT WORKFLOW.

REUSE ALL EXISTING CUSTOMER, DISTRIBUTOR, MESSAGE, DATABASE,
WORKER AND BUSINESS LOGIC.

NO FRONTEND UI CHANGE.

NO DUPLICATE WORKFLOW.

NO UNRELATED FILE CHANGES.

NO UNRELATED DATABASE CHANGES.

NO REWRITE.

ONLY THE MINIMUM RELATED CODE REQUIRED TO ACHIEVE THE
PROMOTIONAL-MESSAGE FILTERING BEHAVIOR.
============================================================