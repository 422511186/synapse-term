import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Core packaging configuration', () => {
  it('stages an independent pinned Core runtime for supported platforms and includes it in the installer', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const stagingScript = resolve(root, 'scripts/stage-core-runtime.mjs');
    const builderConfig = resolve(root, 'electron-builder.yml');
    const installerInclude = resolve(root, 'build/installer.nsh');
    const logoAsset = resolve(root, 'apps/desktop/src/renderer/assets/synapse-term-logo.svg');

    expect(existsSync(stagingScript)).toBe(true);
    expect(existsSync(builderConfig)).toBe(true);
    expect(existsSync(installerInclude)).toBe(true);
    expect(existsSync(logoAsset)).toBe(true);
    if (
      !existsSync(stagingScript) ||
      !existsSync(builderConfig) ||
      !existsSync(installerInclude) ||
      !existsSync(logoAsset)
    ) {
      return;
    }

    const script = readFileSync(stagingScript, 'utf8');
    const config = readFileSync(builderConfig, 'utf8');
    const installer = readFileSync(installerInclude, 'utf8');
    const logo = readFileSync(logoAsset, 'utf8');
    expect(script).toContain("const REQUIRED_NODE_VERSION = '24.12.0'");
    expect(script).toContain("const nodeBinary = platform === 'win32' ? 'node.exe' : 'node'");
    expect(script).toContain('copyFile(process.execPath, join(target, nodeBinary))');
    expect(script).toContain("platform === 'win32' ? 'pnpm.cmd' : 'pnpm'");
    expect(script).toContain("join(target, 'dist', 'core-maintenance.mjs')");
    expect(config).toContain('from: .packaging/core-runtime');
    expect(config).toContain('to: core');
    expect(config).toContain('target: nsis');
    expect(config).toContain('include: build/installer.nsh');
    expect(config).toContain('icon: apps/desktop/src/renderer/assets/synapse-term-logo.svg');
    expect(logo).toContain('<linearGradient id="g"');
    expect(logo).toContain('<rect x="48"');
    expect(installer).toContain('upgrade-state.ini');
    expect(installer).toContain('ReadINIStr $1 $0 "core" "sessions"');
    expect(installer).toContain('ReadINIStr $2 $0 "core" "agentTasks"');
    expect(installer).toContain('IfSilent');
    expect(installer).toContain('MB_RETRYCANCEL');
    expect(installer).toContain('Abort');
  });
});
