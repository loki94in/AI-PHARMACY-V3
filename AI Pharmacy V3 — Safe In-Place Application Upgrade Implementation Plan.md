# AI Pharmacy V3 — Safe In-Place Application Upgrade Implementation Plan

## 1. Objective

Implement a **safe in-place upgrade mechanism** for the Windows version of AI Pharmacy V3.

The user must be able to install the latest application version **over the existing installed version without manually uninstalling the previous version**.

The upgrade must preserve all existing user/application data, including:

- `data/app.db`
- Pharmacy records
- Medicines
- Sales
- Purchases
- Inventory
- Customers/CRM data
- Settings stored in the database
- Uploaded files
- Existing backups
- WhatsApp authentication/session data
- Existing `.env` configuration
- Any other runtime-generated user data that is intentionally stored inside the application data directory

The upgrade must replace/update the application code only where required.

**No frontend UI changes are permitted.**

---

# 2. Current Behavior

First inspect the current V3 installation and build architecture before making any changes.

The current repository uses:

- `PharmacyOS.exe` as the Windows application executable.
- Inno Setup through `installer.iss`.
- Application data stored beside the application.
- SQLite database at:

`data/app.db`

- A database backup script already exists at:

`scripts/backup.mjs`

The existing backup script copies `data/app.db` into the `backup` directory before an operation. Do not replace this existing backup mechanism unnecessarily.

The current installer is designed around:

`%LOCALAPPDATA%\AI Pharmacy OS`

and installs the executable, frontend files, dependencies and runtime files into that location.

The current installer also contains uninstall logic that removes runtime directories such as:

- `data`
- `uploads`
- `backup`
- `.wwebjs_auth`
- `.wwebjs_cache`

Therefore the upgrade mechanism **must not use uninstall/reinstall as its normal update process**.

The current installer must be inspected carefully before modification.

---

# 3. Expected Behavior

After implementation, the application must support:

```text
Existing AI Pharmacy V3
        ↓
Run latest AI Pharmacy V3 installer
        ↓
Detect existing installation
        ↓
Detect existing application data
        ↓
Stop currently running PharmacyOS process safely
        ↓
Create verified database backup
        ↓
Preserve user/runtime data
        ↓
Replace only application files
        ↓
Preserve existing configuration
        ↓
Run required database migration if applicable
        ↓
Verify database opens successfully
        ↓
Start latest PharmacyOS version
        ↓
Application opens normally
```

The user should **not need to uninstall the previous version**.

---

# 4. Critical Data Preservation Rules

These rules are mandatory.

The upgrade process must NEVER intentionally delete or reset:

```text
data/
uploads/
backup/
.wwebjs_auth/
.wwebjs_cache/
.env
```

Most importantly:

```text
data/app.db
```

must never be replaced by a blank/new database during an upgrade.

The existing database must remain the source of truth.

If a new release contains a database schema change, the application must migrate the existing database forward rather than creating a new database.

---

# 5. Required Upgrade Detection

Modify only the installer/update-related files required to implement this behavior.

The installer must detect whether an existing AI Pharmacy OS installation already exists.

The detection should identify the existing installation directory and determine whether:

```text
PharmacyOS.exe
data/app.db
```

already exist.

If an existing installation is detected:

- Treat the operation as an upgrade.
- Do not perform a clean installation.
- Do not remove the existing data directory.
- Do not reset application configuration.

If no existing installation exists:

- Perform the normal first-time installation.

Do not change unrelated application behavior.

---

# 6. Upgrade Backup Requirement

Before replacing application files during an upgrade:

1. Stop the currently running PharmacyOS process.
2. Confirm the process has stopped.
3. Verify that `data/app.db` exists.
4. Create a timestamped backup of the existing database.
5. Store the backup in the existing backup location or another clearly controlled upgrade-backup location.
6. Verify that the backup was successfully created.
7. Only then continue with application replacement.

If the database backup fails:

**ABORT THE UPGRADE.**

Do not continue by replacing application files when a safe database backup could not be created.

The user must retain the working old installation in this failure scenario.

---

# 7. File Replacement Rules

The installer must distinguish between:

### Application files

These may be replaced by the new version:

```text
PharmacyOS.exe
frontend/dist/
node_modules/
sea-entry.cjs
RUN-PharmacyOS.bat
other packaged application runtime files
```

Only replace files that actually belong to the application release.

### User/runtime data

These must be preserved:

```text
data/
uploads/
backup/
.wwebjs_auth/
.wwebjs_cache/
.env
```

Do not blindly delete the entire installation directory before installing the new version.

Do not implement:

```text
delete installation directory
↓
install new version
```

because this defeats the entire purpose of a safe in-place upgrade.

---

# 8. `.env` Preservation

The existing `.env` file must be preserved during upgrades.

If the user already has:

```text
.env
```

the installer must not overwrite it with the packaged default environment file.

The existing configuration must continue to be used.

For a first installation only, the default packaged environment file may be created.

---

# 9. WhatsApp Session Preservation

The upgrade must not delete or reset:

```text
.wwebjs_auth/
.wwebjs_cache/
```

if these directories are used by the current installation.

The purpose is to prevent the user from unnecessarily having to reconnect/authenticate WhatsApp after every application update.

The upgrade must not change WhatsApp automation logic.

Only protect the existing runtime/session files from being removed during an upgrade.

---

# 10. Database Migration Safety

Inspect the existing V3 database initialization and migration architecture before implementing anything.

Do not invent a second independent migration system if an existing migration mechanism already exists.

If an existing migration mechanism is present:

- Reuse it.
- Ensure it runs against the existing `data/app.db`.
- Ensure migrations are incremental and safe.

If no suitable migration mechanism exists, implement the smallest necessary migration/version-check mechanism in the existing database-related file(s).

Do not create unrelated database architecture.

A migration must never silently destroy existing records.

---

# 11. Version Handling

Inspect how the current application version is defined.

Do not create multiple competing version sources.

If the existing project uses:

```text
package.json
installer.iss
```

or another version source, determine the current relationship between them.

The upgrade installer must correctly identify the new version.

If a version comparison is already available, reuse it.

If version comparison is missing and genuinely required for safe upgrade behavior, add only the smallest necessary implementation in the installer/release-related files.

Do not modify unrelated frontend or backend files merely to display a version number.

---

# 12. Installer Behavior

Modify `installer.iss` only as required for safe upgrade behavior.

The installer should support:

### First installation

```text
No previous installation
        ↓
Normal installation
        ↓
Create required directories
        ↓
Install application
        ↓
Start application
```

### Existing installation

```text
Existing installation detected
        ↓
Upgrade mode
        ↓
Stop application
        ↓
Backup database
        ↓
Preserve runtime data
        ↓
Replace application files
        ↓
Preserve .env
        ↓
Preserve WhatsApp session
        ↓
Start latest version
```

The installer must not invoke the uninstall process as part of the upgrade.

---

# 13. Failure Safety

The upgrade must fail safely.

Examples:

### Database backup failure

```text
Backup failed
↓
Do not replace application
↓
Keep existing installation intact
```

### Application process cannot stop

```text
Process still running
↓
Do not overwrite locked files blindly
↓
Handle the condition safely
```

### Database cannot be opened after update

The implementation must provide a rollback-safe path using the pre-upgrade database backup.

Do not automatically delete the database because it failed to open.

### Installation interrupted

The existing user data must remain protected.

Do not introduce a cleanup step that deletes the database during installer failure handling.

---

# 14. Rollback Requirement

The implementation must consider rollback during upgrade.

At minimum, before upgrading:

```text
Existing database
        ↓
Timestamped backup
```

If the application replacement fails, the database backup must remain available.

Do not automatically delete the backup immediately after installation.

The backup should remain available until the normal application backup-retention process handles it.

Do not implement destructive automatic cleanup just to make the installer directory look tidy.

---

# 15. Do Not Change Frontend UI

This feature is an installation/update infrastructure feature.

Therefore:

**DO NOT modify frontend UI components.**

Do not change:

- Layout
- Colors
- Buttons
- Navigation
- Forms
- Tables
- Dashboards
- Icons
- CSS
- User workflows
- WhatsApp Hub UI
- POS UI
- Inventory UI
- CRM UI
- Reports UI

The application should look and behave exactly the same after the update except that the underlying application version is newer.

---

# 16. Do Not Change Business Logic

Do not modify unrelated business logic.

Do not change:

- POS calculations
- GST calculations
- Inventory calculations
- Purchase logic
- Sales logic
- CRM logic
- Refill automation
- WhatsApp automation
- Reports
- Authentication
- Medicine processing
- Database business rules

unless inspection proves a specific existing file must be changed to safely support the upgrade.

The goal is:

**upgrade mechanism only.**

---

# 17. Exact File Scope Rule

Before editing anything, inspect the repository and identify the exact files responsible for:

1. Windows packaging
2. Inno Setup installation
3. Application versioning
4. Database initialization/migration
5. Existing database backup
6. Runtime data location
7. Application shutdown/startup during installation

Then create an explicit internal list:

```text
TARGET FILES:
- file A → why it must change
- file B → why it must change
- file C → why it must change
```

Only those files may be modified.

Do not modify a file merely because it is nearby or related indirectly.

---

# 18. New File Rule

Do not create a new file unless absolutely necessary.

Before creating a new file, inspect whether the functionality can safely be implemented inside an existing installer, packaging, backup, versioning, or database-related file.

If a new file is genuinely required:

1. Explain why existing files cannot safely contain the functionality.
2. Create only that required file.
3. Keep its responsibility narrowly limited to the upgrade mechanism.
4. Do not add unrelated utilities or refactors.

---

# 19. Existing Backup System

Inspect:

```text
scripts/backup.mjs
```

before changing anything.

It already targets:

```text
data/app.db
```

and creates timestamped backups.

Reuse this logic where practical rather than creating duplicate database-backup logic.

If the installer cannot directly call the existing script because of the packaged production architecture, implement only the minimum equivalent backup behavior required by the installer.

Do not maintain two conflicting backup implementations unnecessarily.

---

# 20. Installer Data Directory Rules

Ensure the installer does not accidentally treat the following as disposable installation files:

```text
data/
uploads/
backup/
.wwebjs_auth/
.wwebjs_cache/
```

The installer must differentiate between:

```text
application payload
```

and:

```text
persistent user/runtime data
```

This distinction is mandatory.

---

# 21. Testing Requirements

After implementation, test the upgrade using a realistic existing installation.

Create/test an installation containing:

- Existing database
- Existing sales
- Existing purchases
- Existing inventory
- Existing customers
- Existing settings
- Existing uploaded files
- Existing backup
- Existing WhatsApp session data if available
- Existing `.env`

Then install the newer build over it.

Verify:

```text
Database → still present
Sales → still present
Purchases → still present
Inventory → still present
Customers → still present
Settings → still present
Uploads → still present
Backups → still present
.env → preserved
WhatsApp session → preserved
Application → starts
Frontend → unchanged
```

---

# 22. Fresh Installation Test

Do not test only upgrades.

Also verify that a completely new PC/install with no existing application data still works.

Expected:

```text
Fresh PC
↓
Installer
↓
New installation
↓
Required directories created
↓
Database initialized correctly
↓
Application starts
```

The new upgrade logic must not break first-time installation.

---

# 23. Upgrade Test

Test:

```text
Version N
↓
Install Version N+1
```

Verify that the application starts with the exact same user data.

Then test:

```text
Version N+1
↓
Install Version N+2
```

to verify that upgrades work repeatedly.

Do not assume a one-time upgrade test is sufficient.

---

# 24. Data Integrity Cross-Check

Before upgrading, record representative values from the existing database.

After upgrading, compare:

```text
Medicine count
Customer count
Sales count
Purchase count
Inventory records
Important settings
Relevant WhatsApp configuration
```

The values must remain consistent unless a legitimate database migration intentionally changes the schema without changing the underlying business records.

Do not use a simple “application opened successfully” test as proof of data preservation.

---

# 25. Process Safety

The installer must account for the fact that `PharmacyOS.exe` may already be running.

Before replacing locked application files:

```text
Detect running process
↓
Request/perform controlled shutdown
↓
Wait for termination
↓
Verify process is no longer running
↓
Continue upgrade
```

Do not kill unrelated processes.

Only target the AI Pharmacy OS process.

---

# 26. No Unrelated Refactoring

Do not:

- Rename unrelated files
- Reformat unrelated code
- Upgrade unrelated dependencies
- Change package versions unnecessarily
- Refactor backend services
- Refactor frontend components
- Rewrite database code unnecessarily
- Change API contracts
- Change routes
- Change UI
- Clean up unrelated installer code
- Modify unrelated scripts

This is a focused production-safety change, not a general code cleanup exercise.

---

# 27. Git Diff Verification

After implementation:

1. Run `git status`.
2. Run the complete diff.
3. Review every changed file.
4. Compare every change against the original objective.
5. Identify any unrelated modification.
6. Revert unrelated modifications.

The final diff must contain only files directly required for:

**safe in-place application upgrade and data preservation.**

---

# 28. Required Validation

Run the existing project validation commands relevant to the changed areas.

At minimum, inspect and run the appropriate existing:

```text
npm run build
npm run build:client
npm run build:all
npm run guardrails
```

and the installer build process:

```text
npm run build:exe
```

where the environment supports it.

Do not modify validation scripts simply to make the checks pass.

If a test cannot be executed because the environment lacks Windows/Inno Setup tooling, clearly report that instead of claiming the installer was fully tested.

---

# 29. Final Cross-Check Before Completion

Before reporting completion, verify every requirement:

```text
[ ] Existing installation detected
[ ] Upgrade does not require uninstall
[ ] Database backup created before replacement
[ ] data/app.db preserved
[ ] uploads preserved
[ ] backup preserved
[ ] .wwebjs_auth preserved
[ ] .wwebjs_cache preserved
[ ] .env preserved
[ ] Existing database is reused
[ ] Database migration is safe
[ ] No blank database replaces existing database
[ ] Application process handled safely
[ ] New application files installed
[ ] Fresh installation still works
[ ] Existing installation still works
[ ] Frontend UI unchanged
[ ] Business logic unchanged
[ ] WhatsApp behavior unchanged
[ ] Refill automation unchanged
[ ] No unrelated files modified
[ ] Complete git diff reviewed
[ ] Build validation completed
[ ] Installer validation completed where possible
```

Only after all applicable checks pass should the implementation be considered complete.

---

# 30. Required Short Final Report From the Code Agent

After completing the implementation, provide a short comparison using this exact structure:

## Old Behavior

- User had to uninstall/reinstall or risk replacing the installation.
- Runtime data could be exposed to deletion during uninstall.
- Existing database required manual protection.
- Existing WhatsApp/session data required protection from replacement.

## New Behavior

- User installs the latest version directly over the existing installation.
- Uninstall is not required.
- Existing `data/app.db` is preserved.
- Database is backed up before upgrade.
- Existing uploads and backups are preserved.
- Existing `.env` is preserved.
- Existing WhatsApp authentication/session data is preserved.
- Application files are updated without deleting user data.
- Database migrations, if required, operate on the existing database.
- Fresh installations continue to work.
- Frontend UI remains unchanged.

## Files Modified

List only the exact files changed and one short reason for each.

## Files Created

If none:

`None.`

If any were created, explain exactly why an existing file could not safely contain the required functionality.

## Validation

Report:

- Build result
- Installer build result
- Database preservation result
- Fresh installation result
- Upgrade result
- Git diff review result
- Confirmation that unrelated files were not modified

Do not claim the upgrade is 100% safe merely because the code compiles. The installer must also be tested against an actual existing installation/data set where possible.

# Final Rule

**The implementation must solve only this requirement:**

> Allow the latest AI Pharmacy V3 Windows application to be installed over the existing version without uninstalling it, while preserving all existing pharmacy data, configuration, backups, uploads, and WhatsApp session/runtime data.

Everything else in the application must remain untouched unless it is directly required to achieve that outcome.