@echo off
setlocal

set SCRIPT_DIR=%~dp0
set AVVIA_BAT=%SCRIPT_DIR%AVVIA.bat
set CHIUDI_BAT=%SCRIPT_DIR%CHIUDI.bat
set SHORTCUT_AVVIA=%USERPROFILE%\Desktop\⚽ Torneo Calcetto Saponato.lnk
set SHORTCUT_CHIUDI=%USERPROFILE%\Desktop\⚽ Torneo - CHIUDI.lnk

echo.
echo  Creazione collegamento Desktop per Torneo Calcetto Saponato...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$s = $ws.CreateShortcut('%SHORTCUT_AVVIA%'); " ^
  "$s.TargetPath    = '%AVVIA_BAT%'; " ^
  "$s.WorkingDirectory = '%SCRIPT_DIR%'; " ^
  "$s.IconLocation  = '%SystemRoot%\System32\imageres.dll,20'; " ^
  "$s.Description   = 'Avvia Torneo Calcetto Saponato'; " ^
  "$s.WindowStyle   = 1; " ^
  "$s.Save(); " ^
  "Write-Host '  [OK]  Collegamento AVVIA creato sul Desktop.' -ForegroundColor Green"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$s = $ws.CreateShortcut('%SHORTCUT_CHIUDI%'); " ^
  "$s.TargetPath    = '%CHIUDI_BAT%'; " ^
  "$s.WorkingDirectory = '%SCRIPT_DIR%'; " ^
  "$s.IconLocation  = '%SystemRoot%\System32\imageres.dll,95'; " ^
  "$s.Description   = 'Arresta Torneo Calcetto Saponato'; " ^
  "$s.WindowStyle   = 1; " ^
  "$s.Save(); " ^
  "Write-Host '  [OK]  Collegamento CHIUDI creato sul Desktop.' -ForegroundColor Green"

echo.
echo  Collegamento creato! Adesso trovi sul Desktop:
echo    - "Torneo Calcetto Saponato"  (doppio click per avviare)
echo    - "Torneo - CHIUDI"           (doppio click per fermare)
echo.
pause
endlocal
