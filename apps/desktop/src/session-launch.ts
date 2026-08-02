import type { SessionLaunchInput } from './preload-api.js';
import type { LocalShellDescriptor } from './shell-locator.js';

export function buildSessionLaunch(
  title: string,
  cwd: string,
  shell: LocalShellDescriptor,
): SessionLaunchInput {
  if (!shell.available || shell.executable === undefined) {
    throw new Error(shell.reason ?? `当前系统无法使用 ${shell.label}`);
  }
  return {
    title,
    terminalType: shell.label,
    executable: shell.executable,
    args: [...shell.args],
    cwd,
    env: {},
    executionDialect: shell.executionDialect,
  };
}
