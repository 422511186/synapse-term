/** 模型编辑弹窗（自 app.tsx 拆分）：保存/拉取/检测统一走 useAsyncAction，新建模型可直接检测 */
import { useState, type JSX } from 'react';
import { RefreshCw, Save, X } from 'lucide-react';

import { errorMessageZh } from '@synapse-term/ui-platform';
import type {
  DesktopApi,
  DiscoveredModel,
  ModelConfigurationInput,
  ModelConfigurationView,
  ProviderProfileView,
} from '../../preload/preload-api.js';
import { PendingButton, useAsyncAction, useToast } from '../feedback/index.js';
import { modelInput, newModelInput } from './inputs.js';
import { formatTestDuration, modelTestOutcome } from './model-list-ops.js';

export function ModelEditModal({
  api,
  model,
  providers,
  onClose,
  onSaved,
  onDraftSaved,
}: {
  api: DesktopApi;
  model: ModelConfigurationView | undefined;
  providers: ProviderProfileView[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDraftSaved?: () => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState<ModelConfigurationInput>(() =>
    model === undefined ? newModelInput(providers[0]?.id ?? '') : modelInput(model),
  );
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [error, setError] = useState<string>();
  const fetchAction = useAsyncAction();
  const saveAction = useAsyncAction();
  const testAction = useAsyncAction();
  const toast = useToast();
  const selectedProvider = providers.find((provider) => provider.id === draft.providerProfileId);

  const validateDraft = (): boolean => {
    if (!draft.name.trim() || !draft.modelId.trim() || selectedProvider === undefined) {
      setError('请填写模型名称、模型 ID 并选择 Provider。');
      return false;
    }
    if (draft.contextWindowTokens <= draft.maxOutputTokens) {
      setError('Context Window 必须大于最大输出 Token。');
      return false;
    }
    setError(undefined);
    return true;
  };

  const fetchModels = (): void => {
    if (selectedProvider === undefined) return;
    setError(undefined);
    void fetchAction.run(
      async () => {
        const result = await api.providers.discoverModels(selectedProvider.id);
        setDiscovered(result.models);
        return result;
      },
      { onError: (caught) => toast.error(errorMessageZh(caught)) },
    );
  };

  const save = (): void => {
    if (!validateDraft()) return;
    void saveAction.run(
      async () => {
        await api.models.save({
          ...draft,
          name: draft.name.trim(),
          modelId: draft.modelId.trim(),
        });
        await onSaved();
      },
      { onError: (caught) => toast.error(errorMessageZh(caught)) },
    );
  };

  /** 检测：编辑已有模型直接测试；新建模型先保存草稿再测试，失败保留弹窗内容 */
  const testModel = (): void => {
    if (!validateDraft()) return;
    const startedAt = performance.now();
    void testAction.run(
      async () => {
        if (model === undefined) {
          await api.models.save({
            ...draft,
            name: draft.name.trim(),
            modelId: draft.modelId.trim(),
          });
          await onDraftSaved?.();
        }
        const updated = await api.models.test(model?.id ?? draft.id);
        await onDraftSaved?.();
        const outcome = modelTestOutcome(updated);
        if (!outcome.ok) throw new Error(outcome.message);
        toast.success(`检测通过 · ${formatTestDuration(performance.now() - startedAt)}`);
      },
      { onError: (caught) => toast.error(errorMessageZh(caught)) },
    );
  };

  const busy = saveAction.pending || testAction.pending || fetchAction.pending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        aria-label="编辑模型配置"
        aria-modal="true"
        className="flex w-full max-w-md animate-in zoom-in-95 duration-200 flex-col rounded-xl border border-border bg-[#18181b] shadow-2xl"
        role="dialog"
      >
        <div className="flex items-center justify-between rounded-t-xl border-b border-border/50 bg-[#09090b] p-4">
          <h2 className="text-[15px] font-semibold">
            {model === undefined ? '新增模型配置' : '编辑模型配置'}
          </h2>
          <button
            aria-label="关闭模型编辑器"
            className="text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-model-provider"
            >
              服务商引用 (Provider)
            </label>
            <select
              disabled={model !== undefined || busy}
              id="prototype-model-provider"
              value={draft.providerProfileId}
              onChange={(event) => {
                setDraft({ ...draft, providerProfileId: event.target.value, modelId: '' });
                setDiscovered([]);
              }}
              className="w-full appearance-none rounded-lg border border-border bg-[#09090b] px-3 py-2 text-sm outline-none transition-colors focus:border-primary disabled:opacity-60"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                className="text-[13px] font-medium text-foreground/90"
                htmlFor="prototype-model-id"
              >
                模型 ID (Model ID)
              </label>
              <button
                className="flex items-center gap-1.5 text-[11px] text-primary transition-colors hover:text-primary/80 disabled:opacity-40"
                disabled={fetchAction.pending || selectedProvider === undefined || busy}
                onClick={fetchModels}
                type="button"
              >
                <RefreshCw size={12} className={fetchAction.pending ? 'animate-spin' : ''} />
                {fetchAction.pending ? '拉取中...' : '拉取远程模型'}
              </button>
            </div>
            <div className="relative">
              <input
                aria-label="模型 ID (Model ID)"
                id="prototype-model-id"
                type="text"
                value={draft.modelId}
                onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
                placeholder="手动输入或点击右上角拉取..."
                className="w-full rounded-lg border border-border bg-[#09090b] px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary"
              />
              {discovered.length > 0 && (
                <div className="custom-scrollbar absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border/80 bg-[#18181b] shadow-2xl">
                  {discovered.map((candidate) => (
                    <button
                      key={candidate.id}
                      onClick={() => {
                        setDraft({
                          ...draft,
                          modelId: candidate.id,
                          name: draft.name || candidate.displayName || candidate.id,
                        });
                        setDiscovered([]);
                      }}
                      className="w-full border-b border-border/30 px-3 py-2 text-left font-mono text-[13px] text-muted-foreground transition-colors last:border-0 hover:bg-secondary hover:text-foreground"
                      type="button"
                    >
                      {candidate.id}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-model-name"
            >
              展示名称 (Display Name)
            </label>
            <input
              aria-label="展示名称 (Display Name)"
              id="prototype-model-name"
              type="text"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="w-full rounded-lg border border-border bg-[#09090b] px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label
                className="text-[13px] font-medium text-foreground/90"
                htmlFor="prototype-model-context"
              >
                Context Window
              </label>
              <input
                id="prototype-model-context"
                min={1}
                type="number"
                value={draft.contextWindowTokens}
                onChange={(event) =>
                  setDraft({ ...draft, contextWindowTokens: Number(event.target.value) })
                }
                className="w-full rounded-lg border border-border bg-[#09090b] px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-primary"
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-[13px] font-medium text-foreground/90"
                htmlFor="prototype-model-threshold"
              >
                自动压缩阈值
              </label>
              <input
                id="prototype-model-threshold"
                max={100}
                min={1}
                type="number"
                value={draft.compactThresholdPercent}
                onChange={(event) =>
                  setDraft({ ...draft, compactThresholdPercent: Number(event.target.value) })
                }
                className="w-full rounded-lg border border-border bg-[#09090b] px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-primary"
              />
            </div>
          </div>
          {error !== undefined && (
            <div className="text-xs text-red-400" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-between gap-2 rounded-b-xl border-t border-border bg-[#09090b] p-4">
          <PendingButton
            aria-label="检测模型"
            busyLabel="检测中…"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            disabled={busy && !testAction.pending}
            onClick={testModel}
            onError={(caught) => toast.error(errorMessageZh(caught))}
            pending={testAction.pending}
            successLabel="检测通过"
            {...(model === undefined ? { title: '新建模型测试前会先保存草稿' } : {})}
            type="button"
          >
            检测模型
          </PendingButton>
          <div className="flex gap-2">
            <button
              className="rounded-lg px-4 py-2 text-xs font-medium transition-colors hover:bg-secondary disabled:opacity-40"
              disabled={busy}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black shadow-sm transition-colors hover:bg-white/90 disabled:opacity-40"
              disabled={busy}
              onClick={save}
              type="button"
            >
              <Save size={14} /> {saveAction.pending ? '正在保存…' : '保存配置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
