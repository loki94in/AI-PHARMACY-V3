@echo off
cd /d "%~dp0"
echo ===================================================
echo Stopping AI Pharmacy OS and releasing Port 5175...
echo ===================================================

taskkill /F /IM PharmacyOS.exe >nul 2>&1

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5175 ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
)

echo AI Pharmacy OS stopped cleanly. Port 5175 is free.
timeout /t 2 >nul
