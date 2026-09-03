@echo off
REM ============================================================
REM VANTA - LiveKit Windows Firewall rules (run ONCE as Administrator)
REM ============================================================
REM Adds rules for the WSS bridge (node.exe on port 7443) so a phone on the
REM LAN can reach it over HTTPS, plus explicit rules for the WebRTC RTC ports.
REM
REM IMPORTANT: All rules are scoped to the Private + Domain (local/private)
REM network profiles ONLY - nothing is opened on the Public profile, so the
REM LiveKit ports are NOT exposed to the public internet.
REM
REM Note: changing these firewall rules does NOT touch any LiveKit / VANTA
REM configuration - it only keeps phone live-streaming working on the
REM trusted LAN (the app itself is untouched).
REM
REM To run: right-click this file -> "Run as administrator".
REM ============================================================

netsh advfirewall firewall add rule name="VANTA LiveKit WSS 7443" dir=in action=allow protocol=TCP localport=7443 profile=private,domain
netsh advfirewall firewall add rule name="VANTA LiveKit RTC TCP 7881" dir=in action=allow protocol=TCP localport=7881 profile=private,domain
netsh advfirewall firewall add rule name="VANTA LiveKit RTC UDP 7882" dir=in action=allow protocol=UDP localport=7882 profile=private,domain

echo.
echo Done. Rules:
netsh advfirewall firewall show rule name="VANTA LiveKit WSS 7443" | findstr /i "Rule Name Enabled Action Profile LocalPort"
netsh advfirewall firewall show rule name="VANTA LiveKit RTC TCP 7881" | findstr /i "Rule Name Enabled Action Profile LocalPort"
netsh advfirewall firewall show rule name="VANTA LiveKit RTC UDP 7882" | findstr /i "Rule Name Enabled Action Profile LocalPort"
pause