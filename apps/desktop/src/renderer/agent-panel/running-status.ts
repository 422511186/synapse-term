/** Agent 运行状态纯逻辑：耗时格式化与思考占位判定 */

export function formatRunningDuration(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  if (totalSeconds < 1) return '刚刚';
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function shouldShowThinkingPlaceholder(
  activeTurn: boolean,
  hasActivitySinceTurnStart: boolean,
): boolean {
  return activeTurn && !hasActivitySinceTurnStart;
}
