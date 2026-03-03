$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

$runDir = Join-Path $PSScriptRoot ".run"
$backendPidFile = Join-Path $runDir "backend.pid"
$frontendPidFile = Join-Path $runDir "frontend.pid"

function Stop-FromPidFile {
  param(
    [string]$pidFile,
    [string]$serviceName
  )
  if (!(Test-Path $pidFile)) {
    Write-Host "${serviceName}: nessun PID file."
    return
  }

  $raw = Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  $pidValue = 0
  if (![int]::TryParse($raw, [ref]$pidValue)) {
    Write-Host "${serviceName}: PID non valido."
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    return
  }

  try {
    Stop-Process -Id $pidValue -Force -ErrorAction Stop
    Write-Host "$serviceName arrestato (PID $pidValue)."
  } catch {
    Write-Host "$serviceName gia arrestato."
  }

  Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

function Stop-FromPort {
  param(
    [int]$port,
    [string]$serviceName
  )
  try {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if (!$listeners) {
      return
    }
    foreach ($listener in $listeners) {
      if ($listener.OwningProcess -and $listener.OwningProcess -gt 0) {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    }
    Write-Host "${serviceName} arrestato via porta $port."
  } catch {
    # ignore
  }
}

Write-Host "Arresto servizi locali..."
Stop-FromPidFile -pidFile $backendPidFile -serviceName "Backend"
Stop-FromPidFile -pidFile $frontendPidFile -serviceName "Frontend"
Stop-FromPort -port 8000 -serviceName "Backend"
Stop-FromPort -port 5173 -serviceName "Frontend"

Write-Host "Completato."
