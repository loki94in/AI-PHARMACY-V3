AI PHARMACY V3
IMPLEMENTATION PLAN
FEATURE: INSTANT PAGE NAVIGATION + WARM CACHE + SILENT BACKGROUND DATA REFRESH
MODE: IN-PLACE PERFORMANCE OPTIMIZATION ONLY
UI CHANGE: STRICTLY PROHIBITED

============================================================
1. OBJECTIVE
============================================================

Optimize the existing AI Pharmacy V3 application so that when a user switches between pages:

- The page does not show a completely white screen.
- Previously visited pages become available almost immediately.
- Existing/last-known data can be displayed immediately.
- Latest data is fetched silently in the background.
- Data changes made elsewhere in the application are reflected without forcing the user to wait for the complete page to reload.
- Frequently used pages should feel continuously available without permanently mounting every page in RAM.
- Heavy/rarely used modules must not remain unnecessarily active.
- The application must remain responsive during navigation and background refresh.

PRIMARY TARGET:

Previously visited/common pages:
    Perceived navigation: near-instant / ideally <500 ms

Normal pages:
    Target usable UI: <1–2 seconds

Heavy pages:
    Target usable UI: <3 seconds where technically possible

STRICT REQUIREMENT:

ZERO intentional full-white-screen loading states during normal page navigation.

============================================================
2. CURRENT BEHAVIOR
============================================================

CURRENT PROBLEM:

When the user opens a page and later switches away from it, then returns:

    User clicks page
        ↓
    Previous page/component is unloaded or recreated
        ↓
    JavaScript/component loading starts
        ↓
    API/data loading starts
        ↓
    Page waits for data
        ↓
    Browser shows white/blank area
        ↓
    Data arrives
        ↓
    React renders page
        ↓
    Table/list/components render
        ↓
    User finally sees the page

This creates a perception that the application is offline, frozen, or not responding.

The user should NOT have to wait for an entire page to become visible just because its latest data is being fetched.

The existing V3 performance documentation already identifies:

- oversized frontend JavaScript
- duplicated JavaScript
- large initial entry point
- route-level loading concerns
- heavy feature loading
- forced reflow
- expensive React rendering
- large datasets requiring virtualization

as performance concerns.

DO NOT solve this by removing functionality.

============================================================
3. EXPECTED NEW BEHAVIOR
============================================================

NEW FLOW:

    User opens Page A
          ↓
    Page A UI loads
          ↓
    Page A data is cached
          ↓
    User moves to Page B
          ↓
    Page A is no longer actively rendered if not required
          ↓
    Page A's useful state/data remains available in cache
          ↓
    User returns to Page A
          ↓
    Page A UI becomes visible immediately
          ↓
    Cached/last-known data is displayed
          ↓
    Background refresh starts silently
          ↓
    Latest API/database data arrives
          ↓
    Only required data/components update
          ↓
    User continues working without blocking

IMPORTANT:

The page must NOT disappear into a blank screen while background data is refreshing.

============================================================
4. DO NOT MOUNT EVERY PAGE 24/7
============================================================

DO NOT implement:

    Mount every application page permanently
    + keep every component alive
    + continuously poll every page
    + continuously fetch every API

This can unnecessarily increase:

- RAM usage
- CPU usage
- browser memory pressure
- network usage
- battery/power consumption
- React rendering workload

Instead implement:

    LIGHTWEIGHT PAGE LIFECYCLE
             +
    DATA CACHE
             +
    TARGETED BACKGROUND REFRESH
             +
    SELECTIVE WARMING

The application should FEEL always available without literally keeping the entire application mounted.

============================================================
5. PAGE CACHE / DATA CACHE STRATEGY
============================================================

Implement caching only through the application's existing data/state architecture.

DO NOT introduce a new global architecture if an existing cache/state/data-fetching mechanism already exists.

FIRST AUDIT:

Identify the existing mechanism used for:

- API requests
- server state
- React state
- page state
- query caching
- data refresh
- authentication/session state

Reuse the existing mechanism wherever possible.

DO NOT create duplicate caching systems.

------------------------------------------------------------
CACHE PRINCIPLE
------------------------------------------------------------

For pages where cached data is safe:

    SHOW LAST VALID DATA
           ↓
    FETCH LATEST DATA IN BACKGROUND
           ↓
    UPDATE CACHE
           ↓
    UPDATE UI ONLY WHERE REQUIRED

Never:

    CLEAR DATA
       ↓
    SHOW BLANK PAGE
       ↓
    WAIT FOR API
       ↓
    REBUILD EVERYTHING

------------------------------------------------------------
6. TARGETED DATA FRESHNESS
============================================================

DO NOT refetch the entire application after every action.

Example:

A medicine sale occurs in POS.

BAD:

    POS sale
       ↓
    Reload entire application
       ↓
    Reload Inventory
       ↓
    Reload CRM
       ↓
    Reload Purchases
       ↓
    Reload Reports
       ↓
    Reload Settings
       ↓
    Reload everything

GOOD:

    POS sale completed
           ↓
    Database updated
           ↓
    Update/invalidate only related data
           ↓
       ┌───┼──────────┐
       ↓   ↓          ↓
     Stock Customer  Sales
     data   credit   summary
       ↓     ↓          ↓
       └─────┴──────────┘
             ↓
      Background refresh
             ↓
       UI reflects change

Unrelated pages/data must NOT be unnecessarily refetched.

============================================================
7. PAGE PRIORITY
============================================================

Classify existing application pages based on actual usage.

HIGH-FREQUENCY / WARM-CACHE CANDIDATES:

- POS
- Dashboard
- Inventory
- CRM
- Purchase

These pages may retain useful cached state/data after navigation.

MEDIUM-FREQUENCY:

- Dispatch
- Returns
- Website Orders
- Purchase History
- Customer-related pages

Use cached data + controlled refresh.

LOW-FREQUENCY / HEAVY:

- Reports
- Advanced Analytics
- AI Camera
- OCR
- Prescription scanning
- PDF processing
- Excel/CSV processing
- large catalog operations
- advanced admin tools
- rarely used Settings modules

Do NOT permanently keep heavy functionality mounted unless the existing architecture specifically requires it.

============================================================
8. SILENT BACKGROUND REFRESH
============================================================

When the user returns to a previously visited page:

    DISPLAY PAGE
         ↓
    DISPLAY AVAILABLE CACHE
         ↓
    BACKGROUND API REQUEST
         ↓
    COMPARE/UPDATE DATA
         ↓
    UPDATE UI

The refresh must NOT block page rendering.

If the API is temporarily slow:

    Existing page remains visible.

If the API fails:

    Existing valid data remains visible where safe.

Do not replace the entire page with a blank/error screen merely because a background refresh failed.

Errors should be handled through the application's existing error/loading mechanism.

DO NOT redesign the UI.

============================================================
9. DATA INVALIDATION
============================================================

Identify existing create/update/delete actions and determine which cached data they actually affect.

Examples:

SALE:
- POS data
- relevant stock
- customer credit if applicable
- sales totals if applicable

PURCHASE:
- purchase data
- inventory/stock
- supplier-related data where applicable

CUSTOMER UPDATE:
- CRM/customer data
- related customer information

RETURN:
- inventory/stock
- return history
- relevant transaction information

ORDER UPDATE:
- website orders
- relevant dispatch/order status

Only affected cache/data should be invalidated or refreshed.

Do not globally invalidate all application queries after every mutation.

============================================================
10. NAVIGATION PERFORMANCE
============================================================

Audit the existing routing/navigation implementation.

Check:

- route-level lazy loading
- Suspense behavior
- page loading fallback
- route component recreation
- unnecessary remounting
- expensive initialization on every navigation
- duplicate API requests
- duplicate data processing
- unnecessary state resets

Do NOT remove lazy loading merely to make navigation faster.

Instead:

    LAZY LOAD PAGE CODE
          +
    CACHE PAGE DATA
          +
    SHOW PAGE SHELL IMMEDIATELY
          +
    REFRESH DATA SILENTLY

This provides fast navigation without loading every page into the initial bundle.

============================================================
11. WHITE-SCREEN PREVENTION
============================================================

The existing page loading mechanism must be audited.

A route transition must NEVER intentionally produce:

    completely white screen
    ↓
    wait
    ↓
    page appears

Instead:

    route transition
        ↓
    application/page shell
        ↓
    cached data OR lightweight loading state
        ↓
    background/fresh data
        ↓
    final update

If the existing UI already has a loading component, reuse it.

If a loading fallback exists but is currently causing a blank screen, modify only the directly related loading/routing file.

DO NOT create a new visual design.

DO NOT redesign loaders.

DO NOT add new pages.

============================================================
12. REACT RENDERING OPTIMIZATION
============================================================

Audit only the affected components.

Check for:

- expensive calculations during render
- repeated filtering
- repeated sorting
- unnecessary full-table rerenders
- unnecessary child rerenders
- state updates causing complete page rerender
- large arrays recreated on every render

Use existing project patterns first.

Use memoization only where it solves an identified bottleneck.

DO NOT blindly add useMemo/useCallback everywhere.

The goal is measured performance improvement, not unnecessary code complexity.

============================================================
13. LARGE TABLE PERFORMANCE
============================================================

Audit existing large tables/lists such as:

- Medicine Catalog
- Inventory
- Purchase History
- Sales History
- Customer lists
- Returns
- Orders
- Dispatch
- other transaction tables

Check whether the application is rendering unnecessarily large numbers of DOM rows.

Where an existing table becomes large:

- use existing pagination if already supported
- use existing virtualization if already available
- otherwise implement only within the directly related table/component file

DO NOT redesign table UI.

DO NOT change existing columns, buttons, filters, or workflow unless required to fix the performance problem.

============================================================
14. BACKGROUND REFRESH FREQUENCY
============================================================

Do NOT use aggressive polling.

Do NOT create:

    every page
       ↓
    every second
       ↓
    API request

Instead use:

- refresh on page activation
- refresh after relevant mutations
- controlled stale/cache periods
- refresh when data becomes stale
- existing application events where available

For genuinely real-time information, use the existing real-time mechanism if the project already has one.

Otherwise use controlled polling only for data that actually requires it.

============================================================
15. SESSION / LOGIN
============================================================

Audit the login/session initialization flow.

Current risk:

    Login
      ↓
    Validate session
      ↓
    Initialize every module
      ↓
    Load every page
      ↓
    Load background services
      ↓
    Finally show application

Expected:

    Login
      ↓
    Authenticate/session ready
      ↓
    Application shell available
      ↓
    Primary page available
      ↓
    User can interact
      ↓
    Background initialization
      ↓
    Optional services

Do not make login wait for unrelated modules.

Do not change authentication logic unless the performance issue is directly caused by the related login/session file.

============================================================
16. RESOURCE CONTROL
============================================================

The implementation must balance:

    SPEED
      +
    RAM
      +
    CPU
      +
    NETWORK
      +
    POWER

DO NOT optimize navigation by permanently mounting every page.

Preferred architecture:

    Frequently used page
        ↓
    UI + useful cache retained

    Rare/heavy page
        ↓
    lazy load when required
        ↓
    cache useful data
        ↓
    release unnecessary resources when appropriate

============================================================
17. STRICT FILE-SCOPE RULE
============================================================

THIS IS CRITICAL.

The coding agent MUST NOT modify unrelated files.

Before making changes:

1. Identify the exact files responsible for:
   - routing/navigation
   - page loading
   - existing data fetching/cache
   - relevant state management
   - relevant API/query invalidation
   - loading fallback
   - affected tables/components
   - login/session initialization, only if required

2. Create a FILE SCOPE LIST.

3. Modify ONLY those files.

4. Do NOT modify:
   - unrelated pages
   - unrelated components
   - unrelated backend files
   - unrelated database files
   - unrelated API endpoints
   - unrelated UI
   - unrelated CSS
   - unrelated configuration
   - unrelated integrations
   - documentation
   - deployment configuration
   - package dependencies unless absolutely required and directly related

5. Do NOT create unnecessary new files.

6. Do NOT create new pages.

7. Do NOT duplicate existing functionality.

8. Do NOT move files unnecessarily.

9. Do NOT refactor unrelated code.

10. Do NOT change business logic.

11. Do NOT change database schema.

12. Do NOT change API contracts unless absolutely required and directly proven necessary.

13. Do NOT change the existing frontend design/UI.

If an additional file appears necessary, STOP and document why it is directly related before modifying it.

============================================================
18. NO FRONTEND UI CHANGE
============================================================

STRICTLY PRESERVE:

- existing page layout
- existing navigation
- existing sidebar
- existing buttons
- existing tables
- existing forms
- existing colors
- existing typography
- existing spacing
- existing workflow
- existing labels
- existing business logic
- existing permissions
- existing routes

The feature is a PERFORMANCE/LOADING/DATA-FRESHNESS optimization only.

The user should see the SAME UI, but it should respond faster.

============================================================
19. NO DUMMY DATA
============================================================

STRICT PROJECT RULE:

ZERO DUMMY/FABRICATED BUSINESS DATA.

Do not introduce:

- fake medicines
- fake customers
- fake stock
- fake sales
- fake purchases
- fake API responses
- fake loading data presented as real data

Cached data must originate from the application's legitimate existing data sources.

============================================================
20. IMPLEMENTATION PROCESS
============================================================

STEP 1:
Audit the existing navigation/routing flow.

STEP 2:
Identify why a previously visited page becomes blank/white.

STEP 3:
Audit the existing API/data-fetching/cache architecture.

STEP 4:
Identify duplicate API calls and unnecessary refetches.

STEP 5:
Identify the exact files responsible.

STEP 6:
Produce the FILE SCOPE LIST.

STEP 7:
Implement only within those files.

STEP 8:
Preserve existing UI and business workflow.

STEP 9:
Implement cache retention and silent refresh using existing architecture.

STEP 10:
Implement targeted invalidation after relevant mutations.

STEP 11:
Prevent white-screen navigation states.

STEP 12:
Optimize only affected large tables/components.

STEP 13:
Check login/session initialization only where directly related.

STEP 14:
Run the application's existing validation/build/test/lint checks.

STEP 15:
Check for unintended file modifications.

============================================================
21. CROSS-CHECK AFTER IMPLEMENTATION
============================================================

AFTER CODE IS COMPLETE, THE AGENT MUST PERFORM A SECOND AUDIT.

Compare OLD vs NEW behavior.

------------------------------------------------------------
OLD BEHAVIOR
------------------------------------------------------------

Navigation:

    Click page
       ↓
    White screen
       ↓
    Page/API loading
       ↓
    Long wait
       ↓
    Page appears

Data:

    User changes data
       ↓
    Other page may still show old data
       ↓
    User waits/reloads
       ↓
    Data eventually updates

Resource behavior:

    Large modules may load unnecessarily
    Heavy pages can affect startup/navigation
    Duplicate fetching may occur

------------------------------------------------------------
NEW BEHAVIOR
------------------------------------------------------------

Navigation:

    Click page
       ↓
    Page becomes visible immediately
       ↓
    Cached/previous data shown where available
       ↓
    Background refresh
       ↓
    Latest data replaces stale data
       ↓
    No blocking white screen

Data:

    Mutation occurs
       ↓
    Only related cache/data becomes stale
       ↓
    Related data refreshes
       ↓
    Other pages remain unaffected

Resource behavior:

    Frequently used data remains warm
    Heavy pages load only when needed
    Unrelated APIs are not repeatedly fetched
    No unnecessary permanent mounting of all pages

============================================================
22. ACCEPTANCE CRITERIA
============================================================

The implementation is considered successful only if:

[ ] Previously visited pages do not show a full white screen during normal navigation.

[ ] Cached/last-known data can appear before the fresh API response.

[ ] Fresh data is fetched in the background.

[ ] Background refresh does not block user interaction.

[ ] Relevant data updates after sales/purchases/returns/orders where applicable.

[ ] Unrelated pages are not unnecessarily refetched.

[ ] Every page is NOT permanently mounted.

[ ] Heavy features are not unnecessarily kept active.

[ ] Duplicate API requests are reduced where identified.

[ ] Large tables do not unnecessarily render huge datasets.

[ ] Login/session startup does not wait for unrelated modules.

[ ] Existing UI is unchanged.

[ ] Existing business logic is unchanged.

[ ] Existing routes are unchanged.

[ ] No dummy/fabricated data is introduced.

[ ] No unrelated files are modified.

[ ] No unnecessary new files are created.

[ ] Existing integrations continue working.

[ ] Build/lint/tests pass according to the project's existing setup.

[ ] Git diff contains ONLY intended related-file changes.

============================================================
23. FINAL FILE-SCOPE VERIFICATION
============================================================

Before finishing, run a final change-scope check.

Report:

MODIFIED FILES:
- <exact file>
- <exact file>
- <exact file>

FOR EACH FILE:
Explain in one short sentence why the file was required.

UNMODIFIED:
Confirm that unrelated files were not touched.

If any unrelated file was modified accidentally:
REVERT THAT UNRELATED CHANGE before completion.

============================================================
24. FINAL PERFORMANCE REPORT
============================================================

At completion, provide a SHORT comparison:

OLD:
- Page navigation could produce white screen.
- Page waited for loading/data before becoming usable.
- Previously visited page data was not sufficiently retained.
- Related/unrelated data refresh could cause unnecessary work.

NEW:
- Previously visited pages use retained/cached data where appropriate.
- Page becomes visible before background refresh completes.
- Fresh data is silently fetched and applied.
- Only affected data is refreshed after relevant mutations.
- Heavy/rare functionality is not permanently active.
- Full white-screen navigation state is eliminated where caused by the identified loading architecture.

Also report:

1. Files modified.
2. Why each file was modified.
3. Files intentionally NOT modified.
4. What was optimized.
5. Confirmation that UI was not redesigned.
6. Confirmation that no dummy data was introduced.
7. Confirmation that no unrelated functionality was changed.
8. Build/test/lint result.
9. Old behavior vs new behavior verification result.

============================================================
FINAL RULE
============================================================

DO NOT treat this as a UI redesign.

DO NOT rebuild the application.

DO NOT mount every page permanently.

DO NOT refetch the entire application.

DO NOT add dummy data.

DO NOT create unnecessary files.

DO NOT touch unrelated files.

DO NOT change business logic.

DO NOT change the existing frontend UI.

ONLY optimize the existing navigation, page lifecycle, caching, background refresh, targeted data invalidation, and directly related performance code required to achieve:

    FAST PAGE SWITCHING
          +
    NO WHITE SCREEN
          +
    SILENT DATA REFRESH
          +
    FRESH DATA
          +
    CONTROLLED RAM/CPU/NETWORK USAGE
          +
    SAME EXISTING UI AND WORKFLOW