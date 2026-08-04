/** Agent 运行状态条：常驻运行指示 + 模型 + 耗时 */
import { useEffect, useState, type JSX } from 'react';

import { formatRunningDuration } from './running-status.js';

export function RunningStatusBar({
  running,
  modelName,
  startedAt,
}: {
  running: boolean;
  modelName: string | undefined;
  startedAt: number | undefined;
}): JSX.Element | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt !== undefined) setNow(Date.now());
  }, [startedAt]);

  useEffect(() => {
    if (!running) return;
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1_000);
    return () => globalThis.clearInterval(timer);
  }, [running]);

  if (!running) return null;

  const duration = startedAt === undefined ? undefined : formatRunningDuration(startedAt, now);

  return (
    <div className="running-status-bar flex shrink-0 items-center gap-2 border-b border-border bg-amber-500/5 px-3 py-2">
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
      <div className="flex min-w-0 items-center gap-2 text-xs text-amber-500">
        <span className="truncate">
          Agent 运行中 · {modelName ?? '未配置模型'}
          {duration === undefined ? '' : ` · 已运行 ${duration}`}
        </span>
      </div>
    </div>
  );
}
