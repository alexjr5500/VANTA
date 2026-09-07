# ============================================================================
# VANTA - Apply Prisma schema to the Railway PostgreSQL database (safely)
# ----------------------------------------------------------------------------
# One-time production provisioning + verification. This does NOT use
# `--accept-data-loss`: if the diff ever requires destructive changes the
# command aborts loudly instead of dropping data.
#
# Prereqs:
#   - Railway CLI authenticated (railway login) OR -RailwayToken <token>
#   - The backend service is linked:  railway link  (once)
#   - DATABASE_URL in the service variables is the Railway Postgres URL
#
# Examples:
#   powershell -ExecutionPolicy Bypass -File scripts\apply-prod-schema.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\apply-prod-schema.ps1 -RailwayToken $env:RAILWAY_TOKEN
# ============================================================================
[CmdletBinding()]
param(
  [string]$RailwayToken = ''
)

$ErrorActionPreference = 'Stop'
$rootDir = Split-Path $PSScriptRoot -Parent
$backendDir = Join-Path $rootDir 'backend'

# --- 0. Railway CLI + auth ------------------------------------------------
if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  Write-Host '[0/6] Installing Railway CLI ...'
  npm install -g @railway/cli --silent
}
if ($RailwayToken) { $env:RAILWAY_TOKEN = $RailwayToken }
& railway whoami 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error ('Railway CLI is not authenticated. Run `railway login` (or) pass -RailwayToken. (also run `railway link` inside the project once if not linked)')
}

# --- 1. DATABASE_URL sanity check -----------------------------------------
Write-Host '[1/6] Confirming service DATABASE_URL points at PostgreSQL ...'
$railwayVars = @(& railway variables 2>$null | Where-Object { $_ -match '=' })
$dbLine = $railwayVars | Where-Object { $_ -match '^\s*DATABASE_URL=' } | Select-Object -First 1
if (-not $dbLine) {
  Write-Error 'DATABASE_URL is NOT set on the Railway service. Add the attached PostgreSQL URL in Variables, then re-run.'
}
$dbUrl = $dbLine.Split('=', 2)[1].Trim().Trim('"')
if ($dbUrl -notmatch '^postgres(ql)?://') {
  Write-Error "DATABASE_URL does not look like PostgreSQL: $($dbUrl -replace '(:[^:@/]+@)',':***@')"
}
Write-Host "      DATABASE_URL -> $($dbUrl -replace '(:[^:@/]+@)',':***@')"

# --- 2. Apply schema (safe: never --accept-data-loss) ----------------------
Write-Host '[2/6] Applying Prisma schema with `prisma db push` (no --accept-data-loss; destructive changes abort) ...'
Push-Location $backendDir
& railway run -- npx prisma db push
$pushExit = $LASTEXITCODE
Pop-Location
if ($pushExit -ne 0) {
  Write-Error "prisma db push failed (exit $pushExit). Nothing was applied. See output above."
}

# --- 3. Verify required tables ----------------------------------------------
Write-Host '[3/6] Verifying `LiveStream`, `FundraiserCategory`, `IPReputation` (and total table count) ...'
$verifyJs = @'
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    const rows = await p.$queryRawUnsafe(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    const names = rows.map((r) => r.tablename);
    const required = ['LiveStream', 'FundraiserCategory', 'IPReputation'];
    for (const n of required) {
      console.log('  [OK] public.' + n + (names.includes(n) ? '' : '  <<<< MISSING'));
    }
    console.log('  tables in public schema: ' + names.length);
    const missing = required.filter((n) => !names.includes(n));
    if (missing.length) {
      console.error('MISSING TABLES: ' + missing.join(', '));
      process.exitCode = 1;
    }
  } catch (e) {
    console.error('Verification query failed:', e.message);
    process.exitCode = 1;
  } finally {
    await p.$disconnect();
  }
})();
'@
& railway run -- node -e $verifyJs
if ($LASTEXITCODE -ne 0) { Write-Error 'Table verification failed.' }

# --- 4. Verify production secrets are strong and distinct --------------------
Write-Host '[4/6] Verifying production secrets (values are never printed) ...'
$vars = @(& railway variables 2>$null)
$problems = 0
foreach ($name in 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY') {
  $line = $vars | Where-Object { $_ -match ("^\s*" + $name + "=") } | Select-Object -First 1
  if (-not $line) {
    Write-Warning "[WARN] $name is NOT set"
    $problems++
    continue
  }
  $v = $line.Split('=', 2)[1].Trim().Trim('"')
  $len = $v.Length
  $hexLike = $v -match '^[0-9a-fA-F]+$'
  if ($len -lt 32 -or -not $hexLike) {
    Write-Warning "[WARN] $name is set (len=$len hex=$hexLike) but weaker than a 32-byte hex value"
    $problems++
  } else {
    Write-Output "  [OK] $name is set ($len hex chars)"
  }
}
if ($problems -gt 0) {
  Write-Warning "Secrets missing/weak. Generate strong values with: node -e \"[ 'JWT_SECRET','JWT_REFRESH_SECRET','ENCRYPTION_KEY' ].forEach(k=>console.log(k+'='+require('crypto').randomBytes(32).toString('hex')))\" and set them with `railway variables set KEY=VALUE` (then re-run)."
}

# --- 5. Redeploy so the container restarts against the provisioned schema -----
Write-Host '[5/6] Redeploying backend ...'
& railway redeploy
if ($LASTEXITCODE -ne 0) { Write-Warning 'Could not trigger redeploy automatically; deploy from the Railway dashboard or `git push` to main.' }

# --- 6. Final verification against the running service -------------------------
Write-Host '[6/6] Verifying deployment (health + no P2021 startup errors) ...'
Write-Host '      Open Railway -> backend service -> Deployments/Logs and confirm:'
Write-Host '        - "Server running on port 5000"'
Write-Host '        - no "P2021" table-does-not-exist errors'
Write-Host '      Then hit the health endpoint:'
Write-Host '        curl https://<your-backend>.up.railway.app/health'
Write-Host 'Done.'