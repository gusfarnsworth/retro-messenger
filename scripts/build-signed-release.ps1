# Build a signed Windows NSIS installer; keep your private key outside source control.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$keyPath = Join-Path $env:USERPROFILE '.tauri\retro-messenger.key'
if (!(Test-Path $keyPath)) {
    throw "Missing private key $keyPath. Run scripts/setup-updater.ps1 first."
}
Push-Location $root
try {
    & npm run updater:verify
    if ($LASTEXITCODE -ne 0) { throw 'Updater setup verification failed.' }
    $env:TAURI_SIGNING_PRIVATE_KEY = $keyPath
    $securePassword = Read-Host 'Tauri signing key password (press Enter for none)' -AsSecureString
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
    & npm run desktop:build -- --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw 'Windows NSIS release build failed.' }
    Write-Host 'Release files are under src-tauri\target\release\bundle\nsis' -ForegroundColor Green
    Write-Host 'Upload the .exe and .exe.sig together with latest.json, or use the included GitHub Actions workflow.'
} finally {
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
}
