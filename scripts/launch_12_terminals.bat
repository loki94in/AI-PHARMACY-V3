@echo off
TITLE AI Pharmacy - Catalog Image Harvester (12 Terminals from CSV)
echo ===============================================================
echo   AI PHARMACY - 12 TERMINAL IMAGE HARVESTER (CSV COMPANY QUEUE)
echo ===============================================================
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
echo  - Terminal 12: ~882 companies (TORRENT, INVISION, J^&J...)   [3 keys, 4s delay]
echo.
echo Features:
echo  1. Watermark-Free: Gumlet/DAM transformations stripped for pristine studio photos.
echo  2. 4 Angles Saved: Front, Back, Side/Composition, Combo (compressed 1200px).
echo  3. Auto Fast-Skip: Completed medicines/companies are skipped in milliseconds.
echo  4. Continuous Run: Auto-advances through company queue until CSV is 100%% complete.
echo  5. Database Auto-Commit: Automatically commits Git milestone every 1,000 new images in database.
echo.
echo Launching all 12 harvester terminals now...

start "Harvester T1 [ZYDUS/EMCURE+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=1"
start "Harvester T2 [CIPLA/GLENMARK+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=2"
start "Harvester T3 [INTAS/DR REDDY+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=3"
start "Harvester T4 [ZEE/MACLEODS+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=4"
start "Harvester T5 [ABBOTT/ALEMBIC+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=5"
start "Harvester T6 [ALKEM/HUL+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=6"
start "Harvester T7 [RANBAXY/WOCKHARDT+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=7"
start "Harvester T8 [LUPIN/DABUR+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=8"
start "Harvester T9 [MICRO LABS/LEEFORD+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=9"
start "Harvester T10 [MANKIND/NOVARTIS+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=10"
start "Harvester T11 [SUN PHARMA/IPCA+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=11"
start "Harvester T12 [TORRENT/J&J+]" cmd /k "npx tsx scripts/harvest_top100_company_images.ts --terminal=12"

echo All 12 terminals launched!
