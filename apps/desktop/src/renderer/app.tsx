import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { List, Pencil, Plus, Radio, Search, Settings, Share2, X } from 'lucide-react';

import type {
  DesktopApi,
  McpApprovalDecision,
  McpApprovalRequest,
  McpExecutionEvent,
  McpRuntimeStatus,
  SessionEnvironment,
  SessionLaunchInput,
  SessionSummary,
  TerminalOutputEvent,
  ThemeState,
} from '../preload/preload-api.js';
import { ConfirmDialog } from './feedback/index.js';
import { errorMessageZh } from './i18n/zh-cn.js';
import { createMockDesktopApi } from './mock-api.js';
import { ApprovalCard } from './mcp/approval-card.js';
import { ShareDialog } from './mcp/share-dialog.js';
import { buildSessionLaunch } from './session-launch.js';
import { chooseInitialSessionId } from './session-selection.js';
import { getSessionAvailability } from './session-status.js';
import { AllSessionsPopover, NewSessionModal } from './sessions/index.js';
import { SettingsWorkspace } from './settings/settings-workspace.js';
import { applyThemeToDocument } from './theme/theme-palette.js';
import { TerminalView } from './terminal/terminal-view.js';
import synapseTermLogoUrl from './assets/synapse-term-logo.svg';

let browserMockApi: DesktopApi | undefined;
const EMPTY_OUTPUT_EVENTS: readonly TerminalOutputEvent[] = [];

const DEFAULT_THEME_STATE: ThemeState = Object.freeze({
  mode: 'system',
  scheme: 'dark',
  customTheme: Object.freeze({
    enabled: false,
    background: '#09090b',
    foreground: '#fafafa',
    accent: '#fafafa',
  }),
});

function getApi(): DesktopApi {
  if (window.synapseTerm !== undefined) return window.synapseTerm;
  browserMockApi ??= createMockDesktopApi();
  return browserMockApi;
}

type ViewMode = 'workspace' | 'settings';

interface RenameState {
  sessionId: string;
  value: string;
}

interface ContextMenuState {
  sessionId: string;
  x: number;
  y: number;
}

interface ShareDialogState {
  sessionId: string;
  terminalType: string;
  title: string;
  mcpStatus: McpRuntimeStatus;
}

type CloseRangeDirection = 'left' | 'right';

export function App(): JSX.Element {
  const api = useMemo(getApi, []);
  const isMac =
    api.platform === 'darwin' ||
    (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform));
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [environment, setEnvironment] = useState<SessionEnvironment>({ home: '', shells: [] });
  const [view, setView] = useState<ViewMode>('workspace');
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [isAllSessionsOpen, setIsAllSessionsOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [terminalSearch, setTerminalSearch] = useState('');
  const [renameState, setRenameState] = useState<RenameState | undefined>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | undefined>();
  const [confirmClose, setConfirmClose] = useState<SessionSummary | undefined>();
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const [confirmCloseRange, setConfirmCloseRange] = useState<
    { sessionId: string; direction: CloseRangeDirection } | undefined
  >();
  const [approvalRequest, setApprovalRequest] = useState<McpApprovalRequest | undefined>();
  const [executions, setExecutions] = useState(new Map<string, McpExecutionEvent>());
  const [shareDialog, setShareDialog] = useState<ShareDialogState | undefined>();
  const [busy, setBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string>();
  const [themeState, setThemeState] = useState<ThemeState | undefined>(undefined);
  const terminalSearchInputRef = useRef<HTMLInputElement>(null);
  const outputHistoryRef = useRef(new Map<string, TerminalOutputEvent[]>());

  const refreshSessions = useCallback(async (): Promise<void> => {
    try {
      setSessions(await api.sessions.list());
    } catch (error) {
      setRuntimeError(errorMessageZh(error));
    }
  }, [api]);

  useEffect(() => {
    void refreshSessions();
    void api.sessions
      .environment()
      .then(setEnvironment)
      .catch((error: unknown) => setRuntimeError(errorMessageZh(error)));
  }, [api, refreshSessions]);

  useEffect(
    () =>
      api.sessions.onChanged((session) => {
        setSessions((current) => {
          const index = current.findIndex((item) => item.id === session.id);
          if (index < 0) return [...current, session];
          const next = [...current];
          next[index] = session;
          return next;
        });
      }),
    [api],
  );

  useEffect(
    () =>
      api.mcp.onApprovalClosed(({ id }) => {
        setApprovalRequest((current) => (current?.id === id ? undefined : current));
      }),
    [api],
  );

  useEffect(
    () =>
      api.mcp.onApproval((request) => {
        setApprovalRequest(request);
      }),
    [api],
  );

  useEffect(
    () =>
      api.mcp.onExecution((event) => {
        setExecutions((current) => {
          const next = new Map(current);
          if (event.phase === 'finished') next.delete(event.sessionId);
          else next.set(event.sessionId, event);
          return next;
        });
      }),
    [api],
  );

  useEffect(() => {
    if (sessions.some((session) => session.id === activeSessionId)) return;
    setActiveSessionId(chooseInitialSessionId(sessions, activeSessionId));
  }, [sessions, activeSessionId]);

  useEffect(() => {
    const handleTerminalSearchShortcut = (event: KeyboardEvent): void => {
      if (view !== 'workspace') return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        terminalSearchInputRef.current?.focus();
        terminalSearchInputRef.current?.select();
      }
      if (event.key === 'Escape') {
        setContextMenu(undefined);
        setRenameState(undefined);
      }
    };
    window.addEventListener('keydown', handleTerminalSearchShortcut, true);
    return () => window.removeEventListener('keydown', handleTerminalSearchShortcut, true);
  }, [view]);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];

  useEffect(
    () =>
      api.terminal.onOutput((event) => {
        const list = outputHistoryRef.current.get(event.sessionId) ?? [];
        if (list.length >= 4096) list.shift();
        list.push(event);
        outputHistoryRef.current.set(event.sessionId, list);
      }),
    [api],
  );

  useEffect(() => {
    void api.theme
      .getState()
      .then(setThemeState)
      .catch(() => undefined);
    return api.theme.onChanged(setThemeState);
  }, [api]);

  useEffect(() => {
    if (themeState === undefined) return;
    applyThemeToDocument(themeState);
  }, [themeState]);

  const createSession = useCallback(
    async (
      title: string,
      shellKind: SessionEnvironment['shells'][number]['kind'],
    ): Promise<void> => {
      const shell = environment.shells.find((candidate) => candidate.kind === shellKind);
      if (shell === undefined) throw new Error('未找到所选 Shell');
      const launch: SessionLaunchInput = buildSessionLaunch(
        title,
        environment.home,
        shell,
        sessions,
      );
      const created = await api.sessions.create(launch);
      setActiveSessionId(created.id);
      setIsNewSessionOpen(false);
    },
    [api, environment, sessions],
  );

  const submitRename = useCallback(async (): Promise<void> => {
    if (renameState === undefined) return;
    setBusy(true);
    try {
      await api.sessions.rename(renameState.sessionId, renameState.value);
      setRenameState(undefined);
    } catch (error) {
      setRuntimeError(errorMessageZh(error));
    } finally {
      setBusy(false);
    }
  }, [api, renameState]);

  const closeSession = useCallback(
    async (sessionId: string): Promise<void> => {
      setConfirmClose(undefined);
      try {
        const closed = await api.sessions.close(sessionId);
        if (!closed) return;
        outputHistoryRef.current.delete(sessionId);
        setSessions((current) => current.filter((session) => session.id !== sessionId));
        if (activeSessionId === sessionId) setActiveSessionId('');
      } catch (error) {
        setRuntimeError(errorMessageZh(error));
      }
    },
    [api, activeSessionId],
  );

  const closeAllSessions = useCallback(async (): Promise<void> => {
    setConfirmCloseAll(false);
    const ids = sessions.map((session) => session.id);
    try {
      await Promise.all(ids.map((id) => api.sessions.close(id)));
      outputHistoryRef.current.clear();
      setSessions([]);
      setActiveSessionId('');
    } catch (error) {
      setRuntimeError(errorMessageZh(error));
    }
  }, [api, sessions]);

  const closeRangeSessions = useCallback(async (): Promise<void> => {
    if (confirmCloseRange === undefined) return;
    const { sessionId, direction } = confirmCloseRange;
    setConfirmCloseRange(undefined);
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index < 0) return;
    const targetIds = sessions
      .filter((_, itemIndex) => (direction === 'left' ? itemIndex < index : itemIndex > index))
      .map((session) => session.id);
    try {
      await Promise.all(targetIds.map((id) => api.sessions.close(id)));
      const targetSet = new Set(targetIds);
      for (const id of targetIds) outputHistoryRef.current.delete(id);
      setSessions((current) => current.filter((session) => !targetSet.has(session.id)));
      if (targetSet.has(activeSessionId)) setActiveSessionId('');
    } catch (error) {
      setRuntimeError(errorMessageZh(error));
    }
  }, [api, sessions, confirmCloseRange, activeSessionId]);

  const dispatchSearch = (value: string): void => {
    setTerminalSearch(value);
    window.dispatchEvent(new CustomEvent('terminal-search', { detail: value }));
  };

  const openRenameFromContextMenu = (): void => {
    if (contextMenu === undefined) return;
    const session = sessions.find((candidate) => candidate.id === contextMenu.sessionId);
    if (session !== undefined) setRenameState({ sessionId: session.id, value: session.title });
    setContextMenu(undefined);
  };

  const shareFromContextMenu = async (): Promise<void> => {
    if (contextMenu === undefined) return;
    const sessionId = contextMenu.sessionId;
    const session = sessions.find((candidate) => candidate.id === sessionId);
    setContextMenu(undefined);
    if (session === undefined) return;
    try {
      await api.mcp.shareSession(sessionId);
      const mcpStatus = await api.mcp.getStatus();
      setShareDialog({
        sessionId,
        terminalType: session.terminalType,
        title: session.title,
        mcpStatus,
      });
    } catch (error) {
      setRuntimeError(errorMessageZh(error));
    }
  };

  const decideApproval = async (decision: McpApprovalDecision): Promise<void> => {
    if (approvalRequest === undefined) return;
    try {
      await api.mcp.decideApproval(approvalRequest.id, decision);
    } finally {
      setApprovalRequest(undefined);
    }
  };

  const closeCurrentFromContextMenu = (): void => {
    if (contextMenu === undefined) return;
    const session = sessions.find((candidate) => candidate.id === contextMenu.sessionId);
    setContextMenu(undefined);
    if (session !== undefined) setConfirmClose(session);
  };

  const closeRangeFromContextMenu = (direction: CloseRangeDirection): void => {
    if (contextMenu === undefined) return;
    const { sessionId } = contextMenu;
    setContextMenu(undefined);
    setConfirmCloseRange({ sessionId, direction });
  };

  return (
    <div
      className="prototype-shell flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground"
      data-desktop-platform={isMac ? 'darwin' : undefined}
    >
      {view === 'workspace' ? (
        <>
          <header className="prototype-header flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
            <div className="prototype-brand flex shrink-0 items-center gap-3 border-r border-border pr-6">
              <img
                alt="Synapse Term logo"
                className="h-9 w-9"
                height={36}
                src={synapseTermLogoUrl}
                width={36}
              />
              <span
                className="prototype-brand-name bg-clip-text text-[15px] font-bold tracking-tight text-transparent"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, var(--foreground), color-mix(in oklab, var(--foreground) 60%, transparent))',
                }}
              >
                Synapse Term
              </span>
            </div>

            <div className="session-tab-strip relative z-50 flex min-w-0 flex-1 items-center">
              <div
                aria-label="终端会话"
                className="session-tab-list flex min-w-0 flex-1"
                role="tablist"
              >
                {sessions.map((session) => {
                  const availability = getSessionAvailability(session);
                  return (
                    <div
                      className={`session-tab ${session.id === activeSessionId ? 'is-active' : ''}`}
                      key={session.id}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setContextMenu({
                          sessionId: session.id,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    >
                      <button
                        aria-controls="active-terminal-panel"
                        aria-label={`${session.title} ${session.terminalType}`}
                        aria-selected={session.id === activeSessionId}
                        className="session-tab-select"
                        onClick={() => setActiveSessionId(session.id)}
                        role="tab"
                        title={`${session.title} · ${session.terminalType}`}
                        type="button"
                      >
                        <span
                          aria-label={availability.label}
                          className={`session-status-dot is-${availability.tone}`}
                          title={availability.label}
                        />
                        <span className="session-tab-copy-block">
                          <span className="session-tab-title">{session.title}</span>
                          <span className="session-tab-type">{session.terminalType}</span>
                        </span>
                        {executions.has(session.id) && (
                          <Radio aria-label="外部执行中" className="text-amber-300" size={12} />
                        )}
                      </button>
                      <button
                        aria-label={`关闭 ${session.title}`}
                        className="session-tab-close"
                        onClick={(event) => {
                          event.stopPropagation();
                          setConfirmClose(session);
                        }}
                        title={`关闭 ${session.title}`}
                        type="button"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="session-tab-tools flex shrink-0 items-center" role="group">
                <button
                  aria-label="新建终端会话"
                  className="session-tab-tool"
                  onClick={() => setIsNewSessionOpen(true)}
                  title="新建终端会话"
                  type="button"
                >
                  <Plus size={16} />
                </button>
                <button
                  aria-expanded={isAllSessionsOpen}
                  aria-label="全部会话"
                  className="session-tab-tool session-tab-tool-wide"
                  onClick={() => setIsAllSessionsOpen((open) => !open)}
                  title="全部会话"
                  type="button"
                >
                  <List size={16} />
                  <span className="session-action-label">全部会话</span>
                </button>
              </div>

              {contextMenu !== undefined && (
                <div
                  aria-label="会话操作菜单"
                  className="session-context-menu"
                  role="menu"
                  style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                  <button onClick={openRenameFromContextMenu} role="menuitem" type="button">
                    <Pencil size={14} /> 重命名
                  </button>
                  <button onClick={() => void shareFromContextMenu()} role="menuitem" type="button">
                    <Share2 size={14} /> 共享到 MCP
                  </button>
                  <div className="my-1 border-t border-border/60" />
                  <button onClick={closeCurrentFromContextMenu} role="menuitem" type="button">
                    <X size={14} /> 关闭当前
                  </button>
                  <button
                    onClick={() => closeRangeFromContextMenu('left')}
                    role="menuitem"
                    type="button"
                  >
                    关闭左侧所有
                  </button>
                  <button
                    onClick={() => closeRangeFromContextMenu('right')}
                    role="menuitem"
                    type="button"
                  >
                    关闭右侧所有
                  </button>
                  <button
                    onClick={() => {
                      setContextMenu(undefined);
                      setConfirmCloseAll(true);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    关闭所有
                  </button>
                </div>
              )}

              {isAllSessionsOpen && (
                <AllSessionsPopover
                  activeSessionId={activeSessionId}
                  onClose={(sessionId) => {
                    const session = sessions.find((candidate) => candidate.id === sessionId);
                    if (session !== undefined) setConfirmClose(session);
                  }}
                  onCloseAll={() => setConfirmCloseAll(true)}
                  onQueryChange={setSessionSearch}
                  onSelect={(session) => {
                    setActiveSessionId(session.id);
                    setIsAllSessionsOpen(false);
                  }}
                  query={sessionSearch}
                  sessions={sessions}
                />
              )}
            </div>

            <div className="mx-1 h-4 w-px shrink-0 bg-border" />

            <div className="prototype-global-actions relative z-50 flex shrink-0 items-center gap-3">
              <button
                aria-label="设置"
                className="flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                onClick={() => setView('settings')}
                title="设置"
                type="button"
              >
                <Settings size={16} />
              </button>
            </div>
          </header>

          <main className="prototype-workspace relative flex min-w-0 flex-1 overflow-hidden">
            <div
              aria-label="活动终端"
              className="prototype-terminal relative z-10 flex min-w-0 flex-1 flex-col border-r border-border shadow-[inset_-10px_0_20px_rgba(0,0,0,0.2)] group"
              id="active-terminal-panel"
              role="tabpanel"
              style={{ backgroundColor: 'var(--terminal-bg)' }}
            >
              {sessions.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
                  <img
                    alt="Synapse Term logo"
                    className="h-14 w-14"
                    height={56}
                    src={synapseTermLogoUrl}
                    width={56}
                  />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">暂无终端会话</p>
                    <p className="text-xs text-muted-foreground">
                      新终端将从当前用户主目录启动，在终端中自行完成跳转与认证。
                    </p>
                  </div>
                  <button
                    aria-label="快速新建终端会话"
                    className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                    onClick={() => setIsNewSessionOpen(true)}
                    type="button"
                  >
                    <Plus size={16} />
                    新建终端会话
                  </button>
                </div>
              ) : (
                <>
                  {activeSession !== undefined && executions.has(activeSession.id) && (
                    <div
                      className="external-execution-banner pointer-events-none absolute left-0 right-0 top-0 z-20 border-b border-amber-400/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200"
                      data-testid="external-execution-banner"
                    >
                      <Radio aria-hidden="true" size={13} />
                      <span>
                        外部执行中：{executions.get(activeSession.id)?.command} ·{' '}
                        {executions.get(activeSession.id)?.source}
                      </span>
                    </div>
                  )}
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="absolute inset-0"
                      style={{
                        visibility: session.id === activeSession?.id ? 'visible' : 'hidden',
                      }}
                    >
                      <TerminalView
                        api={api}
                        initialEvents={
                          outputHistoryRef.current.get(session.id) ?? EMPTY_OUTPUT_EVENTS
                        }
                        session={session}
                        themeState={themeState ?? DEFAULT_THEME_STATE}
                      />
                    </div>
                  ))}
                  <div className="absolute right-4 top-4 z-20 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                    <div className="flex items-center overflow-hidden rounded-lg border border-border/80 bg-popover px-2.5 py-1.5 text-muted-foreground shadow-2xl backdrop-blur-md transition-colors focus-within:border-primary/50">
                      <Search size={14} className="mr-2 text-muted-foreground/70" />
                      <input
                        aria-label="搜索终端输出"
                        className="w-40 bg-transparent text-[13px] text-foreground outline-none transition-all duration-300 placeholder:text-muted-foreground focus:w-56"
                        onChange={(event) => dispatchSearch(event.target.value)}
                        placeholder="搜索终端输出 (Ctrl+F)"
                        ref={terminalSearchInputRef}
                        type="text"
                        value={terminalSearch}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </main>

          {(isAllSessionsOpen || contextMenu !== undefined) && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => {
                setIsAllSessionsOpen(false);
                setContextMenu(undefined);
              }}
            />
          )}
        </>
      ) : (
        <SettingsWorkspace api={api} onBack={() => setView('workspace')} />
      )}

      {isNewSessionOpen && (
        <NewSessionModal
          environment={environment}
          onClose={() => setIsNewSessionOpen(false)}
          onCreate={(title, shellKind) => createSession(title, shellKind)}
          sessions={sessions}
        />
      )}

      {renameState !== undefined && (
        <div
          aria-label="重命名会话"
          aria-modal="true"
          className="session-rename-backdrop"
          role="dialog"
        >
          <section className="session-rename-dialog">
            <div className="session-rename-header">
              <div>
                <p className="session-rename-eyebrow">Session Alias</p>
                <h2>重命名会话</h2>
              </div>
              <button
                aria-label="关闭重命名"
                className="session-rename-close"
                onClick={() => setRenameState(undefined)}
                type="button"
              >
                <X size={15} />
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitRename();
              }}
            >
              <label htmlFor="session-rename-input">名称</label>
              <input
                autoFocus
                id="session-rename-input"
                onChange={(event) =>
                  setRenameState((current) =>
                    current === undefined ? undefined : { ...current, value: event.target.value },
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setRenameState(undefined);
                }}
                value={renameState.value}
              />
              <div className="session-rename-actions">
                <button onClick={() => setRenameState(undefined)} type="button">
                  取消
                </button>
                <button disabled={busy || renameState.value.trim().length === 0} type="submit">
                  {busy ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {confirmClose !== undefined && (
        <ConfirmDialog
          confirmLabel="关闭终端"
          danger
          description={`确定关闭「${confirmClose.title}」吗？关闭后该会话的 PTY 将被终止。`}
          onCancel={() => setConfirmClose(undefined)}
          onConfirm={() => void closeSession(confirmClose.id)}
          open
          title="关闭终端会话"
        />
      )}

      {confirmCloseAll && (
        <ConfirmDialog
          confirmLabel="全部关闭"
          danger
          description={`确定关闭全部 ${sessions.length} 个终端会话吗？关闭后所有 PTY 将被终止。`}
          onCancel={() => setConfirmCloseAll(false)}
          onConfirm={() => void closeAllSessions()}
          open
          title="关闭全部终端会话"
        />
      )}

      {confirmCloseRange !== undefined && (
        <ConfirmDialog
          confirmLabel="关闭所选"
          danger
          description={
            confirmCloseRange.direction === 'left'
              ? '确定关闭该标签左侧的所有终端会话吗？'
              : '确定关闭该标签右侧的所有终端会话吗？'
          }
          onCancel={() => setConfirmCloseRange(undefined)}
          onConfirm={() => void closeRangeSessions()}
          open
          title={confirmCloseRange.direction === 'left' ? '关闭左侧终端会话' : '关闭右侧终端会话'}
        />
      )}

      {shareDialog !== undefined && (
        <ShareDialog
          onClose={() => setShareDialog(undefined)}
          sessionId={shareDialog.sessionId}
          terminalType={shareDialog.terminalType}
          title={shareDialog.title}
          mcpStatus={shareDialog.mcpStatus}
        />
      )}
      {approvalRequest !== undefined && (
        <ApprovalCard
          request={approvalRequest}
          onDecide={(decision) => void decideApproval(decision)}
        />
      )}

      {runtimeError !== undefined && (
        <div className="runtime-error-backdrop" role="presentation">
          <section
            aria-label="运行错误"
            aria-modal="true"
            className="runtime-error-dialog"
            role="alertdialog"
          >
            <div className="runtime-error-header">
              <div className="runtime-error-title">操作未完成</div>
              <button
                aria-label="关闭错误提示"
                className="runtime-error-close"
                onClick={() => setRuntimeError(undefined)}
                type="button"
              >
                <X size={16} />
              </button>
            </div>
            <div className="runtime-error-message" role="alert">
              {runtimeError}
            </div>
            <button
              className="runtime-error-confirm"
              onClick={() => setRuntimeError(undefined)}
              type="button"
            >
              知道了
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
