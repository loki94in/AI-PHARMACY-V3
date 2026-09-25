@echo off
setlocal enabledelayedexpansion
TITLE AI Pharmacy - 12-Terminal High-Speed Catalog Harvester (Dual CDN Relay: PharmEasy + 1mg)

:: Ensure the working directory is always the project root
cd /d "%~dp0\.."

echo ===============================================================
echo   AI PHARMACY - 12 TERMINAL HIGH-SPEED CATALOG IMAGE HARVESTER
echo   Architecture: Dual CDN Cascade (PharmEasy -^> Tata 1mg -^> Human Review)
echo   Mode: Zero Gemini Keys Required (Pure High-Speed Network I/O)
echo   Auto-Skip: Already Downloaded Images Skip in ^<1ms
echo ===============================================================
echo Working Directory: %CD%
echo.

set COMPANY_NAME=%~1

if not "%COMPANY_NAME%"=="" (
  echo Targeting Single Company across all terminals: "%COMPANY_NAME%"
  set CMD_BASE=npx tsx scripts/harvest_top100_company_images.ts --company="%COMPANY_NAME%" --no-gemini --source=all --delay=300
) else (
  echo Mode: Sharding All 10,592 Companies Evenly Across 12 Independent Terminals
  set CMD_BASE=npx tsx scripts/harvest_top100_company_images.ts --no-gemini --source=all --delay=300
)

echo.
echo Launching 12 coordinated parallel terminals:
echo  - Terminal 1 : Partition 1/12  (ZYDUS, EMCURE, HIMALAYA...)
echo  - Terminal 2 : Partition 2/12  (CIPLA, GLENMARK, AJANTA...)
echo  - Terminal 3 : Partition 3/12  (INTAS, DR REDDY, SHREYA...)
echo  - Terminal 4 : Partition 4/12  (ZEE LABS, MACLEODS, UNICHEM...)
echo  - Terminal 5 : Partition 5/12  (ABBOTT, ALEMBIC, ARISTO...)
echo  - Terminal 6 : Partition 6/12  (ALKEM, HUL, EAST WEST...)
echo  - Terminal 7 : Partition 7/12  (RANBAXY, WOCKHARDT, GSK...)
echo  - Terminal 8 : Partition 8/12  (LUPIN, ELDER, DABUR...)
echo  - Terminal 9 : Partition 9/12  (MICRO LABS, LEEFORD, SWIFT...)
echo  - Terminal 10: Partition 10/12 (MANKIND, SYMBIOSIS, NOVARTIS...)
echo  - Terminal 11: Partition 11/12 (SUN PHARMA, IPCA, OLCARE...)
echo  - Terminal 12: Partition 12/12 (TORRENT, INVISION, JOHNSON...)
echo.
echo Performance & Safety:
echo  - No tsx watch: CPU stays cool, responsive and quiet
echo  - Micro-delay: 300ms spacing protects IP from CDN throttling
echo  - Dual-relay: Missing PharmEasy items auto-route to Tata 1mg
echo  - Human-in-the-loop: Exhausted items queue for Pharmacist Review (/catalog/images)
echo.

start "Harvester T1 [Shard 1/12]"  /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=1"
start "Harvester T2 [Shard 2/12]"  /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=2"
start "Harvester T3 [Shard 3/12]"  /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=3"
start "Harvester T4 [Shard 4/12]"  /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=4"
start "Harvester T5 [Shard 5/12]"  /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=5"
start "Harvester T6 [Shard 6/12]"  /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=6"
start "Harvester T7 [Shard 7/12]"  /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=7"
start "Harvester T8 [Shard 8/12]"  /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=8"
start "Harvester T9 [Shard 9/12]"  /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=9"
start "Harvester T10 [Shard 10/12]" /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=10"
start "Harvester T11 [Shard 11/12]" /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=11"
start "Harvester T12 [Shard 12/12]" /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=12"

echo All 12 terminals launched successfully!
echo To target a specific company anytime, use:
echo   scripts\launch_12_terminals.bat "SUN PHARMA"
echo.
