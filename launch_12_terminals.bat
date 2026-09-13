@echo off
setlocal enabledelayedexpansion
TITLE AI Pharmacy - Catalog Image Harvester (12 Terminals from CSV)

:: Ensure working directory is the project root
cd /d "%~dp0"

echo ===============================================================
echo   AI PHARMACY - 12 TERMINAL IMAGE HARVESTER (CSV COMPANY QUEUE)
echo ===============================================================
echo Working Directory: %CD%
echo.
echo Launching 12 parallel harvester terminals across 10,592 companies:
echo  - Terminal 1 : ~883 companies (ZYDUS, EMCURE, HIMALAYA...)  [2 keys, 4s delay]
echo  - Terminal 2 : ~883 companies (CIPLA, GLENMARK, AJANTA...)  [2 keys, 4s delay]
echo  - Terminal 3 : ~883 companies (INTAS, DR REDDY, SHREYA...)  [2 keys, 4s delay]
echo  - Terminal 4 : ~883 companies (ZEE LABS, MACLEODS, UNICHEM) [2 keys, 4s delay]
echo  - Terminal 5 : ~883 companies (ABBOTT, ALEMBIC, ARISTO...)  [2 keys, 4s delay]
echo  - Terminal 6 : ~883 companies (ALKEM, HUL, EAST WEST...)   [2 keys, 4s delay]
echo  - Terminal 7 : ~883 companies (RANBAXY, WOCKHARDT, GSK...)  [2 keys, 4s delay]
echo  - Terminal 8 : ~883 companies (LUPIN, ELDER, DABUR...)      [2 keys, 4s delay]
echo  - Terminal 9 : ~883 companies (MICRO LABS, LEEFORD, SWIFT)  [2 keys, 4s delay]
echo  - Terminal 10: ~882 companies (MANKIND, SYMBIOSIS, NOVARTIS)[2 keys, 4s delay]
echo  - Terminal 11: ~882 companies (SUN PHARMA, IPCA, OLCARE...) [2 keys, 4s delay]
echo  - Terminal 12: ~882 companies (TORRENT, INVISION, JOHNSON)  [3 keys, 4s delay]
echo.
echo Features:
echo  1. Watermark-Free: Gumlet/DAM transformations stripped for pristine studio photos.
echo  2. 4 Angles Saved: Front, Back, Side/Composition, Combo (compressed 1200px).
echo  3. Hot-Reload (tsx watch): Automatically reloads on code updates without losing state.
echo  4. Auto-Resume & Fast-Skip: Completed medicines/companies are skipped in milliseconds.
echo  5. Rescue Past Rejections (--retry-rejected): Re-evaluates past strict discards.
echo  6. Database Auto-Commit: Automatically commits Git milestone every 1,000 new images in database.
echo.
echo Launching all 12 harvester terminals with Hot-Reload (watch) & Auto-Resume now...

set WATCH_CMD=npx tsx watch --clear-screen=false --exclude data/** --exclude frontend/public/products/** --exclude uploads/** scripts/harvest_top100_company_images.ts --retry-rejected

start "Harvester T1 [ZYDUS/EMCURE]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=1"
start "Harvester T2 [CIPLA/GLENMARK]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=2"
start "Harvester T3 [INTAS/DR REDDY]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=3"
start "Harvester T4 [ZEE LABS/MACLEODS]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=4"
start "Harvester T5 [ABBOTT/ALEMBIC]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=5"
start "Harvester T6 [ALKEM/HUL]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=6"
start "Harvester T7 [RANBAXY/WOCKHARDT]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=7"
start "Harvester T8 [LUPIN/DABUR]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=8"
start "Harvester T9 [MICRO LABS/LEEFORD]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=9"
start "Harvester T10 [MANKIND/NOVARTIS]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=10"
start "Harvester T11 [SUN PHARMA/IPCA]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=11"
start "Harvester T12 [TORRENT/JOHNSON]" /D "%~dp0" cmd /k "%WATCH_CMD% --terminal=12"

echo All 12 terminals launched!

