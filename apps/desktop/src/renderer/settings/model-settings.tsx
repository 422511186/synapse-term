/** 模型配置页（自 app.tsx 拆分） */
import { useState, type JSX } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';

import { errorMessageZh } from '@synapse-term/ui-platform';
import type { DesktopApi, ModelConfigurationView } from '../../preload/preload-api.js';

export function ModelSettings({
  api,
  models,
  onBack,
  onEdit,
  onNew,
  onRefresh,
}: {
  api: DesktopApi;
  models: ModelConfigurationView[];
  onBack: () => void;
  onEdit: (model: ModelConfigurationView) => void;
  onNew: () => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [pendingId, setPendingId] = useState<string>();
  const [error, setError] = useState<string>();
  const run = async (id: string, operation: () => Promise<unknown>): Promise<void> => {
    setPendingId(id);
    setError(undefined);
    try {
      await operation();
      await onRefresh();
    } catch (caught) {
      setError(errorMessageZh(caught));
    } finally {
      setPendingId(undefined);
    }
  };

  return (
    <div className="absolute inset-0 p-8 overflow-y-auto bg-[#09090b] animate-in fade-in duration-200 z-30">
      <div className="max-w-5xl mx-auto">
        <button
          onClick={onBack}
          className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          <ArrowLeft size={16} /> 返回工作区
        </button>
        <h1 className="text-2xl font-bold mb-2">模型配置</h1>
        <p className="text-muted-foreground mb-8">管理用于 Terminal Agent 的推理模型与权限级别。</p>
        {error !== undefined && <div className="mb-4 text-sm text-red-400">{error}</div>}

        <div className="bg-[#18181b] border border-border/50 rounded-xl overflow-hidden shadow-sm">
          <table aria-label="模型配置列表" className="w-full text-sm text-left">
            <thead className="bg-[#09090b] text-muted-foreground border-b border-border/50">
              <tr>
                <th className="px-5 py-4 font-medium">模型名称</th>
                <th className="px-5 py-4 font-medium">服务商</th>
                <th className="px-5 py-4 font-medium">运行状态</th>
                <th className="px-5 py-4 font-medium">默认</th>
                <th className="px-5 py-4 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {models.map((model) => {
                const pending = pendingId === model.id;
                return (
                  <tr className="hover:bg-secondary/20 transition-colors" key={model.id}>
                    <td className="px-5 py-4 font-medium text-foreground">
                      <div>{model.name}</div>
                      <div className="mt-1 text-xs font-mono text-muted-foreground">
                        {model.modelId}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{model.providerName}</td>
                    <td className="px-5 py-4">
                      <button
                        aria-label={`${model.name} 启用状态`}
                        className={`border px-2.5 py-1 rounded text-xs font-medium ${model.enabled ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-secondary text-muted-foreground border-border/50'}`}
                        disabled={pending}
                        onClick={() =>
                          void run(model.id, () => api.models.setEnabled(model.id, !model.enabled))
                        }
                        type="button"
                      >
                        {model.enabled ? '已启用' : '已停用'} ·{' '}
                        {model.status === 'available'
                          ? '可用'
                          : model.status === 'unavailable'
                            ? '不可用'
                            : '待检测'}
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      <button
                        aria-label={`设为默认 ${model.name}`}
                        className={`text-xs ${model.isDefault ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
                        disabled={pending || !model.enabled}
                        onClick={() =>
                          void run(model.id, () =>
                            api.models.setDefault(model.id, !model.isDefault),
                          )
                        }
                        type="button"
                      >
                        {model.isDefault ? '默认模型' : '设为默认'}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          aria-label={`编辑 ${model.name}`}
                          onClick={() => onEdit(model)}
                          className="text-primary text-xs font-medium hover:underline"
                          type="button"
                        >
                          编辑
                        </button>
                        <button
                          aria-label={`检测 ${model.name}`}
                          disabled={pending}
                          onClick={() => void run(model.id, () => api.models.test(model.id))}
                          className="text-xs text-muted-foreground hover:text-foreground"
                          type="button"
                        >
                          检测
                        </button>
                        <button
                          aria-label={`删除 ${model.name}`}
                          disabled={pending}
                          onClick={() => void run(model.id, () => api.models.remove(model.id))}
                          className="text-xs text-red-400 hover:text-red-300"
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {models.length === 0 && (
            <div className="px-5 py-8 text-sm text-muted-foreground">暂无模型配置。</div>
          )}
        </div>
        <button
          onClick={onNew}
          className="mt-5 flex items-center gap-2 bg-secondary/50 text-foreground px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-secondary border border-border/50 transition-colors shadow-sm"
          type="button"
        >
          <Plus size={16} /> 添加模型配置
        </button>
      </div>
    </div>
  );
}
