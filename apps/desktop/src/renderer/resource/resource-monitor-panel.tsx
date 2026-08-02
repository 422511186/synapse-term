/** 目标资源监控面板（自 app.tsx 拆分） */
import type { JSX } from 'react';
import { Cpu, HardDrive, Network, RefreshCw, Server, X } from 'lucide-react';

import type { SessionResourceSnapshot } from '../../preload/preload-api.js';

export function ResourceMonitorPanel({
  onClose,
  onRefresh,
  resource,
}: {
  onClose: () => void;
  onRefresh: () => Promise<void>;
  resource: ResourceViewState;
}): JSX.Element {
  const snapshot = resource.snapshot;
  const cpuMetric = snapshot?.cpu;
  const memoryMetric = snapshot?.memory;
  const networkMetric = snapshot?.network;
  const cpu = cpuMetric?.status === 'available' ? cpuMetric.value.usagePercent : undefined;
  const memory = memoryMetric?.status === 'available' ? memoryMetric.value : undefined;
  const network = networkMetric?.status === 'available' ? networkMetric.value : undefined;
  const memoryPercent =
    memory === undefined || memory.totalBytes <= 0
      ? undefined
      : Math.round((memory.usedBytes / memory.totalBytes) * 100);

  return (
    <div
      aria-label="目标资源监控"
      className="absolute right-4 top-16 w-[340px] bg-[#18181b] border border-border shadow-2xl rounded-xl z-50 overflow-hidden flex flex-col animate-in slide-in-from-top-4 duration-200"
      role="dialog"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-[#09090b]">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Server size={14} className="text-primary" /> 目标资源监控
        </div>
        <button
          aria-label="关闭资源监控"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary transition-colors"
          type="button"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            最后更新:{' '}
            {snapshot === undefined ? '尚未获取' : formatResourceTime(snapshot.collectedAt)}
          </span>
          <button
            onClick={() => void onRefresh()}
            className="flex items-center gap-1 text-[11px] bg-secondary border border-border px-2 py-1 rounded hover:bg-secondary/80 transition-colors"
            type="button"
          >
            <RefreshCw
              size={12}
              className={resource.status === 'refreshing' ? 'animate-spin' : ''}
            />{' '}
            获取/刷新
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#09090b] border border-border/50 p-3 rounded-lg">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
              <Cpu size={12} /> CPU
            </div>
            <div className="text-[15px] font-mono font-medium">
              {cpu === undefined ? '不可用' : `${cpu}%`}
            </div>
            <div className="w-full h-1 bg-secondary mt-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, cpu ?? 0))}%` }}
              ></div>
            </div>
          </div>
          <div className="bg-[#09090b] border border-border/50 p-3 rounded-lg">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
              <HardDrive size={12} /> Memory
            </div>
            <div className="text-[15px] font-mono font-medium">
              {memory === undefined
                ? '不可用'
                : `${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}`}
            </div>
            <div className="w-full h-1 bg-secondary mt-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${memoryPercent ?? 0}%` }}
              ></div>
            </div>
          </div>
        </div>

        <div className="bg-[#09090b] border border-border/50 p-3 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Network size={14} /> Network I/O
          </div>
          <div className="text-right text-[11px] font-mono text-foreground/80">
            <div>
              ↓{' '}
              {network === undefined
                ? '不可用'
                : formatBytes(network.reduce((sum, item) => sum + item.receivedBytes, 0))}
            </div>
            <div>
              ↑{' '}
              {network === undefined
                ? '不可用'
                : formatBytes(network.reduce((sum, item) => sum + item.transmittedBytes, 0))}
            </div>
          </div>
        </div>
        {resource.error !== undefined && (
          <div className="text-xs text-red-400">{resource.error}</div>
        )}
      </div>
    </div>
  );
}
export function formatResourceTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return '刚刚';
  return `${Math.floor(elapsed / 60_000)} 分钟前`;
}
export function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const rounded = Math.round(amount * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
export interface ResourceViewState {
  status: 'idle' | 'refreshing' | 'ready' | 'error';
  snapshot?: SessionResourceSnapshot;
  error?: string;
}
