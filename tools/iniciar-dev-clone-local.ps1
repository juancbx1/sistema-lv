param(
    [string]$CloneDatabase = 'sistema_lv_cadeia_transversal_test',
    [int]$ApiPort = 3000,
    [int]$VitePort = 5173
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$localPostgresUrl = "postgresql://postgres@127.0.0.1:55432/$CloneDatabase"

$apiListener = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
if ($apiListener) {
    throw "A porta da API $ApiPort ja esta em uso pelo processo $($apiListener.OwningProcess)."
}

$viteListener = Get-NetTCPConnection -LocalPort $VitePort -State Listen -ErrorAction SilentlyContinue
if ($viteListener) {
    throw "A porta do Vite $VitePort ja esta em uso pelo processo $($viteListener.OwningProcess)."
}

$env:POSTGRES_URL = $localPostgresUrl
$env:PORT = [string]$ApiPort
Start-Process -FilePath $nodePath -ArgumentList 'server.js' -WorkingDirectory $projectRoot -WindowStyle Hidden

Start-Process -FilePath $nodePath `
    -ArgumentList "node_modules/vite/bin/vite.js --host 127.0.0.1 --port $VitePort" `
    -WorkingDirectory $projectRoot -WindowStyle Hidden

Write-Output (ConvertTo-Json ([ordered]@{
    api = "http://127.0.0.1:$ApiPort"
    vite = "http://127.0.0.1:$VitePort"
    clone = $CloneDatabase
    postgresUrlOverriddenOnlyForChildProcesses = $true
    envFileChanged = $false
}))
