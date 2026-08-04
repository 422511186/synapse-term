import type { SessionSummary } from '../preload/preload-api.js';

const defaultAliasPattern = /^终端\s+(\d+)$/;

export function getDefaultSessionAlias(sessions: readonly Pick<SessionSummary, 'title'>[]): string {
  const usedNumbers = new Set<number>();
  for (const session of sessions) {
    const match = defaultAliasPattern.exec(session.title.trim());
    if (match === null) continue;
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > 0) usedNumbers.add(number);
  }
  let next = 1;
  while (usedNumbers.has(next)) next += 1;
  return `终端 ${next}`;
}

export function resolveSessionAlias(
  title: string,
  sessions: readonly Pick<SessionSummary, 'title'>[],
): string {
  const normalized = title.trim();
  return normalized.length > 0 ? normalized : getDefaultSessionAlias(sessions);
}
