/** Provider 编辑弹窗（自 app.tsx 拆分） */
import { useState, type JSX } from 'react';
import { Check, RefreshCw, Save, X } from 'lucide-react';

import { errorMessageZh } from '@synapse-term/ui-platform';
import type {
  DesktopApi,
  ProviderProfileInput,
  ProviderProfileView,
} from '../../preload/preload-api.js';
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
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<'none' | 'success'>('none');
  const [error, setError] = useState<string>();

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
    return true;
  };

  const testConnection = async (): Promise<void> => {
    if (!validate()) return;
    setTesting(true);
    setTestResult('none');
    setError(undefined);
    try {
      await api.providers.save(
        { ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim() },
        apiKey.trim() || undefined,
      );
      await api.providers.discoverModels(draft.id);
      setTestResult('success');
    } catch (caught) {
      setError(errorMessageZh(caught));
    } finally {
      setTesting(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!validate()) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.providers.save(
        { ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim() },
        apiKey.trim() || undefined,
      );
      await onSaved();
    } catch (caught) {
      setError(errorMessageZh(caught));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        aria-label="配置服务商"
        aria-modal="true"
        className="bg-[#18181b] border border-border w-full max-w-md rounded-xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        role="dialog"
      >
        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-[#09090b] rounded-t-xl">
          <h2 className="text-[15px] font-semibold">配置服务商</h2>
          <button
            aria-label="关闭服务商配置"
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
              htmlFor="prototype-provider-name"
            >
              名称
            </label>
            <input
              id="prototype-provider-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              type="text"
              className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
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
              className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary appearance-none transition-colors"
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
              className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors font-mono"
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
              className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors font-mono"
            />
          </div>
          {error !== undefined && (
            <div className="text-xs text-red-400" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-border flex justify-between items-center bg-[#09090b] rounded-b-xl">
          <button
            onClick={() => void testConnection()}
            disabled={testing || saving}
            className={`px-3 py-2 text-xs font-medium border rounded-lg transition-colors flex items-center gap-1.5 ${testResult === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'border-border hover:bg-secondary text-muted-foreground hover:text-foreground'} disabled:opacity-40`}
            type="button"
          >
            {testResult === 'success' ? (
              <Check size={14} />
            ) : (
              <RefreshCw size={14} className={testing ? 'animate-spin' : ''} />
            )}
            {testing ? '连接中...' : testResult === 'success' ? '测试成功' : '测试连接'}
          </button>
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
              <Save size={14} /> {saving ? '正在保存…' : '保存凭据'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
