/** 新建终端会话弹窗（自 app.tsx 拆分） */
import { useEffect, useState, type JSX } from 'react';
import { X } from 'lucide-react';

import type { SessionEnvironment, SessionSummary } from '../../preload/preload-api.js';
import { errorMessageZh } from '../i18n/zh-cn.js';
import { getDefaultSessionAlias, resolveSessionAlias } from '../session-alias.js';

export function NewSessionModal({
  environment,
  sessions,
  onClose,
  onCreate,
}: {
  environment: SessionEnvironment;
  sessions: readonly Pick<SessionSummary, 'title'>[];
  onClose: () => void;
  onCreate: (
    title: string,
    shellKind: SessionEnvironment['shells'][number]['kind'],
  ) => Promise<void>;
}): JSX.Element {
  const availableShells = environment.shells.filter((shell) => shell.available);
  const defaultAlias = getDefaultSessionAlias(sessions);
  const [title, setTitle] = useState(() => defaultAlias);
  const [shellKind, setShellKind] = useState<SessionEnvironment['shells'][number]['kind']>(
    () => availableShells[0]?.kind ?? 'bash',
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (availableShells.some((shell) => shell.kind === shellKind)) return;
    const first = availableShells[0];
    if (first !== undefined) setShellKind(first.kind);
  }, [availableShells, shellKind]);

  const create = async (): Promise<void> => {
    const alias = resolveSessionAlias(title, sessions);
    setCreating(true);
    setError(undefined);
    try {
      await onCreate(alias, shellKind);
    } catch (caught) {
      setError(errorMessageZh(caught));
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        aria-label="新建终端会话"
        aria-modal="true"
        className="bg-popover border border-border w-full max-w-md rounded-xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        role="dialog"
      >
        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-background rounded-t-xl">
          <h2 className="text-[15px] font-semibold">新建终端会话</h2>
          <button
            aria-label="关闭新建终端会话"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-5">
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            新 Session 会从当前用户主目录启动。在终端中自行完成跳转与认证。
          </p>
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-session-name"
            >
              Session Alias
            </label>
            <input
              id="prototype-session-name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              type="text"
              placeholder={defaultAlias}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-session-shell"
            >
              系统 Shell
            </label>
            <select
              id="prototype-session-shell"
              value={shellKind}
              onChange={(event) =>
                setShellKind(event.target.value as SessionEnvironment['shells'][number]['kind'])
              }
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary appearance-none transition-colors"
            >
              {environment.shells.map((shell) => (
                <option disabled={!shell.available} key={shell.kind} value={shell.kind}>
                  {shell.label}
                  {shell.available ? '' : '（不可用）'}
                </option>
              ))}
            </select>
          </div>
          {error !== undefined && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2 bg-background rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium hover:bg-secondary rounded-lg transition-colors"
            type="button"
          >
            取消
          </button>
          <button
            disabled={creating || availableShells.length === 0 || !environment.home}
            onClick={() => void create()}
            className="px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-40"
            type="button"
          >
            {creating ? '正在创建…' : '创建并连接'}
          </button>
        </div>
      </div>
    </div>
  );
}
