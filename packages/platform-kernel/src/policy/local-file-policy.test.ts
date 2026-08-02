import { describe, expect, it } from 'vitest';

import { LocalFilePolicy } from './local-file-policy.js';

describe('LocalFilePolicy', () => {
  const policy = new LocalFilePolicy();

  it('classifies ordinary reads as read-only and ordinary writes as mutations', () => {
    expect(policy.classify({ operation: 'read', path: 'projects/app/readme.md' })).toMatchObject({
      level: 'read_only',
    });
    expect(policy.classify({ operation: 'edit', path: 'projects/app/config.json' })).toMatchObject({
      level: 'mutating',
    });
  });

  it('requires approval for credential and secret paths or content', () => {
    for (const path of [
      '.ssh/id_ed25519',
      '.aws/credentials',
      '.kube/config',
      'project/.env.production',
      '.npmrc',
      'AppData/Local/Google/Chrome/User Data/Default/Login Data',
    ]) {
      expect(policy.classify({ operation: 'read', path })).toMatchObject({ level: 'privileged' });
    }
    expect(
      policy.classify({
        operation: 'write',
        path: 'notes.txt',
        content: '-----BEGIN OPENSSH PRIVATE KEY-----',
      }),
    ).toMatchObject({ level: 'privileged' });
  });

  it('treats startup and PowerShell profile writes as destructive high-impact changes', () => {
    expect(
      policy.classify({
        operation: 'write',
        path: 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/agent.cmd',
      }),
    ).toMatchObject({ level: 'destructive' });
    expect(
      policy.classify({
        operation: 'edit',
        path: 'Documents/PowerShell/Microsoft.PowerShell_profile.ps1',
      }),
    ).toMatchObject({ level: 'destructive' });
  });
});
