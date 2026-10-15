$L = (Get-Content c:/VANTA/frontend/src/app/admin/users/page.tsx -Raw) -split '\n'
for ($i = 28; $i -lt 33; $i++) {
    $i++
    Write-Host $i
    Write-Host ('<' + $L[$i-1] + '>')
}
