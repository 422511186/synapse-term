/** 模型编辑弹窗（自 app.tsx 拆分） */
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
import { modelInput, newModelInput } from './inputs.js';

export function ModelEditModal({
  api,
  model,
  providers,
  onClose,
  onSaved,
}: {
  api: DesktopApi;
  model: ModelConfigurationView | undefined;
  providers: ProviderProfileView[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState<ModelConfigurationInput>(() =>
    model === undefined ? newModelInput(providers[0]?.id ?? '') : modelInput(model),
  );
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string>();
  const selectedProvider = providers.find((provider) => provider.id === draft.providerProfileId);

  const fetchModels = async (): Promise<void> => {
    if (selectedProvider === undefined) return;
    setFetching(true);
    setError(undefined);
    try {
      const result = await api.providers.discoverModels(selectedProvider.id);
      setDiscovered(result.models);
    } catch (caught) {
      setError(errorMessageZh(caught));
    } finally {
      setFetching(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!draft.name.trim() || !draft.modelId.trim() || selectedProvider === undefined) {
      setError('请填写模型名称、模型 ID 并选择 Provider。');
      return;
    }
    if (draft.contextWindowTokens <= draft.maxOutputTokens) {
      setError('Context Window 必须大于最大输出 Token。');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.models.save({ ...draft, name: draft.name.trim(), modelId: draft.modelId.trim() });
      await onSaved();
    } catch (caught) {
      setError(errorMessageZh(caught));
      setSaving(false);
    }
  };

  const testModel = async (): Promise<void> => {
    if (model === undefined) return;
    setTesting(true);
    setError(undefined);
    try {
      await api.models.test(model.id);
    } catch (caught) {
      setError(errorMessageZh(caught));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        aria-label="编辑模型配置"
        aria-modal="true"
        className="bg-[#18181b] border border-border w-full max-w-md rounded-xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        role="dialog"
      >
        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-[#09090b] rounded-t-xl">
          <h2 className="text-[15px] font-semibold">
            {model === undefined ? '新增模型配置' : '编辑模型配置'}
          </h2>
          <button
            aria-label="关闭模型编辑器"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-model-provider"
            >
              服务商引用 (Provider)
            </label>
            <select
              disabled={model !== undefined}
              id="prototype-model-provider"
              value={draft.providerProfileId}
              onChange={(event) => {
                setDraft({ ...draft, providerProfileId: event.target.value, modelId: '' });
                setDiscovered([]);
              }}
              className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary appearance-none transition-colors disabled:opacity-60"
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
                onClick={() => void fetchModels()}
                disabled={fetching || selectedProvider === undefined}
                className="text-[11px] flex items-center gap-1.5 text-primary hover:text-primary/80 transition-colors disabled:opacity-40"
                type="button"
              >
                <RefreshCw size={12} className={fetching ? 'animate-spin' : ''} />
                {fetching ? '拉取中...' : '拉取远程模型'}
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
                className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors font-mono text-foreground"
              />
              {discovered.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-[#18181b] border border-border/80 rounded-lg shadow-2xl z-50 custom-scrollbar">
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
                      className="w-full px-3 py-2 text-left text-[13px] font-mono hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors border-b border-border/30 last:border-0"
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
              className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
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
                className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors font-mono"
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
                className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors font-mono"
              />
            </div>
          </div>
          {error !== undefined && (
            <div className="text-xs text-red-400" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-border flex justify-between gap-2 bg-[#09090b] rounded-b-xl">
          {model !== undefined ? (
            <button
              disabled={testing || saving}
              onClick={() => void testModel()}
              className="px-3 py-2 text-xs border border-border rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-40"
              type="button"
            >
              {testing ? '检测中…' : '检测模型'}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              disabled={saving}
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium hover:bg-secondary rounded-lg transition-colors"
              type="button"
            >
              取消
            </button>
            <button
              disabled={saving}
              onClick={() => void save()}
              className="px-4 py-2 bg-white text-black text-xs font-semibold rounded-lg hover:bg-white/90 transition-colors shadow-sm flex items-center gap-1.5 disabled:opacity-40"
              type="button"
            >
              <Save size={14} /> {saving ? '正在保存…' : '保存配置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
