import { win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ShellLocator } from './shell-locator.js';

describe('ShellLocator', () => {
  describe.skipIf(process.platform !== 'win32')('Windows shells', () => {
    it('derives Git Bash from a Git executable found on PATH', () => {
      const gitCmd = win32.join('D:\\Portable', 'Git', 'cmd');
      const bash = win32.join('D:\\Portable', 'Git', 'bin', 'bash.exe');
      const existing = new Set([win32.join(gitCmd, 'git.exe'), bash]);
      const locator = new ShellLocator({
        environment: { PATH: gitCmd },
        exists: (p) => existing.has(p),
        registryInstallPaths: () => [],
      });

      expect(locator.list().find((shell) => shell.kind === 'bash')).toMatchObject({
        available: true,
        executable: bash,
        source: 'path',
        executionDialect: 'posix',
      });
    });

    it('uses dynamic SystemRoot candidates for Windows PowerShell and WSL', () => {
      const systemRoot = 'R:\\Windows';
      const powershell = win32.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      const wsl = win32.join(systemRoot, 'System32', 'wsl.exe');
      const existing = new Set([powershell, wsl]);
      const locator = new ShellLocator({
        environment: { SystemRoot: systemRoot },
        exists: (p) => existing.has(p),
        registryInstallPaths: () => [],
      });

      expect(locator.list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'powershell', executable: powershell, source: 'system' }),
          expect.objectContaining({ kind: 'wsl', executable: wsl, source: 'system' }),
        ]),
      );
    });

    it('uses a Git for Windows registry install path when Git is not on PATH', () => {
      const install = 'E:\\Tools\\Git';
      const bash = win32.join(install, 'bin', 'bash.exe');
      const locator = new ShellLocator({
        environment: {},
        exists: (p) => p === bash,
        registryInstallPaths: () => [install],
      });

      expect(locator.list().find((shell) => shell.kind === 'bash')).toMatchObject({
        executable: bash,
        source: 'registry',
        available: true,
      });
    });

    it('keeps Windows shell startup profiles available', () => {
      const gitCmd = win32.join('D:\\Portable', 'Git', 'cmd');
      const gitBash = win32.join('D:\\Portable', 'Git', 'bin', 'bash.exe');
      const systemRoot = 'R:\\Windows';
      const powershell = win32.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      const wsl = win32.join(systemRoot, 'System32', 'wsl.exe');
      const existing = new Set([win32.join(gitCmd, 'git.exe'), gitBash, powershell, wsl]);
      const locator = new ShellLocator({
        environment: { PATH: gitCmd, SystemRoot: systemRoot },
        exists: (p) => existing.has(p),
        registryInstallPaths: () => [],
      });

      expect(locator.list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'bash', args: ['--login', '-i'] }),
          expect.objectContaining({ kind: 'powershell', args: ['-NoLogo'] }),
          expect.objectContaining({ kind: 'wsl', args: [] }),
        ]),
      );
    });

    it('reports unavailable shells without inventing executable paths', () => {
      const locator = new ShellLocator({
        environment: {},
        exists: () => false,
        registryInstallPaths: () => [],
      });

      expect(locator.list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'bash', available: false }),
          expect.objectContaining({ kind: 'powershell', available: false }),
          expect.objectContaining({ kind: 'wsl', available: false }),
        ]),
      );
      expect(
        locator.list().every((shell) => shell.available || shell.executable === undefined),
      ).toBe(true);
    });
  });

  describe.skipIf(process.platform !== 'darwin')('macOS shells', () => {
    it('starts zsh as a login interactive shell so GUI sessions load user PATH', () => {
      const locator = new ShellLocator({
        environment: {},
        exists: (p) => p === '/bin/zsh',
        registryInstallPaths: () => [],
      });

      expect(locator.list().find((shell) => shell.kind === 'zsh')).toMatchObject({
        args: ['-l', '-i'],
      });
    });

    it('starts bash as a login interactive shell so GUI sessions load user PATH', () => {
      const locator = new ShellLocator({
        environment: {},
        exists: (p) => p === '/bin/bash',
        registryInstallPaths: () => [],
      });

      expect(locator.list().find((shell) => shell.kind === 'bash')).toMatchObject({
        args: ['-l', '-i'],
      });
    });

    it('discovers zsh and bash on macOS', () => {
      const locator = new ShellLocator({
        environment: {},
        exists: (p) => p === '/bin/zsh' || p === '/bin/bash',
        registryInstallPaths: () => [],
      });

      const shells = locator.list();
      const zsh = shells.find((shell) => shell.kind === 'zsh');
      const bash = shells.find((shell) => shell.kind === 'bash');

      expect(zsh).toMatchObject({
        available: true,
        executable: '/bin/zsh',
        source: 'system',
        executionDialect: 'posix',
      });
      expect(bash).toMatchObject({
        available: true,
        executable: '/bin/bash',
        source: 'system',
        executionDialect: 'posix',
      });
    });

    it('reports shells as unavailable when not found', () => {
      const locator = new ShellLocator({
        environment: {},
        exists: () => false,
        registryInstallPaths: () => [],
      });

      const shells = locator.list();
      expect(shells.every((shell) => !shell.available)).toBe(true);
      expect(shells.every((shell) => shell.executable === undefined)).toBe(true);
    });
  });
});
