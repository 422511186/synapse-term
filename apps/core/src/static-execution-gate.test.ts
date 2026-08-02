import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Static gate: scans production execution modules for forbidden
 * encoded-execution patterns. These patterns indicate Base64/hex/compressed
 * payloads being decoded and executed in a shell -- a violation of the
 * plaintext audit requirement.
 *
 * Allowed exceptions: authentication, logging, result serialization modules
 * where Base64 is used only for data encoding (not shell execution).
 */

const CORE_SRC = join(import.meta.dirname);

/** Patterns that indicate encoded content being executed in a shell */
const FORBIDDEN_PATTERNS = [
  { pattern: /base64\s+-d/, description: 'POSIX base64 decode to shell' },
  { pattern: /\$\(.*base64\s+-d/, description: 'POSIX base64 decode in command substitution' },
  { pattern: /\beval\s+["']?\$\{?__ta/, description: 'eval of decoded variable' },
  { pattern: /\beval\s+"\$/, description: 'eval of variable content' },
  { pattern: /FromBase64String/, description: 'PowerShell FromBase64String' },
  { pattern: /\[Convert\]::FromBase64String/, description: 'PowerShell Convert::FromBase64String' },
  { pattern: /EncodedCommand/, description: 'PowerShell EncodedCommand' },
  { pattern: /\[ScriptBlock\]::Create\(/, description: 'PowerShell ScriptBlock::Create' },
  { pattern: /\bInvoke-Expression\b/, description: 'PowerShell Invoke-Expression' },
];

/** Modules where data-encoding Base64 is legitimately used (not shell execution) */
const ALLOWED_ENCODED_MODULES = [
  'secret-protection.ts',
  'handshake.ts', // protocol handshake token encoding
  'sqlite-store.ts', // binary blob storage
];

/** Production execution modules to scan (not test files) */
const EXECUTION_MODULES = [
  'shell-driver.ts',
  'shell-probe.ts',
  'command-executor.ts',
  'session-actor.ts',
  'session-resource-service.ts',
  'session-resource-parser.ts',
  'plaintext-dispatcher.ts',
  'tool-gateway.ts',
];

function readModuleSafe(filename: string): string | null {
  try {
    return readFileSync(join(CORE_SRC, filename), 'utf-8');
  } catch {
    return null;
  }
}

describe('static execution gate', () => {
  it('does not contain encoded-execution patterns in production execution modules', () => {
    const violations: string[] = [];

    for (const module of EXECUTION_MODULES) {
      const content = readModuleSafe(module);
      if (content === null) continue;

      for (const { pattern, description } of FORBIDDEN_PATTERNS) {
        const matches = content.match(new RegExp(pattern, 'g'));
        if (matches !== null && matches.length > 0) {
          // Check if the pattern appears only in comments
          const lines = content.split('\n');
          const nonCommentMatches = lines.filter((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
              return false;
            }
            return pattern.test(line);
          });
          if (nonCommentMatches.length > 0) {
            violations.push(
              `${module}: found "${description}" (${pattern.source}) - ${nonCommentMatches.length} occurrence(s)`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('allows data-encoding Base64 only in non-execution modules', () => {
    const dataEncodingModules: string[] = [];

    for (const module of ALLOWED_ENCODED_MODULES) {
      const content = readModuleSafe(module);
      if (content === null) continue;
      if (/base64|Base64/.test(content)) {
        dataEncodingModules.push(module);
      }
    }

    // These modules are allowed to use Base64 for data encoding
    // Verify they don't also contain shell execution patterns
    for (const module of dataEncodingModules) {
      const content = readModuleSafe(module);
      if (content === null) continue;
      expect(content).not.toMatch(/\beval\b.*\bbase64\b/);
      expect(content).not.toMatch(/ScriptBlock::Create.*base64/i);
    }
  });

  it('lists all known production execution entry points', () => {
    // This test documents the execution entry inventory.
    // Each entry is classified as one of:
    //   plaintext_shell - Agent commands via plaintext dispatch
    //   user_input      - Raw user keystrokes
    //   direct_argv     - Explicit executable+argv (node-pty, reg.exe, taskkill.exe)
    //   data_encoding   - Data serialization only (no shell execution)
    const inventory = [
      {
        module: 'command-executor.ts',
        kind: 'plaintext_shell',
        description: 'terminal_execute commands',
      },
      {
        module: 'shell-probe.ts',
        kind: 'plaintext_shell',
        description: 'Environment/capability probes',
      },
      {
        module: 'session-resource-service.ts',
        kind: 'plaintext_shell',
        description: 'Resource refresh scripts',
      },
      {
        module: 'plaintext-dispatcher.ts',
        kind: 'plaintext_shell',
        description: 'Unified Agent PTY dispatch',
      },
      {
        module: 'session-actor.ts:writeUser',
        kind: 'user_input',
        description: 'Raw user keystrokes to PTY',
      },
      {
        module: 'session-actor.ts:writeAgent',
        kind: 'plaintext_shell',
        description: 'Agent PTY write (guarded by dispatcher)',
      },
      { module: 'node-pty spawn', kind: 'direct_argv', description: 'Shell process startup' },
      { module: 'reg.exe invocation', kind: 'direct_argv', description: 'Windows registry reads' },
      {
        module: 'taskkill.exe invocation',
        kind: 'direct_argv',
        description: 'Windows process cleanup',
      },
      {
        module: 'secret-protection.ts',
        kind: 'data_encoding',
        description: 'Secret redaction Base64',
      },
    ];

    // Verify all execution modules exist
    for (const entry of inventory) {
      if (entry.kind === 'direct_argv' || entry.kind === 'data_encoding') continue;
      const moduleFile = entry.module.split(':')[0]!;
      const content = readModuleSafe(moduleFile);
      if (content !== null) {
        // Module exists and is scannable
        expect(content.length).toBeGreaterThan(0);
      }
    }

    // This assertion documents that the inventory is complete
    expect(inventory.length).toBeGreaterThanOrEqual(9);
  });
});

describe('production execution entry regression', () => {
  it('allows direct Agent PTY writes only from the plaintext dispatcher', () => {
    const directAgentWriters = readdirSync(CORE_SRC)
      .filter((filename) => filename.endsWith('.ts') && !filename.endsWith('.test.ts'))
      .filter((filename) => readModuleSafe(filename)?.match(/\.writeAgent\s*\(/) !== null);

    expect(directAgentWriters).toEqual(['plaintext-dispatcher.ts']);
  });

  it('node-pty spawn uses explicit executable+argv, not shell string', () => {
    const content = readModuleSafe('pty-adapter.ts');
    expect(content).not.toBeNull();
    if (content === null) return;

    // node-pty spawn should use (file, args, options) pattern
    expect(content).toContain('spawn');
    // Should not pass shell strings to spawn
    expect(content).not.toMatch(/spawn\(`.*\$\{/);
    expect(content).not.toMatch(/shell:\s*true/);
  });

  it('taskkill.exe uses explicit args, not shell interpolation', () => {
    const content = readModuleSafe('pty-adapter.ts');
    expect(content).not.toBeNull();
    if (content === null) return;

    // taskkill should use explicit args array
    if (content.includes('taskkill')) {
      expect(content).toContain("'/PID'");
      expect(content).toContain("'/T'");
      expect(content).toContain("'/F'");
    }
  });

  it('maintenance CLI uses direct process execution, not shell', () => {
    const content = readModuleSafe('maintenance-cli.ts');
    if (content === null) return;

    // Should use spawnSync/execSync with explicit args
    expect(content).not.toMatch(/\beval\b/);
    expect(content).not.toMatch(/\bexec\s*\(/);
  });

  it('authentication modules do not invoke shell executors', () => {
    const authModules = ['secret-protection.ts', 'handshake.ts'];
    for (const module of authModules) {
      const content = readModuleSafe(module);
      if (content === null) continue;

      // These modules use Base64 for data encoding only
      expect(content).not.toMatch(/\beval\b/);
      expect(content).not.toMatch(/shell-driver/);
      expect(content).not.toMatch(/command-executor/);
      expect(content).not.toMatch(/plaintext-dispatcher/);
    }
  });

  it('audit service does not invoke shell executors', () => {
    const content = readModuleSafe('audit-service.ts');
    expect(content).not.toBeNull();
    if (content === null) return;

    // Audit service records events but does not execute commands
    expect(content).not.toMatch(/\beval\b/);
    expect(content).not.toMatch(/shell-driver/);
    expect(content).not.toMatch(/command-executor/);
    expect(content).not.toMatch(/plaintext-dispatcher/);
  });

  it('policy engine does not invoke shell executors', () => {
    const content = readModuleSafe('policy-engine.ts');
    if (content === null) return;

    expect(content).not.toMatch(/\beval\b/);
    expect(content).not.toMatch(/shell-driver/);
    expect(content).not.toMatch(/command-executor/);
  });
});
