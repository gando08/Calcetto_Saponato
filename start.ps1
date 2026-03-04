#Requires -Version 5.1
<#
.SYNOPSIS
    Launcher unificato per Torneo Calcetto Saponato.
    Rileva automaticamente Docker o avvia in modalità locale (Python + Node.js).
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# ── Helpers colore ────────────────────────────────────────────────────────────
function Write-Header ([string]$msg) { Write-Host "`n  $msg" -ForegroundColor Cyan }
function Write-Ok     ([string]$msg) { Write-Host "  [OK]  $msg" -ForegroundColor Green }
function Write-Warn   ([string]$msg) { Write-Host "  [!!]  $msg" -ForegroundColor Yellow }
function Write-Err    ([string]$msg) { Write-Host "  [XX]  $msg" -ForegroundColor Red }
function Write-Info   ([string]$msg) { Write-Host "  -->   $msg" -ForegroundColor White }
function Write-Step   ([string]$msg) { Write-Host "        $msg" -ForegroundColor DarkGray }

# ── Utility ───────────────────────────────────────────────────────────────────
function Test-DockerRunning {
    try {
        $null = & docker info 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Wait-ForUrl {
    param(
        [string] $Url,
        [int]    $MaxAttempts = 45,
        [int]    $DelaySeconds = 2,
        [string] $Label = $Url
    )
    Write-Info "Attendo: $Label ..."
    for ($i = 1; $i -le $MaxAttempts; $i++) {
        try {
            $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            return $true
        } catch {
            Write-Step "  Tentativo $i / $MaxAttempts ..."
            Start-Sleep -Seconds $DelaySeconds
        }
    }
    return $false
}

function Stop-PortOwner ([int]$Port) {
    try {
        $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        if ($conns) {
            foreach ($c in $conns) {
                if ($c.OwningProcess -gt 0) {
                    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
                }
            }
        }
    } catch { <# ignora #> }
}

function Test-Command ([string]$Cmd) {
    return ($null -ne (Get-Command $Cmd -ErrorAction SilentlyContinue))
}

# ── Banner ────────────────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "  +----------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |    *** Torneo Calcetto Saponato ***           |" -ForegroundColor Cyan
Write-Host "  |       Launcher Unificato v2.0                |" -ForegroundColor Cyan
Write-Host "  +----------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

# ── Scelta modalità ───────────────────────────────────────────────────────────
$useDocker = $false

if (Test-DockerRunning) {
    $useDocker = $true
    Write-Ok "Docker Desktop rilevato → modalità Docker Compose"
} else {
    Write-Warn "Docker non disponibile → modalità locale (Python + Node.js)"
}

# ═══════════════════════════════════════════════════════════════════════════════
#  MODALITÀ DOCKER
# ═══════════════════════════════════════════════════════════════════════════════
if ($useDocker) {

    Write-Header "Avvio con Docker Compose..."
    Write-Step "docker compose up -d --build"

    try {
        # Timestamp usato come CACHEBUST: invalida il layer COPY/build del frontend
        # mantenendo la cache di npm install (molto più veloce)
        $cacheBust = (Get-Date -Format "yyyyMMddHHmmss")
        Write-Step "Build frontend (cache-bust: $cacheBust)..."
        & docker compose build --build-arg "CACHEBUST=$cacheBust" frontend
        if ($LASTEXITCODE -ne 0) { throw "docker compose build frontend fallito (exit code $LASTEXITCODE)" }
        & docker compose up -d --force-recreate
        if ($LASTEXITCODE -ne 0) { throw "docker compose up fallito (exit code $LASTEXITCODE)" }
    } catch {
        Write-Err "Errore docker compose: $_"
        Write-Warn "Assicurati che Docker Desktop sia avviato e riprova."
        Read-Host "`n  Premi INVIO per uscire"
        exit 1
    }

    $frontendUrl  = "http://localhost:3000"
    $backendUrl   = "http://localhost:8000"
    $swaggerUrl   = "http://localhost:8000/docs"

    $ready = Wait-ForUrl -Url $frontendUrl -Label "Frontend (porta 3000)"
}

# ═══════════════════════════════════════════════════════════════════════════════
#  MODALITÀ LOCALE
# ═══════════════════════════════════════════════════════════════════════════════
else {

    Write-Header "Controllo prerequisiti..."

    # Python 3.13
    $pythonExe = $null
    try {
        $null = & py -3.13 --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $pythonExe = (& py -3.13 -c "import sys; print(sys.executable)").Trim()
        }
    } catch {}

    if (-not $pythonExe -or -not (Test-Path $pythonExe)) {
        Write-Err "Python 3.13 non trovato."
        Write-Warn "Installalo da:  https://www.python.org/downloads/"
        Write-Warn "Assicurati di spuntare 'Add Python to PATH' durante l'installazione."
        Read-Host "`n  Premi INVIO per uscire"
        exit 1
    }
    Write-Ok "Python 3.13  →  $pythonExe"

    # Node.js
    if (-not (Test-Command "node")) {
        Write-Err "Node.js non trovato."
        Write-Warn "Installalo da:  https://nodejs.org/  (versione LTS)"
        Read-Host "`n  Premi INVIO per uscire"
        exit 1
    }
    $nodeVer = (& node --version).Trim()
    Write-Ok "Node.js  →  $nodeVer"

    # Dipendenze backend
    Write-Header "Dipendenze backend..."
    $needInstallBackend = $false
    try {
        $null = & $pythonExe -c "import fastapi, uvicorn, sqlalchemy, ortools" 2>&1
        if ($LASTEXITCODE -ne 0) { $needInstallBackend = $true }
    } catch { $needInstallBackend = $true }

    if ($needInstallBackend) {
        Write-Warn "Prima installazione dipendenze backend (può richiedere qualche minuto)..."
        & $pythonExe -m pip install -r (Join-Path $PSScriptRoot "backend\requirements.txt")
        if ($LASTEXITCODE -ne 0) {
            Write-Err "pip install fallito. Controlla la connessione internet e riprova."
            Read-Host "`n  Premi INVIO per uscire"
            exit 1
        }
        Write-Ok "Dipendenze backend installate."
    } else {
        Write-Ok "Dipendenze backend OK."
    }

    # Dipendenze frontend
    $nodeModules = Join-Path $PSScriptRoot "frontend\node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Warn "Prima installazione dipendenze frontend (può richiedere qualche minuto)..."
        # Chiamato tramite cmd per evitare conflitti con Set-StrictMode e npm.ps1
        $frontendDir = Join-Path $PSScriptRoot "frontend"
        & cmd /c "npm" "install" "--prefix" $frontendDir
        if ($LASTEXITCODE -ne 0) {
            Write-Err "npm install fallito."
            Read-Host "`n  Premi INVIO per uscire"
            exit 1
        }
        Write-Ok "Dipendenze frontend installate."
    } else {
        Write-Ok "Dipendenze frontend OK."
    }

    # Cartella dati
    $dataDir = Join-Path $PSScriptRoot "backend\data"
    if (-not (Test-Path $dataDir)) {
        $null = New-Item -Path $dataDir -ItemType Directory
    }

    # Cartella .run per PID e log
    $runDir = Join-Path $PSScriptRoot ".run"
    $logDir = Join-Path $runDir "logs"
    foreach ($d in @($runDir, $logDir)) {
        if (-not (Test-Path $d)) { $null = New-Item -Path $d -ItemType Directory }
    }

    # Libera le porte
    Stop-PortOwner -Port 8000
    Stop-PortOwner -Port 5173
    Start-Sleep -Seconds 1

    # Avvio backend
    Write-Header "Avvio servizi..."
    Write-Info "Backend → http://localhost:8000"
    $backendProc = Start-Process `
        -FilePath       $pythonExe `
        -ArgumentList   @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000") `
        -WorkingDirectory (Join-Path $PSScriptRoot "backend") `
        -RedirectStandardOutput (Join-Path $logDir "backend.log") `
        -RedirectStandardError  (Join-Path $logDir "backend.err.log") `
        -PassThru
    $backendProc.Id | Set-Content -Path (Join-Path $runDir "backend.pid") -Encoding ascii

    # Avvio frontend
    Write-Info "Frontend → http://localhost:5173"
    $frontendProc = Start-Process `
        -FilePath       "cmd.exe" `
        -ArgumentList   @("/c", "npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173") `
        -WorkingDirectory (Join-Path $PSScriptRoot "frontend") `
        -RedirectStandardOutput (Join-Path $logDir "frontend.log") `
        -RedirectStandardError  (Join-Path $logDir "frontend.err.log") `
        -PassThru
    $frontendProc.Id | Set-Content -Path (Join-Path $runDir "frontend.pid") -Encoding ascii

    $frontendUrl = "http://localhost:5173"
    $backendUrl  = "http://localhost:8000"
    $swaggerUrl  = "http://localhost:8000/docs"

    # Attendi backend
    $backendReady = Wait-ForUrl -Url "$backendUrl/health" -MaxAttempts 30 -Label "Backend (porta 8000)"
    if ($backendReady) { Write-Ok "Backend pronto." } else { Write-Warn "Backend lento a partire -- continuo." }

    # Attendi frontend
    $ready = Wait-ForUrl -Url $frontendUrl -MaxAttempts 30 -Label "Frontend (porta 5173)"
}

# ── Risultato ─────────────────────────────────────────────────────────────────
Write-Host ""
if ($ready) {
    Write-Host "  +----------------------------------------------+" -ForegroundColor Green
    Write-Host "  |          Applicazione PRONTA!                |" -ForegroundColor Green
    Write-Host "  +----------------------------------------------+" -ForegroundColor Green
} else {
    Write-Host "  +----------------------------------------------+" -ForegroundColor Yellow
    Write-Host "  |  Timeout -- il browser si aprira comunque.   |" -ForegroundColor Yellow
    Write-Host "  +----------------------------------------------+" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  App     :  $frontendUrl" -ForegroundColor Cyan
Write-Host "  Swagger :  $swaggerUrl"  -ForegroundColor DarkCyan
Write-Host ""

if (-not $useDocker) {
    Write-Host "  Log dir :  $logDir" -ForegroundColor DarkGray
    Write-Host "  Per fermare l'app usa:  CHIUDI.bat" -ForegroundColor DarkGray
} else {
    Write-Host "  Per fermare l'app usa:  CHIUDI.bat" -ForegroundColor DarkGray
}

Write-Host ""

# Apri il browser
Start-Process $frontendUrl
