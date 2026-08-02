/** 新建终端会话弹窗（自 app.tsx 拆分） */
import { useEffect, useState, type JSX } from 'react';
import { X } from 'lucide-react';

import { errorMessageZh } from '@synapse-term/ui-platform';
import type { SessionEnvironment } from '../../preload/preload-api.js';

export function NewSessionModal({
  environment,
  onClose,
  onCreate,
}: {
  environment: SessionEnvironment;
  onClose: () => void;
  onCreate: (
    title: string,
    shellKind: SessionEnvironment['shells'][number]['kind'],
  ) => Promise<void>;
}): JSX.Element {
  const availableShells = environment.shells.filter((shell) => shell.available);
  const [title, setTitle] = useState('');
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
    if (!title.trim()) {
      setError('请输入会话名称。');
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      await onCreate(title.trim(), shellKind);
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
        className="bg-[#18181b] border border-border w-full max-w-md rounded-xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        role="dialog"
      >
        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-[#09090b] rounded-t-xl">
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
            新 Session 会从当前用户主目录启动。在终端中自行完成跳转与认证，Agent 仅操作就绪的
            Session。
          </p>
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-session-name"
            >
              会话名称
            </label>
            <input
              id="prototype-session-name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              type="text"
              placeholder="例如: 生产环境-K8S"
              className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
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
              className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary appearance-none transition-colors"
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
        <div className="p-4 border-t border-border flex justify-end gap-2 bg-[#09090b] rounded-b-xl">
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
            className="px-4 py-2 bg-white text-black text-xs font-semibold rounded-lg hover:bg-white/90 transition-colors shadow-sm disabled:opacity-40"
            type="button"
          >
            {creating ? '正在创建…' : '创建并连接'}
          </button>
        </div>
      </div>
    </div>
  );
}
