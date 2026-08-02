import { describe, expect, it } from 'vitest';

import { buildSessionLaunch } from './session-launch.js';
import type { LocalShellDescriptor } from '@synapse-term/terminal-service';

describe('session launch profiles', () => {
  it('maps the selected local shell without modeling remote transport', () => {
    const powershell: LocalShellDescriptor = {
      kind: 'powershell',
      label: 'PowerShell',
      executable: 'D:\\Windows\\powershell.exe',
      available: true,
      source: 'system',
      args: ['-NoLogo'],
      executionDialect: 'powershell',
    };
    expect(buildSessionLaunch('PowerShell', 'D:/work', powershell)).toEqual({
      title: 'PowerShell',
      terminalType: 'PowerShell',
      executable: 'D:\\Windows\\powershell.exe',
      args: ['-NoLogo'],
      cwd: 'D:/work',
      env: {},
      executionDialect: 'powershell',
    });
  });

  it('rejects unavailable shells before invoking Core', () => {
    const unavailable: LocalShellDescriptor = {
      kind: 'bash',
      label: 'Git Bash',
      available: false,
      source: 'unavailable',
      args: ['-i'],
      executionDialect: 'posix',
      reason: '未找到 Git Bash',
    };

    expect(() => buildSessionLaunch('Git Bash', 'D:/work', unavailable)).toThrow('未找到 Git Bash');
  });
});
