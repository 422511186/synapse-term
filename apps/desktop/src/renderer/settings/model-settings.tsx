/** 模型配置页（自 app.tsx 拆分）：乐观启用/停用、检测三态、删除确认与防连点 */
import { useState, type JSX } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';

import { errorMessageZh } from '@synapse-term/ui-platform';
import type { DesktopApi, ModelConfigurationView } from '../../preload/preload-api.js';
import { ConfirmDialog, PendingButton, useToast } from '../feedback/index.js';
import { formatTestDuration, modelTestOutcome, optimisticSetEnabled } from './model-list-ops.js';

export function ModelSettings({
  api,
  models,
  onBack,
  onEdit,
  onNew,
  onRefresh,
  onModelsChange,
}: {
  api: DesktopApi;
  models: ModelConfigurationView[];
  onBack: () => void;
  onEdit: (model: ModelConfigurationView) => void;
  onNew: () => void;
  onRefresh: () => Promise<void>;
  onModelsChange: (models: ModelConfigurationView[]) => void;
}): JSX.Element {
  const [pendingId, setPendingId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<ModelConfigurationView>();
  const toast = useToast();

  /** 启用/停用：乐观更新 + 失败回滚（快操作，不转圈） */
  const toggleEnabled = async (model: ModelConfigurationView): Promise<void> => {
    if (pendingId !== undefined) return;
    const enabled = !model.enabled;
    setPendingId(model.id);
    const { next, previous } = optimisticSetEnabled(models, model.id, enabled);
    onModelsChange(next);
    try {
      const updated = await api.models.setEnabled(model.id, enabled);
      onModelsChange(models.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(`${enabled ? '模型已启用' : '模型已停用'} · ${updated.name}`);
    } catch (caught) {
      if (previous !== undefined) {
        onModelsChange(models.map((item) => (item.id === previous.id ? previous : item)));
      }
      toast.error(errorMessageZh(caught));
    } finally {
      setPendingId(undefined);
    }
  };

  const setDefault = async (model: ModelConfigurationView): Promise<void> => {
    if (pendingId !== undefined || !model.enabled) return;
    setPendingId(model.id);
    try {
      const updated = await api.models.setDefault(model.id, !model.isDefault);
      await onRefresh();
      toast.success(
        updated.isDefault ? `已设为默认 · ${updated.name}` : `已取消默认 · ${updated.name}`,
      );
    } catch (caught) {
      toast.error(errorMessageZh(caught));
    } finally {
      setPendingId(undefined);
    }
  };

  const testModel = async (model: ModelConfigurationView): Promise<void> => {
    if (pendingId !== undefined) return;
    setPendingId(model.id);
    const startedAt = performance.now();
    try {
      const updated = await api.models.test(model.id);
      await onRefresh();
      const outcome = modelTestOutcome(updated);
      if (!outcome.ok) throw new Error(outcome.message);
      toast.success(`检测通过 · ${formatTestDuration(performance.now() - startedAt)}`);
    } finally {
      setPendingId(undefined);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    const model = deleteTarget;
    if (model === undefined || pendingId !== undefined) return;
    setPendingId(model.id);
    try {
      await api.models.remove(model.id);
      setDeleteTarget(undefined);
      await onRefresh();
      toast.success(`已删除模型 · ${model.name}`);
    } catch (caught) {
      toast.error(errorMessageZh(caught));
    } finally {
      setPendingId(undefined);
    }
  };

  const rowBusy = pendingId !== undefined;

  return (
    <div className="absolute inset-0 z-30 animate-in fade-in duration-200 overflow-y-auto bg-[#09090b] p-8">
      <div className="max-w-5xl mx-auto">
        <button
          className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={16} /> 返回工作区
        </button>
        <h1 className="text-2xl font-bold mb-2">模型配置</h1>
        <p className="mb-8 text-muted-foreground">管理用于 Terminal Agent 的推理模型与权限级别。</p>

        <div className="overflow-hidden rounded-xl border border-border/50 bg-[#18181b] shadow-sm">
          <table aria-label="模型配置列表" className="w-full text-left text-sm">
            <thead className="border-b border-border/50 bg-[#09090b] text-muted-foreground">
              <tr>
                <th className="px-5 py-4 font-medium">模型名称</th>
                <th className="px-5 py-4 font-medium">服务商</th>
                <th className="px-5 py-4 font-medium">运行状态</th>
                <th className="px-5 py-4 font-medium">默认</th>
                <th className="px-5 py-4 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {models.map((model) => {
                const pending = pendingId === model.id;
                return (
                  <tr className="transition-colors hover:bg-secondary/20" key={model.id}>
                    <td className="px-5 py-4 font-medium text-foreground">
                      <div>{model.name}</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {model.modelId}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{model.providerName}</td>
                    <td className="px-5 py-4">
                      <button
                        aria-busy={pending}
                        aria-label={`${model.name} 启用状态`}
                        className={`border px-2.5 py-1 rounded text-xs font-medium disabled:opacity-40 ${
                          model.enabled
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                            : 'bg-secondary text-muted-foreground border-border/50'
                        }`}
                        disabled={rowBusy}
                        onClick={() => void toggleEnabled(model)}
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
                        className={`text-xs disabled:opacity-40 ${
                          model.isDefault
                            ? 'text-amber-500'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        disabled={rowBusy || !model.enabled}
                        onClick={() => void setDefault(model)}
                        type="button"
                      >
                        {model.isDefault ? '默认模型' : '设为默认'}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          aria-label={`编辑 ${model.name}`}
                          className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
                          disabled={rowBusy}
                          onClick={() => onEdit(model)}
                          type="button"
                        >
                          编辑
                        </button>
                        <PendingButton
                          aria-label={`检测 ${model.name}`}
                          busyLabel="检测中…"
                          className="min-w-[72px] text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                          disabled={rowBusy && !pending}
                          onClick={() => testModel(model)}
                          onError={(caught) => toast.error(errorMessageZh(caught))}
                          pending={pending}
                          successLabel="检测通过"
                          type="button"
                        >
                          检测
                        </PendingButton>
                        <button
                          aria-label={`删除 ${model.name}`}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
                          disabled={rowBusy}
                          onClick={() => setDeleteTarget(model)}
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
          className="mt-5 flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/50 px-4 py-2.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
          onClick={onNew}
          type="button"
        >
          <Plus size={16} /> 添加模型配置
        </button>
      </div>

      <ConfirmDialog
        confirmLabel="删除"
        danger
        description={
          deleteTarget === undefined
            ? ''
            : `将删除模型「${deleteTarget.name}」（${deleteTarget.modelId}），此操作不可撤销。`
        }
        onCancel={() => setDeleteTarget(undefined)}
        onConfirm={confirmDelete}
        open={deleteTarget !== undefined}
        pending={pendingId === deleteTarget?.id}
        title="确认删除模型"
      />
    </div>
  );
}
