import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  Cpu,
  Settings,
  Plus,
  Sparkles,
  ShieldAlert,
  Check,
  Play,
  XCircle,
  Search,
  FileText,
  ChevronDown,
  Key,
  X,
  Network,
  Server,
  HardDrive,
  RefreshCw,
  Command,
  Box,
  ArrowLeft,
  History,
  List,
  Save,
  Clock,
  Power,
  GripVertical,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';

import { createMockDesktopApi } from './mock-api.js';
import {
  groupAgentTimelineItems,
  isApprovalActionable,
  isTerminalTimelineStatus,
  mergeHydratedTimeline,
  resolveTimelineStatus,
  upsertTimelineEvent,
} from './agent-timeline-state.js';
import type {
  AgentHistoryView,
  AgentTimelineItem,
  AuditEventView,
  DesktopApi,
  DiscoveredModel,
  ModelConfigurationInput,
  ModelConfigurationView,
  ProviderProfileInput,
  ProviderProfileView,
  ReasoningEffort,
  SessionResourceSnapshot,
  SessionEnvironment,
  SessionSummary,
} from './preload-api.js';
import { buildSessionLaunch } from './session-launch.js';
import { TerminalView } from './terminal-view.js';
import { auditTypeZh, errorMessageZh } from './zh-cn.js';
import { MarkdownContent } from './markdown-content.js';
import { chooseInitialSessionId, isInteractiveSession } from './session-selection.js';

let browserMockApi: DesktopApi | undefined;

function getApi(): DesktopApi {
  if (window.terminalAgent !== undefined) return window.terminalAgent;
  browserMockApi ??= createMockDesktopApi();
  return browserMockApi;
}

function isCoreRequestTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return code === 'request_cancelled' || /Core request timed out/i.test(error.message);
}

function isApprovalNoLongerPending(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /approval is no longer pending|approval environment is no longer current/i.test(message);
}

const dialectLabels: Record<SessionSummary['executionDialect'], string> = {
  posix: 'POSIX',
  powershell: 'PowerShell',
  observe_only: '仅观察 (Observe)',
};

type PermissionMode = 'manual' | 'auto' | 'full_access';

interface ResourceViewState {
  status: 'idle' | 'refreshing' | 'ready' | 'error';
  snapshot?: SessionResourceSnapshot;
  error?: string;
}

const permissionLabels: Record<PermissionMode, string> = {
  manual: '人工审批',
  auto: '自动审批',
  full_access: '完全权限',
};

const AGENT_PANEL_MIN_WIDTH = 360;
const AGENT_PANEL_MAX_WIDTH = 720;
const TERMINAL_MIN_WIDTH = 360;

function getViewportWidth(): number {
  return typeof window === 'undefined' ? 1440 : window.innerWidth;
}

function getDefaultAgentPanelWidth(): number {
  return getViewportWidth() >= 1280 ? 550 : 480;
}

function getAgentPanelMaxWidth(workspaceWidth: number): number {
  return Math.max(
    AGENT_PANEL_MIN_WIDTH,
    Math.min(AGENT_PANEL_MAX_WIDTH, workspaceWidth - TERMINAL_MIN_WIDTH),
  );
}

function clampAgentPanelWidth(width: number, workspaceWidth: number): number {
  const maxWidth = getAgentPanelMaxWidth(workspaceWidth);
  return Math.round(Math.min(maxWidth, Math.max(AGENT_PANEL_MIN_WIDTH, width)));
}

// --- MAIN APP CONTAINER ---
export function App() {
  const api = useMemo(getApi, []);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [models, setModels] = useState<ModelConfigurationView[]>([]);
  const [providers, setProviders] = useState<ProviderProfileView[]>([]);
  const [activeModelId, setActiveModelId] = useState('');
  const [sessionEnvironment, setSessionEnvironment] = useState<SessionEnvironment>({
    home: '',
    shells: [],
  });
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  const [isResourceMonitorOpen, setIsResourceMonitorOpen] = useState(false);

  // Dropdown states
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isAllSessionsOpen, setIsAllSessionsOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isDialectMenuOpen, setIsDialectMenuOpen] = useState(false);
  const [isPermissionMenuOpen, setIsPermissionMenuOpen] = useState(false);

  // Modal states for deep interactions
  const [isSearchHistoryOpen, setIsSearchHistoryOpen] = useState(false);
  const [modelEditor, setModelEditor] = useState<
    { mode: 'new' } | { mode: 'edit'; modelId: string } | undefined
  >();
  const [providerEditor, setProviderEditor] = useState<
    { mode: 'new' } | { mode: 'edit'; providerId: string } | undefined
  >();

  // App contextual states
  const [currentView, setCurrentView] = useState<'workspace' | 'models' | 'providers'>('workspace');
  const [agentTab, setAgentTab] = useState<'timeline' | 'audit'>('timeline');
  const [chatInput, setChatInput] = useState('');
  const [timeline, setTimeline] = useState<AgentTimelineItem[]>([]);
  const [histories, setHistories] = useState<Record<string, AgentHistoryView>>({});
  const [auditEvents, setAuditEvents] = useState<AuditEventView[]>([]);
  const [resources, setResources] = useState<Record<string, ResourceViewState>>({});
  const [startingTurn, setStartingTurn] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string>();
  const [coreClosed, setCoreClosed] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [agentPanelWidth, setAgentPanelWidth] = useState(getDefaultAgentPanelWidth);
  const [isAgentPanelCollapsed, setIsAgentPanelCollapsed] = useState(false);
  const [isAgentPanelResizing, setIsAgentPanelResizing] = useState(false);
  const sessionTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const agentTimelineRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const shouldStickTimelineToBottom = useRef(true);
  const historyRequestVersions = useRef(new Map<string, number>());
  const historyRequests = useRef(new Map<string, Promise<void>>());
  const pendingHistoryRefreshes = useRef(new Set<string>());
  const timeoutRecoverySessions = useRef(new Set<string>());
  const activeSessionIdRef = useRef('');

  // Dynamic Label States
  const [currentDialect, setCurrentDialect] = useState<SessionSummary['executionDialect']>('posix');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('manual');

  const closeAllDropdowns = () => {
    setIsSettingsMenuOpen(false);
    setIsAllSessionsOpen(false);
    setIsModelMenuOpen(false);
    setIsDialectMenuOpen(false);
    setIsPermissionMenuOpen(false);
    setSessionSearch('');
  };

  const interactiveSessions = sessions.filter(isInteractiveSession);
  const activeSession = interactiveSessions.find((session) => session.id === activeSessionId);
  const currentPermission = permissionLabels[permissionMode];
  const eligibleModels = models.filter((model) => model.enabled);
  const activeModel =
    eligibleModels.find((model) => model.id === activeModelId) ??
    eligibleModels.find((model) => model.isDefault) ??
    eligibleModels[0];
  const currentModelName = activeModel?.name ?? '未配置模型';
  const activeHistory = activeSession === undefined ? undefined : histories[activeSession.id];
  const activeTimeline = timeline.filter((item) => item.sessionId === activeSession?.id);
  const activeResource =
    activeSession === undefined
      ? { status: 'idle' as const }
      : (resources[activeSession.id] ?? { status: 'idle' as const });
  const activeTurn = startingTurn || activeHistory?.activeTurnId !== undefined;
  const agentPanelMaxWidth = getAgentPanelMaxWidth(
    workspaceRef.current?.clientWidth ?? getViewportWidth(),
  );
  activeSessionIdRef.current = activeSessionId;

  useEffect(() => {
    const handleWindowResize = (): void => {
      const workspaceWidth = workspaceRef.current?.clientWidth ?? getViewportWidth();
      setAgentPanelWidth((current) => clampAgentPanelWidth(current, workspaceWidth));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  useEffect(() => {
    if (!isAgentPanelResizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isAgentPanelResizing]);

  const historyVersion = (sessionId: string): number =>
    historyRequestVersions.current.get(sessionId) ?? 0;

  const bumpHistoryVersion = (sessionId: string): number => {
    const next = historyVersion(sessionId) + 1;
    historyRequestVersions.current.set(sessionId, next);
    return next;
  };

  const clearActiveTurn = useCallback((sessionId: string): void => {
    setHistories((items) => {
      const history = items[sessionId];
      if (history === undefined || history.activeTurnId === undefined) return items;
      const next = { ...history };
      delete next.activeTurnId;
      return { ...items, [sessionId]: next };
    });
  }, []);

  const handleHistoryError = useCallback(
    (sessionId: string, caught: unknown): void => {
      if (!isCoreRequestTimeout(caught)) {
        setRuntimeError(errorMessageZh(caught));
        return;
      }
      if (timeoutRecoverySessions.current.has(sessionId)) return;
      timeoutRecoverySessions.current.add(sessionId);
      setRuntimeError(errorMessageZh(caught));
      void api.agent
        .cancel(sessionId)
        .then(() => clearActiveTurn(sessionId))
        .catch(() => undefined);
    },
    [api, clearActiveTurn],
  );

  const refreshAgentHistory = useCallback(
    (sessionId: string): void => {
      if (historyRequests.current.has(sessionId)) {
        pendingHistoryRefreshes.current.add(sessionId);
        return;
      }
      const requestVersion = historyVersion(sessionId);
      const request = api.agent
        .history(sessionId)
        .then((history) => {
          if (historyVersion(sessionId) !== requestVersion) return;
          timeoutRecoverySessions.current.delete(sessionId);
          setHistories((items) => ({ ...items, [sessionId]: history }));
          setTimeline((items) => mergeHydratedTimeline(items, sessionId, history));
          if (activeSessionIdRef.current === sessionId) {
            setPermissionMode(history.conversation?.permissionMode ?? 'manual');
          }
        })
        .catch((caught: unknown) => handleHistoryError(sessionId, caught))
        .finally(() => {
          historyRequests.current.delete(sessionId);
          if (pendingHistoryRefreshes.current.delete(sessionId)) {
            refreshAgentHistory(sessionId);
          }
        });
      historyRequests.current.set(sessionId, request);
    },
    [api, handleHistoryError],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.sessions.list(),
      api.sessions.environment(),
      api.models.list(),
      api.providers.list(),
    ])
      .then(([nextSessions, environment, nextModels, nextProviders]) => {
        if (cancelled) return;
        setSessions(nextSessions);
        setSessionEnvironment(environment);
        setModels(nextModels);
        setProviders(nextProviders);
        setRuntimeError(undefined);
        setActiveSessionId((current) => chooseInitialSessionId(nextSessions, current));
      })
      .catch((caught: unknown) => {
        if (!cancelled) setRuntimeError(errorMessageZh(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(
    () =>
      api.sessions.onChanged((updated) => {
        setSessions((items) => {
          const index = items.findIndex((session) => session.id === updated.id);
          if (index < 0) return [...items, updated];
          const next = [...items];
          next[index] = updated;
          return next;
        });
        setActiveSessionId(
          (current) => current || (isInteractiveSession(updated) ? updated.id : ''),
        );
      }),
    [api],
  );

  useEffect(() => {
    if (activeSession === undefined) return;
    sessionTabRefs.current.get(activeSession.id)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeSession?.id]);

  useEffect(() => {
    if (activeSession !== undefined) setCurrentDialect(activeSession.executionDialect);
  }, [activeSession]);

  useEffect(() => {
    if (eligibleModels.length === 0) {
      setActiveModelId('');
      return;
    }
    if (eligibleModels.some((model) => model.id === activeModelId)) return;
    setActiveModelId((eligibleModels.find((model) => model.isDefault) ?? eligibleModels[0])!.id);
  }, [activeModelId, models]);

  useEffect(() => {
    const dispose = api.agent.onTimeline((event) => {
      setTimeline((items) => upsertTimelineEvent(items, event));
      if (
        (event.kind === 'assistant' || event.kind === 'system') &&
        isTerminalTimelineStatus(event.status)
      ) {
        clearActiveTurn(event.sessionId);
      }
      refreshAgentHistory(event.sessionId);
    });
    return dispose;
  }, [api, clearActiveTurn, refreshAgentHistory]);

  useEffect(
    () =>
      api.resources.onSnapshot((event) => {
        setResources((items) => ({
          ...items,
          [event.sessionId]: { status: 'ready', snapshot: event.snapshot },
        }));
      }),
    [api],
  );

  useEffect(() => {
    if (activeSession === undefined) return;
    let cancelled = false;
    const requestVersion = historyVersion(activeSession.id);
    void Promise.all([
      api.resources.get(activeSession.id),
      api.audit.list({ sessionId: activeSession.id }),
    ])
      .then(([snapshot, events]) => {
        if (cancelled || historyVersion(activeSession.id) !== requestVersion) return;
        if (snapshot !== undefined) {
          setResources((items) => ({
            ...items,
            [activeSession.id]: { status: 'ready', snapshot },
          }));
        }
        setAuditEvents(events);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setRuntimeError(errorMessageZh(caught));
      });
    refreshAgentHistory(activeSession.id);
    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, api, refreshAgentHistory]);

  useEffect(() => {
    shouldStickTimelineToBottom.current = true;
  }, [activeSession?.id, agentTab]);

  useEffect(() => {
    const element = agentTimelineRef.current;
    if (element === null || agentTab !== 'timeline' || !shouldStickTimelineToBottom.current) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTimeline, activeSession?.id, agentTab]);

  useEffect(() => {
    if (agentTab !== 'audit' || activeSession === undefined) return;
    let cancelled = false;
    void api.audit
      .list({ sessionId: activeSession.id })
      .then((events) => {
        if (!cancelled) setAuditEvents(events);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setRuntimeError(errorMessageZh(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, agentTab, api]);

  useEffect(() => {
    setActiveSessionId((current) => chooseInitialSessionId(sessions, current));
  }, [sessions]);

  const selectSession = (session: SessionSummary): void => {
    setActiveSessionId(session.id);
    closeAllDropdowns();
  };

  const selectDialect = async (dialect: SessionSummary['executionDialect']): Promise<void> => {
    if (coreClosed || activeSession === undefined) return;
    try {
      const updated = await api.sessions.setDialect(activeSession.id, dialect);
      setSessions((items) =>
        items.map((session) => (session.id === updated.id ? updated : session)),
      );
      setCurrentDialect(updated.executionDialect);
      closeAllDropdowns();
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const refreshResources = async (): Promise<void> => {
    if (coreClosed || activeSession === undefined || activeResource.status === 'refreshing') return;
    const sessionId = activeSession.id;
    setResources((items) => ({
      ...items,
      [sessionId]: {
        status: 'refreshing',
        ...(activeResource.snapshot === undefined ? {} : { snapshot: activeResource.snapshot }),
      },
    }));
    try {
      const result = await api.resources.refresh(sessionId);
      setResources((items) => ({
        ...items,
        [sessionId]: result.ok
          ? { status: 'ready', snapshot: result.snapshot }
          : { status: 'error', error: result.error.message },
      }));
    } catch (caught) {
      setResources((items) => ({
        ...items,
        [sessionId]: { status: 'error', error: errorMessageZh(caught) },
      }));
    }
  };

  const submitGoal = async (): Promise<void> => {
    const goal = chatInput.trim();
    if (coreClosed || !goal || activeSession === undefined || activeTurn) return;
    const sessionId = activeSession.id;
    setStartingTurn(true);
    setChatInput('');
    try {
      const started = await api.agent.start(sessionId, goal, {
        ...(activeModel === undefined ? {} : { modelConfigurationId: activeModel.id }),
        permissionMode,
      });
      setHistories((items) => ({
        ...items,
        [sessionId]: {
          ...(items[sessionId] ?? { sessionId, turns: [], items: [] }),
          activeTurnId: started.turnId,
        },
      }));
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    } finally {
      setStartingTurn(false);
    }
  };

  const approve = async (item: AgentTimelineItem): Promise<void> => {
    if (coreClosed || activeSession === undefined) return;
    if (item.risk === 'destructive' && !window.confirm('该操作具有破坏性，确认继续执行？')) return;
    try {
      await api.agent.approve(activeSession.id, item.id, item.risk === 'destructive');
    } catch (caught) {
      if (isApprovalNoLongerPending(caught)) {
        setTimeline((items) =>
          items.map((event) =>
            event.id === item.id ? { ...event, status: 'environment_invalidated' } : event,
          ),
        );
        clearActiveTurn(activeSession.id);
        refreshAgentHistory(activeSession.id);
        return;
      }
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const takeOver = async (): Promise<void> => {
    if (coreClosed || activeSession === undefined) return;
    try {
      await api.agent.takeover(activeSession.id);
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const refreshConfigurations = async (): Promise<void> => {
    const [nextModels, nextProviders] = await Promise.all([
      api.models.list(),
      api.providers.list(),
    ]);
    setModels(nextModels);
    setProviders(nextProviders);
  };

  const createSession = async (
    title: string,
    shellKind: SessionEnvironment['shells'][number]['kind'],
  ): Promise<void> => {
    if (coreClosed) return;
    const shell = sessionEnvironment.shells.find((candidate) => candidate.kind === shellKind);
    if (shell === undefined) throw new Error('请选择可用的系统 Shell。');
    try {
      const session = await api.sessions.create(
        buildSessionLaunch(title, sessionEnvironment.home, shell),
      );
      setSessions((items) => {
        const exists = items.some((item) => item.id === session.id);
        return exists
          ? items.map((item) => (item.id === session.id ? session : item))
          : [...items, session];
      });
      setActiveSessionId(session.id);
      setIsNewSessionModalOpen(false);
      setRuntimeError(undefined);
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
      throw caught;
    }
  };

  const closeSession = async (
    sessionId: string,
    options: { keepAllSessionsOpen?: boolean } = {},
  ): Promise<void> => {
    if (coreClosed) return;
    try {
      if (!(await api.sessions.close(sessionId))) return;
      setSessions((items) => {
        const remaining = items.filter((session) => session.id !== sessionId);
        setActiveSessionId((current) =>
          chooseInitialSessionId(remaining, current === sessionId ? '' : current),
        );
        return remaining;
      });
      if (!options.keepAllSessionsOpen) closeAllDropdowns();
      setRuntimeError(undefined);
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const cancelTurn = async (): Promise<void> => {
    if (coreClosed || activeSession === undefined) return;
    try {
      await api.agent.cancel(activeSession.id);
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const interruptCommand = async (item: AgentTimelineItem): Promise<void> => {
    if (coreClosed || activeSession === undefined || item.kind !== 'command') return;
    try {
      await api.agent.interrupt(activeSession.id, item.id);
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const resetConversation = async (): Promise<void> => {
    if (
      coreClosed ||
      activeSession === undefined ||
      activeHistory?.conversation === undefined ||
      activeTurn
    ) {
      return;
    }
    if (!window.confirm('确认清空当前 Agent 会话？该操作会移除当前会话的历史消息。')) return;

    const sessionId = activeSession.id;
    const conversationId = activeHistory.conversation.id;
    bumpHistoryVersion(sessionId);
    try {
      await api.agent.resetConversation(sessionId, conversationId);
      setHistories((items) => ({
        ...items,
        [sessionId]: { sessionId, turns: [], items: [] },
      }));
      setTimeline((items) => items.filter((item) => item.sessionId !== sessionId));
      shouldStickTimelineToBottom.current = true;
      setRuntimeError(undefined);
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const closeCore = async (): Promise<void> => {
    if (coreClosed) return;
    if (
      !window.confirm(
        '确认退出 Core？所有当前终端会话和 PTY 都会结束，但本地配置和审计数据会保留。',
      )
    ) {
      return;
    }
    try {
      await api.core.exit('terminate_sessions');
      setCoreClosed(true);
      setSessions([]);
      setActiveSessionId('');
      setHistories({});
      setTimeline([]);
      setAuditEvents([]);
      setResources({});
      setChatInput('');
      setCurrentView('workspace');
      closeAllDropdowns();
      setRuntimeError('Core 已关闭，请重新启动应用以继续使用。');
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const updateAgentPanelWidth = (clientX: number): void => {
    const workspaceBounds = workspaceRef.current?.getBoundingClientRect();
    if (workspaceBounds === undefined) return;
    setAgentPanelWidth(
      clampAgentPanelWidth(workspaceBounds.right - clientX, workspaceBounds.width),
    );
  };

  const startAgentPanelResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsAgentPanelResizing(true);
    updateAgentPanelWidth(event.clientX);
  };

  const finishAgentPanelResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsAgentPanelResizing(false);
  };

  const handleAgentPanelResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const workspaceWidth = workspaceRef.current?.clientWidth ?? getViewportWidth();
    const maxWidth = getAgentPanelMaxWidth(workspaceWidth);
    const step = event.shiftKey ? 64 : 16;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setAgentPanelWidth((current) =>
        clampAgentPanelWidth(current + (event.key === 'ArrowLeft' ? step : -step), workspaceWidth),
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      setAgentPanelWidth(AGENT_PANEL_MIN_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      setAgentPanelWidth(maxWidth);
    }
  };

  return (
    <div className="prototype-shell flex flex-col h-screen bg-[#09090b] text-foreground font-sans overflow-hidden">
      {/* GLOBAL HEADER */}
      <header className="prototype-header h-14 border-b border-border bg-[#09090b] flex items-center justify-between px-4 shrink-0 relative z-50">
        {/* Logo & App Name */}
        <div className="prototype-brand flex items-center gap-3 pr-6 border-r border-border shrink-0">
          <div className="relative flex items-center justify-center w-7 h-7 bg-white text-black rounded-md shadow-[0_0_15px_rgba(255,255,255,0.2)]">
            <Command size={16} strokeWidth={2.5} />
            <Sparkles
              size={10}
              className="absolute -top-1 -right-1 text-amber-400 fill-amber-400"
            />
          </div>
          <span className="prototype-brand-name font-bold text-[15px] tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Synapse Term
          </span>
        </div>

        <div className="session-tab-strip relative z-50">
          <div aria-label="终端会话" className="session-tab-list" role="tablist">
            {interactiveSessions.map((session) => (
              <div
                className={`session-tab ${session.id === activeSession?.id ? 'is-active' : ''}`}
                key={session.id}
              >
                <button
                  aria-controls="active-terminal-panel"
                  aria-label={`${session.title} ${session.terminalType}`}
                  aria-selected={session.id === activeSession?.id}
                  className="session-tab-select"
                  onClick={() => selectSession(session)}
                  ref={(element) => {
                    if (element === null) sessionTabRefs.current.delete(session.id);
                    else sessionTabRefs.current.set(session.id, element);
                  }}
                  role="tab"
                  title={`${session.title} · ${session.terminalType}`}
                  type="button"
                >
                  <span className="session-tab-title">{session.title}</span>
                  <span className="session-tab-type">{session.terminalType}</span>
                </button>
                <button
                  aria-label={`关闭 ${session.title}`}
                  className="session-tab-close"
                  onClick={() => void closeSession(session.id)}
                  title={`关闭 ${session.title}`}
                  type="button"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="session-tab-tools">
            <button
              aria-label="新建终端会话"
              disabled={coreClosed}
              className="session-tab-tool"
              onClick={() => {
                closeAllDropdowns();
                setIsNewSessionModalOpen(true);
              }}
              title="新建终端会话"
              type="button"
            >
              <Plus size={16} />
            </button>
            <button
              aria-expanded={isAllSessionsOpen}
              aria-label="全部会话"
              disabled={coreClosed}
              className="session-tab-tool"
              onClick={() => {
                const wasOpen = isAllSessionsOpen;
                closeAllDropdowns();
                setIsAllSessionsOpen(!wasOpen);
              }}
              title="全部会话"
              type="button"
            >
              <List size={16} />
            </button>
          </div>
          {isAllSessionsOpen && (
            <AllSessionsPopover
              activeSessionId={activeSession?.id}
              onClose={(sessionId) => closeSession(sessionId, { keepAllSessionsOpen: true })}
              onQueryChange={setSessionSearch}
              onSelect={selectSession}
              query={sessionSearch}
              sessions={sessions}
            />
          )}
        </div>

        <div className="h-4 w-[1px] bg-border mx-1 shrink-0"></div>

        <div className="relative shrink-0">
          <button
            aria-label={`方言: ${dialectLabels[currentDialect]}`}
            disabled={coreClosed || activeSession === undefined}
            onClick={() => {
              const wasOpen = isDialectMenuOpen;
              closeAllDropdowns();
              setIsDialectMenuOpen(!wasOpen);
            }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-secondary/50"
            type="button"
          >
            方言: {dialectLabels[currentDialect]} <ChevronDown size={14} />
          </button>
          {isDialectMenuOpen && (
            <div
              aria-label="方言菜单"
              className="absolute top-8 left-0 w-40 bg-[#18181b] border border-border rounded-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
              role="menu"
            >
              {(
                Object.entries(dialectLabels) as Array<[SessionSummary['executionDialect'], string]>
              ).map(([dialect, label]) => (
                <button
                  key={dialect}
                  onClick={() => void selectDialect(dialect)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-secondary/50 text-foreground transition-colors"
                  role="menuitemradio"
                  type="button"
                >
                  {label}{' '}
                  {currentDialect === dialect && <Check size={12} className="text-emerald-500" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Global Actions */}
        <div className="prototype-global-actions flex items-center gap-3 shrink-0">
          <button
            aria-label="资源监控"
            disabled={coreClosed}
            onClick={() => {
              setIsResourceMonitorOpen(true);
              void refreshResources();
            }}
            className="flex items-center gap-1.5 text-xs font-medium border border-border px-3 py-1.5 rounded hover:bg-secondary transition-colors"
            type="button"
          >
            <Cpu size={14} /> <span className="session-action-label">资源监控</span>
          </button>

          <div className="relative z-50">
            <button
              onClick={() => {
                const wasOpen = isModelMenuOpen;
                closeAllDropdowns();
                setIsModelMenuOpen(!wasOpen);
              }}
              disabled={coreClosed}
              aria-label={`模型: ${currentModelName}`}
              className="flex items-center gap-1.5 text-xs bg-secondary/50 hover:bg-secondary border border-border px-3 py-1.5 rounded transition-colors"
              type="button"
            >
              <span className="session-action-label">
                <span className="text-muted-foreground">模型:</span> {currentModelName}
              </span>{' '}
              <ChevronDown size={14} className="ml-0.5 text-muted-foreground" />
            </button>
            {isModelMenuOpen && (
              <div
                aria-label="模型菜单"
                className="absolute top-10 right-0 w-52 bg-[#18181b] border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                role="menu"
              >
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border/50 bg-[#09090b]">
                  切换模型
                </div>
                {eligibleModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      setActiveModelId(model.id);
                      closeAllDropdowns();
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-secondary/50 text-foreground transition-colors"
                    role="menuitemradio"
                    type="button"
                  >
                    {model.name}{' '}
                    {activeModel?.id === model.id && (
                      <Check size={14} className="text-emerald-500" />
                    )}
                  </button>
                ))}
                {eligibleModels.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">暂无已启用模型</div>
                )}
                <div className="border-t border-border/50 bg-[#09090b]">
                  <button
                    onClick={() => {
                      setCurrentView('models');
                      closeAllDropdowns();
                    }}
                    className="w-full px-3 py-2.5 text-xs text-primary hover:bg-secondary/50 text-left transition-colors font-medium flex items-center gap-1.5"
                    role="menuitem"
                    type="button"
                  >
                    <Box size={14} /> 管理模型配置...
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="relative z-50">
            <button
              aria-label={`当前权限：${currentPermission}`}
              disabled={coreClosed}
              onClick={() => {
                const wasOpen = isPermissionMenuOpen;
                closeAllDropdowns();
                setIsPermissionMenuOpen(!wasOpen);
              }}
              className={`flex items-center gap-1.5 text-xs border px-3 py-1.5 rounded transition-colors ${
                currentPermission === '人工审批'
                  ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/20'
                  : currentPermission === '自动审批'
                    ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/20'
                    : 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/20'
              }`}
              type="button"
            >
              <ShieldAlert size={14} />{' '}
              <span className="session-action-label">{currentPermission}</span>{' '}
              <ChevronDown size={14} className="ml-0.5 opacity-80" />
            </button>
            {isPermissionMenuOpen && (
              <div
                aria-label="权限菜单"
                className="absolute top-10 right-0 w-44 bg-[#18181b] border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                role="menu"
              >
                <button
                  onClick={() => {
                    setPermissionMode('manual');
                    closeAllDropdowns();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-secondary/50 text-amber-500 transition-colors"
                  role="menuitemradio"
                  type="button"
                >
                  人工审批 {permissionMode === 'manual' && <Check size={12} />}
                </button>
                <button
                  onClick={() => {
                    setPermissionMode('auto');
                    closeAllDropdowns();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-secondary/50 text-blue-400 transition-colors"
                  role="menuitemradio"
                  type="button"
                >
                  自动审批 (推荐) {permissionMode === 'auto' && <Check size={12} />}
                </button>
                <button
                  onClick={() => {
                    setPermissionMode('full_access');
                    closeAllDropdowns();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-secondary/50 text-red-400 transition-colors"
                  role="menuitemradio"
                  type="button"
                >
                  完全权限 (高风险) {permissionMode === 'full_access' && <Check size={12} />}
                </button>
              </div>
            )}
          </div>

          <div className="h-4 w-[1px] bg-border mx-1"></div>

          {/* Global Settings Dropdown */}
          <div className="relative z-50">
            <button
              onClick={() => {
                const wasOpen = isSettingsMenuOpen;
                closeAllDropdowns();
                setIsSettingsMenuOpen(!wasOpen);
              }}
              aria-label="设置"
              className="w-8 h-8 flex items-center justify-center border border-border rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              type="button"
            >
              <Settings size={16} />
            </button>

            {isSettingsMenuOpen && (
              <div
                aria-label="设置菜单"
                className="absolute top-10 right-0 w-64 bg-[#18181b] border border-border rounded-lg shadow-2xl overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-200"
                role="menu"
              >
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border/50 mb-1">
                  全局配置
                </div>
                <button
                  disabled={coreClosed}
                  onClick={() => {
                    setCurrentView('models');
                    closeAllDropdowns();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary text-left transition-colors"
                  role="menuitem"
                  type="button"
                >
                  <Box size={14} /> 模型配置 (Models)
                </button>
                <button
                  disabled={coreClosed}
                  onClick={() => {
                    setCurrentView('providers');
                    closeAllDropdowns();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary text-left transition-colors"
                  role="menuitem"
                  type="button"
                >
                  <Key size={14} /> 服务商配置 (Providers)
                </button>
                <button
                  aria-label="清空当前 Agent 会话"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={activeTurn || activeHistory?.conversation === undefined}
                  onClick={() => {
                    closeAllDropdowns();
                    void resetConversation();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <RefreshCw size={14} /> 清空当前 Agent 会话
                </button>
                <button
                  className="w-full flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={coreClosed}
                  onClick={() => {
                    closeAllDropdowns();
                    void closeCore();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Power size={14} /> 退出 Core（结束所有会话）
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* WORKSPACE AREA */}
      <main
        className="prototype-workspace min-w-0 flex-1 flex overflow-hidden relative"
        ref={workspaceRef}
      >
        {currentView === 'workspace' && (
          <>
            {/* Terminal Pane (Left) */}
            <div
              aria-label="活动终端"
              className="prototype-terminal min-w-0 flex-1 flex flex-col bg-[#000000] border-r border-border shadow-[inset_-10px_0_20px_rgba(0,0,0,0.2)] z-10 relative group"
              id="active-terminal-panel"
              role="tabpanel"
            >
              {/* Terminal Search Bar (Floating) */}
              <div className="absolute top-4 right-4 z-20 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
                <div className="flex items-center bg-[#18181b]/90 backdrop-blur-md border border-border/80 rounded-lg text-muted-foreground overflow-hidden shadow-2xl focus-within:border-primary/50 transition-colors px-2.5 py-1.5">
                  <Search size={14} className="mr-2 text-muted-foreground/70" />
                  <input
                    aria-label="搜索终端输出"
                    onChange={(event) => {
                      window.dispatchEvent(
                        new CustomEvent<string>('terminal-agent-search', {
                          detail: event.target.value,
                        }),
                      );
                    }}
                    type="text"
                    placeholder="搜索终端输出 (Ctrl+F)"
                    className="bg-transparent border-none outline-none text-[13px] text-foreground placeholder:text-muted-foreground w-40 focus:w-56 transition-all duration-300"
                  />
                </div>
              </div>

              {activeSession === undefined ? (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  {coreClosed ? 'Core 已关闭，请重新启动应用' : '暂无终端会话'}
                </div>
              ) : (
                <TerminalView api={api} session={activeSession} />
              )}
              {isAgentPanelCollapsed && (
                <button
                  aria-label="显示 Agent 面板"
                  className="agent-panel-show-button"
                  onClick={() => setIsAgentPanelCollapsed(false)}
                  title="显示 Agent 面板"
                  type="button"
                >
                  <PanelRightOpen size={16} />
                </button>
              )}
            </div>

            {/* Agent Pane (Right) */}
            {!isAgentPanelCollapsed && (
              <div
                className={`prototype-agent min-w-0 flex flex-col bg-[#09090b] shrink-0 z-10 ${isAgentPanelResizing ? 'is-resizing' : ''}`}
                style={{ width: `${agentPanelWidth}px` }}
              >
                <div
                  aria-label="调整 Agent 面板宽度"
                  aria-orientation="vertical"
                  aria-valuemax={agentPanelMaxWidth}
                  aria-valuemin={AGENT_PANEL_MIN_WIDTH}
                  aria-valuenow={agentPanelWidth}
                  className={`agent-panel-resize-handle ${isAgentPanelResizing ? 'is-resizing' : ''}`}
                  onKeyDown={handleAgentPanelResizeKeyDown}
                  onPointerCancel={finishAgentPanelResize}
                  onPointerDown={startAgentPanelResize}
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      updateAgentPanelWidth(event.clientX);
                    }
                  }}
                  onPointerUp={finishAgentPanelResize}
                  role="separator"
                  tabIndex={0}
                  title="拖动调整 Agent 面板宽度"
                >
                  <GripVertical aria-hidden="true" size={14} />
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                  {/* Agent Timeline Header */}
                  <div className="flex border-b border-border bg-[#09090b] shrink-0">
                    <button
                      aria-selected={agentTab === 'timeline'}
                      onClick={() => setAgentTab('timeline')}
                      className={`flex-1 h-10 text-[13px] font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${agentTab === 'timeline' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/20'}`}
                      role="tab"
                      type="button"
                    >
                      <Sparkles size={14} /> Agent Timeline
                    </button>
                    <button
                      aria-selected={agentTab === 'audit'}
                      onClick={() => setAgentTab('audit')}
                      className={`flex-1 h-10 text-[13px] font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${agentTab === 'audit' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/20'}`}
                      role="tab"
                      type="button"
                    >
                      <FileText size={14} /> 审计日志 (Audit)
                    </button>
                    <button
                      aria-label="隐藏 Agent 面板"
                      className="agent-panel-collapse-button"
                      onClick={() => setIsAgentPanelCollapsed(true)}
                      title="隐藏 Agent 面板"
                      type="button"
                    >
                      <PanelRightClose size={15} />
                    </button>
                  </div>

                  {/* Chat Timeline or Audit */}
                  <div
                    aria-label={agentTab === 'audit' ? '审计日志 (Audit)' : 'Agent Timeline'}
                    className="flex-1 overflow-y-auto p-5 space-y-7"
                    onScroll={(event) => {
                      const element = event.currentTarget;
                      shouldStickTimelineToBottom.current =
                        element.scrollHeight - element.scrollTop - element.clientHeight <= 64;
                    }}
                    ref={agentTimelineRef}
                    role="tabpanel"
                  >
                    {agentTab === 'audit' ? (
                      <RuntimeAudit events={auditEvents} />
                    ) : (
                      <RuntimeTimeline
                        events={activeTimeline}
                        onApprove={approve}
                        onInterrupt={interruptCommand}
                        onTakeOver={takeOver}
                      />
                    )}
                  </div>

                  {/* Input Box */}
                  <div className="p-4 border-t border-border bg-[#09090b]">
                    <div className="border border-border focus-within:border-primary/50 focus-within:bg-secondary/10 transition-colors rounded-xl bg-[#121214] flex flex-col shadow-sm">
                      <textarea
                        aria-keyshortcuts={
                          api.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
                        }
                        disabled={coreClosed}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(event) => {
                          const modifierPressed =
                            api.platform === 'darwin' ? event.metaKey : event.ctrlKey;
                          if (event.key !== 'Enter' || event.shiftKey || !modifierPressed) return;
                          event.preventDefault();
                          void submitGoal();
                        }}
                        placeholder="输入目标，Command/Ctrl+Enter 发送"
                        className="w-full bg-transparent outline-none resize-none text-[13px] p-3.5 min-h-[60px] text-foreground placeholder:text-muted-foreground/70"
                      />
                      <div className="px-3 pb-2.5 flex items-center justify-between">
                        <button
                          aria-label="取消当前 Agent 任务"
                          className={`text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition px-2 py-1 rounded hover:bg-secondary ${activeTurn ? '' : 'hidden'}`}
                          onClick={() => void cancelTurn()}
                          type="button"
                        >
                          <XCircle size={14} /> 取消任务
                        </button>
                        <button
                          onClick={() => setIsSearchHistoryOpen(true)}
                          disabled={coreClosed}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition px-2 py-1 rounded hover:bg-secondary"
                        >
                          <Clock size={14} /> 提示词历史
                        </button>
                        <button
                          aria-label="发送给 Agent"
                          onClick={() => void submitGoal()}
                          disabled={coreClosed || !chatInput.trim() || activeTurn}
                          className={`px-5 py-1.5 rounded-md text-xs font-semibold transition-all duration-300 ${
                            chatInput.trim()
                              ? 'bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.15)] hover:bg-white/90 active:scale-[0.98]'
                              : 'bg-white/5 text-muted-foreground/40 border border-white/5 cursor-not-allowed'
                          }`}
                        >
                          {activeTurn ? '处理中…' : '发送'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {currentView === 'models' && (
          <ModelSettings
            api={api}
            models={models}
            onBack={() => setCurrentView('workspace')}
            onEdit={(model) => setModelEditor({ mode: 'edit', modelId: model.id })}
            onNew={() => setModelEditor({ mode: 'new' })}
            onRefresh={refreshConfigurations}
          />
        )}
        {currentView === 'providers' && (
          <ProviderSettings
            api={api}
            onBack={() => setCurrentView('workspace')}
            onEdit={(provider) => setProviderEditor({ mode: 'edit', providerId: provider.id })}
            onNew={() => setProviderEditor({ mode: 'new' })}
            onRefresh={refreshConfigurations}
            providers={providers}
          />
        )}
      </main>

      {/* OVERLAYS & MODALS */}

      {runtimeError !== undefined && (
        <div className="runtime-error-backdrop" role="presentation">
          <section
            aria-label="运行错误"
            aria-modal="true"
            className="runtime-error-dialog"
            role="alertdialog"
          >
            <div className="runtime-error-header">
              <div className="runtime-error-title">
                <ShieldAlert size={16} />
                <span>操作未完成</span>
              </div>
              <button
                aria-label="关闭错误提示"
                className="runtime-error-close"
                onClick={() => setRuntimeError(undefined)}
                type="button"
              >
                <X size={15} />
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
            {activeTurn && activeSession !== undefined && (
              <button
                className="runtime-error-confirm"
                onClick={() => {
                  setRuntimeError(undefined);
                  void cancelTurn();
                }}
                type="button"
              >
                取消当前任务
              </button>
            )}
          </section>
        </div>
      )}
      {isResourceMonitorOpen && (
        <ResourceMonitorPanel
          onClose={() => setIsResourceMonitorOpen(false)}
          onRefresh={refreshResources}
          resource={activeResource}
        />
      )}
      {isNewSessionModalOpen && (
        <NewSessionModal
          environment={sessionEnvironment}
          onClose={() => setIsNewSessionModalOpen(false)}
          onCreate={createSession}
        />
      )}
      {isSearchHistoryOpen && (
        <SearchHistoryModal
          onClose={() => setIsSearchHistoryOpen(false)}
          onSelect={(txt) => {
            setChatInput(txt);
            setIsSearchHistoryOpen(false);
          }}
          prompts={Array.from(
            new Set(activeHistory?.turns.map((turn) => turn.userMessage) ?? []),
          ).reverse()}
        />
      )}
      {modelEditor !== undefined && (
        <ModelEditModal
          api={api}
          model={
            modelEditor.mode === 'edit'
              ? models.find((model) => model.id === modelEditor.modelId)
              : undefined
          }
          onClose={() => setModelEditor(undefined)}
          onSaved={async () => {
            await refreshConfigurations();
            setModelEditor(undefined);
          }}
          providers={providers}
        />
      )}
      {providerEditor !== undefined && (
        <ProviderEditModal
          api={api}
          onClose={() => setProviderEditor(undefined)}
          onSaved={async () => {
            await refreshConfigurations();
            setProviderEditor(undefined);
          }}
          provider={
            providerEditor.mode === 'edit'
              ? providers.find((provider) => provider.id === providerEditor.providerId)
              : undefined
          }
        />
      )}

      {/* Dropdown Click Catcher */}
      {(isSettingsMenuOpen ||
        isAllSessionsOpen ||
        isModelMenuOpen ||
        isDialectMenuOpen ||
        isPermissionMenuOpen) && (
        <div className="fixed inset-0 z-40" onClick={closeAllDropdowns}></div>
      )}
    </div>
  );
}

function AllSessionsPopover({
  activeSessionId,
  onClose,
  onQueryChange,
  onSelect,
  query,
  sessions,
}: {
  activeSessionId: string | undefined;
  onClose: (sessionId: string) => Promise<void>;
  onQueryChange: (query: string) => void;
  onSelect: (session: SessionSummary) => void;
  query: string;
  sessions: SessionSummary[];
}): JSX.Element {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSessions = sessions.filter((session) =>
    [session.title, session.terminalType, session.pty, session.shell].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );

  return (
    <div aria-label="全部会话" className="session-all-popover" role="dialog">
      <div className="session-all-search">
        <Search size={15} />
        <input
          aria-label="搜索会话"
          autoFocus
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索会话"
          value={query}
        />
      </div>
      <div aria-label="会话列表" className="session-all-list" role="listbox">
        {visibleSessions.map((session) => (
          <div className="session-all-row" key={session.id}>
            <button
              aria-label={`${session.title} ${session.terminalType}`}
              aria-selected={session.id === activeSessionId}
              className="session-all-select"
              disabled={!isInteractiveSession(session)}
              onClick={() => onSelect(session)}
              role="option"
              type="button"
            >
              <span className="session-all-primary">
                <span className="session-all-title">{session.title}</span>
                <span className="session-all-type">{session.terminalType}</span>
              </span>
              <span className={`session-all-status is-${session.pty}`}>{session.pty}</span>
            </button>
            <button
              aria-label={`关闭 ${session.title}`}
              className="session-all-close"
              onClick={() => void onClose(session.id)}
              title={`关闭 ${session.title}`}
              type="button"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {visibleSessions.length === 0 && <div className="session-all-empty">没有匹配的会话</div>}
      </div>
    </div>
  );
}

function RuntimeTimeline({
  events,
  onApprove,
  onInterrupt,
  onTakeOver,
}: {
  events: AgentTimelineItem[];
  onApprove: (item: AgentTimelineItem) => Promise<void>;
  onInterrupt: (item: AgentTimelineItem) => Promise<void>;
  onTakeOver: () => Promise<void>;
}): JSX.Element {
  if (events.length === 0) {
    return (
      <div className="text-[13px] text-muted-foreground">
        输入目标后，Agent 的实时操作会显示在这里。
      </div>
    );
  }

  const groups = groupAgentTimelineItems(events);

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        if (group.kind === 'tool') {
          return (
            <ToolTimelineCard
              group={group}
              onInterrupt={onInterrupt}
              key={`tool-${group.toolCallId}`}
            />
          );
        }
        const event = group.event;
        if (event.kind === 'user') {
          return (
            <div className="flex gap-3" key={event.id}>
              <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center shrink-0 text-xs font-bold border border-border shadow-sm">
                ME
              </div>
              <div className="bg-secondary/40 border border-border/50 px-4 py-3 rounded-xl rounded-tl-sm text-[13px] text-foreground/90 leading-relaxed shadow-sm">
                {event.text}
              </div>
            </div>
          );
        }

        if (event.kind === 'assistant') {
          return (
            <div className="flex gap-3" key={event.id}>
              <div className="w-8 h-8 rounded bg-white text-black flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(255,255,255,0.15)]">
                <Command size={16} strokeWidth={2.5} />
              </div>
              <div className="flex-1 min-w-0 text-[13px] leading-relaxed text-foreground/90">
                <MarkdownContent>{event.text}</MarkdownContent>
              </div>
            </div>
          );
        }

        if (event.kind === 'approval') {
          const waiting = isApprovalActionable(event.status, undefined);
          const succeeded = event.status === 'completed';
          return (
            <div
              className={`rounded-lg overflow-hidden shadow-sm ${waiting ? 'border border-amber-500/50 bg-amber-500/5' : succeeded ? 'border border-border/50 bg-[#121214]' : 'border border-red-500/30 bg-[#121214]'}`}
              key={event.id}
            >
              <div
                className={`px-3 py-2.5 flex items-center justify-between ${waiting ? 'bg-amber-500/10 border-b border-amber-500/20' : succeeded ? 'bg-secondary/10 border-b border-border/50' : 'bg-red-500/5'}`}
              >
                <div
                  className={`flex items-center gap-2 text-xs font-mono ${waiting ? 'text-amber-500 font-medium' : succeeded ? 'text-muted-foreground' : 'text-red-400'}`}
                >
                  <FileText size={14} /> {event.text}
                </div>
                <span
                  className={`text-[10px] flex items-center gap-1 font-medium ${waiting ? 'text-amber-500' : succeeded ? 'text-emerald-500' : 'text-red-500'}`}
                >
                  {waiting ? (
                    <Clock size={12} />
                  ) : succeeded ? (
                    <Check size={12} />
                  ) : (
                    <XCircle size={12} />
                  )}
                  {waiting
                    ? '需要人工审批'
                    : succeeded
                      ? '已完成'
                      : event.status === 'cancelled'
                        ? '已拒绝'
                        : '已接管'}
                </span>
              </div>
              <div className="p-3 text-[11px] font-mono text-white/50 break-all bg-[#000000] leading-relaxed">
                {event.change?.path ?? event.reasons?.join('；') ?? '该操作将改变运行时状态。'}
              </div>
              {waiting && (
                <div className="px-3 py-2.5 border-t border-amber-500/20 bg-amber-500/5 flex gap-2">
                  <button
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs py-1.5 rounded transition flex justify-center items-center gap-1.5 shadow-sm"
                    onClick={() => void onApprove(event)}
                    type="button"
                  >
                    <Check size={14} /> 批准执行
                  </button>
                  <button
                    className="flex-1 bg-secondary hover:bg-secondary/80 text-foreground font-medium text-xs py-1.5 rounded transition flex justify-center items-center gap-1.5 border border-border shadow-sm"
                    onClick={() => void onTakeOver()}
                    type="button"
                  >
                    <XCircle size={14} /> 拒绝并接管
                  </button>
                </div>
              )}
            </div>
          );
        }

        return (
          <div
            className="border border-border/50 rounded-lg bg-[#121214] overflow-hidden shadow-sm"
            key={event.id}
          >
            <div className="px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <Play size={12} className="text-primary shrink-0" />
                <span className="truncate">{event.text}</span>
              </div>
              <span
                className={`shrink-0 text-[10px] flex items-center gap-1 font-medium ${event.status === 'completed' ? 'text-emerald-500' : isTerminalTimelineStatus(event.status) ? 'text-red-400' : 'text-amber-500'}`}
              >
                {event.status === 'completed' ? (
                  <Check size={12} />
                ) : isTerminalTimelineStatus(event.status) ? (
                  <XCircle size={12} />
                ) : (
                  <Clock size={12} />
                )}
                {timelineStatusLabel(event.status)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ToolTimelineCard({
  group,
  onInterrupt,
}: {
  group: Extract<ReturnType<typeof groupAgentTimelineItems>[number], { kind: 'tool' }>;
  onInterrupt: (item: AgentTimelineItem) => Promise<void>;
}): JSX.Element {
  const [interrupting, setInterrupting] = useState(false);
  const call = group.call;
  const command = group.command;
  const result = group.result;
  const callSummary = call === undefined ? undefined : parseToolCallSummary(call.text);
  const status = resolveTimelineStatus(result, command, call);
  const statusClass =
    status === 'completed' || status === 'succeeded' || status === 'success' || status === 'done'
      ? 'is-complete'
      : isTerminalTimelineStatus(status)
        ? 'is-failed'
        : 'is-running';

  return (
    <div className="agent-tool-card">
      <div className="agent-tool-call-row">
        <Play className="agent-tool-icon" size={12} />
        <span className="agent-tool-name">{callSummary?.name ?? '工具调用'}</span>
        <code className="agent-tool-command">
          {callSummary?.command ?? command?.text ?? callSummary?.arguments ?? ''}
        </code>
        <span className={`agent-tool-status ${statusClass}`}>
          {status === 'completed' ||
          status === 'succeeded' ||
          status === 'success' ||
          status === 'done' ? (
            <Check size={12} />
          ) : isTerminalTimelineStatus(status) ? (
            <XCircle size={12} />
          ) : (
            <Clock size={12} />
          )}
          {timelineStatusLabel(status)}
        </span>
        {status === 'running' && command !== undefined && (
          <button
            aria-label="中断执行"
            className="agent-tool-interrupt"
            disabled={interrupting}
            onClick={() => {
              setInterrupting(true);
              void onInterrupt(command).finally(() => setInterrupting(false));
            }}
            type="button"
          >
            <XCircle size={12} />
            {interrupting ? '中断中…' : '中断执行'}
          </button>
        )}
      </div>
      {result !== undefined && (
        <details className="agent-tool-result">
          <summary>
            <span className="agent-tool-result-label">
              <FileText size={13} /> 返回值
            </span>
            <span className="agent-tool-result-toggle">展开</span>
            <ChevronDown className="agent-tool-result-chevron" size={14} />
          </summary>
          <pre>{formatToolResult(result.text)}</pre>
        </details>
      )}
    </div>
  );
}

function parseToolCallSummary(
  text: string,
): { name: string; command?: string; arguments?: string } | undefined {
  const newline = text.indexOf('\n');
  if (newline < 1) return undefined;
  const name = text.slice(0, newline).trim();
  const argumentsText = text.slice(newline + 1).trim();
  try {
    const argumentsValue: unknown = JSON.parse(argumentsText);
    const command =
      typeof argumentsValue === 'object' && argumentsValue !== null
        ? (argumentsValue as { command?: unknown }).command
        : undefined;
    return {
      name,
      ...(typeof command === 'string' ? { command } : {}),
      ...(typeof command === 'string' ? {} : { arguments: argumentsText }),
    };
  } catch {
    return { name, arguments: argumentsText };
  }
}

function formatToolResult(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function RuntimeAudit({ events }: { events: AuditEventView[] }): JSX.Element {
  if (events.length === 0) {
    return <div className="text-[13px] text-muted-foreground">暂无审计记录</div>;
  }
  return (
    <div className="text-sm font-mono text-muted-foreground/60 space-y-3">
      {events.map((event) => (
        <div className="flex gap-4" key={event.id}>
          <span className="text-white/20 shrink-0">{formatAuditTime(event.occurredAt)}</span>
          <span className="text-emerald-500">[{auditTypeZh(event.type)}]</span>
          <span>{event.summary}</span>
        </div>
      ))}
    </div>
  );
}

function timelineStatusLabel(status: string | undefined): string {
  if (
    status === 'completed' ||
    status === 'succeeded' ||
    status === 'success' ||
    status === 'done'
  ) {
    return '已完成';
  }
  if (
    status === 'failed' ||
    status === 'fatal_error' ||
    status === 'recoverable_error' ||
    status === 'shell_lost' ||
    status === 'protocol_error'
  ) {
    return '失败';
  }
  if (status === 'cancelled') return '已取消';
  if (status === 'interrupted') return '已中断';
  if (status === 'waiting_user' || status === 'interaction_required') return '等待接管';
  return '进行中';
}

function formatAuditTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

// --- CONFIGURATION VIEWS ---

function ModelSettings({
  api,
  models,
  onBack,
  onEdit,
  onNew,
  onRefresh,
}: {
  api: DesktopApi;
  models: ModelConfigurationView[];
  onBack: () => void;
  onEdit: (model: ModelConfigurationView) => void;
  onNew: () => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [pendingId, setPendingId] = useState<string>();
  const [error, setError] = useState<string>();
  const run = async (id: string, operation: () => Promise<unknown>): Promise<void> => {
    setPendingId(id);
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
    <div className="absolute inset-0 p-8 overflow-y-auto bg-[#09090b] animate-in fade-in duration-200 z-30">
      <div className="max-w-5xl mx-auto">
        <button
          onClick={onBack}
          className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          <ArrowLeft size={16} /> 返回工作区
        </button>
        <h1 className="text-2xl font-bold mb-2">模型配置 (Model Configuration)</h1>
        <p className="text-muted-foreground mb-8">管理用于 Terminal Agent 的推理模型与权限级别。</p>
        {error !== undefined && <div className="mb-4 text-sm text-red-400">{error}</div>}

        <div className="bg-[#18181b] border border-border/50 rounded-xl overflow-hidden shadow-sm">
          <table aria-label="模型配置列表" className="w-full text-sm text-left">
            <thead className="bg-[#09090b] text-muted-foreground border-b border-border/50">
              <tr>
                <th className="px-5 py-4 font-medium">模型名称</th>
                <th className="px-5 py-4 font-medium">服务商 (Provider)</th>
                <th className="px-5 py-4 font-medium">运行状态</th>
                <th className="px-5 py-4 font-medium">默认</th>
                <th className="px-5 py-4 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {models.map((model) => {
                const pending = pendingId === model.id;
                return (
                  <tr className="hover:bg-secondary/20 transition-colors" key={model.id}>
                    <td className="px-5 py-4 font-medium text-foreground">
                      <div>{model.name}</div>
                      <div className="mt-1 text-xs font-mono text-muted-foreground">
                        {model.modelId}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{model.providerName}</td>
                    <td className="px-5 py-4">
                      <button
                        aria-label={`${model.name} 启用状态`}
                        className={`border px-2.5 py-1 rounded text-xs font-medium ${model.enabled ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-secondary text-muted-foreground border-border/50'}`}
                        disabled={pending}
                        onClick={() =>
                          void run(model.id, () => api.models.setEnabled(model.id, !model.enabled))
                        }
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
                        className={`text-xs ${model.isDefault ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}
                        disabled={pending || !model.enabled}
                        onClick={() =>
                          void run(model.id, () =>
                            api.models.setDefault(model.id, !model.isDefault),
                          )
                        }
                        type="button"
                      >
                        {model.isDefault ? '默认模型' : '设为默认'}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          aria-label={`编辑 ${model.name}`}
                          onClick={() => onEdit(model)}
                          className="text-primary text-xs font-medium hover:underline"
                          type="button"
                        >
                          编辑
                        </button>
                        <button
                          aria-label={`检测 ${model.name}`}
                          disabled={pending}
                          onClick={() => void run(model.id, () => api.models.test(model.id))}
                          className="text-xs text-muted-foreground hover:text-foreground"
                          type="button"
                        >
                          检测
                        </button>
                        <button
                          aria-label={`删除 ${model.name}`}
                          disabled={pending}
                          onClick={() => void run(model.id, () => api.models.remove(model.id))}
                          className="text-xs text-red-400 hover:text-red-300"
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
          onClick={onNew}
          className="mt-5 flex items-center gap-2 bg-secondary/50 text-foreground px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-secondary border border-border/50 transition-colors shadow-sm"
          type="button"
        >
          <Plus size={16} /> 添加模型配置
        </button>
      </div>
    </div>
  );
}

function ProviderSettings({
  api,
  providers,
  onBack,
  onEdit,
  onNew,
  onRefresh,
}: {
  api: DesktopApi;
  providers: ProviderProfileView[];
  onBack: () => void;
  onEdit: (provider: ProviderProfileView) => void;
  onNew: () => void;
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
    <div className="absolute inset-0 p-8 overflow-y-auto bg-[#09090b] animate-in fade-in duration-200 z-30">
      <div className="max-w-5xl mx-auto">
        <button
          onClick={onBack}
          className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          <ArrowLeft size={16} /> 返回工作区
        </button>
        <h1 className="text-2xl font-bold mb-2">服务商凭据 (Provider Profiles)</h1>
        <p className="text-muted-foreground mb-8">
          配置 API 服务商协议、Base URL 及安全存储的凭证。
        </p>
        {error !== undefined && <div className="mb-4 text-sm text-red-400">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {providers.map((provider) => (
            <div
              className="bg-[#18181b] border border-border/50 rounded-xl p-6 shadow-sm hover:border-border transition-colors"
              key={provider.id}
            >
              <div className="flex items-start justify-between mb-5 gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[15px] text-foreground truncate">
                    {provider.name}
                  </h3>
                  <div className="text-xs text-muted-foreground mt-1.5">
                    协议: {provider.protocol}
                  </div>
                </div>
                <span
                  className={
                    provider.credentialConfigured
                      ? 'bg-emerald-500/10 text-emerald-500 text-xs px-2.5 py-1 rounded font-medium border border-emerald-500/20'
                      : 'bg-secondary text-muted-foreground text-xs px-2.5 py-1 rounded font-medium border border-border/50'
                  }
                >
                  {provider.credentialConfigured ? '已配置' : '未配置 Key'}
                </span>
              </div>
              <div className="text-sm font-mono text-muted-foreground bg-[#09090b] p-3 rounded-lg border border-border/50 mb-5 truncate shadow-inner">
                {provider.baseUrl}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onEdit(provider)}
                  className="flex-1 py-2.5 border border-border/50 bg-[#09090b] rounded-lg text-sm font-medium hover:bg-secondary transition-colors text-foreground"
                  type="button"
                >
                  测试连接 / 编辑
                </button>
                <button
                  aria-label={`删除 ${provider.name}`}
                  disabled={pendingId === provider.id}
                  onClick={() => void remove(provider)}
                  className="px-3 py-2.5 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/10"
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
          {providers.length === 0 && (
            <div className="text-sm text-muted-foreground">暂无 Provider，请先新增一个连接。</div>
          )}
        </div>
        <button
          onClick={onNew}
          className="mt-8 flex items-center gap-2 bg-white text-black px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-white/90 transition-colors shadow-sm"
          type="button"
        >
          <Plus size={16} /> 新增 Provider
        </button>
      </div>
    </div>
  );
}

// --- MODALS & PANELS ---

function ResourceMonitorPanel({
  onClose,
  onRefresh,
  resource,
}: {
  onClose: () => void;
  onRefresh: () => Promise<void>;
  resource: ResourceViewState;
}): JSX.Element {
  const snapshot = resource.snapshot;
  const cpuMetric = snapshot?.cpu;
  const memoryMetric = snapshot?.memory;
  const networkMetric = snapshot?.network;
  const cpu = cpuMetric?.status === 'available' ? cpuMetric.value.usagePercent : undefined;
  const memory = memoryMetric?.status === 'available' ? memoryMetric.value : undefined;
  const network = networkMetric?.status === 'available' ? networkMetric.value : undefined;
  const memoryPercent =
    memory === undefined || memory.totalBytes <= 0
      ? undefined
      : Math.round((memory.usedBytes / memory.totalBytes) * 100);

  return (
    <div
      aria-label="目标资源监控"
      className="absolute right-4 top-16 w-[340px] bg-[#18181b] border border-border shadow-2xl rounded-xl z-50 overflow-hidden flex flex-col animate-in slide-in-from-top-4 duration-200"
      role="dialog"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-[#09090b]">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Server size={14} className="text-primary" /> 目标资源监控
        </div>
        <button
          aria-label="关闭资源监控"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary transition-colors"
          type="button"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            最后更新:{' '}
            {snapshot === undefined ? '尚未获取' : formatResourceTime(snapshot.collectedAt)}
          </span>
          <button
            onClick={() => void onRefresh()}
            className="flex items-center gap-1 text-[11px] bg-secondary border border-border px-2 py-1 rounded hover:bg-secondary/80 transition-colors"
            type="button"
          >
            <RefreshCw
              size={12}
              className={resource.status === 'refreshing' ? 'animate-spin' : ''}
            />{' '}
            获取/刷新
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#09090b] border border-border/50 p-3 rounded-lg">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
              <Cpu size={12} /> CPU
            </div>
            <div className="text-[15px] font-mono font-medium">
              {cpu === undefined ? '不可用' : `${cpu}%`}
            </div>
            <div className="w-full h-1 bg-secondary mt-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, cpu ?? 0))}%` }}
              ></div>
            </div>
          </div>
          <div className="bg-[#09090b] border border-border/50 p-3 rounded-lg">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
              <HardDrive size={12} /> Memory
            </div>
            <div className="text-[15px] font-mono font-medium">
              {memory === undefined
                ? '不可用'
                : `${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}`}
            </div>
            <div className="w-full h-1 bg-secondary mt-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${memoryPercent ?? 0}%` }}
              ></div>
            </div>
          </div>
        </div>

        <div className="bg-[#09090b] border border-border/50 p-3 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Network size={14} /> Network I/O
          </div>
          <div className="text-right text-[11px] font-mono text-foreground/80">
            <div>
              ↓{' '}
              {network === undefined
                ? '不可用'
                : formatBytes(network.reduce((sum, item) => sum + item.receivedBytes, 0))}
            </div>
            <div>
              ↑{' '}
              {network === undefined
                ? '不可用'
                : formatBytes(network.reduce((sum, item) => sum + item.transmittedBytes, 0))}
            </div>
          </div>
        </div>
        {resource.error !== undefined && (
          <div className="text-xs text-red-400">{resource.error}</div>
        )}
      </div>
    </div>
  );
}

function formatResourceTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return '刚刚';
  return `${Math.floor(elapsed / 60_000)} 分钟前`;
}

function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const rounded = Math.round(amount * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

function NewSessionModal({
  environment,
  onClose,
  onCreate,
}: {
  environment: SessionEnvironment;
  onClose: () => void;
  onCreate: (
    title: string,
    shellKind: SessionEnvironment['shells'][number]['kind'],
  ) => Promise<void>;
}): JSX.Element {
  const availableShells = environment.shells.filter((shell) => shell.available);
  const [title, setTitle] = useState('');
  const [shellKind, setShellKind] = useState<SessionEnvironment['shells'][number]['kind']>(
    () => availableShells[0]?.kind ?? 'bash',
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (availableShells.some((shell) => shell.kind === shellKind)) return;
    const first = availableShells[0];
    if (first !== undefined) setShellKind(first.kind);
  }, [availableShells, shellKind]);

  const create = async (): Promise<void> => {
    if (!title.trim()) {
      setError('请输入会话名称。');
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      await onCreate(title.trim(), shellKind);
    } catch (caught) {
      setError(errorMessageZh(caught));
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        aria-label="新建终端会话"
        aria-modal="true"
        className="bg-[#18181b] border border-border w-full max-w-md rounded-xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        role="dialog"
      >
        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-[#09090b] rounded-t-xl">
          <h2 className="text-[15px] font-semibold">新建终端会话</h2>
          <button
            aria-label="关闭新建终端会话"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-5">
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            新 Session 会从当前用户主目录启动。在终端中自行完成跳转与认证，Agent 仅操作就绪的
            Session。
          </p>
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-session-name"
            >
              会话名称
            </label>
            <input
              id="prototype-session-name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              type="text"
              placeholder="例如: 生产环境-K8S"
              className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-[13px] font-medium text-foreground/90"
              htmlFor="prototype-session-shell"
            >
              系统 Shell
            </label>
            <select
              id="prototype-session-shell"
              value={shellKind}
              onChange={(event) =>
                setShellKind(event.target.value as SessionEnvironment['shells'][number]['kind'])
              }
              className="w-full bg-[#09090b] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary appearance-none transition-colors"
            >
              {environment.shells.map((shell) => (
                <option disabled={!shell.available} key={shell.kind} value={shell.kind}>
                  {shell.label}
                  {shell.available ? '' : '（不可用）'}
                </option>
              ))}
            </select>
          </div>
          {error !== undefined && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2 bg-[#09090b] rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium hover:bg-secondary rounded-lg transition-colors"
            type="button"
          >
            取消
          </button>
          <button
            disabled={creating || availableShells.length === 0 || !environment.home}
            onClick={() => void create()}
            className="px-4 py-2 bg-white text-black text-xs font-semibold rounded-lg hover:bg-white/90 transition-colors shadow-sm disabled:opacity-40"
            type="button"
          >
            {creating ? '正在创建…' : '创建并连接'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SearchHistoryModal({
  onClose,
  onSelect,
  prompts,
}: {
  onClose: () => void;
  onSelect: (txt: string) => void;
  prompts: string[];
}): JSX.Element {
  const [query, setQuery] = useState('');
  const history = prompts.filter((prompt) =>
    prompt.toLocaleLowerCase('en-US').includes(query.toLocaleLowerCase('en-US')),
  );
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col items-center pt-[15vh] p-4 animate-in fade-in duration-200">
      <div
        aria-label="提示词历史"
        aria-modal="true"
        className="bg-[#18181b] border border-border w-full max-w-2xl rounded-xl shadow-2xl flex flex-col animate-in slide-in-from-top-10 duration-200"
        role="dialog"
      >
        <div className="flex items-center px-4 py-3 border-b border-border/50 bg-[#09090b] rounded-t-xl">
          <Search size={16} className="text-muted-foreground mr-3" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="text"
            placeholder="搜索提示词历史..."
            autoFocus
            className="flex-1 bg-transparent border-none outline-none text-sm text-foreground"
          />
          <button
            aria-label="关闭提示词历史"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-2 space-y-1 max-h-[40vh] overflow-y-auto">
          {history.map((txt, i) => (
            <button
              key={i}
              onClick={() => onSelect(txt)}
              className="w-full text-left p-3 text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors flex items-start gap-3"
              type="button"
            >
              <History size={14} className="mt-0.5 shrink-0 opacity-50" />
              {txt}
            </button>
          ))}
          {history.length === 0 && (
            <div className="px-3 py-5 text-[13px] text-muted-foreground">暂无历史提示词</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelEditModal({
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

function ProviderEditModal({
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

function newModelInput(providerProfileId: string): ModelConfigurationInput {
  const supportedReasoningEfforts: ReasoningEffort[] = ['low', 'medium', 'high'];
  return {
    id: `model-${crypto.randomUUID()}`,
    name: '',
    providerProfileId,
    modelId: '',
    declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
    contextWindowTokens: 128_000,
    maxOutputTokens: 4_096,
    autoCompact: true,
    compactThresholdPercent: 80,
    supportedReasoningEfforts,
    defaultReasoningEffort: 'medium',
  };
}

function modelInput(model: ModelConfigurationView): ModelConfigurationInput {
  return {
    id: model.id,
    name: model.name,
    providerProfileId: model.providerProfileId,
    modelId: model.modelId,
    declaredCapabilities: model.declaredCapabilities,
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    autoCompact: model.autoCompact,
    compactThresholdPercent: model.compactThresholdPercent,
    supportedReasoningEfforts: model.supportedReasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
  };
}

function newProviderInput(): ProviderProfileInput {
  return {
    id: `provider-${crypto.randomUUID()}`,
    name: '',
    protocol: 'openai_responses',
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
    ...(provider.extraHeaders === undefined ? {} : { extraHeaders: provider.extraHeaders }),
    ...(provider.timeoutMs === undefined ? {} : { timeoutMs: provider.timeoutMs }),
  };
}
