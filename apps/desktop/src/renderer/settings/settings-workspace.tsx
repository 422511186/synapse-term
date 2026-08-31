import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';

import synapseTermLogoUrl from '../assets/synapse-term-logo.svg';
import { GeneralSettingsView, McpSettingsView } from '../mcp/mcp-settings-section.js';
import { ThemeSettingsView } from '../theme/theme-settings-view.js';
import type {
  GeneralSettings,
  McpApprovalMode,
  McpRuntimeStatus,
  McpSettings,
  SharedMcpSession,
} from '../../shared/contracts.js';
import type { DesktopApi } from '../../preload/preload-api.js';

export function SettingsWorkspace({
  api,
  onBack,
}: {
  api?: DesktopApi | undefined;
  onBack: () => void;
}): JSX.Element {
  const [settings, setSettings] = useState<McpSettings | undefined>();
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings | undefined>();
  const [status, setStatus] = useState<McpRuntimeStatus>({ running: false });
  const [shared, setShared] = useState<SharedMcpSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);

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
          <>
            <GeneralSettingsView
              busy={busy}
              onToggleHideProbeEcho={(hide) =>
                api &&
                void applyGeneral(api.general.updateSettings({ hideCompletionProbeEcho: hide }))
              }
              settings={generalSettings}
            />
            <ThemeSettingsView
              busy={busy}
              onSetCustomTheme={(customTheme) =>
                api && void applyGeneral(api.general.updateSettings({ customTheme }))
              }
              onSetMode={(themeMode) =>
                api && void applyGeneral(api.general.updateSettings({ themeMode }))
              }
              settings={generalSettings}
            />
            <McpSettingsView
              busy={busy}
              onRegenerateToken={() => api && void apply(api.mcp.regenerateToken())}
              onRevokeToken={() => api && void apply(api.mcp.revokeToken())}
              onSetMode={(approvalMode: McpApprovalMode) =>
                api && void apply(api.mcp.updateSettings({ approvalMode }))
              }
              onSetPort={(port) => api && void apply(api.mcp.updateSettings({ port }))}
              onToggleEnabled={(enabled) => api && void apply(api.mcp.updateSettings({ enabled }))}
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
          </>
        )}
      </main>
    </div>
  );
}
