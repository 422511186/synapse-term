param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, [int]::MaxValue)]
  [int]$SessionId,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ApplicationPath,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$EncodedCommandLine,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$WorkingDirectory,

  [ValidateRange(1, [int]::MaxValue)]
  [int]$TimeoutMs = 600000
)

$ErrorActionPreference = 'Stop'

if (-not ('TerminalAgent.UserSessionProcess' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace TerminalAgent {
  public static class UserSessionProcess {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct StartupInfo {
      public int cb;
      public string lpReserved;
      public string lpDesktop;
      public string lpTitle;
      public int dwX;
      public int dwY;
      public int dwXSize;
      public int dwYSize;
      public int dwXCountChars;
      public int dwYCountChars;
      public int dwFillAttribute;
      public int dwFlags;
      public short wShowWindow;
      public short cbReserved2;
      public IntPtr lpReserved2;
      public IntPtr hStdInput;
      public IntPtr hStdOutput;
      public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ProcessInformation {
      public IntPtr hProcess;
      public IntPtr hThread;
      public int dwProcessId;
      public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DuplicateTokenEx(
      IntPtr existingToken,
      uint desiredAccess,
      IntPtr tokenAttributes,
      int impersonationLevel,
      int tokenType,
      out IntPtr primaryToken
    );

    [DllImport("userenv.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreateEnvironmentBlock(
      out IntPtr environment,
      IntPtr token,
      bool inherit
    );

    [DllImport("userenv.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DestroyEnvironmentBlock(IntPtr environment);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreateProcessAsUser(
      IntPtr token,
      string applicationName,
      StringBuilder commandLine,
      IntPtr processAttributes,
      IntPtr threadAttributes,
      bool inheritHandles,
      uint creationFlags,
      IntPtr environment,
      string currentDirectory,
      ref StartupInfo startupInfo,
      out ProcessInformation processInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);
  }
}
'@
}

$explorer = Get-Process explorer -ErrorAction Stop |
  Where-Object { $_.SessionId -eq $SessionId } |
  Select-Object -First 1
if ($null -eq $explorer) {
  throw "No Explorer process is running in Session $SessionId"
}

$processHandle = [IntPtr]::Zero
$tokenHandle = [IntPtr]::Zero
$primaryToken = [IntPtr]::Zero
$environment = [IntPtr]::Zero
$processInformation = New-Object TerminalAgent.UserSessionProcess+ProcessInformation

try {
  $processHandle = [TerminalAgent.UserSessionProcess]::OpenProcess(0x1000, $false, $explorer.Id)
  if ($processHandle -eq [IntPtr]::Zero) {
    throw "OpenProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  if (-not [TerminalAgent.UserSessionProcess]::OpenProcessToken(
    $processHandle,
    0x0000018B,
    [ref]$tokenHandle
  )) {
    throw "OpenProcessToken failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  if (-not [TerminalAgent.UserSessionProcess]::DuplicateTokenEx(
    $tokenHandle,
    0x0000018B,
    [IntPtr]::Zero,
    2,
    1,
    [ref]$primaryToken
  )) {
    throw "DuplicateTokenEx failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  if (-not [TerminalAgent.UserSessionProcess]::CreateEnvironmentBlock(
    [ref]$environment,
    $primaryToken,
    $false
  )) {
    throw "CreateEnvironmentBlock failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  $application = (Resolve-Path -LiteralPath $ApplicationPath).Path
  $decodedCommandLine = [Text.Encoding]::Unicode.GetString(
    [Convert]::FromBase64String($EncodedCommandLine)
  )
  $commandLine = New-Object Text.StringBuilder $decodedCommandLine

  $startupInfo = New-Object TerminalAgent.UserSessionProcess+StartupInfo
  $startupInfo.cb = [Runtime.InteropServices.Marshal]::SizeOf($startupInfo)
  $startupInfo.lpDesktop = 'winsta0\default'
  $startupInfo.dwFlags = 0x00000001
  $startupInfo.wShowWindow = 0

  if (-not [TerminalAgent.UserSessionProcess]::CreateProcessAsUser(
    $primaryToken,
    $application,
    $commandLine,
    [IntPtr]::Zero,
    [IntPtr]::Zero,
    $false,
    0x08000400,
    $environment,
    (Resolve-Path -LiteralPath $WorkingDirectory).Path,
    [ref]$startupInfo,
    [ref]$processInformation
  )) {
    throw "CreateProcessAsUser failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  $waitResult = [TerminalAgent.UserSessionProcess]::WaitForSingleObject(
    $processInformation.hProcess,
    [uint32]$TimeoutMs
  )
  if ($waitResult -eq 258) {
    [void][TerminalAgent.UserSessionProcess]::TerminateProcess($processInformation.hProcess, 124)
    [void][TerminalAgent.UserSessionProcess]::WaitForSingleObject(
      $processInformation.hProcess,
      5000
    )
    throw "Interactive process timed out after $TimeoutMs ms"
  }
  if ($waitResult -ne 0) {
    throw "WaitForSingleObject failed: $waitResult"
  }
  [uint32]$exitCode = 0
  if (-not [TerminalAgent.UserSessionProcess]::GetExitCodeProcess(
    $processInformation.hProcess,
    [ref]$exitCode
  )) {
    throw "GetExitCodeProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  Write-Output $exitCode
} finally {
  if ($processInformation.hThread -ne [IntPtr]::Zero) {
    [void][TerminalAgent.UserSessionProcess]::CloseHandle($processInformation.hThread)
  }
  if ($processInformation.hProcess -ne [IntPtr]::Zero) {
    [void][TerminalAgent.UserSessionProcess]::CloseHandle($processInformation.hProcess)
  }
  if ($environment -ne [IntPtr]::Zero) {
    [void][TerminalAgent.UserSessionProcess]::DestroyEnvironmentBlock($environment)
  }
  foreach ($handle in @($primaryToken, $tokenHandle, $processHandle)) {
    if ($handle -ne [IntPtr]::Zero) {
      [void][TerminalAgent.UserSessionProcess]::CloseHandle($handle)
    }
  }
}
