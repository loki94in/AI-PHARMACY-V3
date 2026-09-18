SINGLE IMPLEMENTATION PLAN
AI-PHARMACY-V3
Feature: Reliable Scheduled Distributor WhatsApp Dispatch + WhatsApp Readiness/PC Status Recovery

============================================================
1. OBJECTIVE
============================================================

Improve the EXISTING WhatsApp scheduled-message workflow so that:

1. A scheduled distributor Dispatch Reminder is NEVER silently skipped while
   the application is running.
2. The existing WhatsApp queue remains the SINGLE sending mechanism.
3. Existing scheduling, FIFO ordering, pacing, deduplication, Automation Hub,
   delivery register, and WhatsApp sending logic remain in place.
4. When a Special Order is opened/used, the existing WhatsApp prewarm mechanism
   can be used as an early readiness trigger.
5. Upcoming scheduled messages should receive proactive readiness checks:
   - T-5 minutes: prewarm/readiness preparation.
   - T-1 minute: final readiness check.
   - Scheduled time: process the queue.
6. If WhatsApp is sleeping/disconnected but the PC/application is still
   running, the existing WhatsApp connection should be woken/reconnected.
7. If WhatsApp cannot be made ready, the scheduled message remains in the
   queue and is retried. It must NOT silently disappear.
8. The application must distinguish:
   - PC/Application offline
   - WhatsApp sleeping
   - WhatsApp disconnected/not ready
   - WhatsApp ready
9. If the PC was actually powered off during the scheduled time, the application
   cannot know what happened while it was powered off. After startup, it must
   infer the outage from the last heartbeat and recover overdue messages.
10. No frontend redesign.
11. No duplicate WhatsApp workflow.
12. No new parallel scheduler/sending architecture.
13. Only directly related existing files are allowed to be modified.

============================================================
2. CURRENT WORKFLOW / EXISTING ARCHITECTURE
============================================================

DO NOT BUILD THIS FEATURE FROM ZERO.

The repository already has the required WhatsApp infrastructure.

Existing primary workflow:

Special Order / Dispatch / other business action
        |
        v
Existing WhatsApp enqueue/API
        |
        v
whatsappQueueWorker.enqueue()
        |
        v
whatsapp_send_queue
        |
        v
whatsappQueueWorker
        |
        v
WhatsApp readiness check
        |
        v
sendMessage()
        |
        v
WhatsApp
        |
        v
Sent Register + Automation Hub update

Existing files already involved include:

- src/services/whatsappQueueWorker.ts
- src/routes/whatsappQueue.ts
- frontend/src/services/api.ts

The existing worker already contains:

- queue persistence
- scheduled_at
- pending status
- failed_offline status
- sending status
- sent status
- retry_count
- FIFO queue processing
- WhatsApp readiness checking
- ensureWhatsAppReady()
- prewarm()
- delivery verification
- permanent WhatsApp delivery register
- duplicate protection
- Automation Hub events
- startup recovery
- queue pacing
- scheduled one-shot processing
- lazy worker startup

Therefore the implementation MUST EXTEND these mechanisms rather than
creating another WhatsApp sender or another independent queue.

============================================================
3. CURRENT BEHAVIOR
============================================================

A. QUEUE

whatsappQueueWorker.enqueue() already stores messages in:

whatsapp_send_queue

with:

- number
- message
- type
- status
- retry_count
- created_at
- scheduled_at
- target_name
- media_url
- file_json

This must remain the source of truth.

------------------------------------------------------------

B. SCHEDULED PROCESSING

The existing enqueue() already calculates scheduled_at and:

- processes immediately when scheduled_at <= now
- otherwise creates a timer for the scheduled time

The worker also has a background processing loop.

This existing mechanism must remain.

------------------------------------------------------------

C. WHATSAPP READINESS

The worker already checks:

getWhatsAppStatus()

and has existing support for:

- sleeping
- ready/not ready
- ensureWhatsAppReady()
- auto-connect rules

The existing worker currently attempts to wake WhatsApp in certain cases.

This logic must be strengthened for scheduled messages rather than duplicated.

------------------------------------------------------------

D. CURRENT FAILURE BEHAVIOR

At present, if WhatsApp is not ready, processQueueInternal() can leave the
message pending and stop processing.

That is useful because it prevents an unsafe send, but it is not sufficient
for the required scheduled-message reliability.

The problem is that a scheduled Dispatch Reminder can remain pending without
a sufficiently strong scheduled recovery/readiness mechanism.

There are also existing retry/status restrictions such as:

retry_count < 3

These MUST be reviewed carefully because the new requirement is:

A scheduled distributor WhatsApp message must not silently disappear merely
because a temporary WhatsApp/PC availability problem occurred.

------------------------------------------------------------

E. STARTUP RECOVERY

The worker already has cleanupOldSentItems().

It already performs recovery of:

- interrupted sending items
- stale queue items
- previous pending/failed items
- permanent delivery-register checks

However, the current startup logic intentionally moves some pre-boot pending
messages to review_required instead of automatically recovering them.

That behavior must NOT be blindly removed globally.

Only the scheduled distributor Dispatch Reminder path should be changed so
that legitimate missed scheduled messages are recoverable without creating
duplicate sends.

Other existing queue categories must keep their existing behavior unless
they directly share the exact reliability logic being changed.

============================================================
4. EXPECTED NEW BEHAVIOR
============================================================

NEW SCHEDULED DISTRIBUTOR MESSAGE LIFECYCLE

A distributor Dispatch Reminder should effectively behave as:

SCHEDULED
   |
   | T-5 readiness preparation
   v
PENDING / READY
   |
   | scheduled time reached
   v
SENDING
   |
   +------ success ------> SENT
   |
   +------ temporary failure
   |              |
   |              v
   |        RETRY_PENDING
   |              |
   |              v
   |           SENDING
   |
   +------ permanent business failure
                  |
                  v
          CLEAR PERMANENT FAILURE

Do NOT introduce a second queue table just for this.

Use the existing whatsapp_send_queue status/fields and existing notification
mechanisms.

============================================================
5. T-5 MINUTE READINESS PREPARATION
============================================================

For scheduled distributor Dispatch Reminder messages:

When the worker detects that a distributor reminder is approaching its
scheduled_at time:

If approximately 5 minutes remain:

    call the EXISTING WhatsApp prewarm/readiness mechanism.

Use:

whatsappQueueWorker.prewarm()

which already delegates to:

prewarmWhatsApp()

Do not create another WhatsApp connection function.

The purpose is only:

- wake sleeping WhatsApp
- initialize an existing saved session when permitted
- prepare the client
- reduce the possibility of failure at the exact dispatch time

Prewarm must NOT send the message.

============================================================
6. SPECIAL ORDER TRIGGER
============================================================

The existing Special Order workflow should be used as an additional early
readiness trigger.

When the user opens/enters the existing Special Order workflow:

    existing Special Order action
             |
             v
    existing WhatsApp prewarm API/mechanism

This must be added only where the existing Special Order page/action already
exists.

Do not redesign the Special Order page.

Do not add another WhatsApp workflow.

Do not move message creation into the Special Order page.

The Special Order action simply gives the existing WhatsApp client an early
chance to become ready.

IMPORTANT:

Special Order interaction is an additional trigger only.

It must NOT be the only way scheduled Dispatch Reminders are protected.

The background queue must independently detect upcoming scheduled messages.

============================================================
7. T-1 MINUTE FINAL READINESS CHECK
============================================================

Approximately 1 minute before scheduled_at:

Perform another readiness check.

Expected behavior:

IF WhatsApp is READY:
    leave queue processing normally.

IF WhatsApp is SLEEPING:
    use existing ensureWhatsAppReady().

IF WhatsApp is DISCONNECTED but an existing saved session can be reconnected:
    use the existing allowed reconnect/readiness path.

IF WhatsApp is still unavailable:
    do NOT mark the scheduled distributor message as skipped.

Leave it pending/retryable.

The scheduled time must never be treated as:

"attempt once and forget."

============================================================
8. EXACT SCHEDULED TIME
============================================================

At scheduled_at:

The existing queue worker processes the message.

Before sending:

1. Confirm the item is still pending/retryable.
2. Confirm it is due.
3. Check WhatsApp readiness.
4. Attempt existing readiness recovery when appropriate.
5. Perform the existing duplicate/delivery-register check.
6. Validate phone number using existing logic.
7. Send through existing sendMessage().
8. Verify delivery using existing mechanisms.
9. Mark SENT only after successful send/verification path.

Do not create a second sender.

============================================================
9. WHATSAPP SLEEPING VS PC OFFLINE
============================================================

Implement a lightweight heartbeat/last-seen mechanism using the existing
application/backend infrastructure.

DO NOT create a new UI for this.

The application should maintain internally:

last application heartbeat
last WhatsApp status observation
application/PC availability state

Heartbeat should be updated periodically while the application/backend is
running.

For example:

heartbeat every 15-30 seconds.

The exact interval should use the existing application timing architecture
where possible rather than creating another uncontrolled timer.

------------------------------------------------------------

STATUS INTERPRETATION

CASE 1: PC/application is running + WhatsApp ready

    app heartbeat = current
    WhatsApp = ready

Result:

    READY

------------------------------------------------------------

CASE 2: PC/application is running + WhatsApp sleeping

    app heartbeat = current
    WhatsApp = sleeping

Result:

    WHATSAPP_SLEEPING

Action:

    existing ensureWhatsAppReady()

------------------------------------------------------------

CASE 3: PC/application is running + WhatsApp disconnected

    app heartbeat = current
    WhatsApp = disconnected/not ready

Result:

    WHATSAPP_DISCONNECTED

Action:

    use existing permitted reconnect/readiness mechanism.

------------------------------------------------------------

CASE 4: PC/application stopped

    heartbeat stops.

The application cannot execute code while the PC is actually powered off.

Therefore do NOT falsely claim that the application detected:

"PC turned off at exactly 16:00"

while it was offline.

Instead, after startup:

lastHeartbeat = 15:55:12
scheduledAt   = 16:00:00
startup       = 16:18:43

The application can accurately infer:

    Application/PC was unavailable during the scheduled period.

This is the correct distinction.

============================================================
10. STARTUP RECOVERY
============================================================

On application/backend startup, use the existing
cleanupOldSentItems()/queue recovery path.

Do NOT create another startup recovery service.

Add scheduled distributor recovery into the existing recovery flow.

Find messages such as:

type = distributor_dispatch_reminder

where:

status is pending/failed_offline/retryable
AND
scheduled_at <= current time
AND
message has not already been delivered.

For each legitimate missed scheduled distributor reminder:

1. Preserve the original queue ID.
2. Preserve recipient.
3. Preserve distributor.
4. Preserve original message.
5. Preserve original scheduled_at.
6. Preserve retry/history information.
7. Check permanent delivery register.
8. If already delivered:
       mark SENT.
9. If not delivered:
       restore it to retryable pending state.
10. Start normal queue processing.
11. Send through the existing queue worker.

Do NOT recreate the message.

Do NOT enqueue a second copy.

============================================================
11. PC-OFF RECOVERY EXAMPLE
============================================================

Example:

Dispatch Reminder:
    Distributor: ABC Distributor
    Scheduled: 16:00

Last heartbeat:
    15:55:20

PC powered off:
    around 15:56

PC starts again:
    16:18

Application starts.

The application sees:

last heartbeat = 15:55:20
scheduled_at = 16:00
current time = 16:18

Therefore:

    message was due while application was unavailable.

It must NOT silently disappear.

It must recover the existing queue item.

Then:

    delivery register check
             |
       not already sent
             |
             v
       pending/retryable
             |
             v
       WhatsApp readiness
             |
             v
           SEND
             |
             v
           SENT

Automation Hub can use the existing notification/event system to show the
actual state/reason where applicable.

============================================================
12. NEVER SILENTLY SKIP
============================================================

For scheduled distributor Dispatch Reminders, these conditions MUST NOT
automatically result in silent skipping:

- WhatsApp sleeping
- WhatsApp temporarily disconnected
- temporary connection failure
- WhatsApp initialization delay
- temporary send failure
- PC/application temporarily unavailable
- application restart
- scheduled time passing while WhatsApp was unavailable

Instead:

    remain pending/retryable
    |
    v
    readiness recovery
    |
    v
    retry
    |
    v
    SENT

A message may only become a final non-sent state when the existing business
rules establish a genuine permanent reason, for example:

- invalid recipient phone number
- recipient genuinely not registered on WhatsApp
- explicit cancellation
- another existing permanent validation condition

Do not convert temporary connectivity failures into permanent skipped states.

============================================================
13. IMPORTANT CHANGE TO RETRY LIMIT
============================================================

The current worker contains:

retry_count < 3

This must NOT be blindly removed for every WhatsApp message.

For the specific scheduled distributor Dispatch Reminder workflow:

temporary WhatsApp/PC availability failure must remain recoverable.

Therefore the implementation must separate:

TEMPORARY AVAILABILITY FAILURE
from
PERMANENT DELIVERY FAILURE.

For temporary availability:

    retryable/pending

For permanent failure:

    existing permanent failure status + exact reason

If an existing retry_count is retained for bookkeeping, it must not cause a
scheduled distributor message to silently disappear after three temporary
connection failures.

Do not change retry behavior for unrelated WhatsApp message types unless the
same existing shared helper is necessarily modified.

============================================================
14. EXISTING DEDUPLICATION MUST REMAIN
============================================================

This is critical.

The system already has:

- queue-level deduplication
- permanent whatsappDeliveryRegister
- outbox verification
- recurring reminder-specific delivery checking

These must remain.

When recovering a missed message:

DO NOT:

    create new message
    create new queue ID
    blindly resend

Instead:

    recover existing queue item
            |
            v
    delivery-register check
            |
       already sent?
        /       \
      YES       NO
       |         |
     SENT      retry/send

This prevents a PC restart from producing duplicate distributor messages.

============================================================
15. RECURRING DAILY DISPATCH REMINDER RULE
============================================================

The existing worker already recognizes:

distributor_dispatch_reminder

as a recurring daily reminder and uses a shorter delivery-register window.

Keep this behavior.

Do not change the daily reminder identity/deduplication design.

The new readiness/recovery mechanism must operate around the existing
recurring reminder logic.

============================================================
16. QUEUE ORDER MUST NOT CHANGE
============================================================

Existing FIFO queue behavior remains.

Do not create a separate "urgent scheduled queue."

Do not bypass pacing.

Do not send multiple WhatsApp messages concurrently.

The existing worker remains responsible for:

    ordering
    pacing
    sending
    deduplication
    delivery verification

The readiness system only prepares WhatsApp.

============================================================
17. EXISTING PACING MUST REMAIN
============================================================

The worker currently enforces WhatsApp pacing with a hard minimum.

Do not modify the current anti-abuse pacing rules as part of this feature.

Prewarm/readiness checks must not be interpreted as sending.

Therefore:

    prewarm != send

and prewarm must not reset or bypass the existing message pacing.

============================================================
18. AUTOMATION HUB
============================================================

Do not redesign the Automation Hub UI.

Use the existing:

eventService.broadcast()
automation_hub_updated
message_send_progress
existing queue status

mechanisms.

The system should expose accurate internal status/events where the existing
Automation Hub already consumes them.

Examples:

    scheduled
    preparing
    pending
    sending
    sent
    retrying
    recovered_after_offline

If a new event is absolutely necessary, add it only in the existing event
path and only if the existing UI can consume it without frontend redesign.

Do NOT create a second notification system.

============================================================
19. FRONTEND UI
============================================================

NO FRONTEND UI CHANGE.

Do not change:

- page layout
- colors
- buttons
- popup design
- Automation Hub design
- Dispatch page design
- Special Order design
- labels
- spacing
- navigation
- existing workflow structure

Only add the minimum existing API/service invocation required to trigger the
existing prewarm when the Special Order workflow is already entered, and only
inside the existing related Special Order code.

No new UI components.

No new popup.

No new dashboard.

No new status panel.

============================================================
20. FILE SCOPE RULE
============================================================

The coding agent MUST FIRST inspect the repository and identify the exact
existing files that currently implement:

A. scheduled distributor Dispatch Reminders
B. Special Order entry/action
C. WhatsApp queue scheduling
D. WhatsApp readiness/prewarm
E. WhatsApp queue recovery
F. existing queue status/event handling

The agent MUST NOT guess filenames.

The following already-confirmed files are directly related and may be modified
where necessary:

1. src/services/whatsappQueueWorker.ts
   Purpose:
   Existing queue worker, scheduling, readiness, retries, startup recovery,
   delivery verification and sending.

2. src/routes/whatsappQueue.ts
   Purpose:
   Existing WhatsApp queue API endpoints and enqueue workflow.

3. frontend/src/services/api.ts
   Purpose:
   Existing frontend-to-backend WhatsApp queue API methods.

The agent must additionally identify the EXISTING Special Order/Dispatch
Reminder file(s) before modifying them.

Only those exact files that actually own this workflow may be changed.

Do NOT modify unrelated files.

============================================================
21. STRICT FILE MODIFICATION RULE
============================================================

The implementation agent must follow this rule:

"TOUCH ONLY THE FILES REQUIRED FOR THIS FEATURE."

Before editing:

1. Inspect current implementation.
2. Identify exact function/component/route responsible.
3. Record why each file is required.
4. Modify only those files.
5. Do not refactor unrelated code.
6. Do not rename unrelated functions.
7. Do not reorganize folders.
8. Do not create duplicate services.
9. Do not create duplicate queue logic.
10. Do not rewrite the application architecture.
11. Do not modify frontend UI.
12. Do not modify unrelated APIs.
13. Do not modify unrelated database workflows.

If a file is not directly required, do not touch it.

============================================================
22. DATABASE / EXISTING SCHEMA RULE
============================================================

DO NOT create a second WhatsApp queue table.

Use:

whatsapp_send_queue

and its existing fields.

Use existing:

scheduled_at
retry_count
status
error_message
created_at
sent_at
target_name

If an additional persistence field is genuinely required for heartbeat/recovery,
first check whether an existing app_settings or existing status mechanism can
store it.

Only add schema logic if absolutely required.

If schema modification is required, it must be implemented in the existing
database/WhatsApp-related schema path, not by creating a separate database
system.

============================================================
23. HEARTBEAT IMPLEMENTATION RULE
============================================================

The heartbeat must be lightweight.

It should answer:

"Is the application process still alive?"

It must NOT pretend to be a hardware power sensor.

The system should store:

last heartbeat timestamp

and derive availability from it.

Do not claim:

PC_OFF

simply because WhatsApp is not ready.

Correct interpretation:

heartbeat current + WhatsApp not ready
    = WhatsApp problem

heartbeat stopped + later startup
    = application/PC unavailable during that interval

This distinction is mandatory.

============================================================
24. SPECIAL ORDER + BACKGROUND SCHEDULER
============================================================

Final architecture:

                 SPECIAL ORDER OPEN
                       |
                       v
                existing prewarm()
                       |
                       v
                WhatsApp readiness
                       |
                       |
                       v
Scheduled Reminder ---> Queue Worker
                       |
                 T-5 readiness
                       |
                 T-1 readiness
                       |
                scheduled_at reached
                       |
              WhatsApp readiness
                       |
                  sendMessage()
                       |
                 delivery verify
                       |
                     SENT

The background queue remains the authoritative mechanism.

Special Order is simply an early readiness trigger.

============================================================
25. ERROR HANDLING
============================================================

Every temporary failure must retain a meaningful reason internally.

Examples:

"WhatsApp sleeping, retry pending"
"WhatsApp disconnected, retry pending"
"WhatsApp initialization in progress"
"Application restarted before scheduled send"
"Recovered overdue scheduled reminder"
"Temporary WhatsApp send failure"

Permanent errors must remain explicit:

"Invalid phone number"
"Number not registered on WhatsApp"
etc.

Never:

catch error
    |
    v
do nothing
    |
    v
message disappears

Silent failure is specifically prohibited.

============================================================
26. CONCURRENCY SAFETY
============================================================

Do not allow:

- duplicate worker loops
- duplicate scheduled timers
- duplicate sends
- multiple readiness initialization calls unnecessarily
- multiple recovery processes modifying the same queue item

Use the existing worker state:

isProcessing
isLoopRunning
currentSendingItemId
existing cooldown/readiness controls

Extend them only where necessary.

============================================================
27. STARTUP / UPDATE SAFETY
============================================================

Existing startup recovery must continue protecting against duplicate sends.

For distributor Dispatch Reminders:

1. Find overdue queue item.
2. Check permanent delivery register.
3. If already delivered:
       mark SENT.
4. Otherwise:
       restore/retry.
5. Do not create a new queue item.
6. Process using normal queue worker.

For unrelated legacy/stale queue items:

KEEP CURRENT SAFETY BEHAVIOR.

Do not globally change the existing stale-backlog protection.

This prevents the new reliability requirement from accidentally causing old
unrelated WhatsApp messages to blast out after an update.

============================================================
28. NO DUPLICATE WORKFLOW
============================================================

The implementation agent MUST NOT create:

- New WhatsApp sender
- New WhatsApp queue
- New Dispatch Reminder scheduler
- New Special Order workflow
- New Automation Hub
- New delivery register
- New duplicate recovery service
- New frontend status system

Instead:

EXTEND:

    whatsappQueueWorker

USE:

    existing queue
    existing scheduler/timers
    existing prewarmWhatsApp()
    existing ensureWhatsAppReady()
    existing sendMessage()
    existing delivery register
    existing eventService
    existing Automation Hub

This keeps V3 internally consistent instead of creating three competing
systems because apparently software enjoys having three ways to do the same
thing.

============================================================
29. IMPLEMENTATION STEPS
============================================================

STEP 1
Inspect the current repository and identify the exact existing files/functions
for:

- distributor_dispatch_reminder creation
- scheduled_at assignment
- Special Order open/action
- WhatsApp queue enqueue
- queue worker
- prewarm
- readiness
- startup recovery
- Automation Hub events

Do not edit during discovery.

STEP 2
Modify the existing queue worker to identify upcoming scheduled distributor
Dispatch Reminders.

Add readiness preparation around the existing scheduler.

Use:

T-5 minutes -> prewarm
T-1 minute -> final readiness check
scheduled time -> normal queue processing

STEP 3
Strengthen the existing WhatsApp readiness path so that:

sleeping/disconnected + application alive
    -> existing recovery/wake mechanism

Do not create another WhatsApp client.

STEP 4
Add/extend the existing application heartbeat mechanism only in the smallest
directly related backend location.

Store/update last-seen state.

STEP 5
Use heartbeat information when determining whether a missed scheduled message
was caused by:

- WhatsApp unavailable while application remained alive
OR
- application/PC unavailable.

STEP 6
Modify existing startup recovery for scheduled distributor reminders only.

Recover overdue legitimate reminders instead of silently converting them into
a non-send state.

STEP 7
Preserve existing delivery-register checks before recovery/send.

STEP 8
Preserve existing queue pacing and FIFO order.

STEP 9
Use the existing Special Order workflow as an early prewarm trigger.

Only modify its existing related file/function.

STEP 10
Do not change UI.

STEP 11
Do not touch unrelated files.

============================================================
30. TEST CASES REQUIRED
============================================================

The coding agent MUST test these cases.

TEST 1:
WhatsApp already READY.

Expected:
scheduled reminder sends normally.

------------------------------------------------------------

TEST 2:
WhatsApp sleeping, PC/application running.

Expected:
T-5/T-1 readiness attempts wake WhatsApp.
Message remains queued until ready.
Message sends.
No silent skip.

------------------------------------------------------------

TEST 3:
WhatsApp disconnected, PC/application running.

Expected:
existing permitted reconnect/readiness mechanism runs.
Message remains pending/retryable.
No silent skip.

------------------------------------------------------------

TEST 4:
PC/application goes offline before scheduled time.

Expected:
heartbeat stops.
No false real-time claim is made while application is off.

After restart:
overdue scheduled distributor reminder is discovered and recovered.

------------------------------------------------------------

TEST 5:
PC starts 20 minutes after scheduled time.

Expected:
existing queue item is recovered.
Delivery register is checked.
If not already sent, it is sent through normal queue processing.

------------------------------------------------------------

TEST 6:
Message was actually sent before PC shutdown but database status remained
sending/pending.

Expected:
existing delivery-register/outbox verification identifies the send.
Queue becomes SENT.
No duplicate WhatsApp message.

------------------------------------------------------------

TEST 7:
Temporary WhatsApp failure occurs three times.

Expected:
scheduled distributor reminder remains recoverable.
It does NOT silently become permanently skipped merely because retry_count
reached the old temporary retry threshold.

------------------------------------------------------------

TEST 8:
Invalid distributor phone.

Expected:
existing invalid-phone permanent handling remains.
Do not repeatedly retry an invalid phone forever.

------------------------------------------------------------

TEST 9:
Distributor number is not registered on WhatsApp.

Expected:
existing registration validation remains.
This is a genuine recipient validation result, not a WhatsApp connectivity
failure.

------------------------------------------------------------

TEST 10:
Special Order opened 10 minutes before dispatch.

Expected:
existing Special Order action triggers existing WhatsApp prewarm.
No message is sent early.
Scheduled time remains unchanged.

------------------------------------------------------------

TEST 11:
Multiple distributor reminders scheduled close together.

Expected:
one queue worker.
Existing FIFO.
Existing pacing.
No concurrent duplicate sends.

------------------------------------------------------------

TEST 12:
Application remains open all day.

Expected:
scheduled distributor reminders are continuously monitored by the existing
worker.
No silent skip simply because WhatsApp temporarily sleeps/disconnects.

============================================================
31. POST-IMPLEMENTATION CROSS-CHECK
============================================================

AFTER CODING, THE AGENT MUST NOT JUST SAY "DONE".

It must perform a code-level comparison of OLD vs NEW behavior.

For every modified file, inspect only the functions/sections changed and verify:

------------------------------------------------------------

FILE CHECK:

1. What was the old behavior?
2. What is the new behavior?
3. Why was this exact change required?
4. Does it use the existing workflow?
5. Does it introduce duplicate functionality?
6. Does it alter unrelated behavior?
7. Does it change frontend UI?
8. Does it modify unrelated files?
9. Does it preserve queue ordering?
10. Does it preserve deduplication?
11. Does it preserve delivery verification?
12. Does it preserve existing pacing?
13. Does it preserve existing Automation Hub events?
14. Does it preserve existing Special Order workflow?
15. Does it preserve existing WhatsApp connection rules?

============================================================
32. REQUIRED OLD VS NEW VERIFICATION FORMAT
============================================================

After implementation, the coding agent must produce a short internal report
in this structure:

FILE:
<exact modified file>

OLD:
<what the existing code did>

NEW:
<what the modified code now does>

PRESERVED:
<existing workflow/functions that were intentionally retained>

CHANGED:
<only the exact behavior changed>

NOT TOUCHED:
<important unrelated functionality confirmed unchanged>

DUPLICATION CHECK:
<confirm whether any second queue/sender/scheduler/workflow was introduced>

UI CHECK:
<confirm frontend UI was not changed>

SCOPE CHECK:
<list exact files modified and confirm no unrelated files were touched>

============================================================
33. FINAL ACCEPTANCE CRITERIA
============================================================

The implementation is accepted ONLY if all of the following are true:

[ ] Existing WhatsApp queue remains the single source of truth.

[ ] Existing whatsappQueueWorker remains the single sending worker.

[ ] Existing sendMessage() remains the actual sender.

[ ] Existing prewarmWhatsApp()/ensureWhatsAppReady() are reused.

[ ] Special Order can trigger readiness preparation without sending early.

[ ] T-5 readiness preparation exists for scheduled distributor reminders.

[ ] T-1 readiness verification exists.

[ ] Scheduled-time processing remains through the existing queue.

[ ] Temporary WhatsApp availability failures do not silently skip the reminder.

[ ] Scheduled distributor reminders can recover after PC/application outage.

[ ] Heartbeat/last-seen distinguishes application availability from WhatsApp
    readiness.

[ ] The system does not falsely claim PC OFF merely because WhatsApp is
    disconnected.

[ ] Existing delivery-register deduplication remains active.

[ ] Existing outbox verification remains active.

[ ] Existing FIFO queue remains active.

[ ] Existing pacing remains active.

[ ] Existing permanent validation failures remain protected.

[ ] Existing unrelated stale-backlog behavior remains unchanged.

[ ] No second WhatsApp queue exists.

[ ] No second scheduler exists.

[ ] No second WhatsApp sender exists.

[ ] No duplicate Special Order workflow exists.

[ ] No frontend UI redesign/change exists.

[ ] Only directly related files were modified.

[ ] Every modified file was cross-checked against its old behavior.

[ ] No unrelated refactoring was performed.

[ ] No existing workflow was rebuilt from the beginning.

============================================================
34. MOST IMPORTANT AGENT INSTRUCTION
============================================================

DO NOT START FROM ZERO.

The application already has the WhatsApp queue, worker, scheduler,
prewarm/readiness, delivery register, duplicate protection, Automation Hub
events and startup recovery.

The implementation must be an INCREMENTAL MODIFICATION of that existing
architecture.

The coding agent must first understand the current implementation, then modify
only the smallest number of existing files required to achieve:

    scheduled distributor message
              |
              v
        proactive readiness
              |
              v
       scheduled execution
              |
       +------+------+
       |             |
    WhatsApp OK   WhatsApp unavailable
       |             |
       v             v
      SEND       remain pending/retry
       |             |
       v             |
      SENT <---------+
       
If the PC/application was unavailable:

    heartbeat gap
          |
          v
    startup recovery
          |
          v
    existing queue item
          |
          v
    delivery-register check
          |
       not sent
          |
          v
    normal queue processing
          |
          v
        SENT

The final code must preserve the existing application workflow and structure.
Only the reliability/readiness/recovery behavior required above should change.
No duplicate architecture, no unrelated refactoring, and no frontend UI
changes.