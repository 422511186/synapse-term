import { AlertCircle, ArrowLeft, Palette, RotateCw, Server, Settings2 } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';

import synapseTermLogoUrl from '../assets/synapse-term-logo.svg';
import { GeneralSettingsView, McpSettingsView } from '../mcp/mcp-settings-section.js';
import { ThemeSettingsView } from '../theme/theme-settings-view.js';
import { UpdateSettings } from './update-settings.js';
import type {
  GeneralSettings,
  McpApprovalMode,
  McpRuntimeStatus,
  McpSettings,
  SharedMcpSession,
} from '../../shared/contracts.js';
import type { DesktopApi } from '../../preload/preload-api.js';

export type SettingsCategoryId = 'general' | 'appearance' | 'mcp';

const SETTINGS_CATEGORIES: ReadonlyArray<{
  id: SettingsCategoryId;
  label: string;
  icon: typeof Settings2;
}> = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'mcp', label: 'MCP 服务', icon: Server },
  { id: 'general', label: '通用', icon: Settings2 },
];

export function SettingsWorkspace({
  api,
  activeCategory,
  onBack,
  onSelectCategory,
  themeScheme,
}: {
  api?: DesktopApi | undefined;
  activeCategory: SettingsCategoryId;
  onBack: () => void;
  onSelectCategory: (category: SettingsCategoryId) => void;
  themeScheme?: 'light' | 'dark' | undefined;
}): JSX.Element {
  const [settings, setSettings] = useState<McpSettings | undefined>();
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings | undefined>();
  const [status, setStatus] = useState<McpRuntimeStatus>({ running: false });
  const [shared, setShared] = useState<SharedMcpSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (api === undefined) return;
    let disposed = false;
    setError(undefined);
    void Promise.all([api.mcp.getSettings(), api.general.getSettings()])
      .then(([nextMcpSettings, nextGeneralSettings]) => {
        if (disposed) return undefined;
        setSettings(nextMcpSettings);
        setGeneralSettings(nextGeneralSettings);
        return Promise.all([api.mcp.getStatus(), api.mcp.listSharedSessions()]);
      })
      .then((runtimeState) => {
        if (disposed || runtimeState === undefined) return;
        const [nextStatus, nextShared] = runtimeState;
        setStatus(nextStatus);
        setShared(nextShared);
      })
      .catch(() => {
        if (!disposed) setError('无法加载设置，请重试。');
      });
    return () => {
      disposed = true;
    };
  }, [api, loadAttempt]);

  const refreshMcpState = async (): Promise<void> => {
    if (api === undefined) return;
    const [nextStatus, nextShared] = await Promise.all([
      api.mcp.getStatus(),
      api.mcp.listSharedSessions(),
    ]);
    setStatus(nextStatus);
    setShared(nextShared);
  };

  const apply = async (action: Promise<McpSettings>): Promise<void> => {
    if (api === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const nextSettings = await action;
      setSettings(nextSettings);
      await refreshMcpState();
    } catch {
      setError('未能完成 MCP 设置操作，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const applyGeneral = async (action: Promise<GeneralSettings>): Promise<void> => {
    if (api === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      setGeneralSettings(await action);
    } catch {
      setError('未能保存设置，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return (
    <div
      className="settings-workspace-shell absolute inset-0 z-30 flex min-h-0 flex-col"
      data-desktop-platform={isMac ? 'darwin' : undefined}
      data-testid="settings-workspace"
    >
      <header className="settings-workspace-header">
        <button
          aria-label="返回工作区"
          className="settings-back-button"
          onClick={onBack}
          title="返回工作区"
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          返回工作区
        </button>
        <div className="settings-workspace-brand">
          <img alt="Synapse Term logo" height={24} src={synapseTermLogoUrl} width={24} />
          <span>Synapse Term</span>
          <h1>设置</h1>
        </div>
      </header>
      <main className="settings-workspace-main">
        <div className="settings-workspace-body">
          <nav aria-label="设置分类" className="settings-nav">
            {SETTINGS_CATEGORIES.map((category) => {
              const Icon = category.icon;
              const active = activeCategory === category.id;
              return (
                <button
                  aria-current={active ? 'page' : undefined}
                  className={`settings-nav-item ${active ? 'is-active' : ''}`}
                  key={category.id}
                  onClick={() => onSelectCategory(category.id)}
                  type="button"
                >
                  <Icon aria-hidden="true" className="settings-nav-icon" size={16} />
                  <span className="settings-nav-title">{category.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="settings-panel" data-testid="settings-topic-content" key={activeCategory}>
            {error && (
              <div className="settings-error" role="alert">
                <AlertCircle aria-hidden="true" size={16} />
                <span>{error}</span>
                <button
                  className="mcp-action-button"
                  onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                  type="button"
                >
                  <RotateCw aria-hidden="true" size={14} />
                  重新加载
                </button>
              </div>
            )}
            {settings === undefined || generalSettings === undefined ? (
              !error && (
                <div className="settings-loading">
                  <span className="settings-loading-spinner" aria-hidden="true" />
                  设置加载中…
                </div>
              )
            ) : (
              <>
                {activeCategory === 'general' && (
                  <>
                    <div className="settings-page-heading">
                      <h2>通用</h2>
                    </div>
                    {api && <UpdateSettings api={api.updates} isMac={api.platform === 'darwin'} />}
                    <GeneralSettingsView
                      busy={busy}
                      onToggleHideProbeEcho={(hide) =>
                        api &&
                        void applyGeneral(
                          api.general.updateSettings({ hideCompletionProbeEcho: hide }),
                        )
                      }
                      settings={generalSettings}
                    />
                  </>
                )}
                {activeCategory === 'appearance' && (
                  <ThemeSettingsView
                    busy={busy}
                    onSetCustomTheme={(customTheme) =>
                      api && void applyGeneral(api.general.updateSettings({ customTheme }))
                    }
                    onSetMode={(themeMode) =>
                      api && void applyGeneral(api.general.updateSettings({ themeMode }))
                    }
                    scheme={themeScheme ?? 'dark'}
                    settings={generalSettings}
                  />
                )}
                {activeCategory === 'mcp' && (
                  <McpSettingsView
                    busy={busy}
                    onRegenerateToken={() => api && void apply(api.mcp.regenerateToken())}
                    onRevokeToken={() => api && void apply(api.mcp.revokeToken())}
                    onSetMode={(approvalMode: McpApprovalMode) =>
                      api && void apply(api.mcp.updateSettings({ approvalMode }))
                    }
                    onSetPort={(port) => api && void apply(api.mcp.updateSettings({ port }))}
                    onToggleEnabled={(enabled) =>
                      api && void apply(api.mcp.updateSettings({ enabled }))
                    }
                    onToggleShowToken={() => setShowToken((visible) => !visible)}
                    onUnshare={(sessionId) => {
                      if (api === undefined) return;
                      setBusy(true);
                      setError(undefined);
                      void api.mcp
                        .unshareSession(sessionId)
                        .then(() => refreshMcpState())
                        .catch(() => setError('未能取消共享，请重试。'))
                        .finally(() => setBusy(false));
                    }}
                    shared={shared}
                    settings={settings}
                    showToken={showToken}
                    status={status}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
