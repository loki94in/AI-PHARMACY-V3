@echo off
title Video Playback & Hardware Acceleration Optimizer
echo Running Video Hardware Optimization for NVIDIA GT 730 + i7-4770TE...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0optimize-video-hardware.ps1"
echo.
pause
