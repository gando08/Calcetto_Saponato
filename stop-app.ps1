$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

Write-Host "Arresto Torneo Calcetto Saponato..."
docker compose down

if ($LASTEXITCODE -ne 0) {
  throw "Errore durante docker compose down."
}

Write-Host "Applicazione arrestata."
