import { describe, expect, it } from 'vitest';

import { PolicyEngine } from './policy-engine.js';

describe('PolicyEngine', () => {
  it('classifies known read-only commands as lowest risk', async () => {
    const decision = await new PolicyEngine().classify('ls -la /tmp');
    expect(decision.level).toBe('read_only');
    expect(decision.reasons.join(' ')).toMatch(/read-only/i);
  });

  it('classifies package commands as low-risk writes', async () => {
    const decision = await new PolicyEngine().classify('npm test');
    expect(decision.level).toBe('mutating');
    expect(decision.reasons[0]).toContain('npm');
  });

  it('recognizes privilege escalation, destruction, and unknown executables', async () => {
    const engine = new PolicyEngine();
    await expect(engine.classify('sudo systemctl restart nginx')).resolves.toMatchObject({
      level: 'privileged',
    });
    await expect(engine.classify('rm -rf build')).resolves.toMatchObject({
      level: 'destructive',
    });
    await expect(engine.classify('curl example.com')).resolves.toMatchObject({
      level: 'unknown',
    });
  });

  it('uses PowerShell rules when the terminal identifies that dialect', async () => {
    const decision = await new PolicyEngine().classify('Remove-Item .\\build', {
      terminalType: 'PowerShell',
    });
    expect(decision.level).toBe('destructive');
  });
});
