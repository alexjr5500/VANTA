# ============================================================================
# VANTA — Prepare production environment values (local only; NEVER commit)
# ----------------------------------------------------------------------------
# Generates strong random secrets and writes them to deploy/.env.production
# (git-ignored) as a single paste-source for Vercel + Railway dashboards.
# Values with empty placeholders (DATABASE_URL, LIVEKIT_*, URLs, OAuth) must
# be filled in after you create the Railway Postgres / LiveKit Cloud / domains.
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts\prepare-prod-env.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'

$deployDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'deploy'
if (-not (Test-Path $deployDir)) { New-Item -ItemType Directory -Path $deployDir | Out-Null }

$outFile = Join-Path $deployDir '.env.production'

# --- random hex helper ------------------------------------------------------
function New-Hex([int]$bytes = 32) {
  $buf = New-Object byte[] $bytes
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $rng.GetBytes($buf)
  $rng.Dispose()
  return ($buf | ForEach-Object { $_.ToString('x2') }) -join ''
}

$jwtSecret            = New-Hex 32
$jwtRefreshSecret    = New-Hex 32
$encryptionKey       = New-Hex 32

$lines = @(
  '# VANTA PRODUCTION ENV (generated ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + ' — fill the blanks marked <FILL> after creating services)'
  ''
  '# ---- Backend (Railway) — paste into backend service Variables ----'
  'NODE_ENV=production'
  'PORT=5000'
  "JWT_SECRET=$jwtSecret"
  "JWT_REFRESH_SECRET=$jwtRefreshSecret"
  "ENCRYPTION_KEY=$encryptionKey"
  'DATABASE_URL=<FILL: Railway Postgres internal URL>'
  'FRONTEND_URL=<FILL: https://your-frontend.vercel.app>'
  'CORS_ALLOWED_ORIGINS=<FILL: https://your-frontend.vercel.app>'
  'UPLOAD_STORAGE_DIR=/data/uploads'
  'CLOUDINARY_CLOUD_NAME='
  'CLOUDINARY_API_KEY='
  'CLOUDINARY_API_SECRET='
  'LIVEKIT_HOST=<FILL: https://your-project.livekit.cloud>'
  'LIVEKIT_API_KEY=<FILL from LiveKit Cloud>'
  'LIVEKIT_API_SECRET=<FILL from LiveKit Cloud>'
  'REQUIRE_EMAIL_VERIFICATION=false'
  ''
  '# ---- Frontend (Vercel) — paste into frontend Production env ----'
  'NEXT_PUBLIC_API_URL=<FILL: https://your-backend.up.railway.app>'
  'NEXT_PUBLIC_SOCKET_URL=<FILL: https://your-backend.up.railway.app>'
  'NEXT_PUBLIC_APP_URL=<FILL: https://your-frontend.vercel.app>'
  'NEXT_PUBLIC_LIVEKIT_URL=<FILL: wss://your-project.livekit.cloud>'
  'NEXT_PUBLIC_ENV=production'
  ''
  '# ---- Notes ----'
  '# Do NOT set HTTPS_DEV_CERT / HTTPS_DEV_KEY in prod (dev-only).'
  '# Leave OAuth/OTP/SMTP/Stripe stubs empty for MVP (email/password works).'
  '# Optionally point NEXT_PUBLIC_LIVEKIT_URL + LIVEKIT_HOST at a LiveKit Cloud URL.'
)

Set-Content -Path $outFile -Value $lines -Encoding utf8

Write-Host ''
Write-Host '[prepare-prod-env] Wrote ' + $outFile
Write-Host '[prepare-prod-env] Generated fresh JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY (32-byte hex each).'
Write-Host '[prepare-prod-env] Open the file, replace every <FILL...> with your real service URLs / keys.'
Write-Host '[prepare-prod-env] Then paste each block into Railway / Vercel dashboards (or run scripts\deploy-prod.ps1).'
Write-Host ''