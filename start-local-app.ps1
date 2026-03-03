$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

$runDir = Join-Path $PSScriptRoot ".run"
if (!(Test-Path $runDir)) {
  New-Item -Path $runDir -ItemType Directory | Out-Null
}

$backendPidFile = Join-Path $runDir "backend.pid"
$frontendPidFile = Join-Path $runDir "frontend.pid"
$backendOutLog = Join-Path $runDir "backend.out.log"
$backendErrLog = Join-Path $runDir "backend.err.log"
$frontendOutLog = Join-Path $runDir "frontend.out.log"
$frontendErrLog = Join-Path $runDir "frontend.err.log"

function Stop-IfRunningFromPidFile {
  param([string]$pidFile)
  if (!(Test-Path $pidFile)) {
    return
  }
  $raw = Get-Content -Path $pidFile -ErrorAction SilentlyContinue
  $existingPid = 0
  if (![int]::TryParse(($raw | Select-Object -First 1), [ref]$existingPid)) {
    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    return
  }
  try {
    $proc = Get-Process -Id $existingPid -ErrorAction Stop
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  } catch {
    # Already stopped
  }
  Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

function Stop-IfListeningOnPort {
  param([int]$port)
  try {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      if ($listener.OwningProcess -and $listener.OwningProcess -gt 0) {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    # ignore
  }
}

Stop-IfRunningFromPidFile -pidFile $backendPidFile
Stop-IfRunningFromPidFile -pidFile $frontendPidFile
Stop-IfListeningOnPort -port 8000
Stop-IfListeningOnPort -port 5173

Write-Host "Verifica prerequisiti..."
& py -3.13 -c "import sys; print(sys.version)" *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Python 3.13 non disponibile. Installa Python 3.13 o aggiorna lo script."
}
$pythonExe = (& py -3.13 -c "import sys; print(sys.executable)" | Select-Object -First 1).Trim()
if (!(Test-Path $pythonExe)) {
  throw "Impossibile individuare python.exe per la versione 3.13."
}
& npm --version *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Node.js/NPM non disponibili. Installa Node.js LTS."
}

Write-Host "Verifica dipendenze backend..."
& py -3.13 -c "import fastapi, uvicorn, sqlalchemy" *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installazione dipendenze backend (prima esecuzione)..."
  & py -3.13 -m pip install -r (Join-Path $PSScriptRoot "backend/requirements.txt")
  if ($LASTEXITCODE -ne 0) {
    throw "Installazione dipendenze backend fallita."
  }
}

$frontendNodeModules = Join-Path $PSScriptRoot "frontend/node_modules"
if (!(Test-Path $frontendNodeModules)) {
  Write-Host "Installazione dipendenze frontend (prima esecuzione)..."
  & npm install --prefix (Join-Path $PSScriptRoot "frontend")
  if ($LASTEXITCODE -ne 0) {
    throw "Installazione dipendenze frontend fallita."
  }
}

$backendData = Join-Path $PSScriptRoot "backend/data"
if (!(Test-Path $backendData)) {
  New-Item -Path $backendData -ItemType Directory | Out-Null
}

Write-Host "Avvio backend..."
$backendProc = Start-Process `
  -FilePath $pythonExe `
  -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000") `
  -WorkingDirectory (Join-Path $PSScriptRoot "backend") `
  -RedirectStandardOutput $backendOutLog `
  -RedirectStandardError $backendErrLog `
  -PassThru
$backendProc.Id | Set-Content -Path $backendPidFile -Encoding ascii

Write-Host "Avvio frontend..."
try {
  $frontendProc = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList @("/c", "npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173") `
    -WorkingDirectory (Join-Path $PSScriptRoot "frontend") `
    -RedirectStandardOutput $frontendOutLog `
    -RedirectStandardError $frontendErrLog `
    -PassThru
  $frontendProc.Id | Set-Content -Path $frontendPidFile -Encoding ascii
} catch {
  Write-Host "Avvio frontend fallito, arresto backend..."
  try {
    Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
  } catch {
    # ignore
  }
  Remove-Item -Path $backendPidFile -Force -ErrorAction SilentlyContinue
  throw
}

Write-Host "Avvio servizi in corso..."
Start-Sleep -Seconds 3

Write-Host "Applicazione avviata."
Write-Host "Frontend: http://localhost:5173"
Write-Host "Backend API: http://localhost:8000"
Write-Host "Log backend out: $backendOutLog"
Write-Host "Log backend err: $backendErrLog"
Write-Host "Log frontend out: $frontendOutLog"
Write-Host "Log frontend err: $frontendErrLog"
Start-Process "http://localhost:5173"
