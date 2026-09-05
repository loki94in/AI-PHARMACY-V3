AI PHARMACY V2 — PERFORMANCE, STARTUP & WORKER OPTIMIZATION SPECIFICATION

IMPORTANT:
Do NOT create new pages, screens, routes, or UI unless explicitly required.
Do NOT change the existing business workflow unnecessarily.
Do NOT introduce unnecessary architecture complexity.
Do NOT auto-start the installed application when Windows starts.
The installed application must be started ONLY when the user manually opens it.

==================================================
1. CURRENT PROBLEMS IDENTIFIED
==================================================

Current development startup takes approximately 13.8 seconds.

Observed startup sequence:

- Database initialization/schema check
- Expiry cache rebuild
- Stock calculator worker
- FTS5 index build for 7,899 medicines
- Cache initialization
- Route pre-warming
- Pharmarack cart warm-up
- Token refresh scheduler
- Order fulfillment scheduler
- Catalog worker
- Email poller
- Trigger scheduler
- WhatsApp queue
- Catalog sync scheduler
- AutoMatch worker
- Telegram initialization

The application is functional, but too many operations are being performed during startup.

Primary problems:

1. Heavy work is happening during application boot.
2. Some caches/indexes appear to be rebuilt unnecessarily.
3. External service synchronization happens during startup.
4. Background workers are initialized before they are actually needed.
5. Some scheduler initialization appears duplicated or repeatedly guarded.
6. Development mode starts more background services than necessary.
7. The main API startup is coupled to background initialization.
8. The installed application must not automatically launch after Windows startup.

==================================================
2. TARGET STARTUP ARCHITECTURE
==================================================

The application must use a FAST BOOT + BACKGROUND INITIALIZATION model.

Required sequence:

START APPLICATION
        ↓
Load configuration
        ↓
Open database
        ↓
Verify schema/version
        ↓
Start API/server
        ↓
Make application available
        ↓
Run non-critical initialization in background
        ↓
Initialize workers/services only when required


Critical startup operations:
- Configuration loading
- Database connection
- Schema/version validation
- Minimum required application state
- API/server startup

Non-critical operations must NOT block application availability:
- Expiry cache rebuild
- FTS indexing
- Pharmarack synchronization
- Catalog synchronization
- Stock recalculation
- AutoMatch
- External service heartbeat
- WhatsApp processing
- Telegram initialization
- Email polling
- Route/cache pre-warming where not essential

==================================================
3. EXPIRY CACHE OPTIMIZATION
==================================================

CURRENT:

Application rebuilds all month-wise expiry cache files during startup.

PROBLEM:

Every restart can cause unnecessary processing.

REQUIRED:

Use cache invalidation instead of unconditional rebuilding.

Expected logic:

IF inventory/expiry data changed:
    invalidate affected expiry cache
    rebuild affected cache

ELSE:
    reuse existing cache

Do NOT rebuild all expiry cache files simply because the application restarted.

Cache should be considered valid using an appropriate mechanism such as:
- data version
- inventory revision
- updated_at timestamp
- cache generation/version
- checksum where appropriate

Only rebuild what actually changed.

==================================================
4. FTS5 SEARCH INDEX OPTIMIZATION
==================================================

CURRENT:

FTS5 index is built for approximately 7,899 medicine names during startup.

PROBLEM:

The search index should not be unnecessarily rebuilt on every application launch.

REQUIRED:

Persist and reuse the FTS5 index.

Expected behavior:

FIRST INSTALL / FIRST DATABASE CREATION:
    create FTS5 index
    populate index

NORMAL STARTUP:
    open existing index
    do NOT rebuild entire index

CATALOG CHANGE:
    update only affected records

MEDICINE ADDED:
    insert into FTS5

MEDICINE UPDATED:
    update corresponding FTS5 record

MEDICINE DELETED:
    remove corresponding FTS5 record

FULL REBUILD:
    only when explicitly required, for example:
    - index corruption
    - schema migration
    - administrator maintenance
    - major catalog migration

==================================================
5. PHARMARACK STARTUP SYNCHRONIZATION
==================================================

CURRENT:

Pharmarack cart warm-up takes approximately 1.6 seconds.

PROBLEM:

External service communication should not unnecessarily delay application readiness.

REQUIRED:

The application must become available first.

Then perform Pharmarack synchronization asynchronously.

Expected:

SERVER READY
    ↓
APPLICATION AVAILABLE
    ↓
BACKGROUND PHARMARACK SYNC
    ↓
UPDATE LOCAL CACHE
    ↓
UPDATE UI WHEN DATA CHANGES

If Pharmarack is unavailable:

DO NOT block application startup.

Application should continue operating with:
- last known valid cache
- local database
- appropriate offline/degraded state

Retry synchronization using controlled backoff.

==================================================
6. WORKER STARTUP OPTIMIZATION
==================================================

Workers should not all start immediately unless required.

Use lazy/background startup where possible.

Examples:

Catalog Worker:
    Start only when catalog synchronization is required.

Email Poller:
    Do not start if email credentials are not configured.

WhatsApp Worker:
    Do not continuously initialize when WhatsApp is not connected.

Telegram:
    Do not initialize polling if Telegram is disabled or token is missing.

Prescription/scispaCy:
    Continue using lazy loading.
    Do not load Python sidecar during normal startup.

AutoMatch:
    Start asynchronously after core application readiness.

Order Fulfillment:
    Start independently from API startup.

==================================================
7. SCHEDULER DUPLICATION PREVENTION
==================================================

Review all scheduler/service initialization.

The same scheduler must NEVER be registered twice.

Each scheduler/service must have one authoritative lifecycle:

initialize()
start()
stop()

Use an idempotent startup guard.

Example concept:

IF scheduler already initialized:
    DO NOTHING

ELSE:
    initialize scheduler
    register jobs
    start scheduler

Prevent duplicate:
- intervals
- cron jobs
- workers
- token refreshers
- queue processors
- synchronization loops

There must be ONE owner responsible for starting each background service.

Do not allow multiple modules to independently start the same service.

==================================================
8. DEVELOPMENT MODE
==================================================

Development mode must prioritize fast iteration.

Default development startup should run only services required for the developer's current workflow.

Do NOT start unnecessary external workers automatically.

Example:

DEV CORE:
    API
    Database
    Frontend
    Required local services

OPTIONAL:
    Pharmarack
    WhatsApp
    Telegram
    Email
    AutoMatch
    heavy catalog synchronization

These should be enabled explicitly when required.

Do not disable functionality permanently.
Use feature/service configuration.

==================================================
9. PRODUCTION / INSTALLED PC BEHAVIOR
==================================================

CRITICAL REQUIREMENT:

THE INSTALLED APPLICATION MUST NOT AUTO-START WITH WINDOWS.

Do NOT:
- create Windows Startup shortcut
- create Registry Run entry
- create scheduled task for automatic launch
- install a Windows auto-start service that launches the UI
- automatically open the application after Windows login
- automatically launch the application after PC boot

Required behavior:

Windows starts
    ↓
Nothing from AI Pharmacy launches automatically
    ↓
User manually opens AI Pharmacy
    ↓
Application starts
    ↓
Required services initialize
    ↓
Application becomes ready

The application may start its own required internal background workers AFTER the user manually launches the application.

IMPORTANT DISTINCTION:

"Application startup"
≠
"Windows startup"

Windows startup:
    MUST NOT launch AI Pharmacy.

Manual application launch:
    MUST start AI Pharmacy normally.

==================================================
10. APPLICATION CLOSE BEHAVIOR
==================================================

When the user closes the application:

- Stop application-owned workers cleanly.
- Stop timers/intervals.
- Stop queue processors.
- Close database connections cleanly.
- Close browser/external sessions where required.
- Persist required state.
- Release file handles.
- Release ports.

Do not leave orphan processes running.

If background services intentionally need to continue after UI closes, they must be explicitly designed as independent services.
Do NOT create this behavior accidentally.

==================================================
11. UNCLEAN SHUTDOWN HANDLING
==================================================

Current log:

"WARNING: Last shutdown was unclean"

The application must distinguish between:

NORMAL SHUTDOWN
and
CRASH / FORCE KILL / POWER LOSS.

Use a startup/shutdown marker.

On startup:
    mark application as running

On clean shutdown:
    mark application as cleanly stopped

On next startup:
    if previous state was running:
        record unclean shutdown
        perform only required recovery checks

Do NOT automatically perform expensive full rebuilds simply because an unclean shutdown occurred.

Recovery should be targeted.

==================================================
12. DATABASE OPTIMIZATION
==================================================

Database initialization should be:

1. Open connection
2. Check schema version
3. Apply migrations only if required
4. Verify required indexes
5. Enable required database settings
6. Continue startup

If schema version is already current:

DO NOT execute unnecessary DDL or expensive verification operations.

Database startup must remain lightweight.

==================================================
13. CACHE STRATEGY
==================================================

Use layered caching:

DATABASE
    ↓
PERSISTENT CACHE
    ↓
IN-MEMORY CACHE
    ↓
API RESPONSE

Only rebuild a cache when its source data changes.

Every cache should have:
- version
- validity state
- source-data revision
- last updated timestamp

Avoid:

APPLICATION START
    ↓
REBUILD EVERYTHING

Prefer:

APPLICATION START
    ↓
LOAD VALID EXISTING CACHE
    ↓
BACKGROUND REFRESH ONLY IF REQUIRED

==================================================
14. EXTERNAL SERVICE FAILURE
==================================================

External services must never prevent core application startup.

Examples:
- Pharmarack unavailable
- WhatsApp disconnected
- Telegram disabled
- Email credentials missing
- Browser session expired
- Internet unavailable

Required behavior:

CORE APPLICATION
    ↓
STARTS SUCCESSFULLY

EXTERNAL SERVICES
    ↓
CONNECT IN BACKGROUND
    ↓
RETRY WHEN NECESSARY

The application must remain usable where local functionality allows it.

==================================================
15. PERFORMANCE TARGET
==================================================

Target:

CORE SERVER READY:
    ideally < 3-5 seconds

FULL BACKGROUND INITIALIZATION:
    may continue after application availability

Do NOT define "startup complete" as:

"Every worker, cache, sync, external connection and scheduler has finished."

Instead:

CORE READY:
    API + database + essential application state ready

BACKGROUND READY:
    optional workers/services initialized progressively

==================================================
16. OBSERVABILITY
==================================================

Every startup phase should report duration.

Example:

[Boot] Config: 30ms
[Boot] Database: 120ms
[Boot] Schema validation: 40ms
[Boot] API ready: 350ms

[Background] Cache: 200ms
[Background] Pharmarack sync: 1600ms
[Background] FTS update: 100ms

This makes future optimization measurable.

Do NOT optimize based only on assumptions.

If a startup task takes >100ms:
    identify whether it is critical.

If NOT critical:
    move it to background/lazy initialization.

==================================================
17. FUTURE DEVELOPMENT RULE
==================================================

Every NEW startup operation must answer these questions before implementation:

1. Does this absolutely need to run before the API becomes available?
2. Can this run asynchronously?
3. Can the result be cached?
4. Can it be updated incrementally?
5. Can it be lazy-loaded?
6. Can it run only when the relevant feature is used?
7. Can it fail without blocking the application?
8. Can it accidentally create duplicate workers/timers?
9. Does it need to run on every restart?
10. Does it need to run when the installed app is manually opened?

If the answer to #1 is NO:

DO NOT BLOCK CORE STARTUP.

If the answer to #3 or #4 is YES:

DO NOT REBUILD THE ENTIRE DATASET ON EVERY START.

If the answer to #8 is YES:

IMPLEMENT AN IDEMPOTENT SINGLE-INSTANCE LIFECYCLE.

==================================================
18. INSTALLER REQUIREMENT
==================================================

The installer must NOT configure automatic Windows startup.

Verify the final installer/package for:

- Startup folder entries
- Registry Run entries
- Scheduled Tasks
- Auto-launch configuration
- Background launchers
- Hidden helper processes

AI Pharmacy must appear as a normal manually launched desktop application.

Expected:

INSTALL
    ↓
USER FINISHES INSTALLATION
    ↓
NO AUTOMATIC APP LAUNCH
    ↓
USER OPENS AI PHARMACY WHEN NEEDED
    ↓
APPLICATION STARTS
    ↓
BACKGROUND SERVICES START UNDER APPLICATION CONTROL

==================================================
19. ACCEPTANCE CRITERIA
==================================================

PASS only if:

[ ] Installed app does NOT auto-start with Windows.
[ ] User manually opens the application.
[ ] Core API becomes available without waiting for optional workers.
[ ] Expiry cache is not rebuilt unnecessarily.
[ ] FTS5 is not fully rebuilt on every startup.
[ ] Pharmarack sync does not block application readiness.
[ ] Optional workers start lazily/asynchronously.
[ ] Disabled services remain inactive.
[ ] Missing credentials do not cause startup delay/failure.
[ ] Duplicate scheduler registration is prevented.
[ ] Orphan workers are not left after normal application close.
[ ] Unclean shutdown does not automatically trigger expensive full rebuilds.
[ ] Startup timings are measurable.
[ ] New startup features follow the critical-vs-background rule.
[ ] Existing business workflows remain unchanged.
[ ] No unnecessary pages/routes/UI are created.

==================================================
FINAL PRINCIPLE
==================================================

DO NOT MAKE STARTUP DO EVERYTHING.

CORE STARTUP:
    DATABASE
    CONFIG
    ESSENTIAL STATE
    API
    READY

BACKGROUND:
    CACHE
    SEARCH INDEX UPDATES
    EXTERNAL SYNC
    WORKERS
    SCHEDULERS
    AUTOMATIONS

LAZY:
    HEAVY AI
    PRESCRIPTION SCANNING
    OPTIONAL EXTERNAL SERVICES

INSTALLER:
    NEVER AUTO-START WITH WINDOWS

USER:
    MANUALLY OPENS AI PHARMACY

The objective is not merely to reduce the 13.8-second number.
The objective is to make the architecture predictable, incremental, recoverable, and resistant to future startup-performance regressions.