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

  it('classifies standard read-only filters and shell builtins as lowest risk', async () => {
    const engine = new PolicyEngine();

    await expect(engine.classify('printf "b\\na\\n" | sort')).resolves.toMatchObject({
      level: 'read_only',
      risk: 'read_only',
      requiresConfirmation: false,
    });
    await expect(engine.classify('true')).resolves.toMatchObject({
      level: 'read_only',
      risk: 'read_only',
      requiresConfirmation: false,
    });
    await expect(engine.classify('false')).resolves.toMatchObject({
      level: 'read_only',
      risk: 'read_only',
      requiresConfirmation: false,
    });
  });

  it('classifies simple if blocks from known read-only commands without hiding uncertainty', async () => {
    const engine = new PolicyEngine();

    await expect(engine.classify("if true; then printf 'MCP_OK'; fi")).resolves.toMatchObject({
      level: 'read_only',
      risk: 'read_only',
      confidence: 'medium',
      requiresConfirmation: false,
    });
    await expect(
      engine.classify('if [ -f input.txt ]; then cat input.txt; fi'),
    ).resolves.toMatchObject({
      level: 'read_only',
      risk: 'read_only',
      confidence: 'medium',
      requiresConfirmation: false,
    });
    await expect(
      engine.classify('if true\nthen\nprintf "MCP_OK"\nelse\necho fallback\nfi'),
    ).resolves.toMatchObject({
      level: 'read_only',
      risk: 'read_only',
      confidence: 'medium',
      requiresConfirmation: false,
    });
    await expect(engine.classify('if true; then rm -f output.txt; fi')).resolves.toMatchObject({
      level: 'mutating',
      risk: 'mutating',
      requiresConfirmation: false,
    });
    await expect(engine.classify('if true; then curl example.com; fi')).resolves.toMatchObject({
      level: 'unknown',
      risk: 'unknown',
      confidence: 'low',
      requiresConfirmation: true,
    });
  });

  it('classifies macOS memory diagnostics as read-only', async () => {
    const engine = new PolicyEngine();

    await expect(engine.classify('vm_stat')).resolves.toMatchObject({
      level: 'read_only',
      risk: 'read_only',
      confidence: 'high',
      requiresConfirmation: false,
    });
    await expect(engine.classify('sysctl -n hw.memsize')).resolves.toMatchObject({
      level: 'read_only',
      risk: 'read_only',
      confidence: 'high',
      requiresConfirmation: false,
    });
  });

  it('keeps sysctl writes outside the read-only classification', async () => {
    await expect(
      new PolicyEngine().classify('sysctl -w kern.maxfiles=100000'),
    ).resolves.toMatchObject({
      level: 'privileged',
      risk: 'privileged',
      requiresConfirmation: true,
    });
  });

  it('keeps sort output options conservative because they write files', async () => {
    const engine = new PolicyEngine();

    await expect(engine.classify('sort -o sorted.txt input.txt')).resolves.toMatchObject({
      level: 'mutating',
      risk: 'mutating',
      requiresConfirmation: false,
    });
    await expect(engine.classify('sort --output=sorted.txt input.txt')).resolves.toMatchObject({
      level: 'mutating',
      risk: 'mutating',
      requiresConfirmation: false,
    });
    await expect(engine.classify("sort '--output=sorted.txt' input.txt")).resolves.toMatchObject({
      level: 'mutating',
      risk: 'mutating',
      requiresConfirmation: false,
    });
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
