# Pack ILAF AI as a Windows app folder with ILAF-AI.exe
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "package.json"))) { $root = Get-Location }
Set-Location $root

npm run build
$src = Join-Path $root "release\win-unpacked.tmp"
if (-not (Test-Path $src)) { throw "Missing $src - run electron-builder once to download Electron." }

$dst = Join-Path $root "release\ILAF-AI"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
Copy-Item -Recurse $src $dst
Remove-Item -Force (Join-Path $dst "resources\default_app.asar") -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $dst "resources\app") | Out-Null
Copy-Item -Recurse (Join-Path $root "dist") (Join-Path $dst "resources\app\dist")
Copy-Item -Recurse (Join-Path $root "electron") (Join-Path $dst "resources\app\electron")
Copy-Item (Join-Path $root "package.json") (Join-Path $dst "resources\app\package.json")
$exe = Join-Path $dst "electron.exe"
if (Test-Path $exe) { Rename-Item $exe "ILAF-AI.exe" }
Write-Output "Ready: $dst\ILAF-AI.exe"
