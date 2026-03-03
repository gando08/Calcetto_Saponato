$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

Write-Host "Avvio Torneo Calcetto Saponato..."
docker compose up -d --build

if ($LASTEXITCODE -ne 0) {
  throw "Errore durante docker compose up."
}

$frontendUrl = "http://localhost:3000"
$maxAttempts = 60
$ready = $false

Write-Host "Attendo che il frontend sia pronto..."
for ($i = 1; $i -le $maxAttempts; $i++) {
  try {
    Invoke-WebRequest -Uri $frontendUrl -UseBasicParsing -TimeoutSec 3 | Out-Null
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}

if ($ready) {
  Write-Host "Applicazione pronta. Apertura browser..."
} else {
  Write-Host "Frontend non ancora pronto, apro comunque il browser."
}

Start-Process $frontendUrl
Write-Host "Backend: http://localhost:8000/docs"
