/** Provider 凭据配置页（自 app.tsx 拆分）：删除确认与 pending 态 */
import { useState, type JSX } from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';

import { errorMessageZh } from '@synapse-term/ui-platform';
import type { DesktopApi, ProviderProfileView } from '../../preload/preload-api.js';
import { ConfirmDialog, useToast } from '../feedback/index.js';

export function ProviderSettings({
  api,
  providers,
  onBack,
  onEdit,
  onNew,
  onRefresh,
}: {
  api: DesktopApi;
  providers: ProviderProfileView[];
  onBack: () => void;
  onEdit: (provider: ProviderProfileView) => void;
  onNew: () => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [pendingId, setPendingId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<ProviderProfileView>();
  const toast = useToast();

  const confirmDelete = async (): Promise<void> => {
    const provider = deleteTarget;
    if (provider === undefined || pendingId !== undefined) return;
    setPendingId(provider.id);
    try {
      await api.providers.remove(provider.id);
      setDeleteTarget(undefined);
      await onRefresh();
      toast.success(`已删除 Provider · ${provider.name}`);
    } catch (caught) {
      toast.error(errorMessageZh(caught));
    } finally {
      setPendingId(undefined);
    }
  };

  return (
    <div className="absolute inset-0 z-30 animate-in fade-in duration-200 overflow-y-auto bg-[#09090b] p-8">
      <div className="max-w-5xl mx-auto">
        <button
          onClick={onBack}
          className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          <ArrowLeft size={16} /> 返回工作区
        </button>
        <h1 className="text-2xl font-bold mb-2">服务商凭据</h1>
        <p className="text-muted-foreground mb-8">
          配置 API 服务商协议、Base URL 及安全存储的凭证。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {providers.map((provider) => (
            <div
              className="bg-[#18181b] border border-border/50 rounded-xl p-6 shadow-sm hover:border-border transition-colors"
              key={provider.id}
            >
              <div className="flex items-start justify-between mb-5 gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[15px] text-foreground truncate">
                    {provider.name}
                  </h3>
                  <div className="text-xs text-muted-foreground mt-1.5">
                    协议: {provider.protocol}
                  </div>
                </div>
                <span
                  className={
                    provider.credentialConfigured
                      ? 'bg-emerald-500/10 text-emerald-500 text-xs px-2.5 py-1 rounded font-medium border border-emerald-500/20'
                      : 'bg-secondary text-muted-foreground text-xs px-2.5 py-1 rounded font-medium border border-border/50'
                  }
                >
                  {provider.credentialConfigured ? '已配置' : '未配置 Key'}
                </span>
              </div>
              <div className="text-sm font-mono text-muted-foreground bg-[#09090b] p-3 rounded-lg border border-border/50 mb-5 truncate shadow-inner">
                {provider.baseUrl}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onEdit(provider)}
                  className="flex-1 py-2.5 border border-border/50 bg-[#09090b] rounded-lg text-sm font-medium hover:bg-secondary transition-colors text-foreground disabled:opacity-40"
                  disabled={pendingId !== undefined}
                  type="button"
                >
                  测试连接 / 编辑
                </button>
                <button
                  aria-label={`删除 ${provider.name}`}
                  className="px-3 py-2.5 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/10 disabled:opacity-40"
                  disabled={pendingId !== undefined}
                  onClick={() => setDeleteTarget(provider)}
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
          {providers.length === 0 && (
            <div className="text-sm text-muted-foreground">暂无 Provider，请先新增一个连接。</div>
          )}
        </div>
        <button
          onClick={onNew}
          className="mt-8 flex items-center gap-2 bg-white text-black px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-white/90 transition-colors shadow-sm"
          type="button"
        >
          <Plus size={16} /> 新增 Provider
        </button>
      </div>

      <ConfirmDialog
        confirmLabel="删除"
        danger
        description={
          deleteTarget === undefined
            ? ''
            : `将删除 Provider「${deleteTarget.name}」（${deleteTarget.baseUrl}），关联的模型配置将被重置，此操作不可撤销。`
        }
        onCancel={() => setDeleteTarget(undefined)}
        onConfirm={confirmDelete}
        open={deleteTarget !== undefined}
        pending={pendingId === deleteTarget?.id}
        title="确认删除 Provider"
      />
    </div>
  );
}
