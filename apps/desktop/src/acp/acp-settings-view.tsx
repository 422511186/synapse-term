/**
 * ACP 外部驱动者设置页（specs/acp-driver、ADR-0025 / ADR-0030）
 *
 * 提供：允许 ACP 集成的两级开关、managed / manual 审批配置与运行状态展示。
 * 所有操作经 IPC 交给桌面主进程的 ACP 控制器；渲染进程不直接触碰
 * 设置文件或子进程。开关与审批模式统一走 useAsyncAction 防连点，
 * 关闭开关时展示"正在停止…"直到子进程终止。
 */
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import type { AcpStatus, DesktopApi } from '../preload/preload-api.js';
import { useAsyncAction, useToast } from '../renderer/feedback/index.js';

interface AcpSettingsViewProps {
  api: DesktopApi;
  onBack: () => void;
}

export function AcpSettingsView({ api, onBack }: AcpSettingsViewProps): React.JSX.Element {
  const [status, setStatus] = useState<AcpStatus | undefined>(undefined);
  const [transition, setTransition] = useState<'start' | 'stop' | undefined>(undefined);
  const action = useAsyncAction();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    void api.acp
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) toast.error(toMessage(caught));
      });
    const unsubscribe = api.acp.onStatusChanged((next) => setStatus(next));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api, toast]);

  const run = (
    operation: () => Promise<AcpStatus>,
    options: { transition?: 'start' | 'stop'; successMessage?: string } = {},
  ): void => {
    if (action.pending) return;
    setTransition(options.transition);
    void action
      .run(operation, {
        onSuccess: (next) => {
          setStatus(next);
          if (options.successMessage !== undefined) toast.success(options.successMessage);
        },
        onError: (caught) => toast.error(toMessage(caught)),
      })
      .finally(() => setTransition(undefined));
  };

  const runningLabel =
    transition === 'start'
      ? '正在启动…'
      : transition === 'stop'
        ? '正在停止…'
        : status?.running === true
          ? '运行中'
          : '未运行';

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <button
            aria-label="返回工作区"
            className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft size={16} /> 返回工作区
          </button>
          <h2 className="text-base font-semibold">ACP 集成</h2>
          <p className="text-xs text-muted-foreground">
            opencode 等外部 Agent 以 ACP 协议作为主驾驶完成你的任务
          </p>
        </div>

        {/* 允许 ACP 集成开关 + 运行状态 */}
        <section className="rounded-xl border border-border bg-[#18181b] p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">允许 ACP 集成</div>
              <div className="text-xs text-muted-foreground">
                关闭后任何已启动的外部 Agent 子进程立即终止，面板不再提供 ACP 驱动者
              </div>
            </div>
            <button
              aria-busy={action.pending}
              aria-label={`${status?.enabled ? '停用' : '启用'} ACP 集成`}
              aria-pressed={status?.enabled ?? false}
              className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${
                status?.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
              }`}
              disabled={action.pending}
              onClick={() =>
                run(() => api.acp.setEnabled(!(status?.enabled ?? false)), {
                  transition: !(status?.enabled ?? false) ? 'start' : 'stop',
                })
              }
              type="button"
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  status?.enabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">状态：</span>
            <span
              className={
                status?.running === true || transition === 'start'
                  ? 'text-emerald-400'
                  : 'text-zinc-400'
              }
            >
              {runningLabel}
            </span>
            {status?.activeSessionId !== undefined && (
              <span className="ml-2 text-muted-foreground">会话 {status.activeSessionId}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            子进程采用两级开关：这里允许后，还需在 Agent 面板把驱动者切换为“外部
            Agent（ACP）”并开始任务，才会拉起 opencode 进程。
          </p>
        </section>

        {/* 审批模式 */}
        <section className="rounded-xl border border-border bg-[#18181b] p-4 space-y-3">
          <div className="text-sm font-medium">外部调用审批模式</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <ModeButton
              active={(status?.approvalMode ?? 'managed') === 'managed'}
              description="低危命令自动放行；破坏性与未知高危请求人工审批"
              disabled={action.pending}
              label="托管模式"
              onClick={() => run(() => api.acp.setApprovalMode('managed'))}
            />
            <ModeButton
              active={(status?.approvalMode ?? 'managed') === 'manual'}
              description="只自动放行只读操作，所有命令都需人工批准"
              disabled={action.pending}
              label="手动模式"
              onClick={() => run(() => api.acp.setApprovalMode('manual'))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            外部 Agent 只被授予终端执行与只读文件能力；未声明能力（如写文件）一律拒绝并审计。
          </p>
        </section>
      </div>
    </div>
  );
}

function ModeButton(props: {
  active: boolean;
  description: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      aria-pressed={props.active}
      className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40 ${
        props.active ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-secondary'
      }`}
      disabled={props.disabled}
      onClick={props.onClick}
      type="button"
    >
      <div className="text-sm font-medium">{props.label}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{props.description}</div>
    </button>
  );
}

function toMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
