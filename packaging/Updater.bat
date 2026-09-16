@echo off
:: ============================================================
:: AI Pharmacy OS — Dedicated Updater
:: PRODUCTION.md §22, §23, §24, §25, §26, §27
::
:: Usage (called by autoUpdateService.ts):
::   Updater.bat <update-zip-path> <install-dir> <target-version> <sha256> <log-path>
::
:: Flow:
::   1. Write update.lock
::   2. Wait for PharmacyOS.exe to exit (graceful → taskkill fallback)
::   3. Verify SHA-256 of downloaded zip
::   4. Backup install dir → backup\preupdate-YYYYMMDDHHMMSS\
::   5. Extract zip over install dir
::   6. Verify PharmacyOS.exe exists after extraction
::   7. Write success.json or failure.json
::   8. Delete update.lock
::   9. Start new (or old on rollback) PharmacyOS.exe
:: ============================================================

setlocal enabledelayedexpansion

:: ── Arguments ──────────────────────────────────────────────
set "ZIP_PATH=%~1"
set "INSTALL_DIR=%~2"
set "TARGET_VERSION=%~3"
set "EXPECTED_SHA256=%~4"
set "LOG_PATH=%~5"

:: ── Defaults ───────────────────────────────────────────────
if "%ZIP_PATH%"==""         ( echo [Updater] ERROR: No zip path provided. & exit /b 1 )
if "%INSTALL_DIR%"==""      ( echo [Updater] ERROR: No install dir provided. & exit /b 1 )
if "%TARGET_VERSION%"==""   set "TARGET_VERSION=unknown"
if "%LOG_PATH%"==""         set "LOG_PATH=%INSTALL_DIR%\logs\updater.log"

:: ── Ensure log dir exists ──────────────────────────────────
for %%D in ("%LOG_PATH%") do if not exist "%%~dpD" mkdir "%%~dpD" 2>nul

:: ── Logging helper ─────────────────────────────────────────
call :LOG "=============================="
call :LOG "AI Pharmacy OS Updater Started"
call :LOG "Target version : %TARGET_VERSION%"
call :LOG "ZIP path       : %ZIP_PATH%"
call :LOG "Install dir    : %INSTALL_DIR%"
call :LOG "=============================="

:: ── 1. Write update.lock ───────────────────────────────────
set "LOCK_PATH=%INSTALL_DIR%\updates\update.lock"
set "STAGING_DIR=%INSTALL_DIR%\updates\staging"
if not exist "%INSTALL_DIR%\updates" mkdir "%INSTALL_DIR%\updates"
if not exist "%STAGING_DIR%" mkdir "%STAGING_DIR%"

:: Check for a stale lock (older than 30 minutes = another updater may have crashed)
if exist "%LOCK_PATH%" (
    call :LOG "WARNING: Existing update.lock found. Checking if stale..."
    set "LOCK_AGE_STALE=1"
    :: powershell check: if file is < 30 min old, abort
    powershell -NoProfile -Command "$f='%LOCK_PATH%'; $age=(Get-Date)-(Get-Item $f).LastWriteTime; if($age.TotalMinutes -lt 30){exit 1}else{exit 0}" >nul 2>&1
    if !ERRORLEVEL!==1 (
        call :LOG "ERROR: Active update.lock found (< 30 min old). Another update may be running. Aborting."
        exit /b 1
    )
    call :LOG "Stale lock detected (> 30 min). Removing and continuing."
    del /f /q "%LOCK_PATH%" >nul 2>&1
)

:: Write lock
echo {"pid":"%~$PID:0%","ts":"%DATE% %TIME%","targetVersion":"%TARGET_VERSION%","operation":"update"} > "%LOCK_PATH%"
call :LOG "update.lock written."

:: ── 2. Wait for PharmacyOS.exe to exit ────────────────────
call :LOG "Waiting for PharmacyOS.exe to exit..."
set /a WAIT_COUNT=0
:WAIT_LOOP
    tasklist /FI "IMAGENAME eq PharmacyOS.exe" 2>nul | findstr /I "PharmacyOS.exe" >nul 2>&1
    if !ERRORLEVEL!==0 (
        set /a WAIT_COUNT+=1
        if !WAIT_COUNT! GEQ 20 (
            call :LOG "PharmacyOS.exe still running after 10s. Using taskkill as fallback..."
            taskkill /F /IM PharmacyOS.exe >nul 2>&1
            timeout /t 2 /nobreak >nul
            goto :WAIT_DONE
        )
        timeout /t 1 /nobreak >nul
        goto :WAIT_LOOP
    )
:WAIT_DONE
call :LOG "PharmacyOS.exe is no longer running."

:: ── 3. Verify SHA-256 ──────────────────────────────────────
if not "%EXPECTED_SHA256%"=="" (
    call :LOG "Verifying SHA-256 of update package..."
    for /f "usebackq delims=" %%H in (
        `powershell -NoProfile -Command "(Get-FileHash '%ZIP_PATH%' -Algorithm SHA256).Hash.ToLower()"`
    ) do set "ACTUAL_SHA256=%%H"

    if /i not "!ACTUAL_SHA256!"=="%EXPECTED_SHA256%" (
        call :LOG "ERROR: SHA-256 mismatch!"
        call :LOG "  Expected: %EXPECTED_SHA256%"
        call :LOG "  Actual  : !ACTUAL_SHA256!"
        call :WRITE_FAILURE "CHECKSUM_MISMATCH"
        del /f /q "%ZIP_PATH%" >nul 2>&1
        call :CLEANUP_LOCK
        start "" "%INSTALL_DIR%\PharmacyOS.exe"
        exit /b 1
    )
    call :LOG "SHA-256 verified OK."
) else (
    call :LOG "WARNING: No expected SHA-256 provided — skipping checksum verification."
)

:: ── 4. Backup current install ──────────────────────────────
set "TIMESTAMP="
for /f "tokens=2 delims==" %%T in ('wmic os get LocalDateTime /value 2^>nul ^| findstr LocalDateTime') do set "TIMESTAMP=%%T"
:: Format: YYYYMMDDHHmmss
set "TIMESTAMP=!TIMESTAMP:~0,14!"
if "!TIMESTAMP!"=="" set "TIMESTAMP=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%120000"
set "BACKUP_DIR=%INSTALL_DIR%\backup\preupdate-!TIMESTAMP!"
call :LOG "Creating pre-update backup at: !BACKUP_DIR!"

mkdir "!BACKUP_DIR!" 2>nul
:: Back up only the files that the update will replace
if exist "%INSTALL_DIR%\PharmacyOS.exe" copy /Y "%INSTALL_DIR%\PharmacyOS.exe" "!BACKUP_DIR!\PharmacyOS.exe" >nul 2>&1
if exist "%INSTALL_DIR%\sea-entry.cjs"  copy /Y "%INSTALL_DIR%\sea-entry.cjs"  "!BACKUP_DIR!\sea-entry.cjs"  >nul 2>&1
if exist "%INSTALL_DIR%\Updater.bat"    copy /Y "%INSTALL_DIR%\Updater.bat"    "!BACKUP_DIR!\Updater.bat"    >nul 2>&1

:: Verify backup has PharmacyOS.exe
if not exist "!BACKUP_DIR!\PharmacyOS.exe" (
    call :LOG "ERROR: Backup of PharmacyOS.exe failed."
    call :WRITE_FAILURE "EXECUTABLE_BACKUP_FAILED"
    call :CLEANUP_LOCK
    start "" "%INSTALL_DIR%\PharmacyOS.exe"
    exit /b 1
)
call :LOG "Backup created successfully."

:: Back up data/app.db as well (PRODUCTION.md §25)
if exist "%INSTALL_DIR%\data\app.db" (
    call :LOG "Backing up data/app.db..."
    copy /Y "%INSTALL_DIR%\data\app.db" "!BACKUP_DIR!\app-preupdate-!TIMESTAMP!.db" >nul 2>&1
    if not exist "!BACKUP_DIR!\app-preupdate-!TIMESTAMP!.db" (
        call :LOG "WARNING: data/app.db backup failed — continuing anyway."
    ) else (
        call :LOG "data/app.db backup OK."
    )
)

:: ── 5. Extract update ZIP ──────────────────────────────────
call :LOG "Extracting update package..."
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%INSTALL_DIR%' -Force" >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    call :LOG "ERROR: ZIP extraction failed (code !ERRORLEVEL!)."
    call :ROLLBACK "!BACKUP_DIR!" "FILE_REPLACEMENT_FAILED"
    exit /b 1
)
call :LOG "Extraction complete."

:: ── 6. Verify new PharmacyOS.exe ──────────────────────────
if not exist "%INSTALL_DIR%\PharmacyOS.exe" (
    call :LOG "ERROR: PharmacyOS.exe missing after extraction."
    call :ROLLBACK "!BACKUP_DIR!" "FILE_REPLACEMENT_FAILED"
    exit /b 1
)
call :LOG "PharmacyOS.exe verified after extraction."

:: ── 7. Write success record ────────────────────────────────
echo {"version":"%TARGET_VERSION%","ts":"%DATE% %TIME%","result":"success"} > "%STAGING_DIR%\success.json"
call :LOG "Update v%TARGET_VERSION% applied successfully."

:: ── 8. Remove staging zip and lock ────────────────────────
del /f /q "%ZIP_PATH%" >nul 2>&1
call :CLEANUP_LOCK

:: ── 9. Start new version ──────────────────────────────────
call :LOG "Starting new PharmacyOS.exe..."
timeout /t 2 /nobreak >nul
if exist "%INSTALL_DIR%\RUN-PharmacyOS-Silent.vbs" (
    start "" wscript.exe "%INSTALL_DIR%\RUN-PharmacyOS-Silent.vbs"
) else (
    start "" "%INSTALL_DIR%\PharmacyOS.exe"
)

call :LOG "Updater finished successfully."
exit /b 0

:: ============================================================
:: Subroutines
:: ============================================================

:LOG
echo [%DATE% %TIME%] %~1
echo [%DATE% %TIME%] %~1 >> "%LOG_PATH%" 2>nul
exit /b 0

:WRITE_FAILURE
echo {"version":"%TARGET_VERSION%","error":"%~1","ts":"%DATE% %TIME%"} > "%STAGING_DIR%\failure.json"
call :LOG "Failure recorded: %~1"
exit /b 0

:CLEANUP_LOCK
if exist "%LOCK_PATH%" del /f /q "%LOCK_PATH%" >nul 2>&1
exit /b 0

:ROLLBACK
set "RBACK_DIR=%~1"
set "RBACK_REASON=%~2"
call :LOG "Rolling back to previous version from: !RBACK_DIR! (reason: !RBACK_REASON!)"
if exist "!RBACK_DIR!\PharmacyOS.exe" (
    copy /Y "!RBACK_DIR!\PharmacyOS.exe" "%INSTALL_DIR%\PharmacyOS.exe" >nul 2>&1
)
if exist "!RBACK_DIR!\sea-entry.cjs" (
    copy /Y "!RBACK_DIR!\sea-entry.cjs" "%INSTALL_DIR%\sea-entry.cjs" >nul 2>&1
)
call :WRITE_FAILURE "!RBACK_REASON!"
echo {"version":"%TARGET_VERSION%","error":"!RBACK_REASON!","ts":"%DATE% %TIME%","rollback":"attempted"} > "%STAGING_DIR%\rollback.json"
call :CLEANUP_LOCK
call :LOG "Rollback complete. Starting old PharmacyOS.exe..."
timeout /t 2 /nobreak >nul
start "" "%INSTALL_DIR%\PharmacyOS.exe"
exit /b 0
