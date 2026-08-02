import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cpu,
  Settings,
  Plus,
  Sparkles,
  ShieldAlert,
  Check,
  XCircle,
  Search,
  FileText,
  ChevronDown,
  Key,
  X,
  Network,
  RefreshCw,
  Command,
  Box,
  List,
  Clock,
  Power,
  GripVertical,
  Link2,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';

import { McpSettingsView } from '../mcp/mcp-settings-view.js';
import { AcpSettingsView } from '../acp/acp-settings-view.js';
import { createMockDesktopApi } from './mock-api.js';
import { mergeAcpHistoryIntoTimeline, RuntimeAudit, RuntimeTimeline } from './agent-panel/index.js';
import { AllSessionsPopover, NewSessionModal, SearchHistoryModal } from './sessions/index.js';
import {
  ModelEditModal,
  ModelSettings,
  ProviderEditModal,
  ProviderSettings,
} from './settings/index.js';
import { ResourceMonitorPanel, type ResourceViewState } from './resource/index.js';
import {
  AGENT_PANEL_MIN_WIDTH,
  clampAgentPanelWidth,
  getAgentPanelMaxWidth,
  getDefaultAgentPanelWidth,
  getViewportWidth,
} from './utils/panel-layout.js';
import {
  isTerminalTimelineStatus,
  mergeHydratedTimeline,
  upsertTimelineEvent,
} from '@synapse-term/ui-platform';
import type {
  AcpHistoryView,
  AcpStatus,
  AgentHistoryView,
  AgentTimelineItem,
  AuditEventView,
  DesktopApi,
  ModelConfigurationView,
  ProviderProfileView,
  SessionEnvironment,
  SessionSummary,
} from '../preload/preload-api.js';
import { buildSessionLaunch } from './session-launch.js';
import { errorMessageZh, TerminalView } from '@synapse-term/ui-platform';
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

const permissionLabels: Record<PermissionMode, string> = {
  manual: '人工审批',
  auto: '自动审批',
  full_access: '完全权限',
};

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
  const [currentView, setCurrentView] = useState<
    'workspace' | 'models' | 'providers' | 'mcp' | 'acp'
  >('workspace');
  const [agentTab, setAgentTab] = useState<'timeline' | 'audit'>('timeline');
  const [chatInput, setChatInput] = useState('');
  const [timeline, setTimeline] = useState<AgentTimelineItem[]>([]);
  const [histories, setHistories] = useState<Record<string, AgentHistoryView>>({});
  const [acpHistories, setAcpHistories] = useState<Record<string, AcpHistoryView>>({});
  const [acpActiveTurnIds, setAcpActiveTurnIds] = useState<Record<string, string>>({});
  const [auditEvents, setAuditEvents] = useState<AuditEventView[]>([]);
  const [resources, setResources] = useState<Record<string, ResourceViewState>>({});
  const [startingTurn, setStartingTurn] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string>();
  const [coreClosed, setCoreClosed] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [agentPanelWidth, setAgentPanelWidth] = useState(getDefaultAgentPanelWidth);
  const [isAgentPanelCollapsed, setIsAgentPanelCollapsed] = useState(false);
  const [isAgentPanelResizing, setIsAgentPanelResizing] = useState(false);
  const [driver, setDriver] = useState<'builtin' | 'acp'>('builtin');
  const [acpStatus, setAcpStatus] = useState<AcpStatus | undefined>(undefined);
  const sessionTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const agentTimelineRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const shouldStickTimelineToBottom = useRef(true);
  const historyRequestVersions = useRef(new Map<string, number>());
  const historyRequests = useRef(new Map<string, Promise<void>>());
  const acpHistoryRequests = useRef(new Map<string, Promise<void>>());
  const pendingHistoryRefreshes = useRef(new Set<string>());
  const pendingAcpHistoryRefreshes = useRef(new Set<string>());
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
  const activeBuiltinHistory =
    activeSession === undefined ? undefined : histories[activeSession.id];
  const activeAcpHistory = activeSession === undefined ? undefined : acpHistories[activeSession.id];
  const activeHistory = activeBuiltinHistory;
  const activeTimeline = timeline.filter(
    (item) => item.sessionId === activeSession?.id && (item.driver ?? 'builtin') === driver,
  );
  const activeResource =
    activeSession === undefined
      ? { status: 'idle' as const }
      : (resources[activeSession.id] ?? { status: 'idle' as const });
  const activeTurn =
    startingTurn ||
    (driver === 'acp'
      ? activeSession !== undefined && acpActiveTurnIds[activeSession.id] !== undefined
      : activeBuiltinHistory?.activeTurnId !== undefined);
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

  const clearAcpActiveTurn = useCallback((sessionId: string): void => {
    setAcpActiveTurnIds((items) => {
      if (items[sessionId] === undefined) return items;
      const next = { ...items };
      delete next[sessionId];
      return next;
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

  /** ACP 历史：投影为独立时间线（driver=acp），与内置历史互不干扰（specs/acp-driver 4.7） */
  const refreshAcpHistory = useCallback(
    (sessionId: string): void => {
      if (acpHistoryRequests.current.has(sessionId)) {
        pendingAcpHistoryRefreshes.current.add(sessionId);
        return;
      }
      const requestVersion = historyVersion(sessionId);
      const request = api.acp
        .history(sessionId)
        .then((history) => {
          if (historyVersion(sessionId) !== requestVersion) return;
          timeoutRecoverySessions.current.delete(sessionId);
          setAcpHistories((items) => ({ ...items, [sessionId]: history }));
          setTimeline((items) => mergeAcpHistoryIntoTimeline(items, sessionId, history));
        })
        .catch(() => {
          // ACP 历史暂不可用时保留现有时间线，不打断当前对话
        })
        .finally(() => {
          acpHistoryRequests.current.delete(sessionId);
          if (pendingAcpHistoryRefreshes.current.delete(sessionId)) {
            refreshAcpHistory(sessionId);
          }
        });
      acpHistoryRequests.current.set(sessionId, request);
    },
    [api],
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
      const eventDriver = event.driver ?? 'builtin';
      if (
        (event.kind === 'assistant' || event.kind === 'system') &&
        isTerminalTimelineStatus(event.status)
      ) {
        if (eventDriver === 'acp') clearAcpActiveTurn(event.sessionId);
        else clearActiveTurn(event.sessionId);
      }
      if (eventDriver === 'acp') refreshAcpHistory(event.sessionId);
      else refreshAgentHistory(event.sessionId);
    });
    return () => {
      dispose();
    };
  }, [api, clearActiveTurn, clearAcpActiveTurn, refreshAgentHistory, refreshAcpHistory]);

  useEffect(() => {
    let cancelled = false;
    void api.acp
      .status()
      .then((status) => {
        if (!cancelled) setAcpStatus(status);
      })
      .catch(() => undefined);
    const unsubscribe = api.acp.onStatusChanged((status) => {
      if (!cancelled) setAcpStatus(status);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

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
    if (driver === 'acp') refreshAcpHistory(activeSession.id);
    else refreshAgentHistory(activeSession.id);
    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, api, driver, refreshAgentHistory, refreshAcpHistory]);

  // ACP 全局开关被关闭时自动退回内置驱动者（子进程已由主进程终止）
  useEffect(() => {
    if (driver === 'acp' && acpStatus?.enabled === false) setDriver('builtin');
  }, [acpStatus?.enabled, driver]);

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

  const switchDriver = (next: 'builtin' | 'acp'): void => {
    if (next === driver) return;
    if (next === 'acp' && acpStatus?.enabled !== true) return;
    setDriver(next);
    setStartingTurn(false);
    setRuntimeError(undefined);
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
      if (driver === 'acp') {
        const started = await api.acp.startTurn(sessionId, goal);
        setAcpActiveTurnIds((items) => ({ ...items, [sessionId]: started.turnId }));
        setAcpHistories((items) => ({
          ...items,
          [sessionId]: items[sessionId] ?? {
            sessionId,
            turns: [],
            projection: { userText: [], assistantText: [], toolCalls: [] },
          },
        }));
      } else {
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
      }
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
      if ((item.driver ?? 'builtin') === 'acp') {
        // ACP 单一审批通道：批准后外部 Agent 以 approved_once 继续执行
        await api.acp.respondApproval(item.id, true);
        return;
      }
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

  const takeOver = async (item?: AgentTimelineItem): Promise<void> => {
    if (coreClosed || activeSession === undefined) return;
    try {
      if (item !== undefined && (item.driver ?? 'builtin') === 'acp') {
        // ACP 无内置“接管”语义：拒绝当前审批并取消外部 Agent 任务
        await api.acp.respondApproval(item.id, false);
        await api.acp.cancelTurn(activeSession.id);
        return;
      }
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
        setAcpHistories((acpItems) => {
          if (acpItems[sessionId] === undefined) return acpItems;
          const next = { ...acpItems };
          delete next[sessionId];
          return next;
        });
        setAcpActiveTurnIds((turnIds) => {
          if (turnIds[sessionId] === undefined) return turnIds;
          const next = { ...turnIds };
          delete next[sessionId];
          return next;
        });
        setActiveSessionId((current) =>
          chooseInitialSessionId(remaining, current === sessionId ? '' : current),
        );
        return remaining;
      });
      if (driver === 'acp') {
        void api.acp.closeConversation(sessionId).catch(() => undefined);
      }
      if (!options.keepAllSessionsOpen) closeAllDropdowns();
      setRuntimeError(undefined);
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    }
  };

  /** 复制会话 ID：先标记 Shared Session（外部调用可寻址），再写入剪贴板 */
  const copySessionId = async (session: SessionSummary): Promise<void> => {
    if (coreClosed) return;
    try {
      const updated = await api.sessions.markShared(session.id);
      await navigator.clipboard?.writeText(updated.id);
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setRuntimeError(undefined);
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const cancelTurn = async (): Promise<void> => {
    if (coreClosed || activeSession === undefined) return;
    try {
      if (driver === 'acp') await api.acp.cancelTurn(activeSession.id);
      else await api.agent.cancel(activeSession.id);
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
    if (coreClosed || activeSession === undefined || activeTurn) return;
    const sessionId = activeSession.id;
    if (driver === 'acp') {
      if (activeAcpHistory?.conversation === undefined) return;
      if (!window.confirm('确认关闭当前 ACP 对话？外部 Agent 子进程将被终止。')) return;
      bumpHistoryVersion(sessionId);
      try {
        await api.acp.closeConversation(sessionId);
        setAcpHistories((items) => ({
          ...items,
          [sessionId]: {
            sessionId,
            turns: [],
            projection: { userText: [], assistantText: [], toolCalls: [] },
          },
        }));
        setTimeline((items) =>
          items.filter(
            (item) => item.sessionId !== sessionId || (item.driver ?? 'builtin') !== 'acp',
          ),
        );
        shouldStickTimelineToBottom.current = true;
        setRuntimeError(undefined);
      } catch (caught) {
        setRuntimeError(errorMessageZh(caught));
      }
      return;
    }
    if (activeHistory?.conversation === undefined) return;
    if (!window.confirm('确认清空当前 Agent 会话？该操作会移除当前会话的历史消息。')) return;

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
      setAcpHistories({});
      setAcpActiveTurnIds({});
      setDriver('builtin');
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
                <button
                  aria-label={`复制 ${session.title} 的会话 ID`}
                  className="session-tab-copy"
                  onClick={(event) => {
                    event.stopPropagation();
                    void copySessionId(session);
                  }}
                  title={
                    session.shared === true
                      ? '会话已共享，点击重新复制 ID'
                      : '复制会话 ID（共享给外部 Agent 调用）'
                  }
                  type="button"
                >
                  <Link2 size={12} />
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
                  <Box size={14} /> 模型配置
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
                  <Key size={14} /> 服务商配置
                </button>
                <button
                  onClick={() => {
                    setCurrentView('mcp');
                    closeAllDropdowns();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary text-left transition-colors"
                  role="menuitem"
                  type="button"
                >
                  <Network size={14} /> MCP 服务
                </button>
                <button
                  onClick={() => {
                    setCurrentView('acp');
                    closeAllDropdowns();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary text-left transition-colors"
                  role="menuitem"
                  type="button"
                >
                  <Sparkles size={14} /> ACP 集成
                </button>
                <button
                  aria-label="清空当前 Agent 会话"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={
                    activeTurn ||
                    (driver === 'acp'
                      ? activeAcpHistory?.conversation === undefined
                      : activeHistory?.conversation === undefined)
                  }
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
                  <Power size={14} /> 退出 Core
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
                      <FileText size={14} /> 审计日志
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

                  {/* 驱动者切换：内置 Agent / 外部 Agent（ACP） */}
                  {agentTab === 'timeline' && (
                    <>
                      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-[#0c0c0e] shrink-0">
                        <button
                          aria-pressed={driver === 'builtin'}
                          className={`flex-1 text-xs font-medium rounded-md px-2 py-1.5 transition-colors ${driver === 'builtin' ? 'bg-primary/15 text-foreground border border-primary/40' : 'text-muted-foreground hover:bg-secondary/60 border border-transparent'}`}
                          onClick={() => switchDriver('builtin')}
                          type="button"
                        >
                          内置 Agent
                        </button>
                        <button
                          aria-pressed={driver === 'acp'}
                          className={`flex-1 text-xs font-medium rounded-md px-2 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${driver === 'acp' ? 'bg-primary/15 text-foreground border border-primary/40' : 'text-muted-foreground hover:bg-secondary/60 border border-transparent'}`}
                          disabled={acpStatus?.enabled !== true}
                          onClick={() => switchDriver('acp')}
                          type="button"
                        >
                          外部 Agent
                        </button>
                      </div>
                      {driver === 'acp' && acpStatus?.enabled !== true && (
                        <div className="px-3 py-1.5 text-[11px] text-amber-400/90 bg-amber-500/5 border-b border-border shrink-0">
                          ACP 集成未启用：请到 设置 → ACP 集成 打开后使用外部驱动者。
                        </div>
                      )}
                    </>
                  )}

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
        {currentView === 'mcp' && (
          <McpSettingsView api={api} onBack={() => setCurrentView('workspace')} />
        )}
        {currentView === 'acp' && (
          <AcpSettingsView api={api} onBack={() => setCurrentView('workspace')} />
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
            new Set(
              (driver === 'acp'
                ? activeAcpHistory?.turns.map((turn) => turn.userMessage)
                : activeHistory?.turns.map((turn) => turn.userMessage)) ?? [],
            ),
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

/** ACP 历史投影为 timeline 项（driver=acp），供面板展示与审计（specs/acp-driver 4.6） */

/** 合并 ACP 历史到时间线：保留实时事件，仅替换该会话的合成历史项（避免重复） */
