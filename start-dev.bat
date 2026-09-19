@echo off
echo Starting AI Pharmacy Dev Server in detached window...
start "AI Pharmacy Dev" powershell -NoExit -Command "cd /d 'e:\CURRENT PROJECT ON WORKING\AI PHARMACY v2'; npm run dev"
echo Dev server launched. Close this terminal safely.
