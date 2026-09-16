============================================================
AI PHARMACY V3
SINGLE IMPLEMENTATION PLAN
EXISTING INSTALLER + RELEASE + AUTO-UPDATE FIX
============================================================

PRIMARY RULE
============================================================

DO NOT START THIS FEATURE FROM SCRATCH.

The repository already contains the installer, release pipeline,
update metadata, background auto-update service, update package
builder, and dedicated updater.

The EXISTING implementation is the source of truth.

The task is ONLY to inspect the existing implementation, identify
the specific mismatches, and correct them IN PLACE.

DO NOT create a second implementation.

DO NOT create:
- New updater system
- New release system
- New installer system
- New update API
- New update service
- New download service
- New database system
- New UI
- New frontend workflow
- New settings page
- New update page
- New parallel packaging system

Reuse the current architecture and current workflow.

============================================================
1. VERIFIED CURRENT BASELINE
============================================================

Repository:
AI-PHARMACY-V3

Verified latest commit:
f33ab065f41edd0162577d990d5e2e7230ade266

Latest commit currently changes only:
.gitignore

It adds medicine_data.csv to the ignored files.

IMPORTANT:
Do NOT modify or revert this unrelated .gitignore change.

The installer/update work already exists in the repository.

Existing architecture:

package.json
    ↓
scripts/release.mjs
    ↓
scripts/buildSea.cjs
    ↓
installer.iss
    ↓
PharmacyOS.exe / Installer
    ↓
GitHub Release
    ↓
Update metadata
    ↓
Existing autoUpdateService.ts
    ↓
Existing Updater.bat
    ↓
Existing installed application

KEEP THIS ARCHITECTURE.

============================================================
2. EXISTING FILES TO INSPECT FIRST
============================================================

Before modifying anything, inspect the CURRENT versions of:

1. package.json

2. scripts/release.mjs

3. scripts/buildSea.cjs

4. installer.iss

5. src/services/autoUpdateService.ts

6. scripts/build-update-package.mjs
   IF this file is directly involved in the existing update ZIP
   generation.

7. packaging/Updater.bat
   IF this file is directly involved in the existing update flow.

Do NOT automatically modify every file listed above.

First trace the dependency chain.

Only modify a file if the file actually participates in one of
the identified problems.

============================================================
3. CURRENT VERSION WORKFLOW
============================================================

Current package version is:

0.1.3

The existing release system already supports automatic version
bumping.

Expected release behavior:

CURRENT:
package.json
version = 0.1.3

RELEASE COMMAND
    ↓
existing release.mjs
    ↓
calculate next version
    ↓
0.1.4
    ↓
update package.json
    ↓
build existing application
    ↓
build existing installer
    ↓
build existing update ZIP
    ↓
create GitHub release
    ↓
publish update metadata
    ↓
PILOT rollout

Do NOT create another version manager.

============================================================
4. VERSION SYNCHRONIZATION REQUIREMENT
============================================================

There must be ONE authoritative version.

Source of truth:

package.json

If current version is:

0.1.3

and a patch release is requested:

0.1.4

must automatically become the release version.

The same version must be used by the EXISTING release process
for:

- package.json
- application build
- installer
- installer filename
- update ZIP
- GitHub release/tag
- update metadata
- target version supplied to updater

Do NOT hard-code a new version.

Do NOT manually maintain versions in multiple files.

Do NOT create another version configuration file.

============================================================
5. INSTALLER VERSION
============================================================

Inspect installer.iss.

The installer must continue using the existing injected
APP_VERSION / MyAppVersion mechanism.

Do NOT create another installer version variable.

Do NOT manually write:

0.1.4
0.1.5
0.1.6
etc.

The existing build process must pass the calculated version
into Inno Setup.

Expected:

package.json
    ↓
release.mjs calculates version
    ↓
buildSea.cjs receives version
    ↓
Inno Setup receives /DMyAppVersion=<version>
    ↓
installer.iss uses that value

The installer filename must also use the same calculated version.

Example:

AI-Pharmacy-OS-Setup-v0.1.4.exe

No independently maintained version.

============================================================
6. RELEASE PIPELINE
============================================================

Reuse the existing scripts/release.mjs.

The release process must remain:

CURRENT VERSION
    ↓
automatic version bump
    ↓
build
    ↓
installer
    ↓
update package
    ↓
GitHub Release
    ↓
update metadata
    ↓
PILOT

Do not create a new release command.

Do not create another release script.

Do not create a second GitHub publishing process.

============================================================
7. PILOT → ALL PROMOTION
============================================================

The existing release system already supports:

--pilot

and:

--promote

KEEP THIS.

The intended workflow is:

BUILD ONCE
    ↓
VERSION X
    ↓
PILOT
    ↓
TEST SAME BUILD
    ↓
PROMOTE SAME RELEASE
    ↓
ALL USERS

IMPORTANT:

Promotion MUST NOT rebuild the application.

Promotion MUST NOT create another installer.

Promotion MUST NOT create another update ZIP.

Promotion must update the rollout state of the EXISTING release.

Therefore:

PILOT BUILD
    =
ALL BUILD

Only rollout status changes.

Do not introduce another promotion architecture.

============================================================
8. EXISTING AUTO-UPDATE WORKFLOW
============================================================

The application already has a background update service.

Preserve this flow:

Application starts
    ↓
background update check
    ↓
existing update metadata check
    ↓
update available?
    ↓
YES
    ↓
download update package
    ↓
SHA-256 verification
    ↓
stage update
    ↓
launch existing Updater.bat
    ↓
application exits
    ↓
existing updater waits for exit
    ↓
backup
    ↓
extract update
    ↓
verify
    ↓
restart application

Do NOT replace this workflow.

Do NOT create a new updater.

Do NOT move update logic into the frontend.

============================================================
9. IMPORTANT FIX #1
UPDATE ZIP URL MISMATCH
============================================================

Inspect:

src/services/autoUpdateService.ts

Inspect the existing update metadata response.

The existing metadata contains separate concepts:

downloadUrl
    = installer EXE

updatePackageUrl
    = update ZIP

The background silent update process requires the UPDATE ZIP.

CURRENT PROBLEM TO VERIFY:

If autoUpdateService.ts uses:

result.downloadUrl

for the silent update ZIP download,

this is incorrect because downloadUrl points to the installer
rather than the update package.

REQUIRED CHANGE:

Use the EXISTING:

result.updatePackageUrl

for the update ZIP download.

Do NOT create:
- another URL
- another endpoint
- another download service
- another metadata format

Use the existing updatePackageUrl already supplied by the
existing release/update architecture.

Expected:

Existing update metadata
        ↓
updatePackageUrl
        ↓
download ZIP
        ↓
SHA-256
        ↓
existing staging
        ↓
existing Updater.bat

Installer EXE downloadUrl remains for the installer/release
purpose.

============================================================
10. IMPORTANT FIX #2
ADMIN SECRET
============================================================

Inspect:

scripts/release.mjs

If the current code contains a fallback such as:

ADMIN_SECRET || 'hard-coded-secret'

remove the hard-coded production fallback.

The release process must use the existing environment variable:

ADMIN_SECRET

Do NOT invent a replacement secret.

Do NOT add a new secret-management system.

Expected:

process.env.ADMIN_SECRET
    ↓
existing release/update metadata request

If ADMIN_SECRET is missing:

FAIL CLEARLY

Do not silently use a hard-coded secret.

The existing release workflow must otherwise remain unchanged.

============================================================
11. IMPORTANT FIX #3
UPDATER ERROR LABEL
============================================================

Inspect:

packaging/Updater.bat

The existing updater backs up:

PharmacyOS.exe
sea-entry.cjs
Updater.bat
data/app.db

If the application executable backup fails, the current error
must NOT be incorrectly reported as:

DATABASE_BACKUP_FAILED

because PharmacyOS.exe is not the database.

Correct only the existing error classification/message if
required.

Do NOT create a new error-handling system.

Database backup failures may continue to use the existing
database-backup-specific handling.

The goal is accurate diagnostics inside the existing updater.

============================================================
12. CUSTOMER DATA SAFETY
============================================================

The existing updater already attempts to preserve customer data.

Preserve this behavior.

Before replacing update files:

Existing updater
    ↓
pre-update backup
    ↓
existing application files backed up
    ↓
existing data/app.db backup
    ↓
update extraction

Do NOT replace this with a new backup architecture.

Do NOT move customer data into another database.

Do NOT create another database.

Do NOT delete customer data during normal update.

The existing application data directory must remain outside
the files being intentionally replaced by the update package,
unless the current architecture explicitly requires otherwise.

============================================================
13. UNINSTALL VS UPDATE
============================================================

Inspect installer.iss carefully.

There is an important distinction:

NORMAL UPDATE
    =
replace application files
    +
preserve customer data

UNINSTALL
    =
separate user operation

Do NOT allow normal upgrade behavior to become equivalent to
uninstall behavior.

Do not modify uninstall rules unless code inspection proves that
they can affect the normal update path.

If installer upgrade logic already preserves data, KEEP IT.

Do not introduce another migration or data-preservation system.

============================================================
14. UPDATE PACKAGE CONTENT
============================================================

Inspect:

scripts/build-update-package.mjs

The update ZIP must continue to contain only the files intended
for application update.

It must NOT overwrite customer-specific persistent data
unnecessarily.

Reuse the existing exclusion rules.

Do NOT create a second update package format.

Do NOT add customer database files to the update ZIP.

Do NOT package customer uploads unnecessarily.

Do NOT change unrelated package contents.

============================================================
15. SHA-256 VERIFICATION
============================================================

Keep the existing SHA-256 process.

Expected:

Download ZIP
    ↓
existing SHA-256 calculation
    ↓
compare against published hash
    ↓
MATCH
    ↓
continue updater

Mismatch:

SHA mismatch
    ↓
existing failure handling
    ↓
do not install corrupted update
    ↓
cleanup
    ↓
restart existing application

Do NOT replace SHA-256 with another verification architecture.

============================================================
16. EXISTING UPDATER LOCK
============================================================

Keep the existing:

update.lock

behavior.

It exists to prevent simultaneous update processes.

Preserve:

- stale-lock detection
- active-lock protection
- cleanup
- existing updater flow

Do NOT create another update-lock mechanism.

============================================================
17. EXISTING ROLLBACK
============================================================

Keep the current rollback architecture.

Expected:

Update
    ↓
backup previous files
    ↓
extract new files
    ↓
verify new PharmacyOS.exe

If extraction/verification fails:

rollback
    ↓
restore previous application files
    ↓
write existing failure information
    ↓
remove update lock
    ↓
start previous application

Do NOT create a second rollback system.

IMPORTANT:
Only improve an existing rollback defect if code inspection
shows one directly related to this task.

Do not expand the scope.

============================================================
18. NO FRONTEND UI CHANGE
============================================================

ABSOLUTE REQUIREMENT:

DO NOT CHANGE THE FRONTEND UI.

Do not modify:

- layout
- navigation
- pages
- buttons
- colors
- CSS
- Tailwind classes
- modals
- dashboards
- update screens
- settings screens

unless an existing frontend file is technically required by
the existing auto-update workflow.

Default:

FRONTEND = UNCHANGED

This task is backend/build/installer/update infrastructure.

The user-facing application workflow must remain unchanged.

============================================================
19. DO NOT TOUCH OTHER IMPLEMENTATION PLANS
============================================================

The repository already has other implementation work/plans.

DO NOT modify those workflows as part of this task.

Specifically do not change unrelated:

- POS workflow
- billing workflow
- inventory workflow
- database save workflow
- website order workflow
- refill workflow
- customer history
- catalog
- AI Camera
- OCR
- WhatsApp
- email processing
- promotional filtering
- multi-store logic
- authentication
- CRM
- frontend navigation
- page caching/performance architecture

unless repository inspection proves that one of these is a
DIRECT dependency of the installer/update bug being fixed.

Do not use this task as an excuse to refactor the application.

============================================================
20. FILE MODIFICATION RULE
============================================================

HARD RULE:

Before editing, run repository/code inspection.

Create an internal dependency map.

Then determine EXACTLY which files are required.

Potential files are:

- package.json
- scripts/release.mjs
- scripts/buildSea.cjs
- installer.iss
- src/services/autoUpdateService.ts
- scripts/build-update-package.mjs
- packaging/Updater.bat

These are NOT automatic permission to modify all of them.

Only modify files that are directly required.

If a listed file does not contain a relevant issue:

DO NOT TOUCH IT.

Do not create a new file unless the existing architecture
genuinely requires one.

============================================================
21. NO DUPLICATE ARCHITECTURE
============================================================

PROHIBITED:

NEW updater service
NEW release service
NEW installer
NEW update endpoint
NEW update metadata API
NEW download manager
NEW version manager
NEW rollback manager
NEW database backup service
NEW frontend update page
NEW configuration system

Required principle:

REUSE
    ↓
EXTEND
    ↓
MODIFY
    ↓
CREATE ONLY IF ABSOLUTELY NECESSARY

The desired result is:

EXISTING SYSTEM
      +
TARGETED FIXES
      =
CORRECT EXISTING SYSTEM

NOT:

EXISTING SYSTEM
      +
NEW SYSTEM
      =
DUPLICATE WORKFLOW

============================================================
22. RELEASE VERSION VERIFICATION
============================================================

After implementation, verify the release pipeline using a
development/test release process.

Example expected result:

Before:

package.json
0.1.3

Release:

automatic bump
↓
0.1.4

Then verify:

package.json
    0.1.4

installer
    v0.1.4

installer filename
    v0.1.4

update ZIP
    v0.1.4

GitHub tag
    v0.1.4

GitHub release
    v0.1.4

update metadata
    version = 0.1.4

update package URL
    points to ZIP

installer URL
    points to EXE

hash
    corresponds to ZIP

Do NOT manually change any of these versions.

============================================================
23. PILOT PROMOTION VERIFICATION
============================================================

Verify:

release v0.1.4
    ↓
PILOT

Then:

existing --promote operation
    ↓
same v0.1.4
    ↓
rollout = ALL

Verify:

NO new build
NO new installer
NO new ZIP
NO new version
NO duplicate GitHub release

============================================================
24. AUTO-UPDATE VERIFICATION
============================================================

Test using the existing update workflow.

Scenario:

Installed application:
0.1.3

Published release:
0.1.4

Application starts
    ↓
existing background check
    ↓
detect 0.1.4
    ↓
read existing update metadata
    ↓
use updatePackageUrl
    ↓
download ZIP
    ↓
calculate SHA-256
    ↓
verify hash
    ↓
stage update
    ↓
existing Updater.bat
    ↓
wait for application exit
    ↓
backup
    ↓
extract
    ↓
verify
    ↓
restart
    ↓
application = 0.1.4

Do not change the user's existing UI workflow.

============================================================
25. FAILED UPDATE TEST
============================================================

Test controlled failure in development only.

Examples:

- invalid ZIP
- checksum mismatch
- extraction failure
- missing PharmacyOS.exe after extraction

Expected:

failure detected
    ↓
existing failure record
    ↓
existing rollback
    ↓
previous application restored
    ↓
lock cleaned
    ↓
previous application starts

Customer data must remain protected.

Do not create a new failure architecture.

============================================================
26. DATA PRESERVATION TEST
============================================================

Before update:

existing:
data/app.db
uploads
existing customer/business data

Run update.

After update verify:

data/app.db still exists
existing customer/business data remains
uploads remain
application update files changed
new application starts normally

Do not replace customer data with test/dummy data.

Do not introduce fabricated pharmacy records.

============================================================
27. FINAL CHANGED-FILE AUDIT
============================================================

After coding:

Run:

git status
git diff
git diff --name-only

Compare the actual changed files against the approved
dependency scope.

The coding agent MUST identify:

MODIFIED FILES:
1. <exact file>
2. <exact file>

For EACH:

FILE:
<exact path>

WHY THIS FILE:
<why this file belongs to the existing installer/update flow>

OLD BEHAVIOR:
<actual current behavior before modification>

NEW BEHAVIOR:
<actual behavior after modification>

WHY CHANGED:
<specific bug/fix>

UNCHANGED:
<existing functionality intentionally preserved>

DEPENDENCIES:
<directly related existing files>

============================================================
28. UNRELATED FILE PROTECTION
============================================================

If an unrelated file was modified accidentally:

REVERT THAT UNRELATED CHANGE.

Do not leave incidental formatting changes.

Do not leave:
- generated files
- unrelated frontend changes
- unrelated database changes
- unrelated refactors
- dependency upgrades
- formatting-only changes
- renamed files

unless directly required by the target fix.

The latest commit's .gitignore change for medicine_data.csv
must remain untouched.

============================================================
29. OLD VS NEW CROSS-CHECK
============================================================

AFTER CODE IS COMPLETED, THE AGENT MUST STOP AND COMPARE
THE OLD AND NEW IMPLEMENTATION.

Do NOT simply say "fixed".

For every modified file:

------------------------------------------------------------
FILE
------------------------------------------------------------

OLD BEHAVIOR:
<what the existing code actually did>

NEW BEHAVIOR:
<what the changed code now does>

DIRECT REASON:
<why this exact change was necessary>

EXISTING WORKFLOW PRESERVED:
<what was deliberately not changed>

------------------------------------------------------------

Example for the URL mismatch:

OLD:

Existing update metadata
    ↓
autoUpdateService
    ↓
downloadUrl
    ↓
treated as update ZIP

NEW:

Existing update metadata
    ↓
autoUpdateService
    ↓
updatePackageUrl
    ↓
existing update ZIP download
    ↓
existing SHA verification
    ↓
existing Updater.bat

UNCHANGED:

Installer downloadUrl remains used for the installer asset.

No new endpoint.
No new updater.
No new download service.

============================================================
30. FINAL ARCHITECTURE CHECK
============================================================

Final architecture MUST remain:

PACKAGE VERSION
      ↓
EXISTING RELEASE SCRIPT
      ↓
EXISTING BUILD
      ↓
EXISTING INSTALLER
      ↓
EXISTING GITHUB RELEASE
      ↓
EXISTING UPDATE METADATA
      ↓
EXISTING AUTO UPDATE SERVICE
      ↓
EXISTING UPDATE ZIP
      ↓
EXISTING SHA-256
      ↓
EXISTING UPDATER.BAT
      ↓
EXISTING BACKUP
      ↓
EXISTING EXTRACTION
      ↓
EXISTING VERIFICATION
      ↓
EXISTING ROLLBACK IF REQUIRED
      ↓
EXISTING PHARMACYOS.EXE

ONLY THE IDENTIFIED BUGS ARE FIXED.

============================================================
31. FINAL ACCEPTANCE CRITERIA
============================================================

[ ] Existing installer workflow still works.

[ ] Existing release workflow still works.

[ ] Existing automatic version bump still works.

[ ] package.json remains the authoritative version source.

[ ] Installer receives the same calculated version.

[ ] Installer filename uses the same calculated version.

[ ] Update ZIP uses the same calculated version.

[ ] GitHub release/tag uses the same calculated version.

[ ] Update metadata uses the same calculated version.

[ ] Installer download URL points to installer EXE.

[ ] Auto-update ZIP download uses existing updatePackageUrl.

[ ] ZIP SHA-256 is verified.

[ ] Existing Updater.bat remains the updater.

[ ] Existing update.lock behavior remains.

[ ] Existing backup behavior remains.

[ ] Existing rollback behavior remains.

[ ] Customer data remains protected.

[ ] No hard-coded production ADMIN_SECRET fallback remains.

[ ] No new updater was created.

[ ] No new release system was created.

[ ] No duplicate update workflow was created.

[ ] No new database architecture was created.

[ ] No frontend UI was redesigned.

[ ] No unrelated implementation plan was changed.

[ ] No dummy/fabricated business data was introduced.

[ ] No unrelated file was modified.

[ ] Latest .gitignore change remains intact.

[ ] Existing build passes.

[ ] Existing release process passes.

[ ] Existing update package generation passes.

[ ] Existing installer build passes.

[ ] Existing auto-update flow passes.

[ ] Controlled failed-update/rollback test passes.

[ ] Old-vs-new cross-check is completed.

[ ] Final git changed-file audit is completed.

============================================================
32. MOST IMPORTANT INSTRUCTION TO CODING AGENT
============================================================

DO NOT REBUILD THE FEATURE.

DO NOT START FROM ZERO.

DO NOT CREATE AN ALTERNATIVE IMPLEMENTATION.

FIRST:

1. Inspect the existing code.
2. Trace the current installer/release/update workflow.
3. Identify the exact existing functions/files responsible.
4. Compare current implementation with the requirements above.
5. Modify ONLY the directly affected existing code.
6. Keep the current workflow and architecture.
7. Run targeted verification.
8. Run git diff.
9. Compare OLD vs NEW behavior.
10. Confirm that ONLY the required files changed.

FINAL PRINCIPLE:

CURRENT APPLICATION
        +
MINIMUM TARGETED FIX
        =
CORRECTED CURRENT APPLICATION

NOT:

CURRENT APPLICATION
        +
NEW PARALLEL SYSTEM
        =
DUPLICATE APPLICATION LOGIC
============================================================