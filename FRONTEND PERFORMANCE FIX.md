AI PHARMACY V3 – FRONTEND PERFORMANCE FIX + FUTURE DEVELOPMENT RULES

OBJECTIVE
Fix the current Lighthouse performance problems without changing the existing pharmacy workflow, POS behavior, business logic, UI design, routes, database behavior, or working integrations.

CURRENT PROBLEM IDENTIFIED

1. FRONTEND INITIAL JAVASCRIPT BUNDLE IS TOO LARGE
   Lighthouse is reporting approximately:
   - ~19.5 MB potential JavaScript savings
   - ~5.9 MB unused JavaScript
   - ~1.66 MB duplicated JavaScript
   - ~2.1 s JavaScript execution
   - ~5.0 s main-thread work
   - ~26 MB total network payload

   The application appears to be loading code for many modules/pages together instead of loading only what the current screen needs.

2. DUPLICATED JAVASCRIPT
   Lighthouse identifies duplicated modules originating through the main frontend entry/import chain and multiple pages such as:
   - POS
   - CRM
   - Settings
   - Purchases
   - Dispatch
   - Returns
   - Investigation
   - Catalog Upload
   - Sales
   - Customer Portal
   - Learning
   - Reports
   - Purchase History
   - Website Orders
   - Inventory
   - and other routes

   DO NOT solve this by deleting functionality.
   Solve it by correcting the module/import architecture.

3. LARGE INITIAL ENTRY POINT
   frontend/index.tsx or equivalent application bootstrap should remain lightweight.
   It must NOT directly import every application page, heavy library, scanner, chart library, AI library, PDF library, browser automation library, large catalog utilities, or admin-only functionality.

4. ROUTE-LEVEL CODE SPLITTING IS REQUIRED
   Every major application area must be lazy loaded.

   Example architecture:

   const POS = lazy(() => import("./pages/POS"));
   const CRM = lazy(() => import("./pages/CRM"));
   const Settings = lazy(() => import("./pages/Settings"));
   const Purchases = lazy(() => import("./pages/Purchases"));
   const Dispatch = lazy(() => import("./pages/Dispatch"));

   Render through:

   <Suspense fallback={<PageLoader />}>
       <Routes>
           ...
       </Routes>
   </Suspense>

   Do not preload every route merely because it exists.

5. HEAVY FEATURES MUST BE DEFERRED
   The following must load only when the user actually uses them:
   - AI/CV/scanning features
   - Camera access
   - Prescription scanning
   - PDF processing
   - OCR
   - charts/analytics
   - Excel/CSV processing
   - large catalog import/export tools
   - advanced reporting
   - rich editors
   - maps
   - external SDKs
   - browser/automation-related client libraries

   Example:

   const CameraScanner = lazy(() => import("./features/camera/CameraScanner"));

   Do NOT do:

   import CameraScanner from "./features/camera/CameraScanner";

   in the global application entry when the scanner is only used from one workflow.

6. SHARED DEPENDENCIES MUST COME FROM ONE SOURCE
   Avoid situations where different pages bundle separate copies of the same library.

   Audit:
   - React
   - React DOM
   - date libraries
   - icon libraries
   - chart libraries
   - UI component libraries
   - utility libraries
   - state-management libraries
   - validation libraries

   Check package.json, lockfile and Vite dependency optimization.

   The same dependency must not exist in multiple incompatible versions unless there is a documented technical reason.

7. DO NOT IMPORT ENTIRE LIBRARIES WHEN ONLY ONE FUNCTION IS REQUIRED

   BAD:
   import * as Icons from "large-icon-library";

   GOOD:
   import { Search, Plus, Trash2 } from "icon-library";

   BAD:
   importing an entire utility package for one helper.

   GOOD:
   import only the required function.

8. REMOVE BARREL-IMPORT PROBLEMS
   Audit files such as:
   - index.ts
   - index.tsx
   - components/index.ts
   - services/index.ts
   - utils/index.ts

   Avoid this pattern for route-specific code:

   import { POSService, CRMService, ReportService, InventoryService }
   from "../services";

   because a barrel file may force Vite/Rollup to include unrelated modules.

   Prefer direct imports:

   import { POSService } from "../services/POSService";

   Route-specific code should depend only on the modules it actually needs.

9. SPLIT APPLICATION CHUNKS INTELLIGENTLY
   Configure Vite/Rollup so large independent domains become separate chunks.

   Suggested conceptual structure:

   vendor-react
   vendor-ui
   vendor-utils
   feature-pos
   feature-crm
   feature-reports
   feature-catalog
   feature-scanner
   feature-admin

   Do not create hundreds of tiny chunks.
   The goal is logical feature chunks, not chunk fragmentation.

10. KEEP POS AS THE PRIORITY INITIAL EXPERIENCE
    The POS page is a primary workflow.

    Initial POS load should contain only what is required for:
    - customer selection
    - medicine search
    - cart
    - pricing
    - stock display
    - discount
    - payment controls
    - necessary POS APIs
    - necessary POS UI components

    It should NOT download:
    - reports
    - CRM management
    - settings screens
    - investigation tools
    - website order administration
    - learning modules
    - unused analytics
    - unrelated admin tools

11. DO NOT BLOCK STARTUP WITH NON-CRITICAL WORK
    The current backend startup architecture is already doing many things correctly:
    - database ready early
    - core API unblocked quickly
    - background workers staged after startup
    - lazy routes
    - lazy prescription scanner
    - background automation separated from critical startup

    Preserve this principle.

    Startup sequence should always be:

    CORE APPLICATION
        ↓
    DATABASE/API READY
        ↓
    PRIMARY UI READY
        ↓
    USER INTERACTION AVAILABLE
        ↓
    BACKGROUND CACHE/WARMING
        ↓
    OPTIONAL WORKERS
        ↓
    HEAVY EXTERNAL SERVICES

    Never reverse this sequence.

12. FIX FORCED REFLOW
    Lighthouse also reports forced reflow.

    Audit code that:
    - reads offsetWidth / offsetHeight / offsetTop / offsetLeft
    - calls getBoundingClientRect()
    - reads computed styles
    - immediately writes styles/classes
    - immediately reads layout again

    Avoid:

    element.style.width = "...";
    const width = element.offsetWidth;

    Prefer batching DOM reads and DOM writes.

    Use:
    - requestAnimationFrame
    - CSS transforms
    - CSS containment where appropriate
    - ResizeObserver where appropriate
    - IntersectionObserver for visibility-driven work

    Avoid unnecessary layout measurements during render or repeated event handlers.

13. DO NOT PUT EXPENSIVE COMPUTATION INSIDE REACT RENDER
    Audit POS tables, search results, inventory lists and cart calculations.

    Avoid repeatedly doing expensive filtering/sorting/calculation directly during render.

    Use:
    - useMemo
    - useCallback where actually beneficial
    - memoized child components
    - virtualization for large lists

    Do not blindly add useMemo/useCallback everywhere.
    Optimize measured bottlenecks, not code aesthetics.

14. VIRTUALIZE LARGE DATASETS
    Medicine catalog, inventory, transaction history and other potentially large lists must not render thousands of DOM nodes simultaneously.

    Use list/table virtualization where the dataset can become large.

    Render only visible rows plus a small overscan region.

15. SEARCH MUST BE EFFICIENT
    POS medicine search must NOT scan or transform the entire catalog on every keystroke if the catalog is large.

    Use:
    - indexed server/API search where appropriate
    - debouncing where appropriate
    - normalized search fields
    - memoized local indexes
    - limited result windows

    Initial POS should not download the entire medicine database simply to perform search.

16. IMAGES MUST BE LAZY LOADED
    Product/medicine images should use:
    - lazy loading
    - responsive dimensions
    - optimized formats where possible
    - thumbnails for lists
    - full-size image only when necessary

    Do not load every catalog image during POS startup.

17. CSS
    Lighthouse reports unused CSS as well.

    Audit global CSS imports.

    Avoid importing massive CSS frameworks or feature CSS globally when only one route requires it.

    Keep global CSS limited to:
    - reset/base
    - tokens
    - layout primitives
    - truly global components

    Feature-specific styles should be loaded with the feature.

18. THIRD-PARTY LIBRARIES
    Audit all frontend dependencies.

    For every dependency ask:

    Is it needed on the first screen?

    If NO:
       lazy load it.

    If it is only used in one feature:
       keep it inside that feature.

    If it has a lightweight alternative:
       evaluate replacing it.

    Do NOT add another package for functionality already provided by an existing dependency.

19. DEVTOOLS/LIGHTHOUSE VALIDATION
    After changes, run a production build.

    DO NOT judge final bundle performance only with:
        npm run dev

    Use:
        npm run build
        npm run preview

    Then run Lighthouse against the production build.

    Compare BEFORE and AFTER:
    - Performance
    - JavaScript transferred
    - JavaScript executed
    - unused JavaScript
    - duplicated JavaScript
    - main-thread time
    - network payload
    - LCP
    - INP
    - CLS

20. DEFINE PERFORMANCE BUDGETS
    Establish project limits so the problem does not return.

    Suggested initial budgets:

    Initial JS:
        target < 400–500 KB compressed for normal POS startup

    Initial CSS:
        target < 100–150 KB compressed

    Initial page network:
        target < 1–2 MB for the normal POS shell, excluding user-triggered assets

    Route JS:
        feature-specific and loaded on demand

    Main-thread work:
        keep initial work as low as practical and investigate anything approaching multi-second execution

    These are engineering budgets, not absolute laws.
    Measure them against real pharmacy workflows and adjust only when there is evidence.

21. ADD BUNDLE ANALYSIS
    Add a repeatable bundle-analysis process.

    Use tools such as:
    - rollup-plugin-visualizer
    - source-map-explorer
    - Vite build analysis

    The project should make it easy to answer:

    "Why did the POS bundle become larger?"

    Every significant bundle increase must have an identifiable reason.

22. FUTURE DEVELOPMENT RULE: NO GLOBAL IMPORT FOR FEATURE-SPECIFIC CODE

    Before adding a new feature:

    IF feature is used on one page only:
        import it inside that page/feature.

    IF feature is heavy:
        lazy load it.

    IF feature is optional:
        defer it until user interaction.

    IF feature is shared:
        place it in a genuinely shared module.

    NEVER put every new service/component into the root application entry point.

23. FUTURE DEVELOPMENT RULE: NO "IMPORT EVERYTHING"
    Do not create a pattern where the main application imports every:
    - route
    - service
    - modal
    - report
    - scanner
    - admin panel
    - integration

    just because it is convenient.

    Convenience during development becomes a 20 MB bundle later.

24. FUTURE DEVELOPMENT RULE: KEEP DOMAIN BOUNDARIES
    Preferred structure:

    frontend/
      app/
        App.tsx
        router.tsx

      features/
        pos/
        crm/
        inventory/
        catalog/
        purchases/
        dispatch/
        reports/
        returns/
        investigation/
        scanner/

      shared/
        components/
        hooks/
        utils/
        types/

    A feature must not casually import unrelated feature internals.

25. FUTURE DEVELOPMENT RULE: SHARED CODE MUST ACTUALLY BE SHARED
    Move code into shared only when it is:
    - small
    - stable
    - genuinely reused
    - dependency-light

    Do not create a giant "shared" module containing half the application.

26. FUTURE DEVELOPMENT RULE: PERFORMANCE CHECK BEFORE MERGE
    Every feature PR/change must answer:

    1. Does this increase the initial POS bundle?
    2. Does this introduce a new dependency?
    3. Can the dependency be lazy loaded?
    4. Does this import through a barrel file?
    5. Does this add large assets?
    6. Does this add expensive render work?
    7. Does this add a new API call during initial startup?
    8. Does this render a large list?
    9. Does this introduce layout measurements?
    10. Does Lighthouse or bundle analysis show regression?

27. PERFORMANCE REGRESSION RULE
    BEFORE MERGE:

       npm run build

    Then inspect:

       dist/assets

    and bundle-analysis output.

    If a small feature causes a large unexplained increase in the main bundle,
    stop and investigate before merging.

28. KEEP BUSINESS LOGIC SEPARATE FROM UI BUNDLING
    APIs, database operations, background workers and business services should remain server-side whenever they do not need to run in the browser.

    Do not move backend-only packages into frontend code.

    Never import Node/browser-automation/server-only dependencies into the browser bundle.

29. VERIFY VITE CONFIGURATION
    Audit:
    - manualChunks
    - optimizeDeps
    - build target
    - sourcemap configuration for production
    - dependency deduplication
    - chunk naming
    - asset handling

    Do not blindly add manualChunks everywhere.
    First identify the actual dependency duplication and then configure chunking.

30. VERIFY PACKAGE DUPLICATION
    Run dependency inspection and identify multiple versions of the same package.

    Example:

        npm ls <package-name>

    Resolve unnecessary duplicate versions where safe.

31. DO NOT BREAK EXISTING WORKFLOWS
    Performance work must NOT remove or disable:
    - POS
    - medicine search
    - stock
    - cart
    - payment
    - Pharmarack integration
    - order fulfillment
    - WhatsApp
    - catalog synchronization
    - inventory
    - reports
    - CRM
    - scanner
    - scheduled jobs
    - authentication
    - permissions

    The objective is:
        SAME FUNCTIONALITY
        + SMALLER INITIAL LOAD
        + FASTER INTERACTION

32. REQUIRED IMPLEMENTATION ORDER

    PHASE 1
    Analyze:
    - frontend entry point
    - router
    - package.json
    - Vite config
    - barrel exports
    - route imports
    - duplicated dependencies

    PHASE 2
    Introduce route-level lazy loading.

    PHASE 3
    Move heavy libraries behind feature boundaries.

    PHASE 4
    Remove unnecessary barrel imports.

    PHASE 5
    Deduplicate dependencies.

    PHASE 6
    Optimize POS rendering/search/list behavior.

    PHASE 7
    Fix forced reflow/layout measurement issues.

    PHASE 8
    Optimize images/CSS.

    PHASE 9
    Build production bundle and analyze it.

    PHASE 10
    Run Lighthouse again and compare with the original baseline.

33. SUCCESS CRITERIA

    The fix is successful only when:

    - existing workflows still work
    - POS loads without unrelated feature bundles
    - initial JS is substantially smaller
    - duplicated JS is substantially reduced
    - unused JS is substantially reduced
    - main-thread work is reduced
    - total initial network payload is reduced
    - forced reflow warnings are reduced where caused by application code
    - no new functional regressions appear
    - production build is verified
    - Lighthouse is run again against production build

34. IMPORTANT DEVELOPMENT PRINCIPLE

    DO NOT OPTIMIZE BY HIDING THE LIGHTHOUSE WARNING.

    DO NOT:
    - disable Lighthouse audits
    - remove features
    - artificially delay the whole application
    - suppress warnings
    - add random caching
    - add random memoization
    - blindly add manualChunks
    - blindly install optimization packages

    FIX THE IMPORT GRAPH AND APPLICATION ARCHITECTURE.

35. FINAL ARCHITECTURE TARGET

    INITIAL LOAD:

        App Shell
          ↓
        Router
          ↓
        POS
          ↓
        POS-specific dependencies only

    USER OPENS CRM:

        CRM chunk loads

    USER OPENS REPORTS:

        Reports chunk loads

    USER OPENS SCANNER:

        Scanner dependencies load

    USER OPENS CATALOG:

        Catalog dependencies load

    USER OPENS SETTINGS:

        Settings chunk loads

    This means the browser should not download the entire AI PHARMACY application just to open POS.

FINAL RULE FOR ALL FUTURE DEVELOPMENT

    "BUILD FEATURES LOCALLY, LOAD THEM ON DEMAND, KEEP THE ENTRY POINT SMALL, KEEP DEPENDENCIES DEDUPLICATED, AND MEASURE THE PRODUCTION BUNDLE AFTER EVERY SIGNIFICANT FEATURE."

    Treat performance as an architectural requirement, not a cleanup task at the end of development.