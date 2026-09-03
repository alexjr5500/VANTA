# ============================================================
# VANTA - Start the Local LiveKit background services
#
# Idempotent launcher used by Task Scheduler (at logon + watchdog) and by
# developers. Starts, if not already running:
#   1. The existing LiveKit server binary with the existing config
#      (C:\VANTA\scripts\bin\livekit-server.exe --config livekit-dev.yaml).
#   2. The WSS bridge (scripts/livekit-wss-proxy.mjs) so HTTPS/mobile sessions
#      can reach LiveKit without mixed-content blocking.
#
# Safe to run repeatedly - it only starts a component that is not running.
# ============================================================
$ErrorActionPreference = 'Stop'

$BinDir       = 'C:\VANTA\scripts\bin'
$LiveKitExe   = Join-Path $BinDir 'livekit-server.exe'
$LiveKitCfg   = Join-Path $BinDir 'livekit-dev.yaml'
$LiveKitOut   = Join-Path $BinDir 'livekit.out.log'
$LiveKitErr   = Join-Path $BinDir 'livekit.err.log'
$ProxyScript  = 'C:\VANTA\scripts\livekit-wss-proxy.mjs'
$ProxyOut     = 'C:\VANTA\scripts\livekit-wss.out.log'
$ProxyErr     = 'C:\VANTA\scripts\livekit-wss.err.log'
$NodeExe      = 'C:\Program Files\nodejs\node.exe'

Write-Host '[start-livekit] Ensuring LiveKit + WSS bridge are running...'

# ----------------------------------------------------------
# 1. LiveKit core server
# ----------------------------------------------------------
if (-not (Get-Process -Name 'livekit-server' -ErrorAction SilentlyContinue)) {
  if (-not (Test-Path $LiveKitExe)) { throw "LiveKit binary not found at $LiveKitExe" }
  Write-Host "[start-livekit] Starting $LiveKitExe --config $LiveKitCfg"
  $p = Start-Process -FilePath $LiveKitExe `
    -ArgumentList @('--config', "`"$LiveKitCfg`"") `
    -WorkingDirectory $BinDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LiveKitOut `
    -RedirectStandardError $LiveKitErr `
    -PassThru
  Start-Sleep -Seconds 2
  if ($p.HasExited) {
    throw "livekit-server exited early (code $($p.ExitCode)). Check $LiveKitErr"
  }
  Write-Host "[start-livekit] livekit-server started (PID $($p.Id))"
} else {
  Write-Host '[start-livekit] livekit-server already running'
}

# ----------------------------------------------------------
# 2. WSS bridge (required for HTTPS / mobile LiveKit access)
# ----------------------------------------------------------
$proxyListening = $false
try {
  $proxyListening = [bool](Get-NetTCPConnection -LocalPort 7443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
} catch {
  $proxyListening = $false
}

if (-not $proxyListening) {
  if (-not (Test-Path $NodeExe)) { throw "node not found at $NodeExe" }
  if (-not (Test-Path $ProxyScript)) { throw "WSS proxy script not found at $ProxyScript" }
  Write-Host '[start-livekit] Starting WSS bridge (port 7443)'
  $np = Start-Process -FilePath $NodeExe `
    -ArgumentList @($ProxyScript) `
    -WorkingDirectory 'C:\VANTA\scripts' `
    -WindowStyle Hidden `
    -RedirectStandardOutput $ProxyOut `
    -RedirectStandardError $ProxyErr `
    -PassThru
  Start-Sleep -Seconds 2
  if ($np.HasExited) {
    Write-Warning "[start-livekit] WSS bridge exited early (code $($np.ExitCode)). Check $ProxyErr"
  } else {
    Write-Host "[start-livekit] WSS bridge started (PID $($np.Id))"
  }
} else {
  Write-Host '[start-livekit] WSS bridge already listening on 7443'
}

Write-Host '[start-livekit] Done.'