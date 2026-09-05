import { ArrowLeft, Palette, Server, Settings2 } from 'lucide-react';
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

type SettingsCategoryId = 'general' | 'appearance' | 'mcp';

const SETTINGS_CATEGORIES: ReadonlyArray<{
  id: SettingsCategoryId;
  label: string;
  description: string;
  icon: typeof Settings2;
}> = [
  { id: 'general', label: '通用', description: '终端显示与通用行为', icon: Settings2 },
  { id: 'appearance', label: '外观', description: '主题、模式与配色', icon: Palette },
  { id: 'mcp', label: 'MCP 服务', description: '内嵌端点与会话共享', icon: Server },
];

export function SettingsWorkspace({
  api,
  onBack,
  themeScheme,
}: {
  api?: DesktopApi | undefined;
  onBack: () => void;
  themeScheme?: 'light' | 'dark' | undefined;
}): JSX.Element {
  const [settings, setSettings] = useState<McpSettings | undefined>();
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings | undefined>();
  const [status, setStatus] = useState<McpRuntimeStatus>({ running: false });
  const [shared, setShared] = useState<SharedMcpSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>('general');

  useEffect(() => {
    if (api === undefined) return;
    void Promise.all([api.mcp.getSettings(), api.general.getSettings()])
      .then(([nextMcpSettings, nextGeneralSettings]) => {
        setSettings(nextMcpSettings);
        setGeneralSettings(nextGeneralSettings);
        return Promise.all([api.mcp.getStatus(), api.mcp.listSharedSessions()]);
      })
      .then(([nextStatus, nextShared]) => {
        setStatus(nextStatus);
        setShared(nextShared);
      })
      .catch(() => undefined);
  }, [api]);

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
    try {
      const nextSettings = await action;
      setSettings(nextSettings);
      await refreshMcpState();
    } finally {
      setBusy(false);
    }
  };

  const applyGeneral = async (action: Promise<GeneralSettings>): Promise<void> => {
    if (api === undefined) return;
    setBusy(true);
    try {
      setGeneralSettings(await action);
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
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          返回工作区
        </button>
        <div className="settings-workspace-brand">
          <img alt="Synapse Term logo" height={36} src={synapseTermLogoUrl} width={36} />
          <div>
            <p>Synapse Term</p>
            <h1>设置工作区</h1>
          </div>
        </div>
        <div className="settings-workspace-meta">
          <span>LOCAL DESKTOP</span>
          <span className="settings-workspace-meta-dot" />
          <span>应用设置</span>
        </div>
      </header>
      <main className="settings-workspace-main">
        {settings === undefined || generalSettings === undefined ? (
          <div className="settings-loading" data-testid="settings-topic-content">
            <span className="settings-loading-spinner" aria-hidden="true" />
            设置加载中…
          </div>
        ) : (
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
                    onClick={() => setActiveCategory(category.id)}
                    type="button"
                  >
                    <Icon aria-hidden="true" className="settings-nav-icon" size={16} />
                    <span className="settings-nav-copy">
                      <span className="settings-nav-title">{category.label}</span>
                      <span className="settings-nav-description">{category.description}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
            <div className="settings-panel" data-testid="settings-topic-content">
              {activeCategory === 'general' && (
                <>
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
                  {api && <UpdateSettings api={api.updates} isMac={api.platform === 'darwin'} />}
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
                    void api.mcp
                      .unshareSession(sessionId)
                      .then(() => refreshMcpState())
                      .catch(() => undefined)
                      .finally(() => setBusy(false));
                  }}
                  shared={shared}
                  settings={settings}
                  showToken={showToken}
                  status={status}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
