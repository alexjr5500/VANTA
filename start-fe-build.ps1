$ErrorActionPreference = 'Continue'
$p = Start-Process -FilePath "cmd.exe" -ArgumentList '/c', 'cd /d c:\VANTA && npm run build:frontend > c:\VANTA\build-fe.log 2>&1' -WindowStyle Hidden -PassThru
$p.Id | Out-File -FilePath 'c:\VANTA\build-fe.pid' -Encoding ascii
Write-Output ("STARTED frontend build PID " + $p.Id)