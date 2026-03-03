@echo off
title Torneo Calcetto Saponato - Arresto
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%stop.ps1"
pause
