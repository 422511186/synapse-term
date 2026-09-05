[CmdletBinding()]
param(
  [string]$SetupPath,
  [string]$UpgradeSetupPath
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($SetupPath)) {
  $candidates = Get-ChildItem -LiteralPath (Join-Path $workspace 'release') -Filter 'Synapse-Term-*-Setup.exe' -ErrorAction SilentlyContinue
  if ($null -eq $candidates) { throw 'No Synapse-Term installer found in release/.' }
  $SetupPath = $candidates | Select-Object -First 1 -ExpandProperty FullName
}
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$upgradeSetup = if ([string]::IsNullOrWhiteSpace($UpgradeSetupPath)) { $setup } else { (Resolve-Path -LiteralPath $UpgradeSetupPath).Path }
$upgradeVersion = (Get-Item -LiteralPath $upgradeSetup).VersionInfo.ProductVersion
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$tempRoot = Join-Path $env:TEMP "st-i-$runId"
$installDirectory = Join-Path $tempRoot 'app'
$installedExecutable = Join-Path $installDirectory 'Synapse Term.exe'
$uninstaller = Join-Path $installDirectory 'Uninstall Synapse Term.exe'
$dataRoot = Join-Path $env:APPDATA 'Synapse Term'
$stateDirectory = Join-Path $dataRoot 'state'
$statePath = Join-Path $stateDirectory 'installer.ini'
$markerPath = Join-Path $dataRoot "installer-e2e-retention-$runId.txt"
$stateExisted = Test-Path -LiteralPath $statePath
$stateBytes = if ($stateExisted) { [IO.File]::ReadAllBytes($statePath) } else { $null }
$installed = $false
$previousUserData = $env:SYNAPSE_TERM_USER_DATA_DIR

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Invoke-HiddenProcess {
  param([string]$FilePath, [string[]]$Arguments)
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit(120000)) { throw "Installer process timed out: $FilePath" }
  return $process.ExitCode
}

function Get-TestAppProcesses {
  Get-Process -Name 'Synapse Term' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $installedExecutable }
}

function Stop-TestApp {
  Get-TestAppProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Restore-StateFile {
  if ($stateExisted) {
    [IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
    [IO.File]::WriteAllBytes($statePath, $stateBytes)
  } elseif (Test-Path -LiteralPath $statePath) {
    Remove-Item -LiteralPath $statePath -Force
  }
}

function Wait-ForPathRemoval {
  param([string]$Path, [int]$TimeoutMs = 60000)
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ((Test-Path -LiteralPath $Path) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  return -not (Test-Path -LiteralPath $Path)
}

try {
  $existing = Get-ItemProperty @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  ) -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'Synapse Term' }
  Assert-True ($null -eq $existing) 'Refusing installer E2E because Synapse Term is already installed.'

  [IO.Directory]::CreateDirectory($tempRoot) | Out-Null
  $env:SYNAPSE_TERM_USER_DATA_DIR = Join-Path $tempRoot 'user-data'
  [IO.Directory]::CreateDirectory($dataRoot) | Out-Null
  [IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
  [IO.File]::WriteAllText($markerPath, 'installer retention proof', [Text.Encoding]::UTF8)
  [IO.File]::WriteAllText(
    $statePath,
    "[app]`r`ninstalled=true`r`nupdatedAt=$([DateTime]::UtcNow.ToString('o'))`r`n",
    [Text.Encoding]::ASCII
  )

  $installExitCode = Invoke-HiddenProcess $setup @('/S', "/D=$installDirectory")
  Assert-True ($installExitCode -eq 0) "Silent install failed with exit code $installExitCode."
  $installed = $true
  Assert-True (Test-Path -LiteralPath $installedExecutable) "Installed executable is missing: $installedExecutable"
  Assert-True (Test-Path -LiteralPath $uninstaller) "Installed uninstaller is missing: $uninstaller"

  $upgradeExitCode = Invoke-HiddenProcess $upgradeSetup @('--updated', '/S', '--force-run', "/D=$installDirectory")
  Assert-True ($upgradeExitCode -eq 0) "Silent upgrade failed with exit code $upgradeExitCode."
  Assert-True ((Get-Item -LiteralPath $installedExecutable).VersionInfo.ProductVersion -in @($upgradeVersion, "$upgradeVersion.0")) 'The installed executable version does not match the upgrade.'
  $restartDeadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    $restarted = @(Get-TestAppProcesses).Count -gt 0
    if (-not $restarted) { Start-Sleep -Milliseconds 250 }
  } while (-not $restarted -and [DateTime]::UtcNow -lt $restartDeadline)
  Assert-True $restarted 'The upgraded application did not restart after --force-run.'
  Stop-TestApp

  $uninstallExitCode = Invoke-HiddenProcess $uninstaller @('/S')
  Assert-True ($uninstallExitCode -eq 0) "Silent uninstall failed with exit code $uninstallExitCode."
  Assert-True (Wait-ForPathRemoval $installDirectory) 'Install directory was not removed after uninstall.'
  $installed = $false
  Assert-True (Test-Path -LiteralPath $markerPath) 'Uninstall removed retained user data.'

  [pscustomobject]@{
    setup = $setup
    installExitCode = $installExitCode
    upgradeExitCode = $upgradeExitCode
    upgradeVersion = $upgradeVersion
    restarted = $restarted
    uninstallExitCode = $uninstallExitCode
    userDataRetained = $true
  } | ConvertTo-Json -Compress
} finally {
  Stop-TestApp
  if ($installed -and (Test-Path -LiteralPath $uninstaller)) {
    Invoke-HiddenProcess $uninstaller @('/S') | Out-Null
    Wait-ForPathRemoval $installDirectory | Out-Null
  }
  Restore-StateFile
  $env:SYNAPSE_TERM_USER_DATA_DIR = $previousUserData
  if (Test-Path -LiteralPath $markerPath) {
    Remove-Item -LiteralPath $markerPath -Force
  }
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  if (
    -not (Test-Path -LiteralPath $installedExecutable) -and
    $resolvedTemp.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\st-i-'), [StringComparison]::OrdinalIgnoreCase) -and
    (Test-Path -LiteralPath $resolvedTemp)
  ) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
