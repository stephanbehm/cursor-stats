# Check if running in PowerShell
if ($PSVersionTable.PSEdition -ne "Core") {
    Write-Error "Please run this script using PowerShell Core (pwsh.exe)"
    exit 1
}

# Ensure required tools are installed
$tools = @{
    "vsce" = "npm install -g vsce"
    "gh" = "winget install GitHub.cli"
}

foreach ($tool in $tools.Keys) {
    if (!(Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "Installing $tool..."
        Invoke-Expression $tools[$tool]
    }
}

# Create builds directory if it doesn't exist
if (!(Test-Path "builds")) {
    New-Item -ItemType Directory -Path "builds"
}

# Package the extension
Write-Host "Packaging extension..."
vsce package -o "builds/cursor-stats-1.0.5-beta.15.vsix"

# Prepare release notes
$releaseNotes = @"
## What's Changed

**Major Improvements** 🔥
- Replaced SQLite3 with SQL.js for better cross-platform compatibility
- Added user-configurable refresh interval (5s minimum)
- Eliminated native dependencies for easier installation
- Smart notification system with configurable thresholds
- Reduced extension file size through optimized .vscodeignore

**Database Enhancements** 🗃️
- Complete database handling refactor
- Improved error handling and logging
- Fixed memory leaks and path resolution issues
- Enhanced database path resolution for Cursor Nightly

**UI/UX Improvements** 🎨
- Enhanced tooltip with compact and modern layout
- Optional status bar colors with configuration
- Improved settings accessibility features
- Better startup behavior for notifications

**Maintenance** 🧹
- Removed obsolete dependencies and build scripts
- Updated package dependencies
- Improved installation process
- Refined settings navigation and accessibility
- Better organization of extension files
"@

# Save release notes to temporary file
$tempFile = New-TemporaryFile
$releaseNotes | Out-File -FilePath $tempFile

# Commit changes
Write-Host "Committing changes..."
git add .
git commit -m "Release v1.0.5-beta.15 - SQL.js migration, notifications, and optimizations"
git push origin main

# Create GitHub release
Write-Host "Creating GitHub release..."
gh release create "v1.0.5-beta.15" "builds/cursor-stats-1.0.5-beta.15.vsix" `
    --title "v1.0.5-beta.15 - SQL.js Migration and Feature Update" `
    --notes-file $tempFile

# Cleanup
Remove-Item $tempFile

Write-Host "Release process completed successfully!" -ForegroundColor Green 