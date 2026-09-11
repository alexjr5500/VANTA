$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  $out = docker info 2>&1 | Out-String
  if ($out -match 'Server Version') { $ok = $true; break }
  Start-Sleep -Seconds 3
}
if ($ok) { Write-Host 'DOCKER-READY'; docker ps }
else { Write-Host 'DOCKER-NOT-READY' }