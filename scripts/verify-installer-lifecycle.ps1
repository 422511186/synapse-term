[CmdletBinding()]
param(
  [string]$SetupPath
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($SetupPath)) {
  $SetupPath = Join-Path $workspace 'release\Terminal-Agent-0.3.0-x64-Setup.exe'
}
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$testTempDirectory = [IO.Path]::GetFullPath($env:TEMP)
$tempRoot = Join-Path $testTempDirectory "ta-i-$runId"
$blockedDirectory = Join-Path $tempRoot 'block'
$installDirectory = Join-Path $tempRoot 'app'
$installedExecutable = Join-Path $installDirectory 'Terminal Agent.exe'
$uninstaller = Join-Path $installDirectory 'Uninstall Terminal Agent.exe'
$runtimeDirectory = Join-Path $installDirectory 'resources\core'
$dataRoot = Join-Path $env:APPDATA 'Terminal Agent'
$stateDirectory = Join-Path $dataRoot 'core'
$statePath = Join-Path $stateDirectory 'upgrade-state.ini'
$markerPath = Join-Path $dataRoot "installer-e2e-retention-$runId.txt"
$stateExisted = Test-Path -LiteralPath $statePath
$stateBytes = if ($stateExisted) { [IO.File]::ReadAllBytes($statePath) } else { $null }
$previousPackagedExe = $env:TERMINAL_AGENT_PACKAGED_EXE
$previousRuntimeDirectory = $env:TERMINAL_AGENT_RUNTIME_DIR
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

function Restore-UpgradeState {
  if ($stateExisted) {
    [IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
    [IO.File]::WriteAllBytes($statePath, $stateBytes)
  } elseif (Test-Path -LiteralPath $statePath) {
    Remove-Item -LiteralPath $statePath -Force
  }
}

function Wait-ForPathRemoval {
  param([string]$Path, [int]$TimeoutMs = 20000)
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ((Test-Path -LiteralPath $Path) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
  }
  return -not (Test-Path -LiteralPath $Path)
}

function Wait-ForInstallProcesses {
  param([string]$InstallRoot, [int]$TimeoutMs = 30000)
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  do {
    $active = Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallRoot, [StringComparison]::OrdinalIgnoreCase)
    }
    if ($null -eq $active) { return $true }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

function Assert-NoExistingInstall {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $existing = Get-ItemProperty $roots -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq 'Terminal Agent' }
  Assert-True ($null -eq $existing) 'Refusing installer E2E because Terminal Agent is already installed.'
}

function Assert-NoActiveCore {
  $active = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -ieq 'Terminal Agent.exe' -or
    ($_.CommandLine -match 'core-main\.mjs' -and $_.CommandLine -match 'Terminal Agent|terminal-agent')
  }
  Assert-True ($null -eq $active) 'Refusing installer E2E because Terminal Agent or its Core is running.'
}

try {
  Assert-NoExistingInstall
  Assert-NoActiveCore
  [IO.Directory]::CreateDirectory($tempRoot) | Out-Null
  [IO.Directory]::CreateDirectory($dataRoot) | Out-Null
  [IO.Directory]::CreateDirectory($stateDirectory) | Out-Null
  [IO.File]::WriteAllText($markerPath, 'installer retention proof', [Text.Encoding]::UTF8)

  [IO.File]::WriteAllText(
    $statePath,
    "[core]`r`nrunning=1`r`npid=$PID`r`nversion=0.3.0`r`nsessions=2`r`nagentTasks=1`r`nupdatedAt=$([DateTime]::UtcNow.ToString('o'))`r`n",
    [Text.Encoding]::ASCII
  )
  $blockedExitCode = Invoke-HiddenProcess $setup @('/S', "/D=$blockedDirectory")
  if (Test-Path -LiteralPath (Join-Path $blockedDirectory 'Terminal Agent.exe')) {
    $installDirectory = $blockedDirectory
    $installedExecutable = Join-Path $installDirectory 'Terminal Agent.exe'
    $uninstaller = Join-Path $installDirectory 'Uninstall Terminal Agent.exe'
    $runtimeDirectory = Join-Path $installDirectory 'resources\core'
    $installed = $true
  }
  Assert-True ($blockedExitCode -eq 32) "Expected blocked installer exit code 32, got $blockedExitCode."
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $blockedDirectory 'Terminal Agent.exe'))) 'Blocked installer wrote application files.'
  Restore-UpgradeState

  $installExitCode = Invoke-HiddenProcess $setup @('/S', "/D=$installDirectory")
  Assert-True ($installExitCode -eq 0) "Silent install failed with exit code $installExitCode."
  $installed = $true
  foreach ($requiredPath in @(
    $installedExecutable,
    $uninstaller,
    (Join-Path $runtimeDirectory 'node.exe'),
    (Join-Path $runtimeDirectory 'dist\core-main.mjs'),
    (Join-Path $runtimeDirectory 'dist\core-maintenance.mjs')
  )) {
    Assert-True (Test-Path -LiteralPath $requiredPath) "Installed artifact is missing: $requiredPath"
  }

  Push-Location $workspace
  try {
    $env:TERMINAL_AGENT_PACKAGED_EXE = $installedExecutable
    & pnpm exec playwright test apps/desktop/e2e/packaged.spec.ts --config playwright.electron.config.ts
    Assert-True ($LASTEXITCODE -eq 0) "Installed packaged E2E failed with exit code $LASTEXITCODE."

    $env:TERMINAL_AGENT_RUNTIME_DIR = $runtimeDirectory
    & pnpm smoke:core-package
    Assert-True ($LASTEXITCODE -eq 0) "Installed Core smoke failed with exit code $LASTEXITCODE."
    & pnpm smoke:maintenance-package
    Assert-True ($LASTEXITCODE -eq 0) "Installed maintenance smoke failed with exit code $LASTEXITCODE."
  } finally {
    Pop-Location
  }

  Assert-True (Wait-ForInstallProcesses $installDirectory) 'Installed application processes did not exit before uninstall.'
  $uninstallExitCode = Invoke-HiddenProcess $uninstaller @('/S')
  Assert-True ($uninstallExitCode -eq 0) "Silent uninstall failed with exit code $uninstallExitCode."
  Assert-True (Wait-ForPathRemoval $installDirectory 60000) 'Install directory was not removed after uninstall.'
  $installed = $false
  Assert-True (Test-Path -LiteralPath $markerPath) 'Uninstall removed retained user data.'

  [pscustomobject]@{
    setup = $setup
    blockedExitCode = $blockedExitCode
    installExitCode = $installExitCode
    uninstallExitCode = $uninstallExitCode
    installedPackagedE2E = 'passed'
    coreSmoke = 'passed'
    maintenanceRollback = 'passed'
    userDataRetained = $true
  } | ConvertTo-Json -Compress
} finally {
  $env:TERMINAL_AGENT_PACKAGED_EXE = $previousPackagedExe
  $env:TERMINAL_AGENT_RUNTIME_DIR = $previousRuntimeDirectory
  Restore-UpgradeState
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
    $resolvedTemp.StartsWith($testTempDirectory, [StringComparison]::OrdinalIgnoreCase) -and
    (Test-Path -LiteralPath $resolvedTemp)
  ) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
