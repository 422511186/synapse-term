import { describe, expect, it } from 'vitest';

import { NodePtySpawner } from './pty-adapter.js';

describe('NodePtySpawner integration', () => {
  it.skipIf(process.platform !== 'win32')(
    'runs a command through Windows ConPTY',
    async () => {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      const pty = new NodePtySpawner().spawn({
        executable: process.env.ComSpec ?? 'C:/Windows/System32/cmd.exe',
        args: ['/d', '/q'],
        cwd: process.cwd(),
        env,
        columns: 80,
        rows: 24,
      });
      let output = '';
      const completed = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`ConPTY output timed out: ${output}`)),
          5_000,
        );
        pty.onData((data) => {
          output += data;
          if (output.includes('__PTY_OK__')) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      try {
        pty.write('echo __PTY_OK__\r');
        await completed;
        expect(output).toContain('__PTY_OK__');
      } finally {
        pty.terminate();
      }
    },
    10_000,
  );

  it.skipIf(process.platform !== 'win32')(
    'keeps an interactive PowerShell terminal usable through ConPTY',
    async () => {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      const pty = new NodePtySpawner().spawn({
        executable: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile'],
        cwd: process.cwd(),
        env,
        columns: 100,
        rows: 30,
      });
      let output = '';
      const completed = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`PowerShell ConPTY output timed out: ${output}`)),
          5_000,
        );
        pty.onData((data) => {
          output += data;
          if (output.includes('__POWERSHELL_OK__')) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      try {
        pty.write("Write-Output '__POWERSHELL_OK__'\r");
        await completed;
        expect(output).toContain('__POWERSHELL_OK__');
      } finally {
        pty.terminate();
      }
    },
    10_000,
  );
});
