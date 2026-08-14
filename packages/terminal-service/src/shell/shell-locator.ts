import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import path, { posix, win32 } from 'node:path';

export type LocalShellKind = 'bash' | 'powershell' | 'wsl' | 'zsh';
export type ShellResolutionSource = 'path' | 'registry' | 'environment' | 'system' | 'unavailable';

export interface LocalShellDescriptor {
  kind: LocalShellKind;
  label: string;
  available: boolean;
  source: ShellResolutionSource;
  args: string[];
  executable?: string;
  reason?: string;
}

export interface ShellLocatorOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  exists?: (path: string) => boolean;
  registryInstallPaths?: () => readonly string[];
}

interface Candidate {
  path: string;
  source: Exclude<ShellResolutionSource, 'unavailable'>;
}

export class ShellLocator {
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #exists: (path: string) => boolean;
  readonly #registryInstallPaths: () => readonly string[];

  constructor(options: ShellLocatorOptions = {}) {
    this.#environment = options.environment ?? process.env;
    this.#exists = options.exists ?? existsSync;
    this.#registryInstallPaths = options.registryInstallPaths ?? readGitRegistryInstallPaths;
  }

  list(): LocalShellDescriptor[] {
    if (process.platform === 'darwin') return this.#darwinShells();
    return [this.#gitBash(), this.#powerShell(), this.#wsl()];
  }

  #gitBash(): LocalShellDescriptor {
    const pathDirectories = this.#pathDirectories();
    const candidates: Candidate[] = [];
    for (const directory of pathDirectories) {
      const git = win32.join(directory, 'git.exe');
      if (this.#exists(git)) {
        candidates.push({
          path: win32.resolve(directory, '..', 'bin', 'bash.exe'),
          source: 'path',
        });
      }
      candidates.push({ path: win32.join(directory, 'bash.exe'), source: 'path' });
    }
    for (const installPath of this.#registryInstallPaths()) {
      candidates.push({ path: win32.join(installPath, 'bin', 'bash.exe'), source: 'registry' });
    }
    for (const root of this.#environmentRoots([
      'ProgramFiles',
      'ProgramW6432',
      'ProgramFiles(x86)',
    ])) {
      candidates.push({ path: win32.join(root, 'Git', 'bin', 'bash.exe'), source: 'environment' });
    }
    const localAppData = environmentValue(this.#environment, 'LOCALAPPDATA');
    if (localAppData !== undefined) {
      candidates.push({
        path: win32.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
        source: 'environment',
      });
    }
    return descriptor('bash', 'Git Bash', ['--login', '-i'], this.#find(candidates));
  }

  #powerShell(): LocalShellDescriptor {
    const candidates: Candidate[] = [];
    for (const directory of this.#pathDirectories()) {
      candidates.push({ path: win32.join(directory, 'pwsh.exe'), source: 'path' });
      candidates.push({ path: win32.join(directory, 'powershell.exe'), source: 'path' });
    }
    const systemRoot = environmentValue(this.#environment, 'SystemRoot');
    if (systemRoot !== undefined) {
      candidates.push({
        path: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        source: 'system',
      });
    }
    return descriptor('powershell', 'PowerShell', ['-NoLogo'], this.#find(candidates));
  }

  #wsl(): LocalShellDescriptor {
    const candidates: Candidate[] = this.#pathDirectories().map((directory) => ({
      path: win32.join(directory, 'wsl.exe'),
      source: 'path',
    }));
    const systemRoot = environmentValue(this.#environment, 'SystemRoot');
    if (systemRoot !== undefined) {
      candidates.push({ path: win32.join(systemRoot, 'System32', 'wsl.exe'), source: 'system' });
    }
    return descriptor('wsl', 'WSL', [], this.#find(candidates));
  }

  #darwinShells(): LocalShellDescriptor[] {
    const zshPath = '/bin/zsh';
    const bashPath = '/bin/bash';
    return [
      descriptor(
        'zsh',
        'Zsh',
        ['-l', '-i'],
        this.#exists(zshPath) ? { path: zshPath, source: 'system' } : undefined,
      ),
      descriptor(
        'bash',
        'Bash',
        ['-l', '-i'],
        this.#exists(bashPath) ? { path: bashPath, source: 'system' } : undefined,
      ),
    ];
  }

  #pathDirectories(): string[] {
    const pathValue = environmentValue(this.#environment, 'PATH');
    if (pathValue === undefined) return [];
    return pathValue
      .split(path.delimiter)
      .map((entry) => stripQuotes(entry.trim()))
      .filter((entry) => entry.length > 0);
  }

  #environmentRoots(names: readonly string[]): string[] {
    return names
      .map((name) => environmentValue(this.#environment, name))
      .filter((value): value is string => value !== undefined);
  }

  #find(candidates: readonly Candidate[]): Candidate | undefined {
    const visited = new Set<string>();
    for (const candidate of candidates) {
      const key =
        process.platform === 'win32'
          ? win32.normalize(candidate.path).toLocaleLowerCase('en-US')
          : posix.normalize(candidate.path);
      if (visited.has(key)) continue;
      visited.add(key);
      if (this.#exists(candidate.path)) return candidate;
    }
    return undefined;
  }
}

function descriptor(
  kind: LocalShellKind,
  label: string,
  args: string[],
  candidate: Candidate | undefined,
): LocalShellDescriptor {
  if (candidate === undefined) {
    return {
      kind,
      label,
      args,
      available: false,
      source: 'unavailable',
      reason: 'shell executable not found',
    };
  }
  return {
    kind,
    label,
    args,
    available: true,
    source: candidate.source,
    executable: candidate.path,
  };
}

function environmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = environment[key];
  return value === undefined ? undefined : value;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function readGitRegistryInstallPaths(): readonly string[] {
  if (process.platform !== 'win32') return [];
  try {
    const output = execFileSync(
      'reg.exe',
      ['query', 'HKLM\\SOFTWARE\\GitForWindows', '/v', 'InstallPath', '/reg:32'],
      { encoding: 'utf8', windowsHide: true, timeout: 3_000 },
    );
    const match = /InstallPath\s+REG_SZ\s+(.+)/.exec(output);
    return match?.[1]?.trim() === undefined ? [] : [match[1].trim()];
  } catch {
    return [];
  }
}
