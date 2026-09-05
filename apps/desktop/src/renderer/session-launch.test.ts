import { describe, expect, it } from 'vitest';

import type { SessionEnvironment, SessionSummary } from '../preload/preload-api.js';
import { buildSessionLaunch, getDefaultSessionAlias } from './session-launch.js';

type LocalShellDescriptor = SessionEnvironment['shells'][number];

describe('session launch profiles', () => {
  const shell: LocalShellDescriptor = {
    kind: 'bash',
    label: 'Bash',
    executable: '/bin/bash',
    available: true,
    source: 'system',
    args: ['-i'],
  };

  function session(title: string): Pick<SessionSummary, 'title'> {
    return { title };
  }

  it('computes the smallest unused default alias from existing sessions', () => {
    expect(getDefaultSessionAlias([session('终端 1'), session('终端 3')])).toBe('终端 2');
  });

  it('falls back to the computed default alias for a blank name', () => {
    expect(buildSessionLaunch(' \t ', '/work', shell, [session('终端 1')])).toMatchObject({
      title: '终端 2',
    });
  });

  it('maps the selected local shell without modeling remote transport', () => {
    const powershell: LocalShellDescriptor = {
      kind: 'powershell',
      label: 'PowerShell',
      executable: 'D:\\Windows\\powershell.exe',
      available: true,
      source: 'system',
      args: ['-NoLogo'],
    };
    expect(buildSessionLaunch('PowerShell', 'D:/work', powershell)).toEqual({
      title: 'PowerShell',
      terminalType: 'PowerShell',
      executable: 'D:\\Windows\\powershell.exe',
      args: ['-NoLogo'],
      cwd: 'D:/work',
      env: {},
    });
  });

  it('rejects unavailable shells before creating a session', () => {
    const unavailable: LocalShellDescriptor = {
      kind: 'bash',
      label: 'Git Bash',
      available: false,
      source: 'unavailable',
      args: ['-i'],
      reason: '未找到 Git Bash',
    };

    expect(() => buildSessionLaunch('Git Bash', 'D:/work', unavailable)).toThrow('未找到 Git Bash');
  });
});
