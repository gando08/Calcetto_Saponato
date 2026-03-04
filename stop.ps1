#Requires -Version 5.1
<#
.SYNOPSIS
    Ferma tutti i servizi di Torneo Calcetto Saponato (Docker e/o locale).
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"
Set-Location -Path $PSScriptRoot

function Write-Ok   ([string]$msg) { Write-Host "  [OK]  $msg" -ForegroundColor Green }
function Write-Info ([string]$msg) { Write-Host "  -->   $msg" -ForegroundColor White }
function Write-Warn ([string]$msg) { Write-Host "  [!!]  $msg" -ForegroundColor Yellow }

Clear-Host
Write-Host ""
Write-Host "  +----------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |    *** Torneo Calcetto Saponato ***           |" -ForegroundColor Cyan
Write-Host "  |         Arresto servizi...                   |" -ForegroundColor Cyan
Write-Host "  +----------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

# ── Ferma Docker Compose (se attivo) ─────────────────────────────────────────
$dockerRunning = $false
try {
    $null = & docker info 2>&1
    $dockerRunning = ($LASTEXITCODE -eq 0)
} catch {}

if ($dockerRunning) {
    Write-Info "Arresto container Docker..."
    try {
        & docker compose down 2>&1 | Out-Null
        Write-Ok "Container Docker arrestati."
    } catch {
        Write-Warn "docker compose down: $_"
    }
}

# ── Ferma processi locali (via PID file) ─────────────────────────────────────
$runDir = Join-Path $PSScriptRoot ".run"

function Stop-FromPidFile ([string]$PidFile, [string]$ServiceName) {
    if (-not (Test-Path $PidFile)) { return }
    $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    $pidVal = 0
    if (![int]::TryParse($raw, [ref]$pidVal) -or $pidVal -le 0) {
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
        return
    }
    try {
        Stop-Process -Id $pidVal -Force -ErrorAction Stop
        Write-Ok "$ServiceName arrestato (PID $pidVal)."
    } catch {
        Write-Warn "$ServiceName gia' arrestato."
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Stop-PortOwner ([int]$Port, [string]$ServiceName) {
    try {
        $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        if (-not $conns) { return }
        $stopped = $false
        foreach ($c in $conns) {
            if ($c.OwningProcess -gt 0) {
                Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
                $stopped = $true
            }
        }
        if ($stopped) { Write-Ok "$ServiceName (porta $Port) arrestato." }
    } catch {}
}

Stop-FromPidFile -PidFile (Join-Path $runDir "backend.pid")  -ServiceName "Backend"
Stop-FromPidFile -PidFile (Join-Path $runDir "frontend.pid") -ServiceName "Frontend"

Stop-PortOwner -Port 8000 -ServiceName "Backend"
Stop-PortOwner -Port 5173 -ServiceName "Frontend"

Write-Host ""
Write-Host "  Tutti i servizi sono stati arrestati." -ForegroundColor Green
Write-Host ""

Start-Sleep -Seconds 1
