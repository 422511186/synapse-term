/**
 * MCP 服务设置页（specs/mcp-access、ADR-0021 / ADR-0023）
 *
 * 提供：启用/停用开关、连接串复制、read-only / managed / full 三级审批配置、
 * token 生成与吊销。所有操作经 IPC 交给桌面主进程的 MCP 控制器，
 * 渲染进程不直接触碰设置文件或 HTTP 端点。开关与 token 操作统一走
 * useAsyncAction 防连点，启用/停用展示"正在启动…/正在停止…"状态流转。
 */
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import type { DesktopApi, McpStatus } from '../preload/preload-api.js';
import { ConfirmDialog, useAsyncAction, useToast } from '../renderer/feedback/index.js';

interface McpSettingsViewProps {
  api: DesktopApi;
  onBack?: () => void;
}

export function McpSettingsView({ api, onBack }: McpSettingsViewProps): React.JSX.Element {
  const [status, setStatus] = useState<McpStatus | undefined>(undefined);
  const [transition, setTransition] = useState<'start' | 'stop' | undefined>(undefined);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState<'token' | 'url' | undefined>(undefined);
  const action = useAsyncAction();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    void api.mcp
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) toast.error(toMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [api, toast]);

  const run = (
    operation: () => Promise<McpStatus>,
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

  const copyText = async (kind: 'token' | 'url', text: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    globalThis.setTimeout(() => setCopied(undefined), 1_500);
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
          {onBack !== undefined && (
            <button
              aria-label="返回工作区"
              className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={onBack}
              type="button"
            >
              <ArrowLeft size={16} /> 返回工作区
            </button>
          )}
          <h2 className="text-base font-semibold">MCP 服务</h2>
          <p className="text-xs text-muted-foreground">
            Codex / Claude Code 等外部客户端通过本机回环地址调用终端与只读文件能力
          </p>
        </div>

        {/* 启用开关 + 运行状态 */}
        <section className="rounded-xl border border-border bg-[#18181b] p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">启用 MCP Server</div>
              <div className="text-xs text-muted-foreground">
                仅监听 127.0.0.1 本机回环地址；关闭后所有外部调用立即失败
              </div>
            </div>
            <button
              aria-busy={action.pending}
              aria-label={`${status?.enabled ? '停用' : '启用'} MCP Server`}
              aria-pressed={status?.enabled ?? false}
              className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${status?.enabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
              disabled={action.pending}
              onClick={() =>
                run(() => api.mcp.setEnabled(!(status?.enabled ?? false)), {
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
            {status?.port !== undefined && (
              <span className="ml-2 text-muted-foreground">端口 {status.port}</span>
            )}
          </div>
          {status?.connectionString !== undefined && (
            <div className="flex items-center gap-2 rounded-lg bg-black/40 border border-border px-3 py-2">
              <code className="flex-1 min-w-0 truncate text-xs">{status.connectionString}</code>
              <button
                className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => void copyText('url', status.connectionString!)}
                type="button"
              >
                {copied === 'url' ? '已复制' : '复制连接串'}
              </button>
            </div>
          )}
        </section>

        {/* 审批模式 */}
        <section className="rounded-xl border border-border bg-[#18181b] p-4 space-y-3">
          <div className="text-sm font-medium">外部调用审批模式</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <ModeButton
              active={(status?.approvalMode ?? 'read_only') === 'read_only'}
              description="只放行读类工具（observe / 只读文件），写类一律拒绝"
              disabled={action.pending}
              label="只读模式"
              onClick={() => run(() => api.mcp.setApprovalMode('read_only'))}
            />
            <ModeButton
              active={(status?.approvalMode ?? 'read_only') === 'managed'}
              description="低危命令自动放行；破坏性与未知高危一律拒绝"
              disabled={action.pending}
              label="托管模式"
              onClick={() => run(() => api.mcp.setApprovalMode('managed'))}
            />
            <ModeButton
              active={(status?.approvalMode ?? 'read_only') === 'full'}
              description="不审查命令，任何命令直接放行（高风险）"
              disabled={action.pending}
              label="完全权限模式"
              onClick={() => run(() => api.mcp.setApprovalMode('full'))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            只读模式默认拒绝一切写类命令；完全权限模式会放行包括高危在内的所有命令，请谨慎使用。
          </p>
        </section>

        {/* Token 管理 */}
        <section className="rounded-xl border border-border bg-[#18181b] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">访问 Token</div>
            <div className="flex gap-2">
              <button
                className="text-xs border border-border rounded px-2 py-1 hover:bg-secondary disabled:opacity-40"
                disabled={action.pending}
                onClick={() => run(api.mcp.regenerateToken, { successMessage: 'Token 已重新生成' })}
                type="button"
              >
                重新生成
              </button>
              <button
                className="text-xs border border-red-500/40 text-red-300 rounded px-2 py-1 hover:bg-red-500/10 disabled:opacity-40"
                disabled={action.pending || !(status?.hasToken ?? false)}
                onClick={() => setConfirmRevoke(true)}
                type="button"
              >
                吊销
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-black/40 border border-border px-3 py-2">
            {status?.hasToken === true ? (
              <code className="flex-1 min-w-0 truncate text-xs">
                {showToken && status.token !== undefined ? status.token : '••••••••••••••••'}
              </code>
            ) : (
              <span className="flex-1 text-xs text-muted-foreground">
                暂无 token，启用前需要先生成
              </span>
            )}
            {status?.hasToken === true && (
              <>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => setShowToken(!showToken)}
                  type="button"
                >
                  {showToken ? '隐藏' : '显示'}
                </button>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => void copyToken(status)}
                  type="button"
                >
                  {copied === 'token' ? '已复制' : '复制'}
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            token 无过期时间；吊销后所有新调用（含已建立连接的重连）都会被拒绝。
          </p>
        </section>
      </div>

      <ConfirmDialog
        confirmLabel="吊销"
        danger
        description="吊销后所有外部客户端的新调用（含已建立连接的重连）都会被拒绝，此操作不可撤销。"
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => {
          setConfirmRevoke(false);
          run(api.mcp.revokeToken, { successMessage: 'Token 已吊销' });
        }}
        open={confirmRevoke}
        pending={action.pending}
        title="确认吊销 Token"
      />
    </div>
  );

  async function copyToken(current: McpStatus): Promise<void> {
    if (current.token !== undefined) {
      await copyText('token', current.token);
      return;
    }
    toast.error('当前没有可复制的 token');
  }
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
      className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40 ${props.active ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-secondary'}`}
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
