param(
  [string]$RevitVersion = "2025",
  [switch]$RemoveConfig
)

$ErrorActionPreference = "Stop"

$addinRoot = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$RevitVersion"
$targetPayload = Join-Path $addinRoot "BimPhotoSync"
$manifestTarget = Join-Path $addinRoot "BimPhotoSync.addin"

if (Test-Path -LiteralPath $manifestTarget) {
  Remove-Item -LiteralPath $manifestTarget -Force
}

if (Test-Path -LiteralPath $targetPayload) {
  Remove-Item -LiteralPath $targetPayload -Recurse -Force
}

if ($RemoveConfig) {
  $configDir = Join-Path $env:APPDATA "BimPhotoSync"
  if (Test-Path -LiteralPath $configDir) {
    Remove-Item -LiteralPath $configDir -Recurse -Force
  }
}

Write-Host "BIM Photo Sync Add-in removed for Revit $RevitVersion."
