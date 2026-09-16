============================================================
AI PHARMACY V3
SINGLE IMPLEMENTATION PLAN
PERMANENT VERCEL PRODUCTION DEPLOYMENT FIX
============================================================

PRIMARY OBJECTIVE
============================================================

Permanently fix the Vercel production deployment failure:

"Error: No Output Directory named 'public' found after the
Build completed."

The existing application must NOT be rebuilt from scratch.

The existing application structure, frontend, backend, Vite
configuration, npm scripts, business logic, UI, routes,
database workflow, installer workflow, release workflow, and
desktop application workflow must remain unchanged.

ONLY fix the deployment/build configuration that is responsible
for the Vercel website deployment.

============================================================
1. VERIFIED EXISTING ARCHITECTURE
============================================================

The repository already has two separate parts:

ROOT APPLICATION
    /
    ├── src/
    ├── scripts/
    ├── packaging/
    ├── package.json
    └── tsconfig.json

WEB FRONTEND
    /frontend/
    ├── src/
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── tsconfig.app.json

This architecture already exists.

DO NOT create another frontend.

DO NOT move frontend files.

DO NOT create a second Vite project.

DO NOT create a public/ frontend copy.

DO NOT duplicate the application.

DO NOT change the current application structure.

============================================================
2. EXISTING FRONTEND BUILD WORKFLOW
============================================================

The frontend already has:

frontend/package.json

Existing behavior:

npm run build --prefix frontend

    ↓

frontend/package.json

    ↓

tsc -b

    ↓

vite build

    ↓

frontend/dist/

This is the EXISTING and CORRECT frontend production build.

Reuse it.

Do NOT create another frontend build command if the existing
command already provides the required result.

============================================================
3. EXISTING ROOT BUILD WORKFLOW
============================================================

The root package.json currently contains:

"build": "tsc -p tsconfig.json"

This is the ROOT/BACKEND TypeScript build.

It is NOT the Vite website build.

Existing flow:

npm run build

    ↓

tsc -p tsconfig.json

    ↓

dist/

The root tsconfig.json also excludes:

frontend/**/*

Therefore the root build intentionally does not compile the
frontend.

DO NOT change the root application build simply to satisfy Vercel.

DO NOT combine the backend and frontend into a new build system.

DO NOT change the existing desktop application build workflow.

============================================================
4. CURRENT VERCEL FAILURE
============================================================

CURRENT BEHAVIOR:

Vercel runs:

npm run build

    ↓

root package.json

    ↓

tsc -p tsconfig.json

    ↓

backend compilation completes

    ↓

frontend/dist is NOT generated

    ↓

Vercel expects:

public/

    ↓

public/ does not exist

    ↓

PRODUCTION DEPLOYMENT FAILS

Error:

"No Output Directory named 'public' found after the Build
completed."

The npm deprecated-package warnings are NOT the direct cause
of this failure.

Do not modify unrelated dependencies as part of this task.

============================================================
5. EXPECTED VERCEL BEHAVIOR
============================================================

EXPECTED:

Vercel must deploy the EXISTING frontend.

The deployment flow must become:

Vercel
    ↓
frontend project context
    ↓
existing frontend/package.json
    ↓
existing npm run build
    ↓
existing TypeScript build
    ↓
existing Vite build
    ↓
frontend/dist/
    ↓
Vercel deployment
    ↓
Production website

The existing frontend source code remains unchanged.

The existing frontend UI remains unchanged.

The existing routes remain unchanged.

The existing components remain unchanged.

The existing CSS/Tailwind implementation remains unchanged.

============================================================
6. PREFERRED IMPLEMENTATION
============================================================

Use the EXISTING frontend directory as the Vercel deployment
root.

Configure the Vercel project:

Root Directory:
    frontend

Build Command:
    npm run build

Output Directory:
    dist

Install Command:
    npm install

Framework:
    Vite

IMPORTANT:

Because the Vercel Root Directory becomes:

frontend/

the Output Directory must be:

dist

NOT:

frontend/dist

This prevents path duplication.

Vercel internally resolves:

frontend/
    ↓
npm run build
    ↓
dist/

============================================================
7. REPOSITORY-CONTROLLED CONFIGURATION
============================================================

Before creating any new repository configuration file:

CHECK whether a Vercel configuration already exists.

Search only for:

vercel.json

If an existing vercel.json exists:

    INSPECT IT FIRST.

If it already controls deployment:

    MODIFY ONLY the deployment properties required for this
    frontend build.

Do NOT replace unrelated Vercel configuration.

If no vercel.json exists and repository-controlled deployment
configuration is required, create ONLY:

vercel.json

The file must describe the EXISTING frontend build.

Do NOT create another deployment architecture.

Preferred repository-controlled equivalent:

{
  "buildCommand": "npm run build --prefix frontend",
  "outputDirectory": "frontend/dist"
}

Use this approach ONLY if the project requires deployment
configuration to live inside the repository.

Do not simultaneously configure two competing deployment
architectures.

============================================================
8. IMPORTANT: DO NOT USE PUBLIC DIRECTORY AS A FIX
============================================================

DO NOT create:

public/

only to satisfy the current Vercel error.

DO NOT copy:

frontend/dist

into:

public/

DO NOT create duplicate index.html files.

DO NOT create duplicate assets.

DO NOT change frontend source paths.

The existing Vite output is:

frontend/dist/

That output must be used directly.

============================================================
9. FILE SCOPE CONTROL
============================================================

ABSOLUTE FILE MODIFICATION RULE:

ONLY modify files directly responsible for Vercel deployment.

Potential files:

1. Vercel Project Settings
   OR

2. vercel.json
   ONLY if repository-controlled configuration is required.

3. CI/deployment validation file
   ONLY if an existing deployment validation mechanism exists
   and a minimal change is required.

DO NOT modify:

src/**
frontend/src/**
frontend/index.html
frontend/vite.config.ts
frontend/tsconfig*.json
package.json

unless inspection proves that the existing deployment cannot
work without changing that exact file.

DEFAULT RULE:

FRONTEND SOURCE = UNCHANGED

BACKEND SOURCE = UNCHANGED

BUSINESS LOGIC = UNCHANGED

DATABASE = UNCHANGED

DESKTOP APP = UNCHANGED

INSTALLER = UNCHANGED

AUTO UPDATE = UNCHANGED

RELEASE PIPELINE = UNCHANGED

UI = UNCHANGED

============================================================
10. DO NOT DUPLICATE BUILD WORKFLOW
============================================================

The repository already contains:

build
build:client
build:all
build:all:clean

Do NOT create:

build:web
build:vercel
build:production-web
build:frontend-production

unless repository inspection proves an existing script cannot
be reused.

Prefer the existing:

npm run build --prefix frontend

because it already invokes the frontend's existing build.

The objective is configuration correction, not creation of a
second build system.

============================================================
11. DO NOT CHANGE VITE CONFIGURATION
============================================================

Inspect:

frontend/vite.config.ts

The existing Vite configuration already defines the frontend
build system and optimization behavior.

Do NOT modify:

manualChunks
plugins
aliases
development server
proxy
HMR
React configuration
existing optimization settings

unless the deployment test proves a deployment-specific defect
inside this file.

The Vercel problem is the build/output selection, not the
frontend Vite architecture.

============================================================
12. DO NOT CHANGE FRONTEND UI
============================================================

ABSOLUTE REQUIREMENT:

NO FRONTEND UI CHANGE.

Do not modify:

- pages
- components
- layout
- navigation
- buttons
- forms
- tables
- dashboards
- CSS
- Tailwind classes
- colors
- typography
- spacing
- icons
- modals
- responsive behavior
- application routes
- UI workflows

The website must look and behave exactly as before.

Only the deployment mechanism changes.

============================================================
13. BUILD VALIDATION
============================================================

After implementation, perform this validation:

STEP 1

Run the existing frontend build:

npm run build --prefix frontend

EXPECTED:

Build completes successfully.

STEP 2

Verify:

frontend/dist/

exists.

STEP 3

Verify:

frontend/dist/index.html

exists.

STEP 4

Verify generated assets exist under:

frontend/dist/assets/

STEP 5

Verify the build did NOT require:

public/

STEP 6

Verify root backend build remains independently valid:

npm run build

STEP 7

Verify no frontend source files were modified.

============================================================
14. VERCEL VALIDATION
============================================================

Perform a production-equivalent deployment test.

Expected Vercel process:

Install dependencies
    ↓
frontend build
    ↓
Vite build
    ↓
frontend/dist
    ↓
deployment

The build must NOT show:

"No Output Directory named 'public' found"

The deployment must successfully produce the website.

============================================================
15. PRODUCTION SAFETY CHECK
============================================================

After deployment:

CHECK:

1. Website loads.

2. Existing login/authentication behavior remains unchanged.

3. Existing frontend routing works.

4. Direct navigation to existing routes works according to
   the current application architecture.

5. Static assets load.

6. favicon loads.

7. manifest loads.

8. Existing API requests behave according to the existing
   deployment architecture.

IMPORTANT:

Do not redesign or rewrite API communication as part of this
deployment fix.

If an API issue is discovered separately, report it separately.
Do not expand the scope of this task.

============================================================
16. PREVENTION OF FUTURE DEPLOYMENT FAILURE
============================================================

The permanent solution must prevent Vercel from falling back to
the incorrect:

public/

output expectation.

Deployment configuration must have ONE clearly defined source
of truth.

The project must have:

SOURCE:
    frontend/

BUILD:
    existing frontend build

OUTPUT:
    frontend/dist
    OR dist when frontend is the Vercel Root Directory

Never:

public/

unless the project architecture is intentionally changed in a
future separate task.

============================================================
17. CHANGE DETECTION / SCOPE GUARD
============================================================

Before editing:

Record the current Git working tree.

After editing:

Check Git diff.

The agent must verify that changes are limited to deployment
configuration.

If any unrelated file is modified:

    STOP

Review the change.

Revert the unrelated modification.

Do not continue until only intended deployment files remain.

The agent must NOT automatically format or rewrite unrelated
files.

The agent must NOT update dependencies.

The agent must NOT update deprecated packages.

The agent must NOT update Vite.

The agent must NOT update React.

The agent must NOT update TypeScript.

Those are separate maintenance tasks.

============================================================
18. CURRENT WORKFLOW MUST REMAIN THE SOURCE OF TRUTH
============================================================

DO NOT START FROM SCRATCH.

Existing:

frontend/
    ↓
frontend/package.json
    ↓
existing build script
    ↓
Vite
    ↓
frontend/dist

KEEP THIS.

Only connect Vercel to this existing workflow.

Do not create:

Vercel-specific frontend
Vercel-specific React app
second build system
second output directory
second package.json
second application entry point

============================================================
19. FINAL ACCEPTANCE CRITERIA
============================================================

The implementation is COMPLETE only when ALL conditions below
are true:

[ ] Vercel recognizes the existing frontend.

[ ] Existing frontend build command is used.

[ ] Vite successfully generates the production build.

[ ] frontend/dist is generated.

[ ] Vercel deploys the generated frontend.

[ ] Vercel no longer expects public/.

[ ] Production deployment succeeds.

[ ] Existing frontend UI is unchanged.

[ ] Existing frontend source files are unchanged.

[ ] Existing backend workflow is unchanged.

[ ] Existing desktop application workflow is unchanged.

[ ] Existing installer workflow is unchanged.

[ ] Existing auto-update workflow is unchanged.

[ ] Existing release workflow is unchanged.

[ ] Existing database workflow is unchanged.

[ ] No duplicate build system is introduced.

[ ] No duplicate frontend is introduced.

[ ] No duplicate deployment workflow is introduced.

[ ] No unrelated dependency upgrades are introduced.

[ ] Git diff contains ONLY intended deployment changes.

============================================================
20. REQUIRED POST-IMPLEMENTATION CROSS-CHECK
============================================================

After completing the code/configuration change, the agent MUST
perform a direct OLD vs NEW comparison.

OLD BEHAVIOR:

Vercel
    ↓
npm run build
    ↓
root TypeScript build
    ↓
frontend not built
    ↓
Vercel searches for public/
    ↓
DEPLOYMENT FAILURE

NEW BEHAVIOR:

Vercel
    ↓
existing frontend deployment context
    ↓
existing frontend npm build
    ↓
existing TypeScript frontend build
    ↓
existing Vite build
    ↓
frontend/dist
    ↓
Vercel deployment
    ↓
SUCCESS

The agent must verify that ONLY the connection between Vercel
and the existing frontend build has changed.

============================================================
21. FINAL FILE-LEVEL CROSS-CHECK
============================================================

Before declaring completion, inspect Git diff and classify every
modified file:

FILE
    ↓
Why was it modified?
    ↓
Is it directly responsible for Vercel deployment?
    ↓
Does it change existing application behavior?
    ↓
Does it change frontend UI?
    ↓
Does it duplicate an existing workflow?

Only files satisfying:

"Directly required for Vercel deployment"

are allowed to remain modified.

Anything else must be reverted.

============================================================
22. DO NOT EXPAND SCOPE
============================================================

This task is ONLY:

PERMANENT VERCEL FRONTEND DEPLOYMENT CONFIGURATION FIX.

It is NOT:

- dependency cleanup
- security upgrade
- performance optimization
- UI redesign
- API redesign
- database migration
- installer repair
- auto-update repair
- release-system redesign
- authentication change
- routing redesign
- frontend refactor

Those tasks must remain separate.

============================================================
FINAL OUTCOME
============================================================

The existing AI PHARMACY V3 application remains exactly the same.

The existing frontend remains exactly the same.

The existing build architecture remains exactly the same.

The existing Vite workflow remains exactly the same.

Only Vercel is corrected to consume the EXISTING frontend
production output instead of incorrectly searching for public/.

FINAL ARCHITECTURE:

                    EXISTING PROJECT
                         │
             ┌───────────┴───────────┐
             │                       │
          Backend                 Frontend
             │                       │
          src/**                 frontend/**
             │                       │
       existing build          existing build
             │                       │
          dist/**              Vite → dist/**
                                     │
                                     ▼
                                  Vercel
                                     │
                                     ▼
                               PRODUCTION WEB

NO SECOND WORKFLOW.
NO SECOND FRONTEND.
NO UI CHANGE.
NO BUSINESS-LOGIC CHANGE.
NO REBUILD FROM SCRATCH.
============================================================