Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  Google Drive Vault Sync Installer" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Find Obsidian vaults by looking for .obsidian folders
$searchPaths = @("$env:USERPROFILE\Documents", "$env:USERPROFILE\Desktop", "$env:USERPROFILE", "C:\")
$vaults = @()

foreach ($path in $searchPaths) {
    if (Test-Path $path) {
        $found = Get-ChildItem -Path $path -Recurse -Directory -Filter ".obsidian" -ErrorAction SilentlyContinue -Depth 4
        foreach ($f in $found) { $vaults += $f.Parent.FullName }
    }
    if ($vaults.Count -gt 0) { break }
}

if ($vaults.Count -eq 0) {
    Write-Host "Could not find an Obsidian vault automatically." -ForegroundColor Yellow
    $vaultPath = Read-Host "Please paste your vault path manually (e.g. C:\Users\You\Documents\MyVault)"
} elseif ($vaults.Count -eq 1) {
    $vaultPath = $vaults[0]
    Write-Host "Found vault: $vaultPath" -ForegroundColor Green
} else {
    Write-Host "Found multiple vaults:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $vaults.Count; $i++) {
        Write-Host "  [$i] $($vaults[$i])"
    }
    $choice = Read-Host "Which one? (enter number)"
    $vaultPath = $vaults[[int]$choice]
}

$pluginDir = "$vaultPath\.obsidian\plugins\gdrive-vault-sync"
Write-Host ""
Write-Host "Installing to: $pluginDir" -ForegroundColor Cyan

# Create plugin folder
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null

# Download files
$base = "https://raw.githubusercontent.com/JanakaProjects/obsidian-gdrive-sync/main"
Write-Host "Downloading main.js..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "$base/main.js" -OutFile "$pluginDir\main.js"
Write-Host "Downloading manifest.json..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "$base/manifest.json" -OutFile "$pluginDir\manifest.json"

Write-Host ""
Write-Host "====================================" -ForegroundColor Green
Write-Host "  DONE! Plugin installed." -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Open Obsidian"
Write-Host "  2. Settings -> Community Plugins"
Write-Host "  3. Enable 'Google Drive Vault Sync'"
Write-Host "  4. Click the gear icon and paste your Google credentials"
Write-Host ""
Read-Host "Press Enter to close"
