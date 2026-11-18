# Run from your own Windows computer. Creates/uses your private key outside the repository.
# Example: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-updater.ps1 -Repository "MYNAME/retro-messenger"
param([string]$Repository)
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Repository)) {
    $Repository = Read-Host 'Enter your public GitHub release repository (owner/repo)'
}
if ($Repository -notmatch '^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$') {
    throw 'Repository must be in the form owner/repo (for example MyAccount/retro-messenger).'
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $root 'src-tauri\tauri.conf.json'
$keyFolder = Join-Path $env:USERPROFILE '.tauri'
$keyPath = Join-Path $keyFolder 'retro-messenger.key'
$publicPath = "$keyPath.pub"
New-Item -ItemType Directory -Path $keyFolder -Force | Out-Null

if (!(Test-Path $keyPath)) {
    Write-Host 'Generating a new updater signing key on this computer.' -ForegroundColor Cyan
    Write-Host 'Choose a password and keep both this key file and password safely backed up.'
    Push-Location $root
    try {
        & npm run tauri -- signer generate -w $keyPath
        if ($LASTEXITCODE -ne 0) { throw 'Tauri key generation failed.' }
    } finally { Pop-Location }
} else {
    Write-Host 'Existing signing key found. Preserving it (important for installed users).' -ForegroundColor Green
}
if (!(Test-Path $publicPath)) {
    throw "Public key missing: $publicPath. Restore both files from backup before continuing."
}
# Tauri's .pub file is Base64-encoded Minisign text. Validate the decoded
# key, not the encoded text (which does not contain 'untrusted comment:').
$publicKey = [System.IO.File]::ReadAllText($publicPath).Trim()
try {
    if ($publicKey -notmatch '^[A-Za-z0-9+/]+={0,2}$') {
        throw 'Public key is not Base64.'
    }
    $decodedKey = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($publicKey))
    $lines = @($decodedKey -split '\r?\n' | Where-Object { $_.Trim().Length -gt 0 })
    if ($lines.Count -lt 2 -or !$lines[0].StartsWith('untrusted comment:') -or $lines[1] -notmatch '^[A-Za-z0-9+/=]{40,}$') {
        throw 'Decoded public key has an invalid Minisign structure.'
    }
} catch {
    throw 'The public key is not a valid Base64-encoded Tauri updater signing key. Preserve your private key and inspect the public key before continuing.'
}
$config = Get-Content -Raw $configPath | ConvertFrom-Json
$config.plugins.updater.pubkey = $publicKey
$config.plugins.updater.endpoints = @("https://github.com/$Repository/releases/latest/download/latest.json")
$config.bundle.createUpdaterArtifacts = $true
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 60), $utf8)

Write-Host "Configured signed updater for https://github.com/$Repository/releases" -ForegroundColor Green
Write-Host "Private key (DO NOT UPLOAD): $keyPath"
Write-Host "Public key configured in: $configPath"
Write-Host 'Next: npm run updater:verify'
Write-Host 'Then add TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD to GitHub Actions Secrets.'
Write-Host 'Also add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to the GitHub Secrets.'
