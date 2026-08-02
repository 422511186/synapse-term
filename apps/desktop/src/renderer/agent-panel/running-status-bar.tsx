/** Agent 运行状态条：常驻运行指示 + 耗时 + 取消任务入口 */
import { useEffect, useState, type JSX } from 'react';
import { Loader2, XCircle } from 'lucide-react';

import { formatRunningDuration } from './running-status.js';

export function RunningStatusBar({
  running,
  modelName,
  startedAt,
  startup = false,
  cancelling = false,
  onCancel,
}: {
  running: boolean;
  modelName: string | undefined;
  startedAt: number | undefined;
  startup?: boolean;
  cancelling?: boolean;
  onCancel: () => void;
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

  const duration =
    startup || startedAt === undefined ? undefined : formatRunningDuration(startedAt, now);

  return (
    <div className="running-status-bar flex shrink-0 items-center justify-between gap-3 border-b border-border bg-amber-500/5 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-xs text-amber-500">
        {startup ? (
          <Loader2 className="animate-spin shrink-0" size={13} />
        ) : (
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
        )}
        <span className="truncate">
          {startup
            ? '正在启动外部 Agent（opencode）…'
            : `Agent 运行中 · ${modelName ?? '未配置模型'}${duration === undefined ? '' : ` · 已运行 ${duration}`}`}
        </span>
      </div>
      <button
        aria-label="取消当前 Agent 任务"
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
        disabled={cancelling}
        onClick={onCancel}
        type="button"
      >
        <XCircle size={12} />
        {cancelling ? '取消中…' : '取消任务'}
      </button>
    </div>
  );
}
