param(
  [string]$RevitVersion = "2025"
)

$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$payloadDir = Join-Path $sourceRoot "BimPhotoSync"
$manifestSource = Join-Path $sourceRoot "BimPhotoSync.addin"
$configExample = Join-Path $sourceRoot "config.example.json"

if (-not (Test-Path -LiteralPath $payloadDir)) {
  throw "Payload directory not found: $payloadDir"
}

if (-not (Test-Path -LiteralPath $manifestSource)) {
  throw "Manifest not found: $manifestSource"
}

$addinRoot = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$RevitVersion"
$targetPayload = Join-Path $addinRoot "BimPhotoSync"
$manifestTarget = Join-Path $addinRoot "BimPhotoSync.addin"

New-Item -ItemType Directory -Force -Path $targetPayload | Out-Null
Copy-Item -Path (Join-Path $payloadDir "*") -Destination $targetPayload -Recurse -Force

[xml]$manifest = Get-Content -LiteralPath $manifestSource
$assemblyPath = Join-Path $targetPayload "BimPhotoSyncAddin.dll"
$manifest.RevitAddIns.AddIn.Assembly = [string]$assemblyPath
$manifest.Save($manifestTarget)

$configDir = Join-Path $env:APPDATA "BimPhotoSync"
$configTarget = Join-Path $configDir "config.json"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
if (-not (Test-Path -LiteralPath $configTarget) -and (Test-Path -LiteralPath $configExample)) {
  Copy-Item -LiteralPath $configExample -Destination $configTarget
}

Write-Host "BIM Photo Sync Add-in installed for Revit $RevitVersion."
Write-Host "Manifest: $manifestTarget"
Write-Host "Add-in files: $targetPayload"
Write-Host "Config: $configTarget"
