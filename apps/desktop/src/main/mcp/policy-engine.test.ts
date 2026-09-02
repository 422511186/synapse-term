import { describe, expect, it } from 'vitest';

import { PolicyEngine } from './policy-engine.js';

describe('PolicyEngine', () => {
  it('classifies known read-only commands as lowest risk', async () => {
    const decision = await new PolicyEngine().classify('ls -la /tmp');
    expect(decision.level).toBe('read_only');
    expect(decision.risk).toBe('read_only');
    expect(decision.confidence).toBe('high');
    expect(decision.requiresConfirmation).toBe(false);
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

  it('lowers confidence for scripts and dynamic shell structure', async () => {
    const decision = await new PolicyEngine().classify('./deploy.sh | tee deploy.log');

    expect(decision.risk).toBe('unknown');
    expect(decision.confidence).toBe('low');
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reasons.join(' ')).toMatch(/cannot be fully|unknown executable/i);
  });

  it('keeps a known write conservative when another pipeline segment is unknown', async () => {
    const decision = await new PolicyEngine().classify('npm test && curl example.com');

    expect(decision.risk).toBe('unknown');
    expect(decision.confidence).toBe('low');
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reasons.join(' ')).toContain('unknown executable');
  });
});
