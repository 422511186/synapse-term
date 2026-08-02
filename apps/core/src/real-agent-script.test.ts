import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('real Agent verification script', () => {
  it('reports validation details and bounds lingering native handles after cleanup', () => {
    const source = readFileSync(
      new URL('../../../scripts/verify-real-agent.mts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('validation.validation');
    expect(source).toContain('settleProcess(0)');
    expect(source).toContain('settleProcess(1)');
    expect(source).toContain('fallback.unref()');
    expect(source).toContain('process.exit(code)');
  });

  it('runs the real Agent inside the interactive user token without accepting an API key', () => {
    const source = readFileSync(
      new URL('../../../scripts/run-real-agent-session.mjs', import.meta.url),
      'utf8',
    );

    expect(source).toContain('TERMINAL_AGENT_DATA_DIR');
    expect(source).toContain('TERMINAL_AGENT_MODEL_CONFIGURATION_ID');
    expect(source).toContain("stdio: ['ignore', output, output]");
    expect(source).not.toMatch(/apiKey|API_KEY/);
  });

  it('runs the real SSH Electron test with explicit read-only environment inputs', () => {
    const runner = readFileSync(
      new URL('../../../scripts/run-real-environment-session.mjs', import.meta.url),
      'utf8',
    );
    const config = readFileSync(
      new URL('../../../playwright.electron.config.ts', import.meta.url),
      'utf8',
    );

    expect(runner).toContain("TERMINAL_AGENT_REAL_E2E: '1'");
    expect(runner).toContain('TERMINAL_AGENT_SSH_TARGET');
    expect(runner).toContain('TERMINAL_AGENT_REAL_USER_DATA_DIR');
    expect(runner).not.toMatch(/apiKey|API_KEY/);
    expect(config).not.toContain('webServer');
    expect(config).toContain('workers: 1');
  });
});
