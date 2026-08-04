import { useCallback, useEffect, useState, type JSX } from 'react';
import { ArrowLeft, FileText, RefreshCw } from 'lucide-react';

import { errorMessageZh } from '@synapse-term/ui-platform';
import type { AuditEventView, DesktopApi } from '../../preload/preload-api.js';
import { RuntimeAudit } from '../agent-panel/runtime-audit.js';

export function AuditSettings({
  api,
  onBack,
  sessionId,
}: {
  api: DesktopApi;
  onBack: () => void;
  sessionId?: string | undefined;
}): JSX.Element {
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const loadEvents = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const nextEvents = await api.audit.list(sessionId === undefined ? undefined : { sessionId });
      setEvents(nextEvents);
    } catch (caught) {
      setError(errorMessageZh(caught));
    } finally {
      setLoading(false);
    }
  }, [api, sessionId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  return (
    <div className="absolute inset-0 z-30 animate-in fade-in duration-200 overflow-y-auto bg-[#09090b] p-8">
      <div className="mx-auto max-w-5xl">
        <button
          className="mb-6 flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={16} /> 返回工作区
        </button>
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FileText size={14} /> 运行记录
            </div>
            <h1 className="mb-2 text-2xl font-bold">审计日志</h1>
            <p className="text-sm text-muted-foreground">
              只读记录，不会复制到 Agent 时间线。
              {sessionId === undefined ? '' : '当前页面按活动 Session 过滤。'}
            </p>
          </div>
          <button
            aria-label="刷新审计日志"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
            disabled={loading}
            onClick={() => void loadEvents()}
            title="刷新审计日志"
            type="button"
          >
            <RefreshCw className={loading ? 'animate-spin' : undefined} size={14} />
          </button>
        </div>
        <div className="rounded-lg border border-border/50 bg-[#121214] p-5 shadow-sm">
          {error !== undefined ? (
            <div className="text-sm text-red-400" role="alert">
              {error}
            </div>
          ) : loading ? (
            <div className="text-sm text-muted-foreground">正在加载审计记录…</div>
          ) : (
            <RuntimeAudit events={events} />
          )}
        </div>
      </div>
    </div>
  );
}
