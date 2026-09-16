AI PHARMACY V3
PRODUCTION WINDOWS INSTALLER + AUTO UPDATE + LICENSE + PILOT/PRODUCTION
SINGLE IMPLEMENTATION PLAN

============================================================
1. OBJECTIVE
============================================================

Make the Windows application installation and update system production-stable.

The final system must:

1. Install the application reliably on customer PCs.
2. Avoid installation-time lag, hanging and freezing as much as possible.
3. Keep existing pharmacy data, database, uploads, settings and license data safe.
4. Automatically detect the latest available application version on every boot.
5. Perform update checking in the background without blocking application startup.
6. Automatically update the application using a safe updater process.
7. Never replace the currently running PharmacyOS.exe directly.
8. Support TESTER/PILOT rollout separately from ALL production customers.
9. Use exactly one source of truth for application version.
10. Automatically synchronize:
      package version
      installer version
      executable/release version
      GitHub release tag
      update-server version
      update manifest
11. Never require manually changing the old version inside installer.iss.
12. Never require manually changing multiple version numbers.
13. Never rebuild a different binary when promoting a tested Pilot release to production.
14. Provide automatic rollback if an update fails.
15. Do not change the existing frontend UI.
16. Do not modify unrelated business modules or application files.

============================================================
2. CURRENT BEHAVIOR FOUND IN REPOSITORY
============================================================

Repository:
AI-PHARMACY-V3

Current package.json version:
0.1.3

Current installer.iss contains a hard-coded version:
0.1.0

This creates a version mismatch.

CURRENT BUILD FLOW:

package.json
    ↓
npm run build:exe
    ↓
build frontend
    ↓
build backend
    ↓
buildBundle.cjs
    ↓
Node SEA
    ↓
PharmacyOS.exe
    ↓
Inno Setup
    ↓
installer EXE


CURRENT RELEASE FLOW:

npm run release
    ↓
release.mjs bumps package.json version
    ↓
build installer
    ↓
upload installer to GitHub Release
    ↓
publish latestVersion/downloadUrl to Vercel update server
    ↓
verify update server


CURRENT PILOT FLOW:

npm run release:pilot
    ↓
build
    ↓
GitHub Release
    ↓
publish update metadata as PILOT
    ↓
Pilot licensed PCs can receive it


CURRENT PRODUCTION FLOW:

npm run release
    ↓
publish rollout mode ALL
    ↓
all licensed PCs can receive it


CURRENT PACKAGING:

PharmacyOS.exe is generated using Node SEA.

Third-party runtime packages are still shipped beside the executable in
node_modules.

The same application executable can also be used for background worker roles.

CURRENT INSTALLER BEHAVIOR:

The Inno installer:
- installs to LocalAppData
- copies PharmacyOS.exe
- copies frontend/dist
- copies node_modules
- copies configuration/data files
- checks whether PharmacyOS.exe is running
- may terminate the running process
- creates database backup before upgrade
- has post-install launch behavior
- contains hard-coded application version information

============================================================
3. MAIN CURRENT PROBLEMS
============================================================

PROBLEM A — VERSION MISMATCH

package.json:
0.1.3

installer.iss:
0.1.0

This must be eliminated.

------------------------------------------------------------

PROBLEM B — MANUAL VERSION MANAGEMENT

The installer contains its own version.

This means a new release can accidentally contain:

package.json = 0.1.4
installer = 0.1.0

Never allow this again.

------------------------------------------------------------

PROBLEM C — UPDATE PROCESS SAFETY

The running application must not overwrite its own executable.

A running PharmacyOS.exe must be shut down first.

A separate updater must perform the replacement.

------------------------------------------------------------

PROBLEM D — STARTUP BLOCKING

License/update network operations must never block application startup.

The application must start locally first.

Network checks run asynchronously.

------------------------------------------------------------

PROBLEM E — INSTALLER POST-INSTALL WORK

The installer should not be responsible for starting the full application,
opening the browser and starting heavy background work.

Installation and application startup must be separate operations.

------------------------------------------------------------

PROBLEM F — UPDATE FAILURE

If an update is partially copied or corrupted, the application must not
become unusable.

A previous working version must remain recoverable.

------------------------------------------------------------

PROBLEM G — PILOT/PRODUCTION PROMOTION

The Pilot build must be the exact build that later becomes production.

Do not build another binary after Pilot testing.

------------------------------------------------------------

PROBLEM H — RELEASE VERIFICATION

A GitHub asset existing does NOT mean an update is live.

GitHub release asset and update-server metadata must both be verified.

============================================================
4. STRICT FILE-SCOPE RULE
============================================================

THE AGENT MUST MODIFY ONLY FILES DIRECTLY RELATED TO THIS FEATURE.

ALLOWED EXISTING FILES:

1. package.json

2. installer.iss

3. scripts/release.mjs

4. scripts/buildSea.cjs

5. scripts/buildBundle.cjs

6. src/bootstrap.ts

7. ONLY the existing startup/license/update files discovered by the agent
   that are directly responsible for:
   - startup
   - license verification
   - update checking
   - update handling

ALLOWED NEW FILES:

Create NEW files ONLY inside these dedicated locations:

packaging/
scripts/
src/services/
src/process/

ONLY if the file is directly required for:

- updater
- update manifest
- version handling
- startup update coordinator
- license/update coordination
- rollback
- release packaging

DO NOT CREATE FILES ANYWHERE ELSE.

============================================================
5. ABSOLUTE DO-NOT-TOUCH RULE
============================================================

DO NOT MODIFY:

- frontend UI components
- frontend pages
- frontend styling
- frontend layout
- POS UI
- Purchase UI
- Inventory UI
- CRM UI
- Catalogue UI
- Website UI
- Patient portal UI
- Distributor portal UI
- Retailer portal UI
- WhatsApp UI
- unrelated API routes
- unrelated database logic
- unrelated business services
- unrelated automation
- unrelated catalog logic
- unrelated image processing
- unrelated application features

DO NOT REFACTOR unrelated code.

DO NOT rename unrelated files.

DO NOT reorganize the project.

DO NOT introduce dummy data.

DO NOT change existing business behavior.

DO NOT change frontend appearance.

============================================================
6. SINGLE SOURCE OF VERSION
============================================================

package.json must become the ONLY authoritative application version.

Example:

"version": "0.1.4"

No other manually maintained version is allowed.

installer.iss must receive the version automatically during build.

Do not manually maintain:

#define MyAppVersion "0.1.0"

with an independently maintained value.

Instead, release/build process must generate the installer version.

Possible implementation:

- Generate a temporary versioned installer definition
OR
- Pass version to Inno Setup using compiler defines
OR
- Generate installer.iss from a controlled template

Preferred:
Keep installer.iss as the installer definition but inject the version
automatically from package.json during the build.

Do not introduce a second version source.

============================================================
7. VERSION FLOW
============================================================

Example current version:

0.1.3

Developer executes:

npm run release:pilot

System automatically:

0.1.3
   ↓
0.1.4
   ↓
package.json = 0.1.4
   ↓
installer = 0.1.4
   ↓
installer filename:
AI-Pharmacy-OS-Portable-Setup-v0.1.4.exe
   ↓
GitHub tag:
v0.1.4
   ↓
update manifest:
0.1.4
   ↓
update server:
latestVersion = 0.1.4


NO MANUAL VERSION EDITING.

============================================================
8. OLD VERSION MUST NEVER BE USED AS INSTALLER VERSION
============================================================

The installer may need to know the currently installed application version
when performing an upgrade.

That version must be detected from the installed application metadata,
not from a hard-coded value.

Example:

Installed PC:
0.1.3

New installer:
0.1.4

Installer knows:

OLD VERSION = detected installed version
NEW VERSION = release version

Then:

backup old installation
    ↓
install new version
    ↓
verify
    ↓
start new version


Do not hard-code:

OLD VERSION = 0.1.0

The old version is dynamic and must be detected from the installed system.

============================================================
9. BUILD PROCESS
============================================================

Build must be deterministic.

Run:

npm run build:all:clean

then:

npm run build:bundle

then:

npm run buildSea

then:

Inno Setup build

Before producing installer, verify:

- package.json version exists
- generated application version matches package.json
- PharmacyOS.exe exists
- frontend/dist exists
- required runtime dependencies exist
- sea-entry.cjs exists
- required .env template exists
- license files exist
- installer definition exists
- Inno Setup compiler exists

If any required item is missing:

STOP BUILD.

DO NOT publish.

============================================================
10. INSTALLER STABILITY
============================================================

The installer must:

- install to the existing writable LocalAppData location
- avoid Program Files permission problems
- check for running PharmacyOS.exe
- gracefully stop the application when upgrading
- wait for complete process shutdown
- close child workers owned by the application
- avoid modifying files while processes are still using them
- backup the database before replacement
- preserve user data
- preserve uploads
- preserve license state
- preserve required WhatsApp/session data
- preserve application settings

The installer must not perform heavy application initialization.

============================================================
11. REMOVE INSTALLER-STARTUP COUPLING
============================================================

The installer should install the application.

The installer should NOT:

- start the application server as part of installation
- wait for server initialization
- open the browser automatically
- perform license verification
- perform update checking
- perform catalog loading

After installation:

Installer finishes.

User/application launcher starts PharmacyOS normally.

This separates:

INSTALLATION

from:

APPLICATION STARTUP

============================================================
12. FIRST APPLICATION STARTUP
============================================================

Startup flow must become:

PharmacyOS starts
    ↓
load local configuration
    ↓
load local license/cache state
    ↓
start required local server
    ↓
application becomes available
    ↓
background startup tasks begin
    ↓
license verification
    ↓
update check


IMPORTANT:

License verification and update checking MUST NOT block local startup.

Network timeout must never make the application appear frozen.

============================================================
13. UPDATE CHECK ON EVERY BOOT
============================================================

Every application boot must perform an update check.

Flow:

Application starts
    ↓
read installed version
    ↓
start application normally
    ↓
background update check
    ↓
call update server
    ↓
receive latest version
    ↓
compare versions using semantic version comparison
    ↓
if current:
    continue normally

if newer:
    process update


Update check must have a short timeout.

Recommended network timeout:
5–10 seconds.

If update server is unavailable:

DO NOT FREEZE.

DO NOT BLOCK STARTUP.

DO NOT mark the license invalid.

DO NOT repeatedly retry immediately.

Log the failure and continue.

============================================================
14. LICENSE CHECK
============================================================

License verification and update checking must remain separate.

LICENSE CHECK:

Checks:
- license validity
- activation state
- entitlement
- rollout eligibility

UPDATE CHECK:

Checks:
- latest version
- update package
- rollout mode
- changelog
- checksum
- update availability

Failure of update server must NOT automatically mean:

LICENSE INVALID

Likewise:

license verification failure must not corrupt update state.

============================================================
15. LICENSE CACHE
============================================================

Use the existing licensing system.

Do not redesign licensing.

Only improve startup safety.

If the existing system supports cached valid license state:

- load cached state immediately
- perform server verification asynchronously
- update local state only after valid server response

Do not store credentials/secrets in logs.

============================================================
16. UPDATE MANIFEST
============================================================

Every release must publish a manifest containing:

version
minimumSupportedVersion
releaseType
rolloutMode
installerUrl
updatePackageUrl
sha256
releaseDate
mandatory
changelog

Example:

{
  "version": "0.1.4",
  "minimumSupportedVersion": "0.1.0",
  "releaseType": "production",
  "rolloutMode": "PILOT",
  "installerUrl": "...",
  "updatePackageUrl": "...",
  "sha256": "...",
  "releaseDate": "...",
  "mandatory": false,
  "changelog": "..."
}

The exact format must match the existing update server API where possible.

Do not create a competing update system.

============================================================
17. PILOT / TESTER RELEASE
============================================================

Command:

npm run release:pilot

Behavior:

1. Automatically determine next version.
2. Build the application ONCE.
3. Generate installer.
4. Generate update package.
5. Calculate checksum.
6. Create GitHub release.
7. Upload exact build assets.
8. Publish update metadata as PILOT.
9. Verify update server.
10. Pilot licensed PCs become eligible.
11. Non-pilot production customers remain on their current version.

Example:

Current:
0.1.3

Pilot:
0.1.4

Tester PC:
0.1.3
    ↓
detects 0.1.4
    ↓
updates to 0.1.4

Normal customer:
0.1.3
    ↓
does NOT receive Pilot-only release.

============================================================
18. PRODUCTION PROMOTION
============================================================

After Pilot testing:

DO NOT rebuild.

DO NOT create a different binary.

Promote the exact tested release:

v0.1.4

from:

PILOT

to:

ALL

The update server rollout metadata becomes:

rolloutMode = ALL

Then:

all eligible licensed PCs
    ↓
check update
    ↓
detect 0.1.4
    ↓
perform safe update

This guarantees:

TESTED BUILD = PRODUCTION BUILD

============================================================
19. PRODUCTION RELEASE COMMAND
============================================================

npm run release

must:

- determine the release version
- build exactly once
- generate installer
- generate update package
- calculate checksum
- upload release assets
- publish production metadata
- verify server metadata
- verify URLs
- verify version
- verify checksum
- only then report success

DO NOT report success if any step fails.

============================================================
20. IMPORTANT RELEASE IMPROVEMENT
============================================================

The current release process uploads the installer and then publishes update
metadata.

Keep this general architecture but make it transactional.

If:

GitHub upload succeeds

but:

Vercel/update-server publish fails

then release must be reported as:

RELEASE NOT LIVE

not:

RELEASE SUCCESSFUL

The release script must clearly identify:

GitHub asset uploaded
BUT
update server not published

No customer should be expected to discover this through suffering.

============================================================
21. UPDATE PACKAGE
============================================================

Create a complete update package.

Example:

AI-Pharmacy-OS-Update-v0.1.4.zip

It must contain all runtime files required for an application update.

Do not download individual application files directly into the live directory.

Download to:

%LOCALAPPDATA%\AI Pharmacy OS\updates\staging\

Then:

download
    ↓
verify checksum
    ↓
validate manifest
    ↓
validate package
    ↓
prepare update
    ↓
stop application
    ↓
backup
    ↓
replace
    ↓
verify
    ↓
start new version


============================================================
22. SEPARATE UPDATER
============================================================

Create a dedicated updater under:

packaging/

or:

src/process/

depending on existing project architecture.

The updater must be independent from the running PharmacyOS.exe.

It must:

- receive target version
- locate installed application
- wait for PharmacyOS.exe to exit
- create/verify backup
- stage new files
- replace application files
- verify required files
- write update result
- rollback if necessary
- start PharmacyOS.exe after success

The updater must not depend on the main application remaining alive.

============================================================
23. GRACEFUL SHUTDOWN
============================================================

Update sequence:

Application receives update request
    ↓
stop new background work
    ↓
stop catalog worker
    ↓
stop email worker
    ↓
stop other owned background workers
    ↓
close database connections
    ↓
flush pending writes
    ↓
stop HTTP server
    ↓
exit PharmacyOS.exe
    ↓
start updater

Forced taskkill is only a last-resort fallback after a controlled timeout.

============================================================
24. UPDATE LOCK
============================================================

Create:

update.lock

under the application update state directory.

The lock must prevent:

- two simultaneous updates
- two updater processes
- duplicate startup update jobs

Lock contains:

PID
timestamp
targetVersion
operation

Detect and recover stale locks safely.

============================================================
25. DATABASE BACKUP
============================================================

Before update:

if data/app.db exists:

create:

backup/app-preupgrade-YYYY-MM-DD-HHMMSS.db

Verify:

- file exists
- file size > 0
- database backup completed

Never delete the only valid database backup.

Keep enough recent backup history for recovery.

============================================================
26. ROLLBACK
============================================================

If update fails:

DO NOT leave a partial installation.

Rollback:

backup
    ↓
restore previous application version
    ↓
verify old executable
    ↓
start old application
    ↓
write rollback log

The customer must return to the previous working version automatically.

============================================================
27. DATA PRESERVATION
============================================================

Updates must NOT delete:

- data/app.db
- uploads
- backups
- license state
- application settings
- customer data
- pharmacy data
- required WhatsApp session state
- required local configuration

Application binary/runtime files may be replaced.

User data must remain separate from replaceable application files wherever
the current architecture allows.

============================================================
28. STARTUP PERFORMANCE
============================================================

Do not perform these operations synchronously before application availability:

- GitHub update request
- Vercel update request
- license network verification
- update download
- checksum of huge files
- catalog synchronization
- heavy OCR initialization
- unnecessary background worker startup

Startup should prioritize:

1. local configuration
2. database availability
3. local server
4. application availability

Then background work.

============================================================
29. UPDATE DOWNLOAD PERFORMANCE
============================================================

Update download must be asynchronous.

Never block the main application process while downloading.

Use:

staging directory
temporary filename
download progress internally
checksum verification
atomic finalization

If download is interrupted:

delete incomplete temporary package
keep current installed version
retry later according to controlled retry policy.

============================================================
30. RELEASE ASSET VALIDATION
============================================================

Before release is marked successful:

Verify:

GitHub tag:
vX.Y.Z

Installer:
AI-Pharmacy-OS-Portable-Setup-vX.Y.Z.exe

Update package:
AI-Pharmacy-OS-Update-vX.Y.Z.zip

Manifest:
version = X.Y.Z

Update server:
latestVersion = X.Y.Z

All must match.

============================================================
31. SHA-256 VERIFICATION
============================================================

For every update package:

calculate SHA-256 during release.

Publish checksum in update metadata.

Customer updater:

download
    ↓
calculate SHA-256
    ↓
compare with published SHA-256

If mismatch:

STOP.

Do not install.

Keep current version.

============================================================
32. VERSION COMPARISON
============================================================

Use semantic version comparison.

Examples:

0.1.9 < 0.1.10

must evaluate correctly.

Do not use plain string comparison.

Do not downgrade unless explicitly required by a controlled rollback process.

============================================================
33. BOOT UPDATE BEHAVIOR
============================================================

Every boot:

T+0:
start application.

T+background:
license verification.

T+background:
update check.

If no update:
continue.

If update:
prepare update without freezing application.

If user is actively using application:
do not unexpectedly terminate the session.

Preferred:

UPDATE AVAILABLE

then safe restart/update when the application is closed or when a controlled
restart is initiated.

For mandatory security/critical updates, use the existing application policy,
but still use the separate updater.

============================================================
34. ERROR HANDLING
============================================================

Every installer/update failure must have a controlled reason.

Examples:

UPDATE_SERVER_UNAVAILABLE

DOWNLOAD_FAILED

CHECKSUM_MISMATCH

PACKAGE_INVALID

APPLICATION_STILL_RUNNING

DATABASE_BACKUP_FAILED

FILE_REPLACEMENT_FAILED

NEW_VERSION_START_FAILED

ROLLBACK_SUCCESSFUL

LICENSE_SERVER_UNAVAILABLE

No generic silent failure.

============================================================
35. LOGGING
============================================================

Create dedicated updater/release logs only within related application paths.

Example:

logs/updater.log

Record:

installedVersion
targetVersion
updateCheck
downloadStarted
downloadCompleted
checksumResult
shutdownResult
backupResult
replacementResult
verificationResult
rollbackResult

NEVER log:

- passwords
- license secrets
- API secrets
- authentication tokens
- sensitive customer information

============================================================
36. INSTALLER VERSION DISPLAY
============================================================

The installer UI can display:

AI Pharmacy OS
Version 0.1.4

But the version must be injected automatically.

No manual version editing.

The previous installed version may be detected dynamically if required.

Example:

Installed:
0.1.3

Installing:
0.1.4

The installer must understand this automatically.

============================================================
37. RELEASE VERSION EXAMPLE
============================================================

START:

package.json:
0.1.3

Developer executes:

npm run release:pilot

AUTOMATIC:

0.1.4 created
    ↓
package.json = 0.1.4
    ↓
installer generated = 0.1.4
    ↓
EXE release = 0.1.4
    ↓
GitHub = v0.1.4
    ↓
manifest = 0.1.4
    ↓
server = 0.1.4
    ↓
Pilot rollout


AFTER PILOT APPROVAL:

same v0.1.4
    ↓
rolloutMode changes:
PILOT → ALL
    ↓
production customers receive 0.1.4


NEXT RELEASE:

0.1.4
    ↓
npm run release:pilot
    ↓
0.1.5

No manual version editing anywhere.

============================================================
38. CURRENT RELEASE SCRIPT CORRECTION
============================================================

scripts/release.mjs currently:

- bumps package.json
- searches dist/installer for Setup EXE
- uploads to GitHub
- publishes update metadata
- verifies latestVersion

Keep this overall flow.

Modify only the release-specific logic required to:

1. Generate version-consistent installer.
2. Generate update package.
3. Calculate checksum.
4. Use exact release asset.
5. Prevent stale installer selection.
6. Verify all release assets.
7. Publish correct metadata.
8. Support Pilot.
9. Support production promotion.
10. Refuse release on any mismatch.

Do not rewrite unrelated release logic.

============================================================
39. BUILDSEA CORRECTION
============================================================

scripts/buildSea.cjs currently generates:

dist/PharmacyOS.exe

and then attempts to invoke Inno Setup.

Modify only the version/build integration.

Do not change SEA architecture unless absolutely required.

Do not replace Node SEA with another packaging framework unless an actual
blocking technical issue is demonstrated.

============================================================
40. INSTALLER.ISS CORRECTION
============================================================

installer.iss must stop being the independent source of version.

Maintain existing:

- LocalAppData installation
- writable data location
- native dependency handling
- required runtime files
- shortcuts
- database backup behavior

Modify only:

- automatic version injection
- safe upgrade behavior
- removal of unnecessary post-install application startup
- updater integration
- graceful process shutdown
- update/rollback integration

Do not redesign installer UI.

============================================================
41. CROSS-CHECK AFTER IMPLEMENTATION
============================================================

AFTER CODE IS WRITTEN, THE AGENT MUST NOT STOP AT "BUILD PASSED".

Perform a strict cross-check.

CHECK 1:
package.json version

CHECK 2:
installer generated version

CHECK 3:
installer filename version

CHECK 4:
release tag version

CHECK 5:
update package version

CHECK 6:
manifest version

CHECK 7:
update-server latestVersion

CHECK 8:
download URL

CHECK 9:
SHA-256

CHECK 10:
Pilot rollout

CHECK 11:
ALL rollout

CHECK 12:
startup update check

CHECK 13:
license/update separation

CHECK 14:
database backup

CHECK 15:
rollback

CHECK 16:
frontend files unchanged

============================================================
42. FILE-SCOPE CROSS-CHECK
============================================================

Before finishing:

Generate a changed-file list.

Every changed file must be classified:

VERSION
INSTALLER
UPDATER
STARTUP
LICENSE
RELEASE
PACKAGING

If a changed file does not belong to one of these categories:

REVERT THAT CHANGE.

The agent must NOT leave unrelated modifications in the repository.

============================================================
43. FRONTEND UI CROSS-CHECK
============================================================

Verify:

No frontend UI files were modified.

No frontend layout changed.

No frontend styling changed.

No business page changed.

No new UI was added.

Update functionality must operate through existing application behavior
and backend/process mechanisms.

If a visible update notification already exists, connect to it only where
necessary.

Do not create a new UI design.

============================================================
44. TEST MATRIX
============================================================

TEST CLEAN INSTALL:

- Windows x64
- no existing application
- install
- complete installation
- launch
- verify startup

TEST EXISTING INSTALL:

0.1.3 installed
    ↓
install 0.1.4
    ↓
database preserved
    ↓
application starts

TEST PILOT:

0.1.3
    ↓
Pilot release 0.1.4
    ↓
Pilot PC detects update
    ↓
normal customer does not

TEST PRODUCTION:

Promote same 0.1.4
    ↓
ALL
    ↓
eligible customer detects 0.1.4

TEST OFFLINE:

No internet
    ↓
application starts according to existing license/cache rules

TEST UPDATE SERVER FAILURE:

Update server unavailable
    ↓
application still starts
    ↓
no freeze

TEST CORRUPTED PACKAGE:

checksum mismatch
    ↓
update aborted
    ↓
current version preserved

TEST FAILED UPDATE:

new version cannot start
    ↓
rollback
    ↓
old version starts

TEST DATABASE:

before update:
database contains real customer data

after update:
same data exists

TEST WORKERS:

catalog worker
email worker
other owned workers

must stop safely before binary replacement.

============================================================
45. FINAL ACCEPTANCE CRITERIA
============================================================

FEATURE IS COMPLETE ONLY IF:

[ ] package.json is the single version source

[ ] installer version is automatically generated

[ ] no hard-coded independent installer version remains

[ ] old installed version is detected dynamically

[ ] new version is generated automatically

[ ] clean installer is produced

[ ] installer does not launch heavy application processes

[ ] application starts without waiting for update server

[ ] application starts without waiting for license server

[ ] update check runs on every boot

[ ] update check runs asynchronously

[ ] update failure does not freeze application

[ ] license failure and update failure remain separate

[ ] update package is downloaded to staging

[ ] SHA-256 is verified

[ ] running PharmacyOS.exe is never overwritten directly

[ ] dedicated updater handles replacement

[ ] database is backed up

[ ] user data is preserved

[ ] failed update rolls back

[ ] Pilot release works

[ ] Production release works

[ ] same Pilot-tested binary becomes production

[ ] GitHub release version matches application version

[ ] update server version matches application version

[ ] download URL matches release asset

[ ] checksum matches package

[ ] release script refuses incomplete releases

[ ] frontend UI is unchanged

[ ] unrelated files are unchanged

[ ] changed-file list contains ONLY related files

============================================================
46. FINAL OLD BEHAVIOR VS NEW BEHAVIOR
============================================================

OLD:

package.json
0.1.3

installer.iss
0.1.0

Manual version mismatch possible.

Installer can start application.

Application/update/license work can become coupled.

Running application may be forcibly terminated.

Update process can be unsafe.

GitHub asset can exist while update metadata is not live.

Pilot and production release can accidentally involve different builds.

------------------------------------------------------------

NEW:

package.json
0.1.3
     ↓
release command
     ↓
automatic next version
0.1.4
     ↓
installer automatically becomes 0.1.4
     ↓
GitHub v0.1.4
     ↓
update manifest 0.1.4
     ↓
update server 0.1.4

Pilot:
0.1.4 → PILOT

Pilot testing:
same exact binary

Production:
same exact 0.1.4 → ALL

Customer boot:
start application immediately
     ↓
background license check
     ↓
background update check
     ↓
new update detected
     ↓
safe staging
     ↓
graceful shutdown
     ↓
separate updater
     ↓
backup
     ↓
atomic replacement
     ↓
verify
     ↓
start new version

If failure:
     ↓
automatic rollback
     ↓
previous version starts

============================================================
47. FINAL AGENT INSTRUCTION
============================================================

IMPLEMENT ONLY THIS PLAN.

Before modifying anything:

1. Inspect the existing installer files.
2. Inspect existing startup files.
3. Inspect existing license/update files.
4. Inspect existing release flow.
5. Identify the minimum exact files required.
6. Do not assume a file should be modified merely because it exists.

During implementation:

- modify only required files
- preserve existing architecture
- preserve existing UI
- preserve existing business behavior
- do not introduce dummy data
- do not refactor unrelated code
- do not create duplicate update systems
- do not create duplicate licensing systems
- do not create a second version source

After implementation:

1. Build.
2. Test.
3. Cross-check every version.
4. Cross-check installer.
5. Cross-check updater.
6. Cross-check license separation.
7. Cross-check Pilot rollout.
8. Cross-check production rollout.
9. Cross-check rollback.
10. Produce changed-file list.
11. Revert any unrelated file modifications.

FINAL RESPONSE FROM AGENT AFTER COMPLETION:

Provide a SHORT comparison only:

OLD BEHAVIOR:
- version was independently hard-coded
- installer/update process had unsafe coupling
- update checking could interfere with startup
- Pilot/production release required stronger release validation

NEW BEHAVIOR:
- one automatic version source
- installer version generated automatically
- every boot checks update in background
- safe separate updater
- database/data protection
- automatic rollback
- exact same Pilot-tested build promoted to ALL
- release verification prevents incomplete releases

THEN PROVIDE:

FILES MODIFIED:
[list only files actually modified]

FILES CREATED:
[list only files actually created]

FILES NOT TOUCHED:
confirm frontend UI and unrelated modules were not modified.

Do not claim completion unless the implementation and cross-checks actually pass.