[CmdletBinding()]
param(
  [string]$SetupPath
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($SetupPath)) {
  $candidates = Get-ChildItem -LiteralPath (Join-Path $workspace 'release') -Filter 'Synapse-Term-*-Setup.exe' -ErrorAction SilentlyContinue
  if ($null -eq $candidates) { throw 'No Synapse-Term installer found in release/.' }
  $SetupPath = $candidates | Select-Object -First 1 -ExpandProperty FullName
}
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
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

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Invoke-HiddenProcess {
  param([string]$FilePath, [string[]]$Arguments)
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -PassThru -WindowStyle Hidden
  return $process.ExitCode
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
  $existing = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'Synapse Term' }
  Assert-True ($null -eq $existing) 'Refusing installer E2E because Synapse Term is already installed.'

  [IO.Directory]::CreateDirectory($tempRoot) | Out-Null
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

  $uninstallExitCode = Invoke-HiddenProcess $uninstaller @('/S')
  Assert-True ($uninstallExitCode -eq 0) "Silent uninstall failed with exit code $uninstallExitCode."
  Assert-True (Wait-ForPathRemoval $installDirectory) 'Install directory was not removed after uninstall.'
  $installed = $false
  Assert-True (Test-Path -LiteralPath $markerPath) 'Uninstall removed retained user data.'

  [pscustomobject]@{
    setup = $setup
    installExitCode = $installExitCode
    uninstallExitCode = $uninstallExitCode
    userDataRetained = $true
  } | ConvertTo-Json -Compress
} finally {
  Restore-StateFile
  if ($installed -and (Test-Path -LiteralPath $uninstaller)) {
    Invoke-HiddenProcess $uninstaller @('/S') | Out-Null
    Wait-ForPathRemoval $installDirectory | Out-Null
  }
  if (Test-Path -LiteralPath $markerPath) {
    Remove-Item -LiteralPath $markerPath -Force
  }
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  if (
    -not (Test-Path -LiteralPath $installedExecutable) -and
    $resolvedTemp.StartsWith($env:TEMP, [StringComparison]::OrdinalIgnoreCase) -and
    (Test-Path -LiteralPath $resolvedTemp)
  ) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
