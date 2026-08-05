/** Provider 凭据配置页（自 app.tsx 拆分）：删除确认与 pending 态 */
import { useMemo, useState, type JSX } from 'react';
import { Pencil, PlugZap, Plus, Search, Trash2 } from 'lucide-react';

import { errorMessageZh } from '@synapse-term/ui-platform';
import type { DesktopApi, ProviderProfileView } from '../../preload/preload-api.js';
import { ConfirmDialog, PendingButton, useToast } from '../feedback/index.js';
import { filterProviderProfiles, PROVIDER_SEARCH_THRESHOLD } from './configuration-list-ops.js';

export function ProviderSettings({
  api,
  providers,
  onEdit,
  onNew,
  onRefresh,
}: {
  api: DesktopApi;
  providers: ProviderProfileView[];
  onEdit: (provider: ProviderProfileView) => void;
  onNew: () => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [pendingId, setPendingId] = useState<string>();
  const [testingId, setTestingId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<ProviderProfileView>();
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();
  const showSearch = providers.length > PROVIDER_SEARCH_THRESHOLD;
  const visibleProviders = useMemo(
    () => (showSearch ? filterProviderProfiles(providers, searchQuery) : providers),
    [providers, searchQuery, showSearch],
  );

  const testConnection = async (provider: ProviderProfileView): Promise<void> => {
    if (pendingId !== undefined || testingId !== undefined) return;
    setTestingId(provider.id);
    try {
      const result = await api.providers.discoverModels(provider.id);
      toast.success(`连接成功 · 已发现 ${result.models.length} 个模型`);
    } catch (caught) {
      toast.error(errorMessageZh(caught));
      throw caught;
    } finally {
      setTestingId(undefined);
    }
  };

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
    <div className="min-h-full bg-[#09090b] p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-2 text-2xl font-bold">服务商凭据</h1>
        <p className="text-muted-foreground mb-8">
          配置 API 服务商协议、Base URL 及安全存储的凭证。
        </p>

        {showSearch && (
          <div className="mb-6 flex flex-col items-center gap-3 rounded-xl border border-border/50 bg-[#18181b] p-4 sm:flex-row">
            <label className="relative flex min-w-0 flex-1 items-center" htmlFor="provider-search">
              <Search
                className="pointer-events-none absolute left-2 text-muted-foreground"
                size={16}
              />
              <input
                aria-label="搜索服务商"
                className="w-full rounded-lg border border-border bg-[#09090b] py-2.5 pl-8 pr-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                id="provider-search"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索名称、协议或 Base URL"
                type="search"
                value={searchQuery}
              />
            </label>
            <div className="shrink-0 text-xs text-muted-foreground">
              显示 {visibleProviders.length} / {providers.length} 个服务商
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border/50 bg-[#18181b] shadow-sm">
          {visibleProviders.length > 0 ? (
            <div className="custom-scrollbar overflow-x-auto">
              <table aria-label="服务商配置列表" className="w-full text-left text-sm">
                <thead className="border-b border-border/50 bg-[#09090b] text-muted-foreground">
                  <tr>
                    <th className="px-5 py-4 font-medium">服务商</th>
                    <th className="px-5 py-4 font-medium">Base URL</th>
                    <th className="px-5 py-4 font-medium">凭据状态</th>
                    <th className="px-5 py-4 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {visibleProviders.map((provider) => (
                    <tr className="transition-colors hover:bg-secondary/20" key={provider.id}>
                      <td className="px-5 py-4">
                        <div className="font-medium text-foreground">{provider.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          协议: {provider.protocol}
                        </div>
                      </td>
                      <td className="max-w-md px-5 py-4">
                        <div
                          className="truncate font-mono text-sm text-muted-foreground"
                          title={provider.baseUrl}
                        >
                          {provider.baseUrl}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={
                            provider.credentialConfigured
                              ? 'inline-flex rounded border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500'
                              : 'inline-flex rounded border border-border/50 bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground'
                          }
                        >
                          {provider.credentialConfigured ? '已配置' : '未配置 Key'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          <PendingButton
                            aria-label={`测试连接 ${provider.name}`}
                            busyLabel="测试中…"
                            className="rounded px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-secondary disabled:opacity-40"
                            disabled={
                              pendingId !== undefined ||
                              (testingId !== undefined && testingId !== provider.id)
                            }
                            onClick={() => testConnection(provider)}
                            pending={testingId === provider.id}
                            successLabel="连接成功"
                            type="button"
                          >
                            <PlugZap size={14} />
                            测试连接
                          </PendingButton>
                          <button
                            aria-label={`编辑 ${provider.name}`}
                            className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                            disabled={pendingId !== undefined || testingId !== undefined}
                            onClick={() => onEdit(provider)}
                            type="button"
                          >
                            <Pencil size={14} />
                            编辑
                          </button>
                          <button
                            aria-label={`删除 ${provider.name}`}
                            className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                            disabled={pendingId !== undefined || testingId !== undefined}
                            onClick={() => setDeleteTarget(provider)}
                            type="button"
                          >
                            <Trash2 size={14} />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 py-8 text-sm text-muted-foreground">
              {providers.length === 0 ? '暂无 Provider，请先新增一个连接。' : '没有匹配的服务商。'}
            </div>
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
