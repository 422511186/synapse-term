import { describe, expect, it } from 'vitest';

import {
  PosixShellDriver,
  PowerShellDriver,
  ShellDriverError,
  parseEnvironmentFingerprint,
  resolveShellDriver,
} from './shell-driver.js';

describe('ShellDriver', () => {
  it('dispatches a POSIX command literally before an independent completion probe', () => {
    const command = "printf '%s' '}'";
    const dispatch = new PosixShellDriver().buildDispatch(command, 'nonce-posix');

    expect(dispatch.command).toBe(command);
    expect(dispatch.payload.startsWith(`${command}\r`)).toBe(true);
    expect(dispatch.payload.slice(command.length + 1)).toBe(`${dispatch.probe}\r`);
    expect(dispatch.probe).toContain('printf');
    expect(dispatch.probe).toContain('nonce-posix');
    expect(dispatch.payload).not.toContain('eval');
    expect(dispatch.payload).not.toContain('base64');
    expect(dispatch.payload).not.toContain('__synapse_command');
  });

  it('dispatches a PowerShell command literally without a dot-source wrapper', () => {
    const command = "Write-Output 'literal'";
    const dispatch = new PowerShellDriver().buildDispatch(command, 'nonce-powershell');

    expect(dispatch.payload.startsWith(`${command}\r`)).toBe(true);
    expect(dispatch.probe).toContain('[Console]::Write');
    expect(dispatch.probe).toContain('nonce-powershell');
    expect(dispatch.payload).not.toContain('EncodedCommand');
    expect(dispatch.payload).not.toContain('. {');
    expect(dispatch.payload).not.toContain('& {');
  });

  it('resolves the current terminal type to its shell-specific driver', () => {
    expect(resolveShellDriver('Git Bash')).toBeInstanceOf(PosixShellDriver);
    expect(resolveShellDriver('Zsh')).toBeInstanceOf(PosixShellDriver);
    expect(resolveShellDriver('WSL')).toBeInstanceOf(PosixShellDriver);
    expect(resolveShellDriver('PowerShell')).toBeInstanceOf(PowerShellDriver);
  });

  it.each([
    ['NUL', 'printf \u0000'],
    ['OSC 777', 'printf \u001b]777;TA;forged;0\u0007'],
    ['reserved marker', 'printf __TA_DONE_forged;0__'],
  ])('rejects %s before constructing an auditable payload', (_, command) => {
    expect(() => new PosixShellDriver().buildDispatch(command, 'nonce-safe')).toThrow(
      expect.objectContaining({ code: 'COMMAND_NOT_AUDITABLE' }),
    );
  });

  it('parses only the completion payload for the selected transaction', () => {
    const driver = new PowerShellDriver();

    expect(driver.parseCompletion('TA;nonce-1;7')).toEqual({ nonce: 'nonce-1', exitCode: 7 });
    expect(driver.parseCompletion('other;nonce-1;7')).toBeNull();
    expect(() => driver.buildDispatch('echo ok', 'invalid nonce')).toThrow(ShellDriverError);
  });

  it('builds one fixed plaintext environment fingerprint for either supported dialect', () => {
    const posixProbe = new PosixShellDriver().buildEnvironmentProbe('probe-posix');
    const powershellProbe = new PowerShellDriver().buildEnvironmentProbe('probe-powershell');

    expect(posixProbe).toBe('echo __SYNAPSE_DIALECT_probe-posix__:$?\r');
    expect(powershellProbe).toBe('echo __SYNAPSE_DIALECT_probe-powershell__:$?\r');
    expect(posixProbe).not.toMatch(/base64|eval|EncodedCommand|\. \{/i);
    expect(powershellProbe).not.toMatch(/base64|eval|EncodedCommand|\. \{/i);
  });

  it('accepts only an unambiguous current-PTY fingerprint and ignores echoed input', () => {
    expect(
      parseEnvironmentFingerprint(
        'echo __SYNAPSE_DIALECT_probe__:$?\r\n__SYNAPSE_DIALECT_probe__:0\r\n',
        'probe',
      ),
    ).toEqual({ dialect: 'posix', platform: 'unix' });
    expect(
      parseEnvironmentFingerprint(
        'echo __SYNAPSE_DIALECT_probe__:$?\r\n__SYNAPSE_DIALECT_probe__:True\r\n',
        'probe',
      ),
    ).toEqual({ dialect: 'powershell', platform: 'windows' });
    expect(
      parseEnvironmentFingerprint(
        '\u001b[2K__SYNAPSE_DIALECT_probe__:$?\r\n__SYNAPSE_DIALECT_probe__:maybe\r\n',
        'probe',
      ),
    ).toBeNull();
  });
});
