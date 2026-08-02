import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import {
  Check,
  Database,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';

import type {
  DiscoveredModel,
  ModelConfigurationInput,
  ModelConfigurationView,
  ModelManagementApi,
  ProviderProfileInput,
  ProviderProfileView,
  ReasoningEffort,
} from '../contracts.js';
import { errorMessageZh } from '../i18n/zh-cn.js';

type View = 'models' | 'providers';

export function ModelManagementPage({
  api,
  initialView,
  providers,
  models,
  onNavigate,
  onRefresh,
}: {
  api: ModelManagementApi;
  initialView: View;
  providers: ProviderProfileView[];
  models: ModelConfigurationView[];
  onNavigate: (view: View) => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [modelEditor, setModelEditor] = useState<
    { mode: 'new' } | { mode: 'edit'; modelId: string } | undefined
  >();
  const [providerEditor, setProviderEditor] = useState<
    { mode: 'new' } | { mode: 'edit'; provider: ProviderProfileView } | undefined
  >();

  const switchView = (view: View): void => {
    setModelEditor(undefined);
    setProviderEditor(undefined);
    onNavigate(view);
  };

  const isModelsView = initialView === 'models';
  return (
    <section className="management-page" aria-label="配置管理">
      <header className="management-page-header">
        <div className="management-page-title">
          <span className="eyebrow">配置</span>
          <h1>{isModelsView ? '模型配置' : 'Provider'}</h1>
        </div>
        <div className="management-page-actions">
          <div className="management-tabs" role="tablist" aria-label="配置类别">
            <button
              aria-selected={isModelsView}
              className={isModelsView ? 'is-active' : ''}
              onClick={() => switchView('models')}
              role="tab"
              type="button"
            >
              <Database size={14} /> 模型
            </button>
            <button
              aria-selected={!isModelsView}
              className={!isModelsView ? 'is-active' : ''}
              onClick={() => switchView('providers')}
              role="tab"
              type="button"
            >
              <ShieldAlert size={14} /> Provider
            </button>
          </div>
          {isModelsView ? (
            <button
              className="primary-button management-add-button"
              onClick={() => setModelEditor({ mode: 'new' })}
              type="button"
            >
              <Plus size={14} /> 新建模型
            </button>
          ) : (
            <button
              className="primary-button management-add-button"
              onClick={() => setProviderEditor({ mode: 'new' })}
              type="button"
            >
              <Plus size={14} /> 新建 Provider
            </button>
          )}
        </div>
      </header>

      {isModelsView ? (
        <ModelCatalog
          api={api}
          models={models}
          onEdit={(model) => setModelEditor({ mode: 'edit', modelId: model.id })}
          onRefresh={onRefresh}
        />
      ) : (
        <ProviderCatalog
          api={api}
          providers={providers}
          onEdit={(provider) => setProviderEditor({ mode: 'edit', provider })}
          onRefresh={onRefresh}
        />
      )}

      {modelEditor !== undefined && (
        <ModelEditor
          api={api}
          model={
            modelEditor.mode === 'edit'
              ? models.find((model) => model.id === modelEditor.modelId)
              : undefined
          }
          providers={providers}
          onClose={() => setModelEditor(undefined)}
          onSaved={() => setModelEditor(undefined)}
          onRefresh={onRefresh}
        />
      )}
      {providerEditor !== undefined && (
        <ProviderEditor
          api={api}
          provider={providerEditor.mode === 'edit' ? providerEditor.provider : undefined}
          onClose={() => setProviderEditor(undefined)}
          onSaved={() => setProviderEditor(undefined)}
          onRefresh={onRefresh}
        />
      )}
    </section>
  );
}

function ModelCatalog({
  api,
  models,
  onEdit,
  onRefresh,
}: {
  api: ModelManagementApi;
  models: ModelConfigurationView[];
  onEdit: (model: ModelConfigurationView) => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [pendingId, setPendingId] = useState<string>();
  const [error, setError] = useState<string>();

  const run = async (modelId: string, operation: () => Promise<unknown>): Promise<void> => {
    setPendingId(modelId);
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
    <main className="management-content" role="tabpanel" aria-label="模型">
      <div className="management-toolbar">
        <div>
          <h2>已配置模型</h2>
          <p>为后续 Agent 任务选择已验证的模型、Provider 与推理能力。</p>
        </div>
        <span className="management-count">{models.length} 个配置</span>
      </div>
      {error !== undefined && (
        <div className="form-error management-error" role="alert">
          {error}
        </div>
      )}
      <div className="management-table-scroll">
        <table className="management-table" aria-label="模型配置">
          <thead>
            <tr>
              <th>模型名称</th>
              <th>Provider</th>
              <th>模型 ID</th>
              <th>验证状态</th>
              <th>启用</th>
              <th>默认</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              const pending = pendingId === model.id;
              return (
                <tr key={model.id}>
                  <td>
                    <strong>{model.name}</strong>
                    <small>{model.contextWindowTokens.toLocaleString('en-US')} Token 上下文</small>
                  </td>
                  <td>{model.providerName}</td>
                  <td>
                    <code>{model.modelId}</code>
                  </td>
                  <td>
                    <span className={`management-status is-${model.status}`}>
                      {modelStatusLabel(model.status)}
                    </span>
                  </td>
                  <td>
                    <label className="management-checkbox">
                      <input
                        aria-label={`${model.name} 已启用`}
                        checked={model.enabled}
                        disabled={pending}
                        onChange={(event) =>
                          void run(model.id, () =>
                            api.models.setEnabled(model.id, event.target.checked),
                          )
                        }
                        type="checkbox"
                      />
                      <span>{model.enabled ? '已启用' : '已停用'}</span>
                    </label>
                  </td>
                  <td>
                    <label className="management-checkbox">
                      <input
                        aria-label={`${model.name} 默认模型`}
                        checked={model.isDefault}
                        disabled={pending || !model.enabled}
                        onChange={(event) =>
                          void run(model.id, () =>
                            api.models.setDefault(model.id, event.target.checked),
                          )
                        }
                        type="checkbox"
                      />
                      <span>{model.isDefault ? '默认' : '非默认'}</span>
                    </label>
                  </td>
                  <td>
                    <div className="management-row-actions">
                      <button
                        aria-label={`编辑 ${model.name}`}
                        className="management-text-action"
                        onClick={() => onEdit(model)}
                        type="button"
                      >
                        <Pencil size={13} /> 编辑
                      </button>
                      <button
                        aria-label={`检测 ${model.name}`}
                        className="icon-button"
                        disabled={pending}
                        onClick={() => void run(model.id, () => api.models.test(model.id))}
                        title="检测模型"
                        type="button"
                      >
                        <RefreshCw size={13} className={pending ? 'spin' : ''} />
                      </button>
                      <button
                        aria-label={`删除 ${model.name}`}
                        className="icon-button danger-icon-button"
                        disabled={pending}
                        onClick={() => void run(model.id, () => api.models.remove(model.id))}
                        title="删除模型"
                        type="button"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {models.length === 0 && <div className="management-empty">暂无模型配置。</div>}
    </main>
  );
}

function ModelEditor({
  api,
  model,
  providers,
  onClose,
  onSaved,
  onRefresh,
}: {
  api: ModelManagementApi;
  model: ModelConfigurationView | undefined;
  providers: ProviderProfileView[];
  onClose: () => void;
  onSaved: () => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState<ModelConfigurationInput>(() =>
    model === undefined ? newModel(providers[0]?.id ?? '') : modelInput(model),
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [discoveryTruncated, setDiscoveryTruncated] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState<string>();
  const [modelQuery, setModelQuery] = useState('');
  const [error, setError] = useState<string>();
  const discoveryToken = useRef(0);
  const mounted = useRef(true);
  const selectedProvider = providers.find((provider) => provider.id === draft.providerProfileId);
  const filteredDiscovered = discovered.filter((candidate) =>
    `${candidate.id} ${candidate.displayName ?? ''}`
      .toLocaleLowerCase('en-US')
      .includes(modelQuery.toLocaleLowerCase('en-US')),
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      discoveryToken.current += 1;
    };
  }, []);

  const cancelDiscovery = (): void => {
    if (selectedProvider === undefined) return;
    discoveryToken.current += 1;
    setDiscovering(false);
    setDiscoveryMessage('已取消模型发现');
    setError(undefined);
    void api.providers.cancelDiscovery(selectedProvider.id).catch((caught: unknown) => {
      if (mounted.current) setError(errorMessageZh(caught));
    });
  };

  const close = (): void => {
    if (discovering) cancelDiscovery();
    onClose();
  };

  const discoverModels = async (): Promise<void> => {
    if (selectedProvider === undefined || !selectedProvider.credentialConfigured) return;
    const token = discoveryToken.current + 1;
    discoveryToken.current = token;
    setDiscovering(true);
    setDiscoveryMessage(undefined);
    setError(undefined);
    try {
      const result = await api.providers.discoverModels(selectedProvider.id);
      if (!mounted.current || discoveryToken.current !== token) return;
      setDiscovered(result.models);
      setDiscoveryTruncated(result.truncated);
      setModelQuery('');
      if (result.models.length > 0) {
        setDraft((current) => ({
          ...current,
          modelId: result.models.some((candidate) => candidate.id === current.modelId)
            ? current.modelId
            : result.models[0]!.id,
        }));
      }
      setDiscoveryMessage(`已发现 ${result.models.length} 个模型`);
    } catch (caught) {
      if (mounted.current && discoveryToken.current === token) setError(errorMessageZh(caught));
    } finally {
      if (mounted.current && discoveryToken.current === token) setDiscovering(false);
    }
  };

  const save = async (): Promise<void> => {
    const validationError = validateModel(draft, providers);
    if (validationError !== undefined) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.models.save({
        ...draft,
        name: draft.name.trim(),
        modelId: draft.modelId.trim(),
      });
      await onRefresh();
      onSaved();
    } catch (caught) {
      setError(errorMessageZh(caught));
    } finally {
      setSaving(false);
    }
  };

  const testModel = async (): Promise<void> => {
    if (model === undefined) return;
    setTesting(true);
    setError(undefined);
    try {
      await api.models.test(model.id);
      await onRefresh();
    } catch (caught) {
      setError(errorMessageZh(caught));
    } finally {
      setTesting(false);
    }
  };

  const removeModel = async (): Promise<void> => {
    if (model === undefined) return;
    setError(undefined);
    try {
      await api.models.remove(model.id);
      await onRefresh();
      onSaved();
    } catch (caught) {
      setError(errorMessageZh(caught));
    }
  };

  const setReasoningSupport = (effort: ReasoningEffort, enabled: boolean): void => {
    const supportedReasoningEfforts = enabled
      ? [...new Set([...draft.supportedReasoningEfforts, effort])]
      : draft.supportedReasoningEfforts.filter((item) => item !== effort);
    if (supportedReasoningEfforts.length === 0) return;
    setDraft({
      ...draft,
      supportedReasoningEfforts,
      defaultReasoningEffort: supportedReasoningEfforts.includes(draft.defaultReasoningEffort)
        ? draft.defaultReasoningEffort
        : supportedReasoningEfforts[0]!,
    });
  };

  const modeLabel = model === undefined ? '新建模型配置' : '编辑模型配置';
  return (
    <ManagementDialog
      closeLabel="关闭模型编辑器"
      eyebrow="模型配置"
      label={modeLabel}
      onClose={close}
      title={model === undefined ? '新建模型配置' : `编辑 ${model.name}`}
      footer={
        <>
          <div className="management-dialog-secondary-actions">
            {model !== undefined && (
              <>
                <button
                  className="secondary-button"
                  disabled={testing || saving}
                  onClick={() => void testModel()}
                  type="button"
                >
                  <RefreshCw size={14} className={testing ? 'spin' : ''} />
                  {testing ? '检测中…' : '检测模型'}
                </button>
                <button
                  className="danger-button"
                  disabled={saving || testing}
                  onClick={() => void removeModel()}
                  type="button"
                >
                  <Trash2 size={14} /> 删除模型
                </button>
              </>
            )}
          </div>
          <div className="management-dialog-primary-actions">
            <button className="secondary-button" disabled={saving} onClick={close} type="button">
              取消
            </button>
            <button
              className="primary-button"
              disabled={saving}
              onClick={() => void save()}
              type="button"
            >
              <Save size={14} /> {saving ? '正在保存…' : '保存模型'}
            </button>
          </div>
        </>
      }
    >
      <div className="management-form-grid">
        <label>
          显示名称
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          Provider
          <select
            value={draft.providerProfileId}
            onChange={(event) => {
              setDraft({ ...draft, providerProfileId: event.target.value, modelId: '' });
              setDiscovered([]);
              setDiscoveryMessage(undefined);
              setModelQuery('');
            }}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>

        <div className="management-form-field management-span-two">
          <div className="management-field-heading">
            <label htmlFor="model-id">模型 ID</label>
            <div className="management-field-actions">
              {discovering && (
                <button
                  className="secondary-button compact-button"
                  onClick={cancelDiscovery}
                  type="button"
                >
                  <X size={13} /> 取消拉取
                </button>
              )}
              <button
                className="secondary-button compact-button"
                disabled={
                  selectedProvider === undefined ||
                  !selectedProvider.credentialConfigured ||
                  discovering
                }
                onClick={() => void discoverModels()}
                type="button"
              >
                <Download size={13} /> {discovering ? '拉取中…' : '拉取模型'}
              </button>
            </div>
          </div>
          <input
            id="model-id"
            aria-label="模型 ID"
            value={draft.modelId}
            onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
          />
          {discoveryMessage !== undefined && (
            <p className="management-inline-status" role="status">
              {discoveryMessage}
              {discoveryTruncated ? '，结果已达到 500 条上限' : ''}
            </p>
          )}
          {discovered.length > 0 && (
            <div className="management-discovery-list">
              <label className="management-search-field">
                <Search size={13} />
                <input
                  aria-label="搜索已拉取模型"
                  placeholder="搜索已拉取模型"
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                />
              </label>
              <div aria-label="已拉取模型" className="management-discovery-options" role="listbox">
                {filteredDiscovered.map((candidate) => (
                  <button
                    aria-selected={draft.modelId === candidate.id}
                    key={candidate.id}
                    onClick={() => setDraft({ ...draft, modelId: candidate.id })}
                    role="option"
                    type="button"
                  >
                    <span>{candidate.displayName ?? candidate.id}</span>
                    <code>{candidate.id}</code>
                  </button>
                ))}
                {filteredDiscovered.length === 0 && <p>没有匹配的模型</p>}
              </div>
            </div>
          )}
        </div>

        <label>
          上下文窗口（Token）
          <input
            min={1_024}
            type="number"
            value={draft.contextWindowTokens}
            onChange={(event) =>
              setDraft({ ...draft, contextWindowTokens: Number(event.target.value) })
            }
          />
        </label>
        <label>
          最大输出（Token）
          <input
            min={1}
            type="number"
            value={draft.maxOutputTokens}
            onChange={(event) =>
              setDraft({ ...draft, maxOutputTokens: Number(event.target.value) })
            }
          />
        </label>
        <label className="management-toggle">
          <input
            checked={draft.autoCompact}
            type="checkbox"
            onChange={(event) => setDraft({ ...draft, autoCompact: event.target.checked })}
          />
          <span>自动压缩上下文</span>
        </label>
        <label>
          自动压缩阈值（%）
          <input
            disabled={!draft.autoCompact}
            max={95}
            min={50}
            type="number"
            value={draft.compactThresholdPercent}
            onChange={(event) =>
              setDraft({ ...draft, compactThresholdPercent: Number(event.target.value) })
            }
          />
        </label>
        <label>
          默认推理强度
          <select
            value={draft.defaultReasoningEffort}
            onChange={(event) =>
              setDraft({
                ...draft,
                defaultReasoningEffort: event.target.value as ReasoningEffort,
              })
            }
          >
            {draft.supportedReasoningEfforts.map((effort) => (
              <option key={effort} value={effort}>
                {reasoningEffortLabel(effort)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="management-fieldset management-span-two">
          <legend>支持的推理强度</legend>
          {(['low', 'medium', 'high', 'xhigh'] as const).map((effort) => (
            <label key={effort}>
              <input
                checked={draft.supportedReasoningEfforts.includes(effort)}
                type="checkbox"
                onChange={(event) => setReasoningSupport(effort, event.target.checked)}
              />
              {reasoningEffortLabel(effort)}
            </label>
          ))}
        </fieldset>

        <fieldset className="management-fieldset management-span-two">
          <legend>模型能力</legend>
          {(
            [
              ['responses', 'Responses API'],
              ['streaming', '流式输出'],
              ['toolCalls', 'Tool Call'],
              ['reasoning', '推理'],
            ] as const
          ).map(([capability, label]) => (
            <label key={capability}>
              <input
                checked={Boolean(draft.declaredCapabilities[capability])}
                type="checkbox"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    declaredCapabilities: {
                      ...draft.declaredCapabilities,
                      [capability]: event.target.checked,
                    },
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
      </div>

      {model !== undefined && <ModelValidation model={model} testing={testing} />}
      {error !== undefined && (
        <div className="form-error management-error" role="alert">
          {error}
        </div>
      )}
    </ManagementDialog>
  );
}

function ProviderCatalog({
  api,
  providers,
  onEdit,
  onRefresh,
}: {
  api: ModelManagementApi;
  providers: ProviderProfileView[];
  onEdit: (provider: ProviderProfileView) => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [pendingId, setPendingId] = useState<string>();
  const [error, setError] = useState<string>();

  const remove = async (provider: ProviderProfileView): Promise<void> => {
    setPendingId(provider.id);
    setError(undefined);
    try {
      await api.providers.remove(provider.id);
      await onRefresh();
    } catch (caught) {
      setError(errorMessageZh(caught));
    } finally {
      setPendingId(undefined);
    }
  };

  return (
    <main className="management-content" role="tabpanel" aria-label="Provider">
      <div className="management-toolbar">
        <div>
          <h2>Provider 连接</h2>
          <p>管理真实连接协议、端点和安全保存在 Core 中的凭据。</p>
        </div>
        <span className="management-count">{providers.length} 个连接</span>
      </div>
      {error !== undefined && (
        <div className="form-error management-error" role="alert">
          {error}
        </div>
      )}
      <div className="provider-card-grid">
        {providers.map((provider) => {
          const pending = pendingId === provider.id;
          return (
            <article className="provider-card" key={provider.id}>
              <div className="provider-card-heading">
                <div>
                  <span className="provider-card-icon" aria-hidden="true">
                    {provider.protocol === 'anthropic_messages' ? 'A' : 'O'}
                  </span>
                  <div>
                    <h3>{provider.name}</h3>
                    <span>{providerProtocolLabel(provider.protocol)}</span>
                  </div>
                </div>
                <span
                  className={`management-status ${
                    provider.credentialConfigured ? 'is-available' : 'is-unverified'
                  }`}
                >
                  {provider.credentialConfigured ? '凭据已配置' : '未配置凭据'}
                </span>
              </div>
              <code className="provider-card-url">{provider.baseUrl}</code>
              <dl className="provider-card-details">
                <div>
                  <dt>超时</dt>
                  <dd>{(provider.timeoutMs ?? 30_000).toLocaleString('en-US')} ms</dd>
                </div>
                <div>
                  <dt>Headers</dt>
                  <dd>{Object.keys(provider.extraHeaders ?? {}).length} 条</dd>
                </div>
              </dl>
              <div className="provider-card-actions">
                <button
                  aria-label={`编辑 ${provider.name}`}
                  className="secondary-button"
                  onClick={() => onEdit(provider)}
                  type="button"
                >
                  <Pencil size={14} /> 编辑
                </button>
                <button
                  aria-label={`删除 ${provider.name}`}
                  className="icon-button danger-icon-button"
                  disabled={pending}
                  onClick={() => void remove(provider)}
                  title="删除 Provider"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {providers.length === 0 && <div className="management-empty">暂无 Provider 连接。</div>}
    </main>
  );
}

function ProviderEditor({
  api,
  provider,
  onClose,
  onSaved,
  onRefresh,
}: {
  api: ModelManagementApi;
  provider: ProviderProfileView | undefined;
  onClose: () => void;
  onSaved: () => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState<ProviderProfileInput>(() =>
    provider === undefined ? newProvider() : providerInput(provider),
  );
  const [headers, setHeaders] = useState(() =>
    JSON.stringify(provider?.extraHeaders ?? {}, null, 2),
  );
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [headersError, setHeadersError] = useState<string>();
  const [error, setError] = useState<string>();
  const modeLabel = provider === undefined ? '新建 Provider' : '编辑 Provider';

  const save = async (): Promise<void> => {
    let extraHeaders: Record<string, string>;
    try {
      extraHeaders = parseHeaders(headers);
      setHeadersError(undefined);
    } catch (caught) {
      setHeadersError(errorMessageZh(caught));
      return;
    }
    const validationError = validateProvider(draft);
    if (validationError !== undefined) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.providers.save(
        {
          ...draft,
          name: draft.name.trim(),
          baseUrl: draft.baseUrl.trim(),
          extraHeaders,
          timeoutMs: draft.timeoutMs ?? 30_000,
        },
        apiKey.trim() || undefined,
      );
      await onRefresh();
      onSaved();
    } catch (caught) {
      setError(errorMessageZh(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ManagementDialog
      closeLabel="关闭 Provider 编辑器"
      eyebrow="Provider 连接"
      label={modeLabel}
      onClose={onClose}
      title={provider === undefined ? '新建 Provider' : `编辑 ${provider.name}`}
      footer={
        <div className="management-dialog-primary-actions">
          <button className="secondary-button" disabled={saving} onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => void save()}
            type="button"
          >
            <Save size={14} /> {saving ? '正在保存…' : '保存 Provider'}
          </button>
        </div>
      }
    >
      <div className="management-form-grid">
        <label>
          名称
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          协议
          <select
            value={draft.protocol}
            onChange={(event) =>
              setDraft({
                ...draft,
                protocol: event.target.value as ProviderProfileInput['protocol'],
              })
            }
          >
            <option value="openai_responses">OpenAI Responses</option>
            <option value="openai_chat_completions">OpenAI-compatible Chat Completions</option>
            <option value="anthropic_messages">Anthropic Messages</option>
          </select>
        </label>
        <label className="management-span-two">
          Base URL
          <input
            value={draft.baseUrl}
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
          />
        </label>
        <label>
          超时（毫秒）
          <input
            min={1}
            type="number"
            value={draft.timeoutMs ?? 30_000}
            onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) })}
          />
        </label>
        <label>
          API Key
          <input
            autoComplete="new-password"
            placeholder={provider?.credentialConfigured ? '留空以保留当前凭据' : ''}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <label className="management-span-two">
          额外请求头（JSON）
          <textarea
            rows={6}
            value={headers}
            onChange={(event) => {
              setHeaders(event.target.value);
              setHeadersError(undefined);
            }}
          />
        </label>
      </div>
      <div className="management-security-note">
        <ShieldAlert size={15} />
        <span>保存后凭据只通过 Preload 提交给 Core，已保存的 API Key 不会回显。</span>
      </div>
      {headersError !== undefined && (
        <div className="form-error management-error" role="alert">
          {headersError}
        </div>
      )}
      {error !== undefined && (
        <div className="form-error management-error" role="alert">
          {error}
        </div>
      )}
    </ManagementDialog>
  );
}

function ModelValidation({
  model,
  testing,
}: {
  model: ModelConfigurationView;
  testing: boolean;
}): JSX.Element {
  const validation = testing
    ? {
        status: 'validating' as const,
        attempt: model.validation.status === 'unverified' ? 1 : model.validation.attempt + 1,
      }
    : model.validation;
  return (
    <section className={`management-validation is-${validation.status}`} aria-label="模型验证状态">
      <div>
        <span>验证状态</span>
        <strong>{modelStatusLabel(validation.status)}</strong>
      </div>
      {validation.status === 'unverified' && <p>该模型尚未验证。</p>}
      {validation.status === 'validating' && <p>正在检查模型连接、流式输出与 Tool Call。</p>}
      {validation.status === 'available' && (
        <p>
          <Check size={13} /> 已验证 · 第 {validation.attempt} 次 ·{' '}
          {formatDateTime(validation.checkedAt)}
        </p>
      )}
      {validation.status === 'unavailable' && (
        <p>
          {validation.reason} · 第 {validation.attempt} 次 · {formatDateTime(validation.checkedAt)}
        </p>
      )}
    </section>
  );
}

function ManagementDialog({
  label,
  eyebrow,
  title,
  closeLabel,
  onClose,
  children,
  footer,
}: {
  label: string;
  eyebrow: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}): JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="management-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section aria-label={label} aria-modal="true" className="management-dialog" role="dialog">
        <header className="management-dialog-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button
            aria-label={closeLabel}
            className="icon-button"
            onClick={onClose}
            title={closeLabel}
            type="button"
          >
            <X size={16} />
          </button>
        </header>
        <div className="management-dialog-body">{children}</div>
        <footer className="management-dialog-footer">{footer}</footer>
      </section>
    </div>
  );
}

function validateModel(
  draft: ModelConfigurationInput,
  providers: ProviderProfileView[],
): string | undefined {
  if (!draft.name.trim()) return '请输入模型名称。';
  if (!providers.some((provider) => provider.id === draft.providerProfileId)) {
    return '请先选择有效的 Provider 连接。';
  }
  if (!draft.modelId.trim()) return '请输入模型 ID。';
  if (!Number.isSafeInteger(draft.contextWindowTokens) || draft.contextWindowTokens < 1_024) {
    return '上下文窗口必须是不小于 1024 的整数。';
  }
  if (!Number.isSafeInteger(draft.maxOutputTokens) || draft.maxOutputTokens < 1) {
    return '最大输出必须是正整数。';
  }
  if (draft.contextWindowTokens <= draft.maxOutputTokens) {
    return '上下文窗口必须大于最大输出 Token。';
  }
  if (!draft.supportedReasoningEfforts.includes(draft.defaultReasoningEffort)) {
    return '默认推理强度必须包含在支持列表中。';
  }
  return undefined;
}

function validateProvider(draft: ProviderProfileInput): string | undefined {
  if (!draft.name.trim()) return '请输入 Provider 名称。';
  try {
    new URL(draft.baseUrl.trim());
  } catch {
    return 'Base URL 必须是有效的绝对地址。';
  }
  if (!Number.isSafeInteger(draft.timeoutMs ?? 30_000) || (draft.timeoutMs ?? 30_000) < 1) {
    return '超时必须是正整数。';
  }
  return undefined;
}

function parseHeaders(value: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('额外请求头必须是 JSON 对象');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('额外请求头必须是 JSON 对象');
  }
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(parsed)) {
    if (typeof header !== 'string') throw new Error(`请求头 ${name} 的值必须是字符串`);
    headers[name] = header;
  }
  return headers;
}

function newModel(providerProfileId: string): ModelConfigurationInput {
  return {
    id: crypto.randomUUID(),
    name: '新模型',
    providerProfileId,
    modelId: '',
    declaredCapabilities: { responses: true, streaming: true, toolCalls: true, reasoning: true },
    contextWindowTokens: 128_000,
    maxOutputTokens: 8_192,
    autoCompact: true,
    compactThresholdPercent: 80,
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
  };
}

function modelInput(model: ModelConfigurationView): ModelConfigurationInput {
  return {
    id: model.id,
    name: model.name,
    providerProfileId: model.providerProfileId,
    modelId: model.modelId,
    declaredCapabilities: { ...model.declaredCapabilities },
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    autoCompact: model.autoCompact,
    compactThresholdPercent: model.compactThresholdPercent,
    supportedReasoningEfforts: [...model.supportedReasoningEfforts],
    defaultReasoningEffort: model.defaultReasoningEffort,
  };
}

function newProvider(): ProviderProfileInput {
  return {
    id: crypto.randomUUID(),
    name: '新 Provider',
    protocol: 'openai_chat_completions',
    baseUrl: 'https://api.openai.com/v1',
    extraHeaders: {},
    timeoutMs: 30_000,
  };
}

function providerInput(provider: ProviderProfileView): ProviderProfileInput {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    extraHeaders: { ...(provider.extraHeaders ?? {}) },
    ...(provider.timeoutMs === undefined ? {} : { timeoutMs: provider.timeoutMs }),
  };
}

function modelStatusLabel(status: ModelConfigurationView['status'] | 'validating'): string {
  if (status === 'available') return '可用';
  if (status === 'unavailable') return '不可用';
  if (status === 'validating') return '检测中';
  return '未验证';
}

function providerProtocolLabel(provider: ProviderProfileView['protocol']): string {
  if (provider === 'openai_responses') return 'OpenAI Responses';
  if (provider === 'openai_chat_completions') return 'OpenAI Chat Completions';
  return 'Anthropic Messages';
}

function reasoningEffortLabel(value: ReasoningEffort): string {
  return value;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
