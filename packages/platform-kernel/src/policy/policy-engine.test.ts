import { describe, expect, it } from 'vitest';

import type { ShellAstParser } from '@synapse-term/domain';

import { PolicyEngine } from './policy-engine.js';

const validParser: ShellAstParser = {
  async parse() {
    return { hasError: false, tree: 'program' };
  },
};

describe('PolicyEngine', () => {
  it('classifies conservative read-only commands without trusting model metadata', async () => {
    const engine = new PolicyEngine(validParser);

    await expect(engine.classify('systemctl status api')).resolves.toMatchObject({
      level: 'read_only',
      requiresApproval: false,
    });
    await expect(
      engine.classify('systemctl status api', { modelRisk: 'read_only' }),
    ).resolves.toMatchObject({
      level: 'read_only',
    });
  });

  it('fails closed for syntax errors, unknown commands, substitutions, and redirections', async () => {
    const parser: ShellAstParser = {
      async parse(command) {
        return { hasError: command === 'broken (', tree: command };
      },
    };
    const engine = new PolicyEngine(parser);

    await expect(engine.classify('broken (')).resolves.toMatchObject({ level: 'unknown' });
    await expect(engine.classify('custom-tool --flag')).resolves.toMatchObject({
      level: 'unknown',
    });
    await expect(engine.classify('cat $(cat secret)')).resolves.toMatchObject({ level: 'unknown' });
    await expect(engine.classify('cat input > output')).resolves.toMatchObject({
      level: 'mutating',
      requiresApproval: true,
    });
  });

  it('distinguishes privileged and destructive mutations and detects overrides', async () => {
    const engine = new PolicyEngine(validParser);

    await expect(engine.classify('sudo systemctl restart api')).resolves.toMatchObject({
      level: 'privileged',
      requiresApproval: true,
    });
    await expect(engine.classify('rm -rf /tmp/cache')).resolves.toMatchObject({
      level: 'destructive',
      requiresSecondConfirmation: true,
    });
    await expect(engine.classify('alias rm="rm -i"')).resolves.toMatchObject({
      level: 'unknown',
    });
    await expect(engine.classify('function deploy() { echo ok; }')).resolves.toMatchObject({
      level: 'unknown',
    });
  });

  it('classifies PowerShell commands by dialect before applying permission modes', async () => {
    const engine = new PolicyEngine(validParser);
    const powershell = { executionDialect: 'powershell' as const };

    await expect(
      engine.classify('Get-Process | Select-Object -First 1', powershell),
    ).resolves.toMatchObject({ level: 'read_only', requiresApproval: false });
    await expect(
      engine.classify('Set-Content -Path ./state.txt -Value ready', powershell),
    ).resolves.toMatchObject({ level: 'mutating', requiresApproval: true });
    await expect(engine.classify('Restart-Service api', powershell)).resolves.toMatchObject({
      level: 'privileged',
      requiresApproval: true,
    });
    await expect(
      engine.classify('Remove-Item -Recurse -Force ./cache', powershell),
    ).resolves.toMatchObject({
      level: 'destructive',
      requiresApproval: true,
      requiresSecondConfirmation: true,
    });
    await expect(engine.classify('rm -r ./cache', powershell)).resolves.toMatchObject({
      level: 'destructive',
    });
    await expect(
      engine.classify('Invoke-Expression $dynamicCommand', powershell),
    ).resolves.toMatchObject({ level: 'unknown', requiresApproval: true });
  });

  it('returns a stable command hash and explanatory reasons', async () => {
    const engine = new PolicyEngine(validParser);
    const first = await engine.classify('df -h');
    const second = await engine.classify('df -h');

    expect(first.commandHash).toBe(second.commandHash);
    expect(first.commandHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.reasons.length).toBeGreaterThan(0);
  });
});
