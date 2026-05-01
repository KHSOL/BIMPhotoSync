param(
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release",
  [string]$RevitVersion = "2025",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$revitRoot = $PSScriptRoot
$repoRoot = Split-Path -Parent $revitRoot
$projectPath = Join-Path $revitRoot "BimPhotoSyncAddin\BimPhotoSyncAddin.csproj"
$buildOutput = Join-Path $revitRoot "BimPhotoSyncAddin\bin\$Configuration\net8.0-windows"
$stagingRoot = Join-Path $revitRoot ".package"
$packageName = "BimPhotoSyncAddin-Revit$RevitVersion-$Configuration"
$stagingDir = Join-Path $stagingRoot $packageName
$payloadDir = Join-Path $stagingDir "BimPhotoSync"
$distDir = Join-Path $revitRoot "dist"
$zipPath = Join-Path $distDir "$packageName.zip"

if (-not $SkipBuild) {
  dotnet build $projectPath -c $Configuration
}

if (-not (Test-Path -LiteralPath (Join-Path $buildOutput "BimPhotoSyncAddin.dll"))) {
  throw "Build output not found: $buildOutput"
}

$resolvedStagingRoot = [System.IO.Path]::GetFullPath($stagingRoot)
$resolvedRevitRoot = [System.IO.Path]::GetFullPath($revitRoot)
if (-not $resolvedStagingRoot.StartsWith($resolvedRevitRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to remove staging path outside revit-addin: $resolvedStagingRoot"
}

if (Test-Path -LiteralPath $stagingDir) {
  Remove-Item -LiteralPath $stagingDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $payloadDir | Out-Null
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

Copy-Item -Path (Join-Path $buildOutput "*") -Destination $payloadDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $revitRoot "BimPhotoSync.addin") -Destination $stagingDir
Copy-Item -LiteralPath (Join-Path $revitRoot "config.example.json") -Destination $stagingDir
Copy-Item -LiteralPath (Join-Path $revitRoot "install.ps1") -Destination $stagingDir
Copy-Item -LiteralPath (Join-Path $revitRoot "uninstall.ps1") -Destination $stagingDir

$readme = @"
BIM Photo Sync Revit Add-in

Install:
1. Extract this zip.
2. Open PowerShell in the extracted folder.
3. Run:
   powershell -ExecutionPolicy Bypass -File .\install.ps1
4. Edit %APPDATA%\BimPhotoSync\config.json if needed.
5. Restart Revit 2025.

Uninstall:
   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1

The installer copies the add-in DLLs to:
%APPDATA%\Autodesk\Revit\Addins\$RevitVersion\BimPhotoSync

The installer writes:
%APPDATA%\Autodesk\Revit\Addins\$RevitVersion\BimPhotoSync.addin
"@
Set-Content -LiteralPath (Join-Path $stagingDir "README.txt") -Value $readme -Encoding UTF8

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $stagingDir | Select-Object -ExpandProperty FullName) -DestinationPath $zipPath -Force
Write-Host "Created $zipPath"
