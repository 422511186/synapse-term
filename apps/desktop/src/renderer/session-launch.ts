import type {
  SessionEnvironment,
  SessionLaunchInput,
  SessionSummary,
} from '../preload/preload-api.js';
import { resolveSessionAlias } from './session-alias.js';

type LocalShellDescriptor = SessionEnvironment['shells'][number];

export { getDefaultSessionAlias, resolveSessionAlias } from './session-alias.js';

export function buildSessionLaunch(
  title: string,
  cwd: string,
  shell: LocalShellDescriptor,
  sessions: readonly Pick<SessionSummary, 'title'>[] = [],
): SessionLaunchInput {
  if (!shell.available || shell.executable === undefined) {
    throw new Error(shell.reason ?? `当前系统无法使用 ${shell.label}`);
  }
  return {
    title: resolveSessionAlias(title, sessions),
    terminalType: shell.label,
    executable: shell.executable,
    args: [...shell.args],
    cwd,
    env: {},
  };
}
