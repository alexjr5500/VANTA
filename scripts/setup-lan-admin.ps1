# ============================================================================
# VANTA - one-time LAN admin setup for physical-phone local testing
# (must run as Administrator)
# ============================================================================
# Does the following on this development machine WITHOUT exposing anything to
# the public internet:
#
#  1. Repairs the backwards per-app "Node.js JavaScript Runtime" firewall
#     rules (Public=ALLOW exposed every node port; Private=BLOCK stopped the
#     phone on the trusted LAN) by disabling them.
#  2. Adds explicit inbound allow rules scoped to the Private + Domain
#     profiles only (never Public):
#       TCP 3000  -> Next.js dev server (https://<LAN-IP>:3000)
#       TCP 5000  -> Express API + Socket.IO over TLS
#       TCP 7443  -> LiveKit WSS signaling bridge (phone live streaming)
#       TCP 7881  -> LiveKit WebRTC (DTLS)
#       UDP 7882  -> LiveKit WebRTC (SRTP media)
#     (LiveKit "configuration" is NOT modified - only Windows Firewall rules.)
#  3. Reclassifies the active Wi-Fi/Ethernet network from Public to Private
#     so the LAN-scoped rules above actually apply to the connection the
#     phone is testing over.
#
# Reverting: netsh advfirewall firewall set rule name="Node.js JavaScript
# Runtime" profile=public new enable=yes  (re-enables the Public allow rules)
# and netsh advfirewall firewall set rule name="Node.js JavaScript Runtime"
# profile=private new enable=yes. The VANTA rules added here can be removed
# with: netsh advfirewall firewall delete rule name="VANTA HTTPS Frontend 3000"
# (repeat for the other VANTA* rule names).
# ============================================================================

$ErrorActionPreference = 'Stop'

# --- Admin check ------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'ERROR: This script must run as Administrator.' -ForegroundColor Red
  Write-Host 'Right-click your terminal -> "Run as administrator", or use:'
  Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\setup-lan-admin.ps1'
  exit 1
}

Write-Host '==> 1/3 Disabling backwards Node.js per-app firewall rules...'
netsh advfirewall firewall set rule name="Node.js JavaScript Runtime" profile=public new enable=no
netsh advfirewall firewall set rule name="Node.js JavaScript Runtime" profile=private new enable=no

Write-Host '==> 2/3 Adding VANTA LAN inbound rules (Private + Domain only)...'
netsh advfirewall firewall add rule name="VANTA HTTPS Frontend 3000" dir=in action=allow protocol=TCP localport=3000 profile=private,domain
netsh advfirewall firewall add rule name="VANTA HTTPS API 5000" dir=in action=allow protocol=TCP localport=5000 profile=private,domain
netsh advfirewall firewall add rule name="VANTA LiveKit WSS 7443" dir=in action=allow protocol=TCP localport=7443 profile=private,domain
netsh advfirewall firewall add rule name="VANTA LiveKit RTC TCP 7881" dir=in action=allow protocol=TCP localport=7881 profile=private,domain
netsh advfirewall firewall add rule name="VANTA LiveKit RTC UDP 7882" dir=in action=allow protocol=UDP localport=7882 profile=private,domain

Write-Host '==> 3/3 Reclassifying the active network(s) to Private...'
$profiles = Get-NetConnectionProfile -ErrorAction SilentlyContinue
if (-not $profiles) {
  Write-Warning 'No active network profile found; skip reclassification.'
} else {
  foreach ($p in $profiles) {
    if ($p.NetworkCategory -eq 'Public') {
      try {
        $p | Set-NetConnectionProfile -NetworkCategory Private
        Write-Host ("  - {0} ({1}): Public -> Private" -f $p.Name, $p.InterfaceAlias)
      } catch {
        Write-Warning ("  - could not change {0}: {1}" -f $p.Name, $_.Exception.Message)
      }
    } else {
      Write-Host ("  - {0} ({1}): already {2}" -f $p.Name, $p.InterfaceAlias, $p.NetworkCategory)
    }
  }
}

Write-Host ''
Write-Host 'Done. Verification:'
netsh advfirewall firewall show rule name="VANTA HTTPS Frontend 3000" | findstr /i "Rule Name Enabled Action Profile LocalPort"
netsh advfirewall firewall show rule name="VANTA HTTPS API 5000" | findstr /i "Rule Name Enabled Action Profile LocalPort"
netsh advfirewall firewall show rule name="VANTA LiveKit WSS 7443" | findstr /i "Rule Name Enabled Action Profile LocalPort"
Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, NetworkCategory | Format-Table -AutoSize
Write-Host ''
Write-Host 'Now from the phone (same Wi-Fi):'
Write-Host '  https://10.174.123.177:3000'
Write-Host 'Trust the app once it is verified:'
Write-Host '  frontend/.certs-dev/rootCA.pem  (install on the phone as a CA cert)'