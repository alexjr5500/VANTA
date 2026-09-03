$ErrorActionPreference = 'Continue'
$p = Start-Process -FilePath "cmd.exe" -ArgumentList '/c', 'cd /d c:\VANTA && npm run build:backend > c:\VANTA\build-be.log 2>&1' -WindowStyle Hidden -PassThru
$p.Id | Out-File -FilePath 'c:\VANTA\build-be.pid' -Encoding ascii
Write-Output ("STARTED backend build PID " + $p.Id)