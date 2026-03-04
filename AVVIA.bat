@echo off
title Torneo Calcetto Saponato
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [ERRORE] Lo script e' terminato con codice %ERRORLEVEL%
    pause
)
