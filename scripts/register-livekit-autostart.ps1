# ============================================================
# VANTA - Register LiveKit background autostart
#
# Registers two Windows Task Scheduler tasks so LiveKit (and its WSS bridge)
# start automatically when the machine starts / the developer logs in, and stay
# available in the background:
#
#   VANTA-LiveKit            - runs once at user logon.
#   VANTA-LiveKit-Watchdog   - re-runs every 5 minutes if nothing is listening
#                              (self-healing; the launcher is idempotent).
#
# When run from an elevated prompt it additionally registers a system-level
# "At startup" trigger so LiveKit starts before any user logs in.
#
# Re-run any time to refresh the registration (it is idempotent).
# ============================================================
$ErrorActionPreference = 'Stop'

$Launcher   = 'C:\VANTA\scripts\start-livekit.ps1'
$User       = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$PwArgs     = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Launcher`""
$Action     = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $PwArgs
$Settings   = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

function Register-VantaTask {
  param(
    [string]$Name,
    [Microsoft.Management.Infrastructure.CimInstance]$Trigger,
    [Microsoft.Management.Infrastructure.CimInstance]$Principal = $null
  )
  Write-Host "Registering scheduled task $Name ..."
  if ($null -eq $Principal) {
    Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Settings $Settings `
      -Description 'VANTA LiveKit background autostart (existing LiveKit server + WSS bridge)' -Force | Out-Null
  } else {
    Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Principal $Principal `
      -Settings $Settings `
      -Description 'VANTA LiveKit background autostart (system startup, elevated)' -Force | Out-Null
  }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
  # Best case: start at boot before anyone logs in.
  $bootTrigger = New-ScheduledTaskTrigger -AtStartup
  $systemPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-VantaTask 'VANTA-LiveKit' $bootTrigger $systemPrincipal
} else {
  # Non-elevated: start at logon for the current user. The watchdog keeps it
  # alive afterwards.
  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $User
  Register-VantaTask 'VANTA-LiveKit' $logonTrigger
}

# Watchdog: try to ensure the services every 5 minutes (idempotent launcher).
# Omitting -RepetitionDuration makes the repetition run indefinitely.
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-VantaTask 'VANTA-LiveKit-Watchdog' $watchdogTrigger

Write-Host ''
Write-Host 'Registered tasks:'
schtasks /query /fo table /tn 'VANTA-LiveKit' | Out-Host
schtasks /query /fo table /tn 'VANTA-LiveKit-Watchdog' | Out-Host
Write-Host ''
Write-Host 'Done. LiveKit will now auto-start after logon / reboot and self-heal every 5 minutes.'