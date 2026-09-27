# Dual-Install Port Conflict — Permanent Fix Implementation Plan

## Problem
Two AI Pharmacy OS installations on different drives (G:\ and C:\AppData\Local)
both used port 5175. When new install launched and found old one running, it
opened browser to OLD backend → white screen + WhatsApp loading loop (not a code crash).

## Root Cause
`installer.iss` had `GetDefaultInstallDir` logic that preferred D:\, E:\, G:\ drives
over %LOCALAPPDATA%, causing installs to scatter across drives. The old G:\ instance
would run silently in background on port 5175 while the new C:\ install connected
to its stale backend.

## What Was Fixed

### TASK 1: PC Cleanup ✅ COMPLETE (2026-09-27)
- [x] Killed G:\AI Pharmacy OS\PharmacyOS.exe (PID 13084)
- [x] Uninstalled G:\AI Pharmacy OS\ (ran unins000.exe /VERYSILENT)
- [x] Uninstalled C:\Users\ratna\AppData\Local\AI Pharmacy OS\ (ran unins000.exe /VERYSILENT)
- [x] User data preserved: G:\AI Pharmacy OS\{data,backup,uploads,catalogue} — NOT deleted
- [x] Port 5175 now free, no running PharmacyOS processes

### TASK 2: server.ts — Smart EADDRINUSE handler ✅ COMPLETE
- [x] When port 5175 is already bound, new code uses netstat + wmic to find owning PID
- [x] Checks if owning process exe path == current exe path (same install = just open window)
- [x] If DIFFERENT path (ghost/old install) → `taskkill /F /PID` it, then retry listen
- [x] Retry loop: up to 10 attempts × 800ms until port is free
- [x] Only falls back to open-window if owner PID cannot be determined
- File: src/server.ts lines ~569-645

### TASK 3: installer.iss — Standardized install path ✅ COMPLETE
- [x] Removed GetDefaultInstallDir() — no more D:/E:/G: drive priority logic
- [x] DefaultDirName now always = {localappdata}\AI Pharmacy OS (Windows standard)
- [x] Removed DataDir wizard page — no more "Select Database Location" confusion
- [x] GetDataDir() always returns {app}\data (data stays beside the exe)
- [x] CurStepChanged now strips any stale DATA_DIR= line from .env on install
- [x] Removed unused variables TargetDataDir, NewEnvContent
- File: installer.iss

## Next Step
Build a fresh installer: `npm run build:exe`
Then install from the new .exe — it will always go to C:\Users\ratna\AppData\Local\AI Pharmacy OS\
and never create cross-drive ghost instances again.

## Files Changed
- `src/server.ts` — EADDRINUSE smart handler
- `installer.iss` — standardized install path + removed DataDir wizard
