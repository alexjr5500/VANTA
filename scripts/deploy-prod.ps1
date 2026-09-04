# ============================================================================
# VANTA — Deploy to production (Vercel frontend + Railway backend)
# ----------------------------------------------------------------------------
# Uses the Railway + Vercel CLIs. Either pass tokens (-VercelToken / -RailwayToken)
# for non-interactive runs, or the CLIs will open a browser to log you in (interactive).
#
# Prereqs: deploy/.env.production exists (scripts\prepare-prod-env.ps1) and is
# filled with real URLs/keys (DATABASE_URL from Railway Postgres, LIVEKIT_* from
# LiveKit Cloud, NEXT_PUBLIC_* with your service URLs).
#
# Examples:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-prod.ps1 -Seed
#   powershell ... -VercelToken $env:VERCEL_TOKEN -RailwayToken $env:RAILWAY_TOKEN -Seed
# ============================================================================
[CmdletBinding())]
param(
  [string]$VercelToken = '',
  [string]$RailwayToken = '',
  [switch]$Seed
)

$ErrorActionPreference = 'Continue'
$rootDir = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $rootDir 'deploy\.env.production'

if (-not (Test-Path $envFile)) {
  Write-Error "Missing $envFile — run scripts\prepare-prod-env.ps1 first, fill the <FILL> values, then re-run."
  exit 1
}

# --- 0. install CLIs if absent -------------------------------------------
function Ensure-Cli([string]$name, [string]$pkg) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Host "[deploy] Installing $pkg ..."
    npm install -g $pkg --silent
  }
}

Ensure-Cli 'railway' '@railway/cli'
Ensure-Cli 'vercel' 'vercel'

# --- 1. auth ---------------------------------------------------------------
if ($RailwayToken) {
  $env:RAILWAY_TOKEN = $RailwayToken
  & railway whoami 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Warning '[deploy] railway whoami failed — token invalid?' }
} else {
  Write-Host '[deploy] Logging into Railway (browser opens)...'
  & railway login
}

if ($VercelToken) {
  $env:VERCEL_TOKEN = $VercelToken
} else {
  Write-Host '[deploy] Logging into Vercel (browser opens)...'
  & vercel login
# --- 2. set Railway variables (skip empty / <FILL> / commented) --------
function Set-RailwayVars {
  parameter()
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) return
    if (-not $line.Contains('=')) return
    $key, $value = $line.Split('=', 2)
    $value = $value.Trim()
    if (-not $value -or $value.Contains('<FILL')) {
      Write-Host "[deploy]  skip empty: $key"
      return
    }
    Write-Host "[deploy]  railway variables set $key ..."
    & railway variables set "$key=$value" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "[deploy]  could not set $key — set it manually in the Railway dashboard."
    }
  }
}

Write-Host ''
Write-Host '[deploy] Setting Railway variables from deploy/.env.production ...'
Set-RailwayVars

# --- 3. deploy backend ---------------------------------------------------------
Write-Host ''
Write-Host '[deploy] Deploying backend (Railway up; builds + prisma db push per railway.json)...'
Push-Location (Join-Path $rootDir 'backend')
& railway up
Pop-Location
}
# --- 4. optional one-time seeds (run with -Seed after first successful deploy) ---
if ($Seed) {
  Write-Host ''
  Write-Host '[deploy] Running one-time prod seeds (railway run)...'
  & railway run -- npx prisma db push --accept-data-loss
  & railway run -- npm run seed
  & railway run -- npm run seed:gifts
  & railway run -- npm run seed:dev-wallet
}

# --- 5. deploy frontend (Vercel) -----------------------------------------------------
Write-Host ''
Write-Host '[deploy] Deploying frontend (Vercel --prod)...'
Push-Location (Join-Path $rootDir 'frontend')
& vercel link --yes 2>$null
& vercel --prod --yes
Pop-Location

Write-Host ''
Write-Host '[deploy] Frontend env vars — paste into Vercel dashboard (Project → Settings → Environment Variables → Production):'
$envVars = @()
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line.StartsWith('NEXT_PUBLIC_')) {
    $envVars += $line
  }
}
$envVars | ForEach-Object { Write-Host "  $_" }
Write-Host '(If a value still says <FILL..., set it after you have the API/LiveKit URLs.)'

# --- 6. verify --------------------------------------------------------------------
Write-Host ''
Write-Host '[deploy] Backend health once live:'
$apiUrl = ((Get-Content $envFile | Where-Object { $_ -like 'NEXT_PUBLIC_API_URL=*' }) -replace '^NEXT_PUBLIC_API_URL=','')
if ($apiUrl -and -not $apiUrl.Contains('<FILL')) {
  Write-Host "  Check:  $apiUrl/health"
  & curl.exe -s -m 60 "$apiUrl/health"
  Write-Host ''
}
Write-Host '[deploy] Done. Backend URL + frontend URL were printed by the CLIs above.'
Write-Host '[deploy] Open the Vercel URL from your phone — HTTPS, PC OFF, nothing to install.'