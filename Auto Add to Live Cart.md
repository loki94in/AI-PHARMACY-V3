# SINGLE IMPLEMENTATION PLAN
# Add "Auto Add to Live Cart" control to the EXISTING COMMON AUTOMATION WORKFLOW
# IMPORTANT: EXTEND EXISTING WORKFLOW ONLY. DO NOT CREATE A SECOND WORKFLOW.

======================================================================
1. OBJECTIVE
======================================================================

Add one small application setting:

    Auto Add to Live Cart

This setting controls ONLY whether the EXISTING automation is allowed to
automatically add a medicine/order into the existing Pharmarack Live Cart.

The application already has the required overall workflow.

DO NOT rebuild it.

DO NOT create a new order workflow.

DO NOT create a new WhatsApp workflow.

DO NOT create a new Special Quick Order workflow.

DO NOT create a new Refill workflow.

DO NOT create a new Live Cart service.

DO NOT create a new Quick Assist system.

DO NOT create a new notification system.

The goal is only to add one decision point into the existing workflow.


======================================================================
2. EXISTING APPLICATION STRUCTURE TO PRESERVE
======================================================================

The current application already has multiple sources that feed into the
existing automation/Quick Assist workflow:

    WhatsApp Customer
          |
          v
    Existing WhatsApp Intent
          |
          v
    Confirmed Request
          |
          |
          +-----------------------------+
                                        |
    Walk-in Customer                     |
          |                              |
          v                              |
    Existing Special Quick Order --------+
                                        |
    Refill Workflow --------------------+
                                        |
                                        v
                              EXISTING COMMON AUTOMATION
                                        |
                                        v
                              Distributor Resolution
                                        |
                                        v
                              Pharmarack / Live Cart
                                        |
                                        v
                                QUICK ASSIST PANE
                                        |
                              +---------+---------+
                              |                   |
                              v                   v
                         MARK READY           COMPLETE
                              |                   |
                              +---------+---------+
                                        |
                                        v
                              Existing messaging/
                              automation workflow


IMPORTANT:

The application already has dedicated Quick Assist actions such as:

    Mark Ready
    Complete

These are existing workflow controls.

DO NOT replace them.

DO NOT duplicate them.

DO NOT move them into a new service.

The new setting must work with this existing architecture.


======================================================================
3. CURRENT BEHAVIOR
======================================================================

CURRENT CONFIRMED PROCUREMENT BEHAVIOR:

When an applicable WhatsApp request reaches the existing confirmed state:

    Customer WhatsApp
          |
          v
    Existing medicine matching
          |
          v
    Existing clarification/quantity handling
          |
          v
    Customer confirmation
          |
          v
    Existing Pharmarack search
          |
          v
    Existing stock/distributor resolution
          |
          v
    Existing addItemsToPharmarackCart(...)
          |
          v
    Existing owner/admin notification
          |
          v
    Existing order / automation / Quick Assist flow


The current code already imports and uses the existing Pharmarack cart
function from:

    src/routes/pharmarack.ts

through the existing:

    src/services/whatsappIntentService.ts


CURRENT LIMITATION:

The automatic Live Cart action is currently part of the procurement flow
without the requested ON/OFF application setting controlling that action.

Therefore the owner cannot currently choose:

    "Let automation add to Live Cart"

versus:

    "Do not let automation add to Live Cart; I will review and add it
     manually."


======================================================================
4. REQUIRED NEW BEHAVIOR
======================================================================

Add:

    Auto Add to Live Cart

with two states:

    ON
    OFF


======================================================================
5. WHEN AUTO ADD TO LIVE CART = ON
======================================================================

The existing workflow should continue almost exactly as it currently works.

Flow:

    WhatsApp / Special Quick Order / Refill
                    |
                    v
          Existing common automation
                    |
                    v
          Existing distributor resolution
                    |
                    v
          Auto Add to Live Cart = ON
                    |
                    v
          EXISTING Live Cart function
                    |
                    v
          Verify existing cart result
                    |
                    v
          Existing owner notification
                    |
                    v
          Existing Quick Assist workflow
                    |
              +-----+------+
              |            |
              v            v
         Mark Ready     Complete


DO NOT replace the existing Live Cart function.

Continue using the existing:

    addItemsToPharmarackCart(...)

or whichever existing cart function is actually called after tracing
the latest code.


======================================================================
6. WHEN AUTO ADD TO LIVE CART = OFF
======================================================================

The existing automation must still process the request.

The OFF setting means:

    "Do not automatically perform the Live Cart action."

It does NOT mean:

    "Reject the order."

It does NOT mean:

    "Pharmarack failed."

It does NOT mean:

    "Stop the automation."

Flow:

    WhatsApp / Special Quick Order / Refill
                    |
                    v
          Existing common automation
                    |
                    v
          Existing distributor resolution
                    |
                    v
          Auto Add to Live Cart = OFF
                    |
                    X
              NO AUTO CART CALL
                    |
                    v
          Existing owner notification
                    |
                    v
          Owner reviews request,
          medicine and distributor
                    |
                    v
          Owner manually adds medicine
          using EXISTING Live Cart workflow
                    |
                    v
          Existing Quick Assist workflow
                    |
              +-----+------+
              |            |
              v            v
         Mark Ready     Complete


CRITICAL:

When OFF, the application must NOT call:

    addItemsToPharmarackCart(...)

for the automatic procurement step.

There must be exactly zero automatic Live Cart additions caused by that
confirmed request.


======================================================================
7. TOGGLE MUST CONTROL THE COMMON AUTOMATION POINT
======================================================================

This is extremely important.

Do NOT add separate toggle logic like:

    if WhatsApp then ...
    if Special Quick Order then ...
    if Refill then ...

That would create three different versions of the same business rule.

Instead:

    WhatsApp
       |
    Special Quick Order
       |
    Refill
       |
       +----> EXISTING COMMON AUTOMATION
                       |
                       v
                Auto Add setting
                       |
                 +-----+-----+
                 |           |
                ON          OFF
                 |           |
             Live Cart     Skip Cart


The setting belongs at the existing common procurement/Live Cart trigger
where the application already decides to perform the automatic cart action.

Before modifying anything, trace the repository to find whether WhatsApp,
Special Quick Order and Refill already converge into the same backend
automation function.

If they already converge:

    MODIFY THAT EXISTING FUNCTION.

If they do not technically converge, do NOT create a new common workflow
just for this feature. Identify the smallest existing shared service/state
where the Live Cart decision can safely be controlled.

The objective is one business rule, not three implementations.


======================================================================
8. WHATSAPP WORKFLOW
======================================================================

Preserve the existing WhatsApp confirmation system.

Existing behavior such as:

    medicine selection
    clarification
    strength/formulation clarification
    quantity
    explicit confirmation
    distributor resolution

must remain unchanged.

Only after the existing customer confirmation should the procurement
workflow evaluate:

    Auto Add to Live Cart?


DO NOT allow the setting to bypass customer confirmation.

Example:

    Customer:
    "Pan 40"

    Existing clarification/confirmation flow
          |
          v
    Customer confirms
          |
          v
    Existing procurement
          |
          v
    Auto Add setting


======================================================================
9. SPECIAL QUICK ORDER WORKFLOW
======================================================================

The existing Special Quick Order functionality must remain unchanged.

A staff member can manually create a Special Quick Order when a customer
visits the pharmacy directly.

That order must continue entering the EXISTING automation/Quick Assist
workflow.

The new setting controls only the automatic Live Cart action.

Therefore:

    Special Quick Order
          |
          v
    Existing automation
          |
          v
    Auto Add to Live Cart?
          |
       +--+--+
       |     |
      ON    OFF
       |     |
       v     v
    Existing  Skip automatic
    Live Cart Live Cart
              |
              v
          Owner manually
          handles Live Cart


Do NOT create a separate "walk-in Live Cart workflow."


======================================================================
10. REFILL WORKFLOW
======================================================================

The existing Refill workflow must also remain intact.

Do not rebuild or duplicate refill processing.

Where the existing refill workflow enters the same procurement automation,
the new Live Cart setting should be respected by that existing automation.

If the existing refill implementation has a completely separate intentional
Live Cart path, inspect it first.

Only modify it if necessary to ensure the SAME setting is respected.

Do not create another refill-specific setting.

There must be only:

    ONE setting
    ONE business rule


======================================================================
11. QUICK ASSIST
======================================================================

Quick Assist is already the operational control layer.

Preserve existing:

    Mark Ready
    Complete
    existing customer/order actions
    existing automation status
    existing messaging actions

The new toggle must NOT change the meaning of:

    Mark Ready

or:

    Complete


IMPORTANT:

    Auto Add to Live Cart
        =
    procurement automation decision


    Mark Ready
        =
    existing Quick Assist operational status/action


    Complete
        =
    existing Quick Assist completion action


These must remain separate responsibilities.


======================================================================
12. OWNER NOTIFICATION
======================================================================

Reuse the existing:

    src/services/waAdminEscalationService.ts

and existing owner/admin WhatsApp notification mechanism.

Do NOT create another owner notification service.

When AUTO ADD = ON:

    Owner can receive the existing Live Cart success notification after
    the existing Live Cart operation succeeds.


When AUTO ADD = OFF:

    Owner should receive the existing notification indicating that the
    request/order has been received and requires manual Live Cart review.

The notification should use information already produced by the existing
workflow, including where available:

    customer
    order/request
    medicine
    quantity
    distributor
    distributor options/list
    manual-review requirement


Do NOT fabricate distributor information.

Do NOT create another distributor lookup.


======================================================================
13. CUSTOMER WHATSAPP ACKNOWLEDGEMENT
======================================================================

The existing post-procurement customer WhatsApp acknowledgement should
remain available.

This is NOT the final fulfilment message.

Its purpose is only to tell the customer that the pharmacy has received/
noticed the medicine request.

Example meaning:

    "Your medicine request has been received by the pharmacy and is being
     reviewed. We will update you once it has been checked."


This acknowledgement may use the EXISTING:

    whatsappQueueWorker.enqueue(...)

mechanism.

Do NOT create a new messaging service.


IMPORTANT DISTINCTION:

    AUTOMATIC ACKNOWLEDGEMENT
        |
        v
    "Your request has been received/noted."
        |
        v
    Customer gets reassurance


versus


    FINAL CUSTOMER RESULT
        |
        v
    Existing Staged Message / Quick Assist
        |
        v
    Human reviews
        |
        v
    Existing manual Send
        |
        v
    Customer receives final result


Do NOT automatically send the final fulfilment/result message.

The acknowledgement must NOT claim:

    medicine is ready
    medicine has been arranged
    order is fulfilled
    medicine is available

unless the existing workflow has actually established that fact.


======================================================================
14. LIVE CART FAILURE
======================================================================

When:

    Auto Add to Live Cart = ON

and the existing Live Cart operation fails:

    Treat it as a real Live Cart failure.

Do NOT create a false successful cart/order state.

Reuse the existing owner failure notification.

Do not silently continue as if the medicine was added.


When:

    Auto Add to Live Cart = OFF

there is no Live Cart attempt.

Therefore:

    OFF != failure

Do NOT send a Live Cart failure notification simply because the setting
is OFF.


======================================================================
15. ORDER / DATABASE STRUCTURE
======================================================================

Reuse the existing order structures.

The current implementation already uses the existing special-order/
procurement structures.

Do NOT create:

    new_orders
    whatsapp_orders
    walkin_orders
    refill_orders
    manual_orders

just for this feature.

The order source can remain represented using the existing fields/
metadata if already available.

Do not create a new database architecture.


======================================================================
16. SETTINGS STORAGE
======================================================================

First inspect the existing Settings implementation.

Identify:

    settings table/schema
    storeSettingsService
    settings API
    existing boolean/toggle storage
    existing Settings frontend component

The repository already contains:

    src/services/storeSettingsService.ts

Use the existing settings architecture where appropriate.

Add only the required setting/key using the application's established
naming convention.

Suggested logical key:

    auto_add_to_live_cart

Do not create a new settings table.

Do not create a second settings service.

Do not hardcode the setting in the procurement service.


======================================================================
17. SETTINGS UI
======================================================================

The user requested a small toggle in Settings.

Therefore:

    ADD ONLY THE SMALL TOGGLE USING THE EXISTING SETTINGS UI/PATTERN.

Do NOT redesign the Settings page.

Do NOT change:

    layout
    colors
    typography
    navigation
    cards
    page structure
    unrelated controls

Reuse the existing toggle/control component if one exists.

The only frontend modification permitted is the minimum existing Settings
file/component required to expose this already-defined backend setting.

No other frontend UI changes are allowed.


======================================================================
18. SETTINGS DEFAULT
======================================================================

Because the application currently performs automatic Live Cart addition,
preserve existing behavior for installations where the setting has never
been configured.

Therefore:

    Missing setting
        =
    preserve existing automatic behavior

which means the effective default should be:

    ON

unless the existing Settings architecture already has a formal default
mechanism that should be used instead.

Do not introduce a second default system.


======================================================================
19. SETTING READ BEHAVIOR
======================================================================

The procurement workflow should read the current setting through the
existing settings mechanism.

Do not permanently cache the value in a process-level variable if that
would require restarting the application after changing Settings.

Expected:

    Setting ON
        ↓
    New procurement request
        ↓
    Auto cart allowed


    Setting changed OFF
        ↓
    Next procurement request
        ↓
    Auto cart skipped


No application restart should be artificially required by this feature
if the existing settings system supports runtime reads.


======================================================================
20. DUPLICATE / IDEMPOTENCY PROTECTION
======================================================================

Before modifying duplicate handling, inspect the latest existing
WhatsApp event/order/cart protection.

Reuse it.

The new setting must not create duplicate cart opportunities.

Required behavior:

    One confirmed event
        =
    One automatic Live Cart attempt when ON


    One confirmed event
        =
    Zero automatic Live Cart attempts when OFF


If the same WhatsApp event is processed twice:

    It must NOT add the same quantity twice.


Do not create a new idempotency service if existing event/message/order
identifiers can provide this protection.


======================================================================
21. FILE SCOPE
======================================================================

PRIMARY FILE TO MODIFY:

    src/services/whatsappIntentService.ts

This is the existing central WhatsApp intent/procurement orchestrator and
already contains the Pharmarack cart integration.


SETTINGS FILES:

Only modify the EXISTING Settings file/service/component required to add:

    auto_add_to_live_cart


POTENTIALLY RELATED EXISTING FILES:

    src/services/storeSettingsService.ts
    src/services/waAdminEscalationService.ts
    src/routes/pharmarack.ts

These must NOT be modified automatically.

Only touch them if repository inspection proves the requested behavior
cannot be implemented correctly without doing so.


QUICK ASSIST FILES:

Only modify the existing Quick Assist file if the existing automation
trigger genuinely lives there.

Do not create another Quick Assist workflow.


REFILL FILES:

    src/services/refillService.ts

Do not modify unless the existing refill procurement path requires the same
setting and there is no shared existing decision point.


TEST FILES:

Modify/create ONLY the tests directly related to this feature.


======================================================================
22. FILES THAT MUST NOT BE TOUCHED
======================================================================

Do NOT modify unrelated files.

Do NOT modify generated distribution artifacts:

    dist-pkg/server.cjs
    dist-pkg/sea-prep.blob


Do NOT modify:

    deployment configuration
    package configuration
    unrelated backend services
    unrelated frontend pages
    unrelated database structures
    unrelated tests
    unrelated UI components


Do not make broad cleanup changes while implementing this feature.


======================================================================
23. MANDATORY FIRST STEP FOR CODING AGENT
======================================================================

BEFORE WRITING CODE:

Trace the existing implementation and identify exact functions/files for:

    1. WhatsApp inbound
    2. customer confirmation
    3. confirmed procurement
    4. Special Quick Order creation
    5. Refill procurement
    6. common automation path
    7. distributor resolution
    8. Live Cart addition
    9. Quick Assist
    10. Mark Ready
    11. Complete
    12. owner WhatsApp notification
    13. customer acknowledgement queue
    14. staged/final customer message
    15. existing manual Send
    16. settings storage
    17. settings UI


Then determine:

    WHERE DOES THE EXISTING AUTOMATIC LIVE CART ACTION ACTUALLY HAPPEN?


The new setting must be inserted at that existing point.

Do not guess.

Do not start building a new workflow before understanding the existing one.


======================================================================
24. NO DUPLICATE FILES / SERVICES
======================================================================

DO NOT create files such as:

    newLiveCartService.ts
    autoCartService.ts
    whatsappOrderService.ts
    specialQuickOrderService.ts
    refillAutomationService.ts
    newQuickAssistService.ts
    customerNotificationService.ts
    newOwnerNotificationService.ts
    newProcurementWorkflow.ts
    newSettingsService.ts


The repository already contains these responsibilities.

Extend the existing implementation.


======================================================================
25. TEST REQUIREMENTS
======================================================================

Add/modify only relevant tests.

TEST 1:
    Setting ON allows existing automatic Live Cart call.


TEST 2:
    Setting OFF prevents existing automatic Live Cart call.


TEST 3:
    Setting OFF still performs existing medicine/Pharmarack search.


TEST 4:
    Setting OFF still performs existing distributor resolution.


TEST 5:
    Setting OFF sends existing owner notification/manual-review information.


TEST 6:
    Setting OFF is NOT treated as Live Cart failure.


TEST 7:
    Setting ON + successful cart continues existing successful workflow.


TEST 8:
    Setting ON + failed cart follows existing failure handling.


TEST 9:
    WhatsApp confirmation behavior remains unchanged.


TEST 10:
    Special Quick Order continues entering the existing automation.


TEST 11:
    Refill workflow continues using the existing workflow.


TEST 12:
    Quick Assist Mark Ready remains unchanged.


TEST 13:
    Quick Assist Complete remains unchanged.


TEST 14:
    Automatic customer acknowledgement can still be queued through the
    existing WhatsApp Queue Worker.


TEST 15:
    Final customer fulfilment message is NOT automatically sent.


TEST 16:
    Duplicate WhatsApp event cannot add the same quantity twice.


TEST 17:
    Existing manual Live Cart action still works when Auto Add is OFF.


TEST 18:
    Changing the setting from ON → OFF affects subsequent requests.


TEST 19:
    Changing the setting from OFF → ON allows subsequent automatic
    Live Cart additions.


======================================================================
26. EXPECTED FINAL WORKFLOW
======================================================================

ALL SOURCES:

    WhatsApp
       |
    Special Quick Order
       |
    Refill
       |
       +-----------------------+
                               |
                               v
                    EXISTING AUTOMATION
                               |
                               v
                    Distributor Resolution
                               |
                               v
                       Auto Add Setting
                          /         \
                        ON           OFF
                        |             |
                        v             v
                  Existing Live    Skip automatic
                  Cart function    Live Cart
                        |             |
                        |             v
                        |        Owner Review
                        |             |
                        |             v
                        |        Manual Live Cart
                        |             |
                        +------+------+
                               |
                               v
                         QUICK ASSIST
                               |
                      +--------+--------+
                      |                 |
                      v                 v
                 MARK READY         COMPLETE
                      |                 |
                      +--------+--------+
                               |
                               v
                     Existing automation/
                     messaging workflow


======================================================================
27. CUSTOMER COMMUNICATION
======================================================================

For WhatsApp-originated requests:

    Request received
         |
         v
    Automatic acknowledgement
         |
         v
    "Pharmacy has received/noted your request."
         |
         v
    Existing order/procurement process
         |
         v
    Final message remains under existing
    Quick Assist / Staged Message workflow
         |
         v
    Human manually sends final message


For walk-in Special Quick Orders:

    Staff creates Special Quick Order
         |
         v
    Existing automation
         |
         v
    Existing Quick Assist
         |
         v
    Existing communication behavior


Do not force the WhatsApp acknowledgement onto walk-in orders unless the
existing Special Quick Order workflow already uses WhatsApp notification
for that order.


======================================================================
28. OLD VS NEW BEHAVIOR CROSS-CHECK
======================================================================

OLD BEHAVIOR:

    Confirmed/created order
          ↓
    Existing automation
          ↓
    Distributor resolution
          ↓
    Automatic Live Cart
          ↓
    Existing Quick Assist
          ↓
    Mark Ready / Complete
          ↓
    Existing messaging


NEW BEHAVIOR - SETTING ON:

    Confirmed/created order
          ↓
    Existing automation
          ↓
    Distributor resolution
          ↓
    Auto Add = ON
          ↓
    Existing Live Cart
          ↓
    Existing owner notification
          ↓
    Existing Quick Assist
          ↓
    Mark Ready / Complete
          ↓
    Existing messaging


NEW BEHAVIOR - SETTING OFF:

    Confirmed/created order
          ↓
    Existing automation
          ↓
    Distributor resolution
          ↓
    Auto Add = OFF
          ↓
    NO automatic Live Cart
          ↓
    Existing owner notification
          ↓
    Owner manually reviews
          ↓
    Owner manually adds to EXISTING Live Cart
          ↓
    Existing Quick Assist
          ↓
    Mark Ready / Complete
          ↓
    Existing messaging


======================================================================
29. FINAL CODE-AGENT CROSS-CHECK
======================================================================

After implementation, DO NOT simply report "feature completed."

Perform this exact cross-check:

    [ ] Existing WhatsApp workflow was preserved.
    [ ] Existing Special Quick Order workflow was preserved.
    [ ] Existing Refill workflow was preserved.
    [ ] Existing common automation was reused.
    [ ] Existing distributor resolution was reused.
    [ ] Existing Pharmarack integration was reused.
    [ ] Existing Live Cart function was reused.
    [ ] ON executes the existing Live Cart function.
    [ ] OFF does not execute the existing Live Cart function.
    [ ] OFF is not treated as a failure.
    [ ] Existing owner notification was reused.
    [ ] Existing Quick Assist was reused.
    [ ] Mark Ready was not duplicated or redesigned.
    [ ] Complete was not duplicated or redesigned.
    [ ] Existing customer acknowledgement remains available.
    [ ] Final customer fulfilment message is not automatically sent.
    [ ] Existing staged/manual Send remains unchanged.
    [ ] Duplicate WhatsApp processing cannot add quantity twice.
    [ ] No new order table was created.
    [ ] No new distributor system was created.
    [ ] No new Live Cart service was created.
    [ ] No new Quick Assist workflow was created.
    [ ] No new WhatsApp automation workflow was created.
    [ ] No new Refill workflow was created.
    [ ] No duplicate messaging system was created.
    [ ] No generated dist-pkg files were modified.
    [ ] No unrelated files were modified.
    [ ] Only the minimum Settings UI change was made.
    [ ] Existing frontend UI/layout was not redesigned.


======================================================================
30. REQUIRED COMPLETION REPORT
======================================================================

After coding, provide a SHORT report containing ONLY:

1. FILES MODIFIED
   List the exact files changed.

2. FILES NOT MODIFIED
   Confirm unrelated files and generated artifacts were untouched.

3. OLD BEHAVIOR
   One short paragraph describing how Live Cart worked before.

4. NEW BEHAVIOR
   One short paragraph describing ON and OFF behavior.

5. COMMON WORKFLOW CHECK
   Confirm WhatsApp + Special Quick Order + Refill still use the existing
   automation/Quick Assist structure.

6. CUSTOMER MESSAGE CHECK
   Confirm automatic acknowledgement remains available and final
   fulfilment messaging remains under the existing workflow.

7. DUPLICATE CHECK
   Confirm duplicate processing cannot add the same quantity twice.

8. TEST CHECK
   List the relevant tests executed and their result.


======================================================================
FINAL IMPLEMENTATION PRINCIPLE
======================================================================

DO NOT START FROM THE BEGINNING.

DO NOT REBUILD THE APPLICATION.

DO NOT CREATE A SECOND VERSION OF THE WORKFLOW.

The existing architecture is already:

    WhatsApp
    Special Quick Order
    Refill
          ↓
    Existing Automation
          ↓
    Existing Quick Assist
          ↓
    Mark Ready / Complete


ONLY ADD:

    Auto Add to Live Cart?
          |
       ON / OFF


ON:
    use the existing automatic Live Cart action.

OFF:
    skip ONLY the automatic Live Cart action and allow the existing owner/
    Quick Assist/manual process to handle it.

Everything else remains on the existing implementation.

CORE RULE:

    EXTEND THE EXISTING WORKFLOW.
    CHANGE ONLY THE REQUIRED DECISION POINT.
    DO NOT DUPLICATE THE WORKFLOW.