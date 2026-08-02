import { describe, expect, it } from 'vitest';

import {
  ObserveOnlyShellDriver,
  PosixShellDriver,
  PowerShellDriver,
  ShellDriverError,
  resolveShellDriver,
  shellInputLines,
} from './shell-driver.js';

describe('ShellDriver', () => {
  it('selects a driver for each execution dialect and rejects observe-only execution', () => {
    expect(resolveShellDriver('posix')).toBeInstanceOf(PosixShellDriver);
    expect(resolveShellDriver('powershell')).toBeInstanceOf(PowerShellDriver);
    expect(resolveShellDriver('observe_only')).toBeInstanceOf(ObserveOnlyShellDriver);

    expect(() => resolveShellDriver('observe_only').wrapCommand('Get-Location', 'nonce-1')).toThrow(
      expect.objectContaining({ code: 'execution_dialect_observe_only' }),
    );
  });

  it('wraps POSIX commands in plaintext brace group with visible command', () => {
    const command = "printf '%s' ok";
    const wrapped = new PosixShellDriver().wrapCommand(command, 'nonce-posix');

    // Original command is visible in plaintext
    expect(wrapped).toContain(command);
    // Uses brace group, not eval
    expect(wrapped).toContain('{');
    expect(wrapped).toContain('}');
    // No base64 encoding
    expect(wrapped).not.toContain('base64');
    expect(wrapped).not.toContain('eval');
    expect(wrapped).not.toContain('__ta_b64');
    // Contains completion markers
    expect(wrapped).toContain('nonce-posix');
    expect(wrapped).toContain("'__TA_'");
    expect(wrapped).toContain("'START__'");
    expect(wrapped).toContain('__TA_DONE_');
    // Contains exit code capture
    expect(wrapped).toContain('__ta_exit=$?');
  });

  it('protects nested PowerShell scripts from POSIX variable expansion', () => {
    const command = `powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object @{n='TotalGB';e={[math]::Round($_.TotalVisibleMemorySize/1MB,2)}} | Format-List"`;
    const wrapped = new PosixShellDriver().wrapCommand(command, 'nonce-powershell-from-posix');

    expect(wrapped).toContain("powershell -NoProfile -Command 'Get-CimInstance");
    expect(wrapped).toContain('$_.TotalVisibleMemorySize');
    expect(wrapped).toContain("'\\''TotalGB'\\''");
    expect(wrapped).not.toContain('powershell -NoProfile -Command "');
  });

  it('decodes escaped quotes before single-quoting nested PowerShell scripts', () => {
    const command = 'powershell -NoProfile -Command "Write-Output \\"quoted\\""';
    const wrapped = new PosixShellDriver().wrapCommand(command, 'nonce-powershell-escaped');

    expect(wrapped).toContain('powershell -NoProfile -Command \'Write-Output "quoted"\'');
  });

  it('wraps PowerShell commands in plaintext dot-sourced block', () => {
    const command = "$global:terminalAgentValue = '你好'; Set-Location ..";
    const wrapped = new PowerShellDriver().wrapCommand(command, 'nonce-powershell');

    // Original command is visible in plaintext
    expect(wrapped).toContain(command);
    // Uses dot-sourced block
    expect(wrapped).toContain('. {');
    // No base64 or encoding
    expect(wrapped).not.toContain('FromBase64String');
    expect(wrapped).not.toContain('ScriptBlock]::Create');
    expect(wrapped).not.toContain('$__ta_b64');
    // Contains completion markers
    expect(wrapped).toContain('nonce-powershell');
    expect(wrapped).toContain("'__TA_'+'START__'");
    expect(wrapped).toContain('__TA_DONE_');
  });

  it('includes a fixed OS fingerprint marker in capability probes', () => {
    const posix = new PosixShellDriver().buildProbe('probe-os-posix');
    const powershell = new PowerShellDriver().buildProbe('probe-os-powershell');

    expect(posix).toContain('__TA_OS_probe-os-posix__');
    expect(posix).toContain('uname -s');
    expect(powershell).toContain('__TA_OS_probe-os-powershell__');
    expect(powershell).toContain('IsWindows');
  });

  it('rejects commands with disallowed control characters', () => {
    const driver = new PosixShellDriver();
    expect(() => driver.wrapCommand('echo \x00', 'nonce')).toThrow(ShellDriverError);
    expect(() => driver.wrapCommand('echo \x00', 'nonce')).toThrow(
      expect.objectContaining({ code: 'command_not_auditable' }),
    );
  });

  it('rejects commands containing transaction boundary markers', () => {
    const posix = new PosixShellDriver();
    expect(() => posix.wrapCommand('echo __TA_START__', 'nonce')).toThrow(
      expect.objectContaining({ code: 'command_not_auditable' }),
    );
    expect(() => posix.wrapCommand('echo __TA_DONE_fake;0__', 'nonce')).toThrow(
      expect.objectContaining({ code: 'command_not_auditable' }),
    );

    const ps = new PowerShellDriver();
    expect(() => ps.wrapCommand('echo __TA_START__', 'nonce')).toThrow(
      expect.objectContaining({ code: 'command_not_auditable' }),
    );
  });

  it('rejects commands containing OSC 777 sequences', () => {
    const driver = new PosixShellDriver();
    expect(() => driver.wrapCommand('echo \u001b]777;TA;fake;0\u0007', 'nonce')).toThrow(
      expect.objectContaining({ code: 'command_not_auditable' }),
    );
  });

  it('emits a safe single-line POSIX transaction for state retention', () => {
    const command = 'cd /tmp && echo hello';
    const wrapped = new PosixShellDriver().wrapCommand(command, 'nonce-state');

    // Brace group preserves current shell state (doesn't create subshell)
    expect(wrapped).toBe(
      `printf '%s%s' '__TA_' 'START__'; { ${command}; }; __ta_exit=$?; printf '\\033]777;TA;%s;%s\\007' 'nonce-state' "$__ta_exit"; printf '__TA_DONE_%s;%s__\\n' 'nonce-state' "$__ta_exit"; unset __ta_exit`,
    );
    expect(wrapped).not.toMatch(/[\r\n]/);
  });

  it('emits a safe single-line PowerShell transaction for state retention', () => {
    const command = 'Set-Location /tmp';
    const wrapped = new PowerShellDriver().wrapCommand(command, 'nonce-state');

    // Dot-sourced block preserves current scope
    expect(wrapped).toContain('. {');
    expect(wrapped).toContain(command);
    expect(wrapped).not.toMatch(/[\r\n]/);
  });

  it('keeps line-sensitive POSIX source in its original physical-line structure', () => {
    const command = 'printf first\n# keep this comment on its own line';
    const wrapped = new PosixShellDriver().wrapCommand(command, 'nonce-multiline');

    expect(wrapped).toContain(command);
    expect(wrapped).toContain('\r');
  });

  it('maps every source line ending to an individual PTY input line', () => {
    expect(shellInputLines('first\r\nsecond\nthird\rfourth')).toEqual([
      'first',
      'second',
      'third',
      'fourth',
    ]);
  });

  it('parses only matching private completion payloads', () => {
    const driver = new PowerShellDriver();

    expect(driver.parseCompletion('TA;nonce-2;7')).toEqual({ nonce: 'nonce-2', exitCode: 7 });
    expect(driver.parseCompletion('other;nonce-2;7')).toBeNull();
  });
});
