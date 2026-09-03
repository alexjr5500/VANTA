@echo off
REM ============================================================
REM VANTA - Local HTTPS development Windows Firewall rules
REM (run ONCE as Administrator)
REM ============================================================
REM Allows a phone on the same LAN to reach the VANTA local HTTPS
REM stack on this machine:
REM   TCP 3000 - Next.js dev server (https://<LAN-IP>:3000)
REM   TCP 5000 - Express API + Socket.IO over TLS (https://<LAN-IP>:5000)
REM
REM Rules are scoped to the Private + Domain (local/private) network
REM profiles ONLY - the ports are NOT opened on the Public profile, so
REM nothing is exposed to the public internet.
REM
REM This file ALSO repairs the backwards per-app Node.js rules created
REM when the Windows Firewall allow prompt was answered earlier:
REM   * Public  profile: Node.js inbound = ALLOW  (exposes every node port
REM     to the internet)          -> DISABLED
REM   * Private profile: Node.js inbound = BLOCK  (blocks the phone on the
REM     trusted LAN)              -> DISABLED
REM Replaced by the explicit TCP rules below (private/domain only).
REM
REM To run: right-click this file -> "Run as administrator".
REM ============================================================

echo Reparing Node.js per-app firewall rules (public=Allow / private=Block)...
netsh advfirewall firewall set rule name="Node.js JavaScript Runtime" profile=public new enable=no
netsh advfirewall firewall set rule name="Node.js JavaScript Runtime" profile=private new enable=no

echo Adding VANTA LAN HTTPS rules (private/domain profiles only)...
netsh advfirewall firewall add rule name="VANTA HTTPS Frontend 3000" dir=in action=allow protocol=TCP localport=3000 profile=private,domain
netsh advfirewall firewall add rule name="VANTA HTTPS API 5000" dir=in action=allow protocol=TCP localport=5000 profile=private,domain

echo.
echo Done. Rules:
netsh advfirewall firewall show rule name="VANTA HTTPS Frontend 3000" | findstr /i "Rule Name Enabled Action Profile LocalPort"
netsh advfirewall firewall show rule name="VANTA HTTPS API 5000" | findstr /i "Rule Name Enabled Action Profile LocalPort"
pause