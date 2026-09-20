# AI-PHARMACY-V3 — SINGLE IMPLEMENTATION PLAN
# Apply 20 UX Laws to the EXISTING application workflow
# WITHOUT rebuilding, duplicating, redesigning, or changing the existing frontend UI

============================================================
1. OBJECTIVE
============================================================

Improve the existing AI-PHARMACY-V3 user experience by applying the
20 UX principles shown in the supplied reference:

1. Hick's Law
2. Fitts's Law
3. Jakob's Law
4. Law of Proximity
5. Miller's Law
6. Doherty Threshold
7. Von Restorff Effect
8. Minimize Target Distance
9. Serial Position Effect
10. Peak-End Rule
11. Zeigarnik Effect
12. Law of Prägnanz
13. Law of Similarity
14. Law of Uniform Connectedness
15. Tesler's Law
16. Postel's Law
17. Postel's Law (duplicate in reference image; treat as the same
    principle and DO NOT implement it twice)
18. Parkinson's Law
19. Occam's Razor
20. Pareto Principle

IMPORTANT:

This is NOT a frontend redesign.

Do NOT:
- redesign screens
- replace components
- change the existing navigation structure
- introduce a new UI framework
- create a second state-management system
- create a second API-management system
- create duplicate business logic
- create duplicate workflows
- replace existing managers/services unnecessarily
- change existing page layout merely to demonstrate a UX law
- add animations just for visual effect
- add unnecessary API calls
- add polling
- add unnecessary background workers
- modify unrelated files

The objective is:

EXISTING WORKFLOW
        ↓
UNDERSTAND CURRENT BEHAVIOUR
        ↓
IDENTIFY UX FRICTION
        ↓
IMPROVE THE EXISTING LOGIC
        ↓
KEEP SAME UI / SAME ARCHITECTURE
        ↓
VERIFY OLD VS NEW BEHAVIOUR
        ↓
VERIFY NO REGRESSION


============================================================
2. EXISTING ARCHITECTURE IS THE SOURCE OF TRUTH
============================================================

AI-PHARMACY-V3 already contains an established architecture.

The agent MUST work with the existing architecture instead of creating
a parallel implementation.

Known architectural layers include:

- Presentation / existing React SPA
- API / existing Express routes
- Service / existing business logic
- Data / existing database and data layer
- Infrastructure / existing workers and supporting infrastructure
- Testing
- Documentation
- Scripts
- Configuration

The repository also already has:

- existing agent rules
- existing knowledge graph
- existing project audit
- existing performance guardrails
- existing SSE/cache-first performance architecture
- existing worker architecture
- existing application workflows

Therefore:

NEVER start from scratch.

NEVER create a new "UX architecture".

NEVER create a new generic UX manager if an existing service,
hook, utility, controller, route, state manager, or component already
owns that responsibility.

First locate the current owner of the behaviour.

Then modify that owner only if modification is actually required.


============================================================
3. MANDATORY DISCOVERY BEFORE CODING
============================================================

Before modifying anything, the agent MUST inspect the repository.

The agent must determine:

A. What currently performs the requested workflow?
B. Which existing page/component starts it?
C. Which existing state/store/hook manages it?
D. Which existing API route provides the data?
E. Which existing service contains the business logic?
F. Which existing database query supplies the data?
G. Which existing cache/SSE mechanism already refreshes it?
H. Which existing worker is responsible, if any?
I. Which existing tests cover it?
J. Which existing AGENTS.md rules apply to every target file?

The agent MUST follow the repository's existing AGENTS.md hierarchy.

The repository explicitly requires agents to read the applicable AGENTS.md
chain before editing and to identify every file they expect to touch.

Do that before writing code.


============================================================
4. STRICT FILE-SCOPE RULE
============================================================

THIS IS THE MOST IMPORTANT RULE.

The agent MUST NOT decide the files to modify based only on filenames.

It must trace the actual implementation.

Before coding, create an internal change map:

FEATURE / WORKFLOW
    ↓
CURRENT ENTRY POINT
    ↓
CURRENT STATE OWNER
    ↓
CURRENT DATA OWNER
    ↓
CURRENT API OWNER
    ↓
CURRENT BUSINESS LOGIC OWNER
    ↓
CURRENT TEST OWNER

Only those existing files that are directly responsible for the
behaviour may be modified.

DO NOT touch:

- unrelated frontend pages
- unrelated backend routes
- unrelated services
- unrelated workers
- unrelated database tables
- unrelated configuration
- package.json
- dependency versions
- build configuration
- authentication
- deployment
- navigation
- global styling

unless the existing implementation proves that the requested
behaviour genuinely requires one of those files.

If no existing file needs modification, DO NOT modify one merely
because it seems convenient.


============================================================
5. NEW FILE RULE
============================================================

Do NOT create a new file by default.

First determine whether the required logic already belongs in an
existing file.

Preferred order:

1. Reuse existing function
2. Extend existing function
3. Extend existing service/hook/utility
4. Extend existing test
5. Only then create a new file if the responsibility genuinely
   cannot belong to an existing file

If a new file is genuinely necessary:

- explain why an existing file cannot own the responsibility
- make the new file narrowly scoped
- do not duplicate existing functionality
- connect it to the existing workflow
- do not create a parallel workflow

No new framework.
No new manager.
No new global state system.
No duplicate API layer.


============================================================
6. FRONTEND UI FREEZE
============================================================

The existing frontend UI must remain visually and structurally unchanged.

DO NOT change:

- layout
- colors
- typography
- navigation design
- component hierarchy unless technically necessary
- buttons
- cards
- tables
- page structure
- existing labels
- existing visual design
- responsive design

The 20 UX principles should primarily be applied through:

- existing interaction logic
- existing state management
- existing loading behaviour
- existing error handling
- existing validation
- existing data ordering
- existing focus/selection behaviour
- existing navigation logic
- existing API timing
- existing caching
- existing workflow completion
- existing task persistence

If a UX law can only be implemented by changing the UI,
DO NOT automatically change the UI.

First determine whether the same principle can be achieved
through existing application behaviour.


============================================================
7. LAW-BY-LAW IMPLEMENTATION
============================================================


------------------------------------------------------------
1. HICK'S LAW
------------------------------------------------------------

Meaning:
The more choices a user has, the longer it generally takes to decide.

CURRENT BEHAVIOUR:
Use the existing application workflow and identify places where the
user is presented with unnecessary choices, duplicate actions,
unnecessary intermediate decisions, or multiple paths to perform
the same task.

EXPECTED BEHAVIOUR:

- preserve the existing workflow
- reduce unnecessary decision points in the existing logic
- automatically determine values when the application already has
  enough information
- avoid asking the user for information that can safely be derived
  from existing state/data
- keep existing primary workflow as the default path
- do not create additional choices merely to implement Hick's Law

Example:

If an existing workflow already knows:
medicine → batch → stock record

do not make the user choose the same information again.


------------------------------------------------------------
2. FITTS'S LAW
------------------------------------------------------------

Meaning:
Actions that are easier/closer to reach are faster to perform.

Because the frontend layout is frozen, apply this primarily to
interaction behaviour.

CURRENT BEHAVIOUR:
Identify workflows requiring repeated navigation or unnecessary
interaction steps.

EXPECTED BEHAVIOUR:

- preserve current UI
- reduce unnecessary navigation between related actions
- retain relevant state where the existing workflow already expects it
- avoid forcing users to repeatedly re-enter the same information
- keep keyboard/focus behaviour consistent where already supported

Do not redesign button sizes or positions unless explicitly requested.


------------------------------------------------------------
3. JAKOB'S LAW
------------------------------------------------------------

Meaning:
Users expect familiar patterns based on other applications.

CURRENT BEHAVIOUR:
Existing AI-PHARMACY workflows should continue using their established
interaction conventions.

EXPECTED BEHAVIOUR:

- do not introduce a new interaction pattern for an existing task
- reuse existing loading states
- reuse existing error handling
- reuse existing confirmation patterns
- reuse existing navigation behaviour
- reuse existing form behaviour

Example:

If the application already uses one standard save/update workflow,
another module should not invent a completely different save workflow.


------------------------------------------------------------
4. LAW OF PROXIMITY
------------------------------------------------------------

Meaning:
Related things are perceived as belonging together.

Since UI is frozen, apply this to data/state/logic relationships.

CURRENT BEHAVIOUR:
Identify cases where related information is fetched or managed
through disconnected logic.

EXPECTED BEHAVIOUR:

- keep related state updates together
- avoid unrelated refreshes
- ensure the result of one action updates the existing related state
- reuse existing central data source where available

Do not create another API just to obtain data already available
through the existing data flow.


------------------------------------------------------------
5. MILLER'S LAW
------------------------------------------------------------

Meaning:
Users have limited working memory.

CURRENT BEHAVIOUR:
Identify workflows where users must remember information that the
application already knows.

EXPECTED BEHAVIOUR:

- preserve existing context
- reuse existing selected medicine/customer/batch/etc. state
- avoid unnecessary re-entry
- avoid forcing users to remember intermediate information
- retain context through existing workflow transitions

Do not add a new persistent store merely for this purpose.


------------------------------------------------------------
6. DOHERTY THRESHOLD
------------------------------------------------------------

Meaning:
Fast system feedback improves user productivity.

CURRENT BEHAVIOUR:
AI-PHARMACY already has performance-oriented architecture including
cache-first behaviour and event-driven refresh mechanisms.

EXPECTED BEHAVIOUR:

- use existing cache before making network/database requests
- use existing SSE/event updates where applicable
- avoid duplicate requests
- do not introduce polling
- do not add eager refetches
- show existing loading state immediately where appropriate
- update only affected data
- avoid blocking unrelated application functionality

IMPORTANT:

Performance improvements must use the existing performance architecture.

Do not create another cache manager.


------------------------------------------------------------
7. VON RESTORFF EFFECT
------------------------------------------------------------

Meaning:
Distinct items attract attention more easily.

Because UI is frozen:

CURRENT BEHAVIOUR:
Existing important states may already have visual treatment.

EXPECTED BEHAVIOUR:

Do not redesign visual elements.

Instead ensure existing state classification remains correct:

- error
- warning
- success
- pending
- completed
- unavailable
- actionable

The application logic must correctly classify these states so the
existing UI can represent them correctly.

Do not add new colors or visual components.


------------------------------------------------------------
8. MINIMIZE TARGET DISTANCE
------------------------------------------------------------

Meaning:
Reduce unnecessary physical/interaction distance between an action
and its required context.

CURRENT BEHAVIOUR:
Identify workflows where the user leaves the current context only
because backend/state handling is inefficient.

EXPECTED BEHAVIOUR:

- preserve current page/context
- avoid unnecessary page reloads
- avoid unnecessary route transitions
- update the current existing state where appropriate
- return users to the same existing context after an operation

Do not create duplicate pages.


------------------------------------------------------------
9. SERIAL POSITION EFFECT
------------------------------------------------------------

Meaning:
People tend to remember the beginning and end of a sequence better.

CURRENT BEHAVIOUR:
Identify multi-step existing workflows.

EXPECTED BEHAVIOUR:

- preserve logical existing workflow order
- make the first required step unambiguous
- ensure the final completion state is reliable
- do not insert unnecessary steps
- ensure the final action actually commits the intended operation

Example:

Search
→ select
→ modify
→ save

The existing flow should remain this flow.

Do not create:

Search
→ intermediate manager
→ second search
→ duplicate selection
→ save.


------------------------------------------------------------
10. PEAK-END RULE
------------------------------------------------------------

Meaning:
Users remember important moments and especially how an interaction
ends.

CURRENT BEHAVIOUR:
Identify important operations such as:

- save
- sale
- purchase
- return
- import
- export
- add-to-cart
- bill creation
- settings changes

EXPECTED BEHAVIOUR:

The existing operation must end with a reliable final state.

Examples:

Successful save:
existing data state must immediately reflect the saved result.

Failed save:
existing state must not falsely appear successful.

Partial failure:
do not silently report success.

Do not create a new notification system.
Use the existing one.


------------------------------------------------------------
11. ZEIGARNIK EFFECT
------------------------------------------------------------

Meaning:
Incomplete tasks tend to remain mentally active.

CURRENT BEHAVIOUR:
Identify existing multi-step tasks that can become incomplete.

EXPECTED BEHAVIOUR:

- preserve existing draft/intermediate state where the application
  already supports it
- do not lose important user-entered information because of an
  unrelated refresh
- clearly preserve task continuity using existing state mechanisms
- avoid forcing users to restart unnecessarily

Do not introduce a new draft system unless the existing architecture
cannot support the requirement.


------------------------------------------------------------
12. LAW OF PRÄGNANZ
------------------------------------------------------------

Meaning:
People tend to perceive the simplest understandable structure.

CURRENT BEHAVIOUR:
Identify unnecessary complexity in application logic.

EXPECTED BEHAVIOUR:

- simplify control flow where safe
- remove duplicate branches
- reuse existing functions
- remove redundant requests
- avoid multiple representations of the same state
- preserve the existing architecture

Do not perform a large refactor simply because code can be made
"cleaner".

Only change code directly related to the workflow.


------------------------------------------------------------
13. LAW OF SIMILARITY
------------------------------------------------------------

Meaning:
Similar things are perceived as belonging together.

CURRENT BEHAVIOUR:
Different modules may implement similar operations differently.

EXPECTED BEHAVIOUR:

When modifying an existing workflow:

- follow the existing implementation pattern
- reuse existing helper functions
- use the same validation approach
- use the same error-handling pattern
- use the same API response interpretation
- use the same state-update pattern

Do not create another implementation style.


------------------------------------------------------------
14. LAW OF UNIFORM CONNECTEDNESS
------------------------------------------------------------

Meaning:
Things visually/structurally connected are perceived as related.

For this implementation, apply it to application state and workflow
connections rather than redesigning the UI.

CURRENT BEHAVIOUR:
Identify operations where the backend changes but the related frontend
state does not update correctly.

EXPECTED BEHAVIOUR:

Operation
    ↓
existing API/service
    ↓
existing data source
    ↓
existing cache/state
    ↓
existing UI

The chain must remain connected.

No duplicate state source.


------------------------------------------------------------
15. TESLER'S LAW
------------------------------------------------------------

Meaning:
Every system has inherent complexity; it must exist somewhere.

CURRENT BEHAVIOUR:
Identify complexity currently being unnecessarily pushed onto the user.

EXPECTED BEHAVIOUR:

Move complexity into existing application logic where it can safely
be automated.

Example:

Instead of requiring repeated user selection when the application
already has enough information, use existing business logic.

IMPORTANT:

Do not hide business-critical decisions.

Do not automatically make decisions where existing pharmacy rules
require explicit user confirmation.


------------------------------------------------------------
16. POSTEL'S LAW
------------------------------------------------------------

Meaning:
Be conservative in what you send and tolerant in what you receive.

CURRENT BEHAVIOUR:
Identify existing API/form/data boundaries.

EXPECTED BEHAVIOUR:

INPUT:
- tolerate harmless formatting differences
- normalize where existing architecture permits
- validate before processing
- do not accept invalid business data silently

OUTPUT:
- preserve existing API contracts
- do not unexpectedly change response structures
- do not break existing consumers

Do not create a second validation system.


------------------------------------------------------------
17. POSTEL'S LAW DUPLICATE
------------------------------------------------------------

The supplied image lists Postel's Law twice.

DO NOT implement it twice.

Use ONE centralized implementation of the Postel principle in the
existing validation/API/data boundary.

No duplicate utility.
No duplicate middleware.
No duplicate normalization pipeline.


------------------------------------------------------------
18. PARKINSON'S LAW
------------------------------------------------------------

Meaning:
Work tends to expand to fill the time available.

CURRENT BEHAVIOUR:
Identify workflows with unnecessary waiting, repeated processing,
unnecessary background work, or excessive intermediate operations.

EXPECTED BEHAVIOUR:

- process only required data
- avoid full-table/full-catalog work when a targeted query is enough
- avoid unnecessary repeated API calls
- avoid unnecessary worker execution
- avoid unnecessary refreshes
- complete operations using the smallest required processing scope

This is particularly important for the low-spec local pharmacy PC.

Do not trade CPU/RAM efficiency for architectural complexity.


------------------------------------------------------------
19. OCCAM'S RAZOR
------------------------------------------------------------

Meaning:
Prefer the simplest explanation/implementation that sufficiently
solves the problem.

CURRENT BEHAVIOUR:
Identify existing duplicate solutions.

EXPECTED BEHAVIOUR:

Prefer:

existing service
over
new service

existing cache
over
new cache

existing state
over
new state

existing API
over
new API

existing worker
over
new worker

existing component
over
new component

Only create something new when the current architecture genuinely
cannot support the requirement.


------------------------------------------------------------
20. PARETO PRINCIPLE
------------------------------------------------------------

Meaning:
A relatively small number of causes often account for a large
portion of the result.

CURRENT BEHAVIOUR:
Do not attempt to modify every part of the application.

EXPECTED BEHAVIOUR:

Identify the highest-impact UX problems first.

Prioritize:

1. POS workflow
2. medicine search
3. add-to-cart
4. billing/save workflow
5. inventory operations
6. purchase/inventory relationship
7. reports
8. settings/data refresh behaviour
9. customer/patient workflow
10. other frequently used workflows

Only modify the workflows where the UX issue is actually present.

Do not touch low-impact files merely to claim that all 20 laws
were implemented.


============================================================
8. EXISTING DATA / API / PERFORMANCE ARCHITECTURE
============================================================

The implementation MUST preserve the application's existing
data-driven architecture.

Do not introduce:

- duplicate API calls
- duplicate database reads
- duplicate state
- duplicate caches
- unnecessary polling
- unnecessary workers
- unnecessary timers
- unnecessary SSE connections
- unnecessary background processing

The existing repository performance rules specifically protect:

- SSE event-driven refresh
- cache-first pages
- gated workers
- session persistence
- one global SSE connection
- mark-stale-only behaviour instead of eager refetch storms

These mechanisms must remain the source of truth.

The agent must improve behaviour by using these mechanisms,
not by replacing them.


============================================================
9. CURRENT BEHAVIOUR VS EXPECTED BEHAVIOUR
============================================================

For EVERY modified workflow, the agent MUST document:

------------------------------------------------------------
CURRENT BEHAVIOUR
------------------------------------------------------------

Describe exactly:

- current entry point
- current user action
- current state changes
- current API calls
- current database/service calls
- current refresh behaviour
- current loading behaviour
- current success behaviour
- current error behaviour
- current completion behaviour

------------------------------------------------------------
EXPECTED BEHAVIOUR
------------------------------------------------------------

Describe:

- what remains unchanged
- what specific behaviour changes
- why it changes
- which existing function/service owns the change
- which API/data flow remains unchanged
- what unnecessary work is removed
- what state must remain synchronized

No vague statement such as:

"Improve UX."

It must say exactly what changes.


============================================================
10. FILE-SCOPE TABLE REQUIRED BEFORE CODING
============================================================

Before editing, the agent MUST produce an internal table:

| Workflow | Existing Owner | Existing File | Why Modify | Change |
|----------|----------------|---------------|------------|--------|
| Example  | existing hook/service | exact/path.ts | direct owner | targeted change |

Only files in this table may be modified.

If another file becomes necessary during implementation:

STOP.

Explain why it is necessary.

Verify that it is genuinely part of the same workflow.

Then add it to the scope.

Do NOT silently expand scope.


============================================================
11. DO NOT CREATE DUPLICATE WORKFLOW
============================================================

The most important architectural requirement:

If the application already has:

Search → API → service → DB → state → UI

DO NOT create:

Search → new UX service → new API → new DB query → new state → UI

Instead modify the existing path:

Search → EXISTING API → EXISTING SERVICE → EXISTING DB → EXISTING STATE → UI

The same principle applies to:

- POS
- inventory
- purchase
- sales
- reports
- settings
- customer history
- cart
- Pharmarack
- workers
- imports
- exports
- authentication
- notifications


============================================================
12. NO FRONTEND REDESIGN
============================================================

The UI must look and function as the existing application expects.

The implementation may improve:

- response timing
- state consistency
- error correctness
- workflow continuity
- data ordering
- automatic reuse of existing context
- API efficiency
- loading behaviour
- completion reliability

But it must NOT redesign the frontend.

If a requested UX improvement cannot be achieved without UI changes,
leave the UI unchanged and document the limitation rather than
inventing an unrelated visual change.


============================================================
13. TESTING REQUIREMENTS
============================================================

After implementation, verify every changed workflow.

Minimum checks:

A. TypeScript compilation
B. Existing relevant unit tests
C. Existing relevant integration tests
D. Existing relevant frontend tests
E. Existing API tests
F. Browser/manual workflow test where applicable
G. Performance guardrails
H. Knowledge graph update

The repository's required commands include:

node scripts/quick-update.mjs

npm run guardrails

Both must be respected after code changes.

If the relevant existing test suite is available, run it.

Do not create broad new test infrastructure.


============================================================
14. OLD VS NEW CROSS-CHECK
============================================================

AFTER CODE COMPLETION, THE AGENT MUST PERFORM A DIRECT
OLD-BEHAVIOUR VS NEW-BEHAVIOUR CROSS-CHECK.

Use this format:

| Area | Old Behaviour | New Behaviour | Intended? | Regression? |
|------|---------------|---------------|-----------|-------------|
| Entry | ... | ... | YES/NO | YES/NO |
| Data | ... | ... | YES/NO | YES/NO |
| API | ... | ... | YES/NO | YES/NO |
| State | ... | ... | YES/NO | YES/NO |
| Loading | ... | ... | YES/NO | YES/NO |
| Error | ... | ... | YES/NO | YES/NO |
| Completion | ... | ... | YES/NO | YES/NO |
| Performance | ... | ... | YES/NO | YES/NO |
| UI | unchanged | unchanged | YES/NO | YES/NO |

The agent must verify that only the intended behaviour changed.


============================================================
15. FILE-BY-FILE CROSS-CHECK
============================================================

After implementation, inspect every modified file.

For EACH modified file answer:

1. Why was this file modified?
2. Which existing workflow owns it?
3. Which existing function/class/hook/service was changed?
4. Was duplicate functionality created?
5. Was an unrelated function changed?
6. Did the API contract change?
7. Did database behaviour change?
8. Did UI structure change?
9. Did performance characteristics change?
10. Can the change be removed without affecting the requested UX
    improvement?

If a file cannot answer these questions clearly,
revert the unnecessary modification.


============================================================
16. IMPORT / DEPENDENCY CROSS-CHECK
============================================================

For every modified file:

- inspect imports
- inspect exports
- inspect callers
- inspect consumers
- verify no circular dependency was introduced
- verify no duplicate helper was created
- verify existing service ownership remains intact

Do not add a dependency/package for these UX principles.


============================================================
17. PERFORMANCE CROSS-CHECK
============================================================

Before vs after compare:

- API request count
- database query count where measurable
- duplicate requests
- unnecessary refreshes
- worker activity
- timers
- SSE connections
- memory-heavy processing
- CPU-heavy processing
- page transition behaviour
- initial load behaviour

Expected result:

UX improvements must NOT cause a measurable unnecessary increase
in CPU/RAM/API/database activity.

For the local pharmacy environment:

LOW CPU
LOW RAM
LOW API CALLS
LOW DATABASE WORK
FAST RESPONSE
SAME ARCHITECTURE


============================================================
18. DATABASE SAFETY
============================================================

Unless absolutely required by the existing workflow:

DO NOT:

- create new tables
- migrate existing tables
- duplicate records
- create a second source of truth
- modify production/local application data
- alter historical billing records
- alter existing business records

If a database modification becomes necessary:

STOP and document:

- why
- exact table
- exact field
- migration requirement
- backward compatibility
- rollback strategy

Do not make a database change simply to make implementation easier.


============================================================
19. API SAFETY
============================================================

Preserve existing API contracts.

Do not:

- create duplicate endpoint
- rename endpoint
- change response shape unnecessarily
- change request shape unnecessarily
- create a parallel API
- add polling endpoint
- add an endpoint for data already available from an existing endpoint

If existing endpoint can support the requirement, extend its existing
logic carefully.


============================================================
20. WORKER SAFETY
============================================================

Do not modify workers unless the workflow being changed genuinely
belongs to that worker.

Never create a second worker for an existing responsibility.

Do not introduce:

- new polling loops
- uncontrolled setInterval
- autonomous messaging
- duplicate synchronization workers
- duplicate data processors

Existing worker supervision, heartbeat, restart and crash protection
must remain intact.


============================================================
21. NO UNRELATED CLEANUP
============================================================

While working on this feature, DO NOT:

- refactor unrelated files
- rename unrelated functions
- format unrelated code
- update dependencies
- reorganize folders
- redesign components
- clean old code outside scope
- fix unrelated bugs
- change unrelated API endpoints
- modify unrelated database queries

Even if the agent notices something that "could be improved",
leave it untouched.

Create a separate issue/task if necessary.


============================================================
22. ACCEPTANCE CRITERIA
============================================================

The task is complete ONLY if:

[ ] Existing workflow was identified before coding
[ ] Existing architecture was reused
[ ] Existing UI was preserved
[ ] Existing state management was reused
[ ] Existing API was reused where possible
[ ] Existing service was reused where possible
[ ] No duplicate workflow was created
[ ] No duplicate manager was created
[ ] No unnecessary API was created
[ ] No unnecessary polling was created
[ ] No unnecessary worker was created
[ ] No unnecessary dependency was added
[ ] Only directly related files were modified
[ ] Any new file has a documented architectural reason
[ ] All 20 UX principles were evaluated
[ ] Duplicate Postel's Law entry was implemented only once
[ ] Current vs expected behaviour was documented
[ ] Old vs new behaviour was cross-checked
[ ] Every modified file was reviewed
[ ] Existing relevant tests pass
[ ] TypeScript/build validation passes
[ ] npm run guardrails passes
[ ] node scripts/quick-update.mjs completed
[ ] No unrelated UI change occurred
[ ] No unrelated workflow changed
[ ] No duplicate source of truth was introduced


============================================================
23. REQUIRED FINAL REPORT FROM THE CODING AGENT
============================================================

After completing the implementation, return ONLY a concise technical
completion report containing:

### 1. Files Modified

List ONLY the exact files changed.

### 2. Files Created

If none:
"None — existing architecture was sufficient."

If any:
list each file and explain why it was unavoidable.

### 3. Existing Workflow Reused

Explain which existing workflow was extended rather than recreated.

### 4. UX Laws Applied

| UX Law | Existing Area | How Applied |
|--------|---------------|-------------|
| Hick | ... | ... |
| Fitts | ... | ... |
| Jakob | ... | ... |
| Proximity | ... | ... |
| Miller | ... | ... |
| Doherty | ... | ... |
| Von Restorff | ... | ... |
| Target Distance | ... | ... |
| Serial Position | ... | ... |
| Peak-End | ... | ... |
| Zeigarnik | ... | ... |
| Prägnanz | ... | ... |
| Similarity | ... | ... |
| Uniform Connectedness | ... | ... |
| Tesler | ... | ... |
| Postel | ... | ... |
| Postel duplicate | SAME IMPLEMENTATION — no duplicate code |
| Parkinson | ... | ... |
| Occam | ... | ... |
| Pareto | ... | ... |

### 5. Old vs New Behaviour

Show the before/after comparison.

### 6. UI Verification

Explicitly state:

"Frontend UI structure/design was not changed."

OR, if a UI change was genuinely unavoidable, list the exact reason
and exact file.

### 7. Performance Verification

Report:

- API calls
- unnecessary refetches
- database work
- worker activity
- timers
- SSE behaviour
- CPU/RAM concerns

### 8. Validation

Report:

- TypeScript/build
- tests
- guardrails
- knowledge graph update
- browser/manual verification

### 9. Scope Verification

Final statement:

"Only files directly belonging to the requested workflow were
modified. No duplicate workflow, manager, API, state system, or
unrelated implementation was introduced."


============================================================
FINAL PRINCIPLE
============================================================

DO NOT IMPLEMENT THE 20 UX LAWS AS 20 NEW FEATURES.

They are PRINCIPLES used to improve the EXISTING APPLICATION.

The correct architecture is:

                 EXISTING AI-PHARMACY-V3
                          │
                          ▼
                 Existing workflow
                          │
                          ▼
               Identify UX friction
                          │
                          ▼
              Apply relevant UX principle
                          │
                          ▼
               Modify existing owner
                          │
                          ▼
                Existing data flow
                          │
                          ▼
                 Existing frontend UI
                          │
                          ▼
               Existing user workflow


NOT:

20 UX laws
   ↓
20 new features
   ↓
20 new components
   ↓
20 new services
   ↓
20 new APIs
   ↓
duplicate application architecture

The agent must ALWAYS extend the existing implementation instead of
creating a second implementation style.

The goal is:

SAME APPLICATION
+ SAME WORKFLOW
+ SAME UI
+ SAME ARCHITECTURE
+ LESS FRICTION
+ LESS UNNECESSARY WORK
+ BETTER RESPONSE
+ BETTER STATE CONSISTENCY
+ BETTER TASK COMPLETION
= UX IMPROVEMENT WITHOUT ARCHITECTURAL DUPLICATION