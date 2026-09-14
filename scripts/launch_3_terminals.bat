@echo off
setlocal enabledelayedexpansion
TITLE AI Pharmacy - Catalog Image Harvester (3 Terminals, 8 Keys Each, Sharded)

:: Ensure the working directory is always the project root
cd /d "%~dp0\.."

echo ===============================================================
echo   AI PHARMACY - 3 TERMINAL IMAGE HARVESTER (SHARDED BY MEDICINE)
echo ===============================================================
echo Working Directory: %CD%
echo.

set COMPANY_NAME=%~1

if not "%COMPANY_NAME%"=="" (
  echo Targeting Single Company: "%COMPANY_NAME%"
  set CMD_BASE=npx tsx scripts/harvest_top100_company_images.ts --company="%COMPANY_NAME%"
) else (
  echo Mode: Processing All Companies Sequentially in Lockstep (Highest Volume First)
  set CMD_BASE=npx tsx scripts/harvest_top100_company_images.ts
)

echo.
echo Launching 3 coordinated terminals (Zero CPU thrashing, 8 Gemini keys each):
echo  - Terminal 1 : Shard 1/3 (Medicines 1, 4, 7, 10...) [8 dedicated Gemini keys]
echo  - Terminal 2 : Shard 2/3 (Medicines 2, 5, 8, 11...) [8 dedicated Gemini keys]
echo  - Terminal 3 : Shard 3/3 (Medicines 3, 6, 9, 12...) [8 dedicated Gemini keys]
echo.
echo Key Architecture:
echo  - Images stored in clean per-company folders: /products/^<company-slug^>/
echo  - Safe buffer staging: unverified images NEVER overwrite good photos on disk
echo  - Real-time skip guard: already-verified medicines skip in ^<1ms
echo  - Rate-limit protection: 8 keys per terminal eliminate HTTP 429 errors
echo  - No tsx watch: CPU stays cool and responsive
echo.

start "Harvester T1 [Shard 1/3]" /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=1"
start "Harvester T2 [Shard 2/3]" /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=2"
start "Harvester T3 [Shard 3/3]" /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=3"

echo All 3 terminals launched successfully!
echo To run a specific company in the future, use:
echo   scripts\launch_3_terminals.bat "SUN PHARMA"
echo.
