/** Provider 编辑弹窗（自 app.tsx 拆分）：保存/测试连接统一走 useAsyncAction */
import { useState, type JSX } from 'react';
import { Check, RefreshCw, Save, X } from 'lucide-react';

import { errorMessageZh } from '@synapse-term/ui-platform';
import type {
  DesktopApi,
  ProviderProfileInput,
  ProviderProfileView,
} from '../../preload/preload-api.js';
import { useAsyncAction, useToast } from '../feedback/index.js';
import { newProviderInput, providerInput } from './inputs.js';

export function ProviderEditModal({
  api,
  provider,
  onClose,
  onSaved,
}: {
  api: DesktopApi;
  provider: ProviderProfileView | undefined;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState<ProviderProfileInput>(() =>
    provider === undefined ? newProviderInput() : providerInput(provider),
  );
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<'none' | 'success'>('none');
  const [error, setError] = useState<string>();
  const saveAction = useAsyncAction();
  const testAction = useAsyncAction();
  const toast = useToast();

  const validate = (): boolean => {
    if (!draft.name.trim() || !draft.baseUrl.trim()) {
      setError('请填写名称和 Base URL。');
      return false;
    }
    try {
      new URL(draft.baseUrl);
    } catch {
      setError('Base URL 必须是有效 URL。');
      return false;
    }
    setError(undefined);
    return true;
  };

  const testConnection = (): void => {
    if (!validate()) return;
    setTestResult('none');
    void testAction.run(
      async () => {
        await api.providers.save(
          { ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim() },
          apiKey.trim() || undefined,
        );
        await api.providers.discoverModels(draft.id);
        setTestResult('success');
      },
      { onError: (caught) => toast.error(errorMessageZh(caught)) },
    );
  };

  const save = (): void => {
    if (!validate()) return;
    void saveAction.run(
      async () => {
        await api.providers.save(
          { ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim() },
          apiKey.trim() || undefined,
        );
        await onSaved();
      },
      { onError: (caught) => toast.error(errorMessageZh(caught)) },
    );
  };

  const busy = saveAction.pending || testAction.pending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        aria-label="配置服务商"
        aria-modal="true"
        className="flex w-full max-w-md animate-in zoom-in-95 duration-200 flex-col rounded-xl border border-border bg-[#18181b] shadow-2xl"
        role="dialog"
      >
        <div className="flex items-center justify-between rounded-t-xl border-b border-border/50 bg-[#09090b] p-4">
          <h2 className="text-[15px] font-semibold">配置服务商</h2>
          <button
            aria-label="关闭服务商配置"
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
              htmlFor="prototype-provider-name"
            >
              名称
            </label>
            <input
              id="prototype-provider-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              type="text"
              className="w-full rounded-lg border border-border bg-[#09090b] px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-provider-protocol"
            >
              协议支持
            </label>
            <select
              id="prototype-provider-protocol"
              value={draft.protocol}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  protocol: event.target.value as ProviderProfileView['protocol'],
                })
              }
              className="w-full appearance-none rounded-lg border border-border bg-[#09090b] px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            >
              <option value="openai_chat_completions">OpenAI Chat Completions</option>
              <option value="openai_responses">OpenAI Responses</option>
              <option value="anthropic_messages">Anthropic Messages</option>
            </select>
          </div>
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-provider-url"
            >
              Base URL
            </label>
            <input
              id="prototype-provider-url"
              value={draft.baseUrl}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              type="text"
              className="w-full rounded-lg border border-border bg-[#09090b] px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-provider-key"
            >
              API Key
            </label>
            <input
              id="prototype-provider-key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              placeholder="留空则保留当前凭据"
              className="w-full rounded-lg border border-border bg-[#09090b] px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
          {error !== undefined && (
            <div className="text-xs text-red-400" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between rounded-b-xl border-t border-border bg-[#09090b] p-4">
          <button
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
              testResult === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
            disabled={busy}
            onClick={testConnection}
            title="测试连接会先保存当前草稿"
            type="button"
          >
            {testResult === 'success' ? (
              <Check size={14} />
            ) : (
              <RefreshCw size={14} className={testAction.pending ? 'animate-spin' : ''} />
            )}
            {testAction.pending ? '连接中...' : testResult === 'success' ? '测试成功' : '测试连接'}
          </button>
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
              <Save size={14} /> {saveAction.pending ? '正在保存…' : '保存凭据'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
