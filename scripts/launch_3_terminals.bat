@echo off
setlocal enabledelayedexpansion
TITLE AI Pharmacy - Smart Routing Harvester (3 Dedicated Terminals: PharmEasy, 1mg, Dawa India)

:: Ensure the working directory is always the project root
cd /d "%~dp0\.."

echo ===============================================================
echo   AI PHARMACY - 3 TERMINAL SMART ROUTING IMAGE HARVESTER
echo   Auto-Relay: PharmEasy (T1) -^> Tata 1mg (T2) -^> Dawa India (T3)
echo   Auto-Skip: Already Downloaded Images Skip in ^<1ms
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
echo Launching 3 coordinated terminals (Smart Routing Relay + Auto-Skip):
echo  - Terminal 1 : [T1 - PHARMEASY HARVESTER] (Primary pharma CDN)
echo  - Terminal 2 : [T2 - TATA 1MG HARVESTER] (Zero-watermark studio packshots)
echo  - Terminal 3 : [T3 - DAWA INDIA HARVESTER] (Authentic generic packaging)
echo.
echo Key Architecture:
echo  - Smart Relay: Missing items in T1 auto-route to T2; missing in T2 auto-route to T3
echo  - Exhausted items route to Pharmacist Human Review (/catalog/images)
echo  - Auto-Skip: Already downloaded/verified images skip in ^<1ms
echo  - Zero watermarks: Gumlet / Cloudinary watermarks stripped automatically
echo  - Rate-limit protection: 8 isolated Gemini keys per terminal
echo  - No tsx watch: CPU stays cool and responsive
echo.

start "Harvester T1 [PharmEasy Source]" /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=1 --source=pharmeasy"
start "Harvester T2 [Tata 1mg Source - No Watermarks]" /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=2 --source=1mg"
start "Harvester T3 [Dawa India Generic Source]" /D "%~dp0\.." cmd /k "%CMD_BASE% --terminal=3 --source=davaindia"

echo All 3 smart routing terminals launched successfully!
echo To run a specific company in the future, use:
echo   scripts\launch_3_terminals.bat "SUN PHARMA"
echo.
