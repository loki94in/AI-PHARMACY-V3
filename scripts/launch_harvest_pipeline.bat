@echo off
setlocal enabledelayedexpansion
TITLE AI Pharmacy - High Performance Image Harvester

cd /d "%~dp0\.."

:MENU
cls
echo ======================================================================
echo       AI PHARMACY - OFFLINE CATALOG IMAGE PIPELINE
echo       (Zero Duplicates | Local Disk Pre-Scan | Auto-Resume)
echo ======================================================================
echo.
echo Current Status:
echo   - Local PC Packaging Files: 27,940+ indexed on disk across 56 companies
echo   - AI OCR Engine: 100%% Offline Local ONNX PaddleOCR (Zero API keys)
echo   - Resume Protection: Atomic state sync (Safe against PC shutdown/Ctrl+C)
echo.
echo Select Pipeline Mode:
echo   [1] Run 10-Image Live Benchmark Profiler (Test CPU, RAM, and Disk)
echo   [2] Auto-Resume Next Company (1 Downloader + 1 Batch OCR) [RECOMMENDED]
echo   [3] Choose Specific Company Catalog to Complete (e.g. Cipla, Zydus...)
echo   [4] Run Continuous Harvester (All Companies Sequentially to 100%%)
echo   [5] Dedicated Batch OCR Worker Only (Watch Mode)
echo   [6] View Company Catalog Status ^& Progress Dashboard
echo   [7] Exit
echo.
set /p CHOICE="Enter choice [1-7]: "

if "%CHOICE%"=="1" (
  cls
  echo Running 10-Image Benchmark Profiler...
  npx tsx scripts/test_10_images_benchmark.ts
  echo.
  pause
  goto MENU
)

if "%CHOICE%"=="2" (
  echo Launching 2 Terminals (Downloader + Batch OCR) for active company...
  start "Harvester - Stage 1 Downloader" cmd /k "cd /d "%~dp0\.." && npx tsx scripts/fast_image_downloader.ts --single-company"
  start "Harvester - Stage 2 Batch OCR" cmd /k "cd /d "%~dp0\.." && npx tsx scripts/batch_ocr_worker.ts --watch"
  echo Both terminals launched! They will auto-resume exactly where you left off.
  echo Close this window or press any key to return to menu.
  pause >nul
  goto MENU
)

if "%CHOICE%"=="3" (
  cls
  echo ======================================================================
  echo Enter company name or part of name to target (e.g. CIPLA, ZYDUS, ABBOTT):
  echo ======================================================================
  set /p COMP="Company Name: "
  if "!COMP!"=="" goto MENU
  start "Harvester - Company Downloader" cmd /k "cd /d "%~dp0\.." && npx tsx scripts/fast_image_downloader.ts --company="!COMP!" --single-company"
  start "Harvester - Stage 2 Batch OCR" cmd /k "cd /d "%~dp0\.." && npx tsx scripts/batch_ocr_worker.ts --watch"
  echo Launched processing for "!COMP!"!
  pause
  goto MENU
)

if "%CHOICE%"=="4" (
  echo Launching Continuous Pipeline (All Companies Sequentially)...
  start "Harvester - Continuous Downloader" cmd /k "cd /d "%~dp0\.." && npx tsx scripts/fast_image_downloader.ts --continuous"
  start "Harvester - Batch OCR" cmd /k "cd /d "%~dp0\.." && npx tsx scripts/batch_ocr_worker.ts --watch"
  echo Continuous pipeline launched!
  pause
  goto MENU
)

if "%CHOICE%"=="5" (
  cls
  echo Starting Dedicated Offline Batch OCR Worker (Watch Mode)...
  npx tsx scripts/batch_ocr_worker.ts --watch
  pause
  goto MENU
)

if "%CHOICE%"=="6" (
  cls
  npx tsx scripts/harvest_status.ts
  echo.
  pause
  goto MENU
)

if "%CHOICE%"=="7" (
  exit /b
)

goto MENU
