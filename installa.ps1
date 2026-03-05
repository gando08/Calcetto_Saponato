#Requires -Version 5.1
<#
.SYNOPSIS
    Installatore automatico per Torneo Calcetto Saponato.
    Funziona su PC vergini (Windows 10/11) senza software preinstallato.

.DESCRIPTION
    1. Verifica/installa Python 3.9+    (via winget o installer silenzioso)
    2. Verifica/installa Node.js 18 LTS (via winget o installer silenzioso)
    3. Installa le dipendenze Python   (pip install -r requirements.txt)
    4. Installa le dipendenze Node.js  (npm install nel frontend)
    5. Crea collegamento sul Desktop
#>

$ErrorActionPreference = "Stop"
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$LogFile    = Join-Path $ScriptDir "installa.log"
$BackendDir = Join-Path $ScriptDir "backend"
$FrontendDir = Join-Path $ScriptDir "frontend"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Log($msg) {
    $ts = (Get-Date).ToString("HH:mm:ss")
    $line = "[$ts] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

function LogOk($msg)    { Log "  [OK]    $msg" }
function LogWarn($msg)  { Log "  [WARN]  $msg" }
function LogError($msg) { Log "  [ERR]   $msg" }

function Test-CommandExists($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Get-Version($cmd, $args) {
    try {
        $out = & $cmd $args 2>&1 | Select-Object -First 1
        return [string]$out
    } catch { return "" }
}

function Install-WithWinget($id, $label) {
    Log "Installazione $label tramite winget..."
    try {
        winget install --id $id --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
        return $true
    } catch {
        LogWarn "winget non disponibile o installazione fallita per $label"
        return $false
    }
}

function Download-File($url, $dest) {
    Log "Download: $url"
    try {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($url, $dest)
        return $true
    } catch {
        LogError "Download fallito: $_"
        return $false
    }
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# ── Header ────────────────────────────────────────────────────────────────────

Clear-Host
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "   Installazione Torneo Calcetto Saponato" -ForegroundColor Cyan
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $LogFile) { Remove-Item $LogFile -Force }
Log "Inizio installazione - $(Get-Date)"
Log "Cartella progetto: $ScriptDir"


# ── Step 1: Python ────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  [1/4] Verifica Python..." -ForegroundColor Yellow

$pythonOk = $false
foreach ($cmd in @("python", "python3", "py")) {
    if (Test-CommandExists $cmd) {
        $ver = Get-Version $cmd "--version"
        if ($ver -match "Python (\d+)\.(\d+)") {
            $major = [int]$Matches[1]; $minor = [int]$Matches[2]
            if ($major -ge 3 -and $minor -ge 9) {
                LogOk "Trovato $ver (comando: $cmd)"
                $PythonCmd = $cmd
                $pythonOk = $true
                break
            } else {
                LogWarn "Trovato $ver ma serve 3.9+; cerco versione aggiornata..."
            }
        }
    }
}

if (-not $pythonOk) {
    Log "Python 3.9+ non trovato. Tento installazione automatica..."

    $installed = Install-WithWinget "Python.Python.3.14" "Python 3.14"
    if (-not $installed) {
        # Fallback: download diretto dell'installer silenzioso
        $pyInstaller = Join-Path $env:TEMP "python-3.14-installer.exe"
        $pyUrl = "https://www.python.org/ftp/python/3.14.3/python-3.14.3-amd64.exe"
        if (Download-File $pyUrl $pyInstaller) {
            Log "Esecuzione installer Python (silenziosa)..."
            Start-Process -FilePath $pyInstaller -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_pip=1" -Wait
            Remove-Item $pyInstaller -Force -ErrorAction SilentlyContinue
        } else {
            LogError "Impossibile installare Python automaticamente."
            Write-Host ""
            Write-Host "  Scarica Python 3.14+ da https://www.python.org/downloads/" -ForegroundColor Red
            Write-Host "  e riavvia INSTALLA.bat" -ForegroundColor Red
            exit 1
        }
    }

    Refresh-Path

    foreach ($cmd in @("python", "python3", "py")) {
        if (Test-CommandExists $cmd) {
            $ver = Get-Version $cmd "--version"
            if ($ver -match "Python 3\.(\d+)" -and [int]$Matches[1] -ge 9) {
                LogOk "Installato: $ver"
                $PythonCmd = $cmd
                $pythonOk = $true
                break
            }
        }
    }

    if (-not $pythonOk) {
        LogError "Python 3.9+ non trovato dopo l'installazione. Riavvia il PC e riprova."
        exit 1
    }
}


# ── Step 2: Node.js ───────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  [2/4] Verifica Node.js..." -ForegroundColor Yellow

$nodeOk = $false
if (Test-CommandExists "node") {
    $ver = Get-Version "node" "--version"
    if ($ver -match "v(\d+)\.") {
        $major = [int]$Matches[1]
        if ($major -ge 18) {
            LogOk "Trovato Node.js $ver"
            $nodeOk = $true
        } else {
            LogWarn "Trovato Node.js $ver ma serve v18+; installo versione aggiornata..."
        }
    }
}

if (-not $nodeOk) {
    Log "Node.js 18+ non trovato. Tento installazione automatica..."

    $installed = Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
    if (-not $installed) {
        $nodeInstaller = Join-Path $env:TEMP "node-lts-installer.msi"
        $nodeUrl = "https://nodejs.org/dist/v24.14.0/node-v24.14.0-x64.msi"
        if (Download-File $nodeUrl $nodeInstaller) {
            Log "Esecuzione installer Node.js (silenziosa)..."
            Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$nodeInstaller`" /quiet /norestart" -Wait
            Remove-Item $nodeInstaller -Force -ErrorAction SilentlyContinue
        } else {
            LogError "Impossibile installare Node.js automaticamente."
            Write-Host ""
            Write-Host "  Scarica Node.js LTS da https://nodejs.org/" -ForegroundColor Red
            Write-Host "  e riavvia INSTALLA.bat" -ForegroundColor Red
            exit 1
        }
    }

    Refresh-Path

    if (Test-CommandExists "node") {
        $ver = Get-Version "node" "--version"
        LogOk "Installato: Node.js $ver"
        $nodeOk = $true
    } else {
        LogError "Node.js non trovato dopo l'installazione. Riavvia il PC e riprova."
        exit 1
    }
}


# ── Step 3: Dipendenze Python ─────────────────────────────────────────────────

Write-Host ""
Write-Host "  [3/4] Installazione dipendenze Python..." -ForegroundColor Yellow

$reqFile = Join-Path $BackendDir "requirements.txt"
if (-not (Test-Path $reqFile)) {
    LogError "File requirements.txt non trovato in: $BackendDir"
    exit 1
}

Log "pip install -r requirements.txt"
try {
    Push-Location $BackendDir
    & $PythonCmd -m pip install --upgrade pip --quiet 2>&1 | Tee-Object -Append $LogFile | Out-Null
    & $PythonCmd -m pip install -r requirements.txt --quiet 2>&1 | Tee-Object -Append $LogFile
    if ($LASTEXITCODE -ne 0) { throw "pip install fallito (exit $LASTEXITCODE)" }
    LogOk "Dipendenze Python installate"
} catch {
    LogError "Errore pip: $_"
    exit 1
} finally {
    Pop-Location
}


# ── Step 4: Dipendenze Node.js ────────────────────────────────────────────────

Write-Host ""
Write-Host "  [4/4] Installazione dipendenze Node.js..." -ForegroundColor Yellow

if (-not (Test-Path $FrontendDir)) {
    LogError "Cartella frontend non trovata: $FrontendDir"
    exit 1
}

Log "npm install (frontend)"
try {
    Push-Location $FrontendDir
    & npm install --prefer-offline 2>&1 | Tee-Object -Append $LogFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm install fallito (exit $LASTEXITCODE)" }
    LogOk "Dipendenze Node.js installate"
} catch {
    LogError "Errore npm: $_"
    exit 1
} finally {
    Pop-Location
}


# ── Collegamento sul Desktop ──────────────────────────────────────────────────

Write-Host ""
Write-Host "  Creazione collegamento sul Desktop..." -ForegroundColor Yellow

try {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "Torneo Calcetto Saponato.lnk"
    $avviaPath = Join-Path $ScriptDir "AVVIA.bat"

    $wshShell = New-Object -ComObject WScript.Shell
    $shortcut = $wshShell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $avviaPath
    $shortcut.WorkingDirectory = $ScriptDir
    $shortcut.Description = "Avvia Torneo Calcetto Saponato"
    $shortcut.WindowStyle = 1

    # Usa l'icona del bat se non c'e' un .ico
    $icoPath = Join-Path $ScriptDir "docs\images\icon.ico"
    if (Test-Path $icoPath) { $shortcut.IconLocation = $icoPath }

    $shortcut.Save()
    LogOk "Collegamento creato: $shortcutPath"
} catch {
    LogWarn "Impossibile creare il collegamento sul Desktop: $_"
}


# ── Riepilogo ─────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "   Installazione completata con successo!" -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Per avviare l'applicazione:" -ForegroundColor White
Write-Host "    - Doppio clic su  AVVIA.bat" -ForegroundColor Cyan
Write-Host "    - oppure sul collegamento creato sul Desktop" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Log completo: $LogFile" -ForegroundColor DarkGray
Write-Host ""

Log "Installazione completata con successo - $(Get-Date)"
