@echo off
title Installazione - Torneo Calcetto Saponato
set SCRIPT_DIR=%~dp0

echo.
echo  ============================================================
echo   Installazione Torneo Calcetto Saponato
echo  ============================================================
echo.

:: Esegui lo script PowerShell di installazione
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%installa.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [ERRORE] L'installazione e' terminata con codice %ERRORLEVEL%
    echo  Controlla il file installa.log per i dettagli.
    pause
) else (
    echo.
    echo  Installazione completata. Puoi chiudere questa finestra.
    pause
)
