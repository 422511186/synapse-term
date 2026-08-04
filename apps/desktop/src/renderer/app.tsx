import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Cpu,
  Settings,
  Plus,
  Sparkles,
  ShieldAlert,
  Check,
  Search,
  FileText,
  Image as ImageIcon,
  Paperclip,
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
  Loader2,
  Pencil,
  Send,
  Square,
} from 'lucide-react';

import { McpSettingsView } from '../mcp/mcp-settings-view.js';
import { AcpSettingsView } from '../acp/acp-settings-view.js';
import { ConfirmDialog, ToastProvider } from './feedback/index.js';
import { createMockDesktopApi } from './mock-api.js';
import { mergeAcpHistoryIntoTimeline, RuntimeTimeline } from './agent-panel/index.js';
import { RunningStatusBar } from './agent-panel/running-status-bar.js';
import { shouldShowThinkingPlaceholder } from './agent-panel/running-status.js';
import {
  composerActionReducer,
  createComposerActionState,
  getComposerAction,
} from './agent-panel/composer-action.js';
import {
  appendSentPrompt,
  buildPromptHistory,
  movePromptHistory,
} from './agent-panel/composer-prompt-history.js';
import { filterAgentSlashCommands } from './agent-panel/agent-slash-commands.js';
import type { AgentSlashCommand } from './agent-panel/agent-slash-commands.js';
import { SlashCommandPopover } from './agent-panel/slash-command-popover.js';
import { AllSessionsPopover, NewSessionModal, SearchHistoryModal } from './sessions/index.js';
import {
  AuditSettings,
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
  applyAgentTextDelta,
  applyAgentTimelineEvent,
  createAgentTimelineState,
  hydrateAgentTimelineState,
  isTerminalTimelineStatus,
} from '@synapse-term/ui-platform';
import type {
  AcpHistoryView,
  AgentHistoryView,
  AgentTimelineItem,
  DesktopApi,
  ModelConfigurationView,
  PickedAgentAttachment,
  ProviderProfileView,
  SessionEnvironment,
  SessionSummary,
} from '../preload/preload-api.js';
import { buildSessionLaunch } from './session-launch.js';
import { getSessionAvailability } from './session-status.js';
import { errorMessageZh, TerminalView } from '@synapse-term/ui-platform';
import { chooseInitialSessionId, isInteractiveSession } from './session-selection.js';

const AGENT_ATTACHMENT_MAX_ITEMS = 8;

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

type PendingConfirm =
  | { kind: 'approve'; item: AgentTimelineItem }
  | { kind: 'closeSession'; sessionId: string; keepAllSessionsOpen?: boolean }
  | { kind: 'resetAcp' }
  | { kind: 'resetBuiltin' }
  | { kind: 'exitCore' };

const permissionLabels: Record<PermissionMode, string> = {
  manual: '人工审批',
  auto: '自动审批',
  full_access: '完全权限',
};

const PERMISSION_MODES: readonly PermissionMode[] = ['manual', 'auto', 'full_access'];

function formatAttachmentSize(sizeBytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = sizeBytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Math.round(value * 10) / 10} ${units[unit]}`;
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
  const [sessionContextMenu, setSessionContextMenu] = useState<
    { sessionId: string; x: number; y: number } | undefined
  >();
  const [sessionRename, setSessionRename] = useState<
    { sessionId: string; value: string } | undefined
  >();
  const [sessionRenameBusy, setSessionRenameBusy] = useState(false);
  const [sessionActionMessage, setSessionActionMessage] = useState<string>();
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
    'workspace' | 'models' | 'providers' | 'mcp' | 'acp' | 'audit'
  >('workspace');
  const [chatInput, setChatInput] = useState('');
  const [chatHistoryIndex, setChatHistoryIndex] = useState<number | undefined>();
  const [chatHistoryDraft, setChatHistoryDraft] = useState<string | undefined>();
  const [sentPromptHistory, setSentPromptHistory] = useState<Record<string, string[]>>({});
  const [pendingAttachments, setPendingAttachments] = useState<PickedAgentAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [composerSelectedIndex, setComposerSelectedIndex] = useState(0);
  const [composerPanel, setComposerPanel] = useState<
    { kind: 'model' } | { kind: 'permission' } | undefined
  >();
  const [timeline, setTimeline] = useState<AgentTimelineItem[]>([]);
  const [histories, setHistories] = useState<Record<string, AgentHistoryView>>({});
  const [acpHistories, setAcpHistories] = useState<Record<string, AcpHistoryView>>({});
  const [acpActiveTurnIds, setAcpActiveTurnIds] = useState<Record<string, string>>({});
  const [resources, setResources] = useState<Record<string, ResourceViewState>>({});
  const [startingTurn, setStartingTurn] = useState(false);
  const [turnStartedAt, setTurnStartedAt] = useState<number>();
  const [hasTurnActivity, setHasTurnActivity] = useState(false);
  const [cancellingTurn, setCancellingTurn] = useState(false);
  const [composerActionState, dispatchComposerAction] = useReducer(
    composerActionReducer,
    undefined,
    createComposerActionState,
  );
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>();
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string>();
  const [coreClosed, setCoreClosed] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [agentPanelWidth, setAgentPanelWidth] = useState(getDefaultAgentPanelWidth);
  const [isAgentPanelResizing, setIsAgentPanelResizing] = useState(false);
  const [driver, setDriver] = useState<'builtin' | 'acp'>('builtin');
  const sessionTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const agentTimelineRef = useRef<HTMLDivElement>(null);
  const terminalSearchInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const shouldStickTimelineToBottom = useRef(true);
  const historyRequestVersions = useRef(new Map<string, number>());
  const historyRequests = useRef(new Map<string, Promise<void>>());
  const acpHistoryRequests = useRef(new Map<string, Promise<void>>());
  const pendingHistoryRefreshes = useRef(new Set<string>());
  const pendingAcpHistoryRefreshes = useRef(new Set<string>());
  const timeoutRecoverySessions = useRef(new Set<string>());
  const activeSessionIdRef = useRef('');
  const agentTimelineStateRef = useRef(createAgentTimelineState());
  const textDeltaRenderFrameRef = useRef<number | undefined>(undefined);

  // Dynamic Label States
  const [currentDialect, setCurrentDialect] = useState<SessionSummary['executionDialect']>('posix');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('manual');

  useEffect(() => {
    if (sessionActionMessage === undefined) return;
    const timeoutId = window.setTimeout(() => setSessionActionMessage(undefined), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [sessionActionMessage]);

  const closeAllDropdowns = () => {
    setIsSettingsMenuOpen(false);
    setIsAllSessionsOpen(false);
    setIsModelMenuOpen(false);
    setIsDialectMenuOpen(false);
    setIsPermissionMenuOpen(false);
    setSessionContextMenu(undefined);
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
  const promptHistory = buildPromptHistory(
    activeSession === undefined ? undefined : sentPromptHistory[activeSession.id],
    driver === 'acp'
      ? (activeAcpHistory?.turns.map((turn) => turn.userMessage) ?? [])
      : (activeHistory?.turns.map((turn) => turn.userMessage) ?? []),
  );
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
  const composerAction = getComposerAction(composerActionState, chatInput);
  const slashCommands = filterAgentSlashCommands(chatInput, activeTurn);
  const slashEnabledIndices = slashCommands
    .map((command, index) => (command.disabled === true ? -1 : index))
    .filter((index) => index >= 0);
  const slashPopoverOpen = slashCommands.length > 0 && composerPanel === undefined;
  const attachmentsDisabled =
    coreClosed || activeSession === undefined || driver === 'acp' || activeTurn;
  const imageAttachmentsDisabled =
    attachmentsDisabled || activeModel?.declaredCapabilities.multimodal !== true;
  const attachmentLimitReached = pendingAttachments.length >= AGENT_ATTACHMENT_MAX_ITEMS;
  const agentPanelMaxWidth = getAgentPanelMaxWidth(
    workspaceRef.current?.clientWidth ?? getViewportWidth(),
  );
  activeSessionIdRef.current = activeSessionId;

  useEffect(() => {
    const handleTerminalSearchShortcut = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'f' || (!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }
      const input = terminalSearchInputRef.current;
      if (input === null) return;
      event.preventDefault();
      event.stopPropagation();
      input.focus({ preventScroll: true });
      input.select();
    };
    window.addEventListener('keydown', handleTerminalSearchShortcut, true);
    return () => window.removeEventListener('keydown', handleTerminalSearchShortcut, true);
  }, [activeSession?.id]);

  useEffect(() => {
    setChatHistoryIndex(undefined);
    setChatHistoryDraft(undefined);
  }, [activeSessionId, driver]);

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
          setTimeline((items) => {
            const hydrated = hydrateAgentTimelineState(
              { ...agentTimelineStateRef.current, items },
              history,
            );
            agentTimelineStateRef.current = hydrated;
            return hydrated.items;
          });
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
      const eventDriver = event.driver ?? 'builtin';
      setTimeline(() => {
        let nextState = applyAgentTimelineEvent(agentTimelineStateRef.current, event);
        if (
          eventDriver === 'builtin' &&
          event.kind === 'assistant' &&
          isTerminalTimelineStatus(event.status)
        ) {
          nextState = hydrateAgentTimelineState(nextState, [event]);
        }
        agentTimelineStateRef.current = nextState;
        return nextState.items;
      });
      if (
        (event.kind === 'assistant' || event.kind === 'system') &&
        isTerminalTimelineStatus(event.status)
      ) {
        if (eventDriver === 'acp') clearAcpActiveTurn(event.sessionId);
        else clearActiveTurn(event.sessionId);
      }
      if (event.sessionId === activeSessionIdRef.current && event.kind !== 'user') {
        setHasTurnActivity(true);
      }
      if (eventDriver === 'acp') refreshAcpHistory(event.sessionId);
      else refreshAgentHistory(event.sessionId);
    });
    const disposeTextDelta = api.agent.onTextDelta((event) => {
      const current = agentTimelineStateRef.current;
      const next = applyAgentTextDelta(current, event);
      agentTimelineStateRef.current = next;
      if (next.items !== current.items && textDeltaRenderFrameRef.current === undefined) {
        textDeltaRenderFrameRef.current = requestAnimationFrame(() => {
          textDeltaRenderFrameRef.current = undefined;
          setTimeline(agentTimelineStateRef.current.items);
        });
      }
      if (
        !current.historyRefreshSessions.includes(event.sessionId) &&
        next.historyRefreshSessions.includes(event.sessionId)
      ) {
        refreshAgentHistory(event.sessionId);
      }
      if (event.sessionId === activeSessionIdRef.current) setHasTurnActivity(true);
    });
    return () => {
      dispose();
      disposeTextDelta();
      if (textDeltaRenderFrameRef.current !== undefined) {
        cancelAnimationFrame(textDeltaRenderFrameRef.current);
        textDeltaRenderFrameRef.current = undefined;
      }
    };
  }, [api, clearActiveTurn, clearAcpActiveTurn, refreshAgentHistory, refreshAcpHistory]);

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
    void Promise.all([api.resources.get(activeSession.id)])
      .then(([snapshot]) => {
        if (cancelled || historyVersion(activeSession.id) !== requestVersion) return;
        if (snapshot !== undefined) {
          setResources((items) => ({
            ...items,
            [activeSession.id]: { status: 'ready', snapshot },
          }));
        }
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

  // 任务结束后复位运行状态（耗时与思考占位）
  useEffect(() => {
    if (!activeTurn) {
      setTurnStartedAt(undefined);
      setHasTurnActivity(false);
    }
    dispatchComposerAction({ type: activeTurn ? 'task-started' : 'task-ended' });
  }, [activeTurn]);

  useEffect(() => {
    if (slashEnabledIndices.length === 0) return;
    if (!slashEnabledIndices.includes(slashSelectedIndex)) {
      setSlashSelectedIndex(slashEnabledIndices[0]!);
    }
  }, [chatInput, activeTurn]);

  useEffect(() => {
    shouldStickTimelineToBottom.current = true;
  }, [activeSession?.id]);

  useEffect(() => {
    const element = agentTimelineRef.current;
    if (element === null || !shouldStickTimelineToBottom.current) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTimeline, activeSession?.id]);

  useEffect(() => {
    setActiveSessionId((current) => chooseInitialSessionId(sessions, current));
  }, [sessions]);

  const selectSession = (session: SessionSummary): void => {
    setActiveSessionId(session.id);
    closeAllDropdowns();
    setPendingAttachments([]);
    setAttachmentError(undefined);
    setComposerPanel(undefined);
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
    dispatchComposerAction({ type: 'task-started' });
    setStartingTurn(true);
    setTurnStartedAt(Date.now());
    setHasTurnActivity(false);
    setChatInput('');
    setChatHistoryIndex(undefined);
    setChatHistoryDraft(undefined);
    setComposerPanel(undefined);
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
          ...(pendingAttachments.length === 0 ? {} : { attachments: pendingAttachments }),
        });
        setHistories((items) => ({
          ...items,
          [sessionId]: {
            ...(items[sessionId] ?? { sessionId, turns: [], items: [] }),
            activeTurnId: started.turnId,
          },
        }));
        setPendingAttachments([]);
        setAttachmentError(undefined);
      }
      setSentPromptHistory((items) => ({
        ...items,
        [sessionId]: appendSentPrompt(items[sessionId] ?? [], goal),
      }));
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    } finally {
      setStartingTurn(false);
    }
  };

  const pickAttachments = async (kind: 'image' | 'file'): Promise<void> => {
    if (coreClosed || activeSession === undefined || driver === 'acp' || activeTurn) return;
    if (kind === 'image' && activeModel?.declaredCapabilities.multimodal !== true) {
      setAttachmentError('当前模型不支持图片输入。');
      return;
    }
    if (attachmentLimitReached) {
      setAttachmentError(`一次任务最多可携带 ${AGENT_ATTACHMENT_MAX_ITEMS} 个附件。`);
      return;
    }
    setAttachmentBusy(true);
    setAttachmentError(undefined);
    try {
      const picked = await api.attachments.pick({
        kind,
        currentCount: pendingAttachments.length,
      });
      const nextCount = pendingAttachments.length + picked.length;
      if (nextCount > AGENT_ATTACHMENT_MAX_ITEMS) {
        setAttachmentError(`一次任务最多可携带 ${AGENT_ATTACHMENT_MAX_ITEMS} 个附件。`);
        return;
      }
      setPendingAttachments((current) => [...current, ...picked]);
    } catch (caught) {
      setAttachmentError(errorMessageZh(caught));
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removeAttachment = (attachmentId: string): void => {
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.attachmentId !== attachmentId),
    );
    setAttachmentError(undefined);
  };

  const approve = async (item: AgentTimelineItem): Promise<void> => {
    if (coreClosed || activeSession === undefined) return;
    if (item.risk === 'destructive') {
      setPendingConfirm({ kind: 'approve', item });
      return;
    }
    await submitApproval(item);
  };

  const submitApproval = async (item: AgentTimelineItem): Promise<void> => {
    if (coreClosed || activeSession === undefined) return;
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
        buildSessionLaunch(title, sessionEnvironment.home, shell, sessions),
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

  const requestCloseSession = (
    sessionId: string,
    options: { keepAllSessionsOpen?: boolean } = {},
  ): void => {
    if (coreClosed) return;
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (session === undefined) return;
    const hasActiveTask =
      histories[sessionId]?.activeTurnId !== undefined || acpActiveTurnIds[sessionId] !== undefined;
    const terminalIsBusy = session.pty === 'starting' || session.pty === 'running';
    if (terminalIsBusy || hasActiveTask) {
      setPendingConfirm({
        kind: 'closeSession',
        sessionId,
        ...(options.keepAllSessionsOpen === undefined
          ? {}
          : { keepAllSessionsOpen: options.keepAllSessionsOpen }),
      });
      return;
    }
    void closeSession(sessionId, options);
  };

  const openSessionRename = (session: SessionSummary): void => {
    setSessionContextMenu(undefined);
    setSessionRename({ sessionId: session.id, value: session.title });
  };

  const submitSessionRename = async (): Promise<void> => {
    const draft = sessionRename;
    if (draft === undefined || sessionRenameBusy) return;
    const alias = draft.value.trim();
    if (alias.length === 0) return;
    setSessionRenameBusy(true);
    try {
      const updated = await api.sessions.rename(draft.sessionId, alias);
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setSessionRename(undefined);
      setRuntimeError(undefined);
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    } finally {
      setSessionRenameBusy(false);
    }
  };

  /** 复制会话 ID：先标记 Shared Session（外部调用可寻址），再写入剪贴板 */
  const copySessionId = async (session: SessionSummary): Promise<void> => {
    if (coreClosed) return;
    try {
      const updated = await api.sessions.markShared(session.id);
      if (navigator.clipboard?.writeText === undefined) {
        throw new Error('当前环境不支持复制 Session ID');
      }
      await navigator.clipboard.writeText(updated.id);
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setSessionActionMessage('Session ID 已复制');
      setRuntimeError(undefined);
    } catch (caught) {
      setSessionActionMessage('Session ID 复制失败');
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const cancelTurn = async (): Promise<void> => {
    if (coreClosed || activeSession === undefined || cancellingTurn) return;
    dispatchComposerAction({ type: 'cancel-requested' });
    setCancellingTurn(true);
    try {
      if (driver === 'acp') await api.acp.cancelTurn(activeSession.id);
      else await api.agent.cancel(activeSession.id);
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    } finally {
      setCancellingTurn(false);
      dispatchComposerAction({ type: 'cancel-settled' });
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
    if (driver === 'acp') {
      if (activeAcpHistory?.conversation === undefined) return;
      setPendingConfirm({ kind: 'resetAcp' });
      return;
    }
    if (activeHistory?.conversation === undefined) return;
    setPendingConfirm({ kind: 'resetBuiltin' });
  };

  const executeSlashCommand = (command: AgentSlashCommand): void => {
    if (command.disabled === true) return;
    setChatInput('');
    setChatHistoryIndex(undefined);
    setChatHistoryDraft(undefined);
    setComposerPanel(undefined);
    setAttachmentError(undefined);
    switch (command.id) {
      case 'model':
        if (eligibleModels.length > 0) {
          setComposerSelectedIndex(
            Math.max(
              0,
              eligibleModels.findIndex((model) => model.id === activeModel?.id),
            ),
          );
          setComposerPanel({ kind: 'model' });
        }
        break;
      case 'permission':
        setComposerSelectedIndex(Math.max(0, PERMISSION_MODES.indexOf(permissionMode)));
        setComposerPanel({ kind: 'permission' });
        break;
      case 'clear':
        void resetConversation();
        break;
    }
  };

  const performResetAcp = async (): Promise<void> => {
    if (coreClosed || activeSession === undefined || activeAcpHistory?.conversation === undefined) {
      return;
    }
    const sessionId = activeSession.id;
    bumpHistoryVersion(sessionId);
    try {
      await api.acp.closeConversation(sessionId);
      setPendingAttachments([]);
      setAttachmentError(undefined);
      setComposerPanel(undefined);
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
  };

  const performResetBuiltin = async (): Promise<void> => {
    if (coreClosed || activeSession === undefined || activeHistory?.conversation === undefined) {
      return;
    }
    const sessionId = activeSession.id;
    const conversationId = activeHistory.conversation.id;
    bumpHistoryVersion(sessionId);
    try {
      await api.agent.resetConversation(sessionId, conversationId);
      setPendingAttachments([]);
      setAttachmentError(undefined);
      setComposerPanel(undefined);
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
    setPendingConfirm({ kind: 'exitCore' });
  };

  const performCloseCore = async (): Promise<void> => {
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
      setResources({});
      setChatInput('');
      setChatHistoryIndex(undefined);
      setChatHistoryDraft(undefined);
      setPendingAttachments([]);
      setAttachmentError(undefined);
      setComposerPanel(undefined);
      setCurrentView('workspace');
      closeAllDropdowns();
      setRuntimeError('Core 已关闭，请重新启动应用以继续使用。');
    } catch (caught) {
      setRuntimeError(errorMessageZh(caught));
    }
  };

  const runPendingConfirm = async (): Promise<void> => {
    const pending = pendingConfirm;
    if (pending === undefined || confirmBusy) return;
    setConfirmBusy(true);
    try {
      if (pending.kind === 'approve') {
        await submitApproval(pending.item);
      } else if (pending.kind === 'closeSession') {
        await closeSession(pending.sessionId, {
          ...(pending.keepAllSessionsOpen === undefined
            ? {}
            : { keepAllSessionsOpen: pending.keepAllSessionsOpen }),
        });
      } else if (pending.kind === 'resetAcp') {
        await performResetAcp();
      } else if (pending.kind === 'resetBuiltin') {
        await performResetBuiltin();
      } else {
        await performCloseCore();
      }
      setPendingConfirm(undefined);
    } finally {
      setConfirmBusy(false);
    }
  };

  const pendingConfirmView = (() => {
    switch (pendingConfirm?.kind) {
      case 'approve':
        return {
          title: '确认批准破坏性操作',
          description: `命令：${pendingConfirm.item.text}。该操作具有破坏性，确认继续执行？`,
          confirmLabel: '批准执行',
        };
      case 'closeSession': {
        const session = sessions.find((item) => item.id === pendingConfirm.sessionId);
        return {
          title: '关闭运行中的会话',
          description: `${session?.title ?? '此会话'} 仍有终端或 Agent 任务在运行，确认关闭？`,
          confirmLabel: '关闭会话',
        };
      }
      case 'resetAcp':
        return {
          title: '关闭当前 ACP 对话',
          description: '外部 Agent 子进程将被终止，当前对话历史将被清空。',
          confirmLabel: '关闭对话',
        };
      case 'resetBuiltin':
        return {
          title: '清空当前 Agent 会话',
          description: '该操作会移除当前会话的历史消息。',
          confirmLabel: '清空会话',
        };
      case 'exitCore':
        return {
          title: '退出 Core',
          description: '所有当前终端会话和 PTY 都会结束，但本地配置和审计数据会保留。',
          confirmLabel: '退出 Core',
        };
      default:
        return undefined;
    }
  })();

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
    <ToastProvider>
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
              {interactiveSessions.map((session) => {
                const availability = getSessionAvailability(session);
                return (
                  <div
                    className={`session-tab ${session.id === activeSession?.id ? 'is-active' : ''}`}
                    key={session.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSessionContextMenu({
                        sessionId: session.id,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
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
                      <span
                        aria-label={availability.label}
                        className={`session-status-dot is-${availability.tone}`}
                        title={availability.label}
                      />
                      <span className="session-tab-copy-block">
                        <span className="session-tab-title">{session.title}</span>
                        <span className="session-tab-type">{session.terminalType}</span>
                      </span>
                    </button>
                    <button
                      aria-label={`关闭 ${session.title}`}
                      className="session-tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        requestCloseSession(session.id);
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
            <div className="session-tab-tools" role="group" aria-label="会话操作">
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
                className="session-tab-tool session-tab-tool-wide"
                onClick={() => {
                  const wasOpen = isAllSessionsOpen;
                  closeAllDropdowns();
                  setIsAllSessionsOpen(!wasOpen);
                }}
                title="全部会话"
                type="button"
              >
                <List size={16} />
                <span className="session-action-label">全部会话</span>
              </button>
              <button
                aria-label="共享并复制当前 Session ID"
                className="session-tab-tool session-tab-tool-wide"
                disabled={coreClosed || activeSession === undefined}
                onClick={() => {
                  if (activeSession !== undefined) void copySessionId(activeSession);
                }}
                title="共享并复制当前 Session ID"
                type="button"
              >
                <Link2 size={15} />
                <span className="session-action-label">共享 ID</span>
              </button>
            </div>
            {isAllSessionsOpen && (
              <AllSessionsPopover
                activeSessionId={activeSession?.id}
                onClose={(sessionId) => {
                  requestCloseSession(sessionId, { keepAllSessionsOpen: true });
                }}
                onQueryChange={setSessionSearch}
                onSelect={selectSession}
                query={sessionSearch}
                sessions={sessions}
              />
            )}
            {sessionContextMenu !== undefined && (
              <div
                aria-label="会话操作菜单"
                className="session-context-menu"
                role="menu"
                style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }}
              >
                <button
                  onClick={() => {
                    const session = sessions.find(
                      (item) => item.id === sessionContextMenu.sessionId,
                    );
                    if (session !== undefined) openSessionRename(session);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Pencil size={14} /> 重命名
                </button>
              </div>
            )}
            {sessionActionMessage !== undefined && (
              <div aria-live="polite" className="session-action-feedback" role="status">
                {sessionActionMessage}
              </div>
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
                  Object.entries(dialectLabels) as Array<
                    [SessionSummary['executionDialect'], string]
                  >
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
                    onClick={() => {
                      setCurrentView('audit');
                      closeAllDropdowns();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary text-left transition-colors"
                    role="menuitem"
                    type="button"
                  >
                    <FileText size={14} /> 审计日志
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
                      ref={terminalSearchInputRef}
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
              </div>

              {/* Agent Pane (Right) */}
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
                  <div
                    aria-label="Agent 时间线"
                    className="flex-1 overflow-y-auto p-5 space-y-7"
                    onScroll={(event) => {
                      const element = event.currentTarget;
                      shouldStickTimelineToBottom.current =
                        element.scrollHeight - element.scrollTop - element.clientHeight <= 64;
                    }}
                    ref={agentTimelineRef}
                    role="tabpanel"
                  >
                    <RuntimeTimeline
                      events={activeTimeline}
                      onApprove={approve}
                      onInterrupt={interruptCommand}
                      onTakeOver={takeOver}
                      thinking={shouldShowThinkingPlaceholder(activeTurn, hasTurnActivity)}
                    />
                  </div>

                  <RunningStatusBar
                    modelName={activeModel?.name}
                    running={activeTurn}
                    startedAt={turnStartedAt}
                  />

                  {/* Input Box */}
                  <div className="p-4 border-t border-border bg-[#09090b]">
                    <div className="relative border border-border focus-within:border-primary/50 focus-within:bg-secondary/10 transition-colors rounded-xl bg-[#121214] flex flex-col shadow-sm">
                      {slashPopoverOpen && (
                        <SlashCommandPopover
                          commands={slashCommands}
                          onSelect={executeSlashCommand}
                          selectedIndex={slashSelectedIndex}
                        />
                      )}
                      {composerPanel !== undefined && (
                        <div className="absolute bottom-full left-0 right-0 mb-2 z-30 max-h-64 overflow-y-auto rounded-lg border border-border bg-[#0e0e10] shadow-2xl">
                          {composerPanel.kind === 'model' && (
                            <div aria-label="Composer 模型选择" className="p-2" role="group">
                              <div className="flex items-center justify-between px-1 py-1">
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  选择当前模型
                                </span>
                                <button
                                  aria-label="关闭模型选择"
                                  className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary"
                                  onClick={() => setComposerPanel(undefined)}
                                  type="button"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                              {eligibleModels.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-muted-foreground">
                                  没有已启用的模型，请先到模型配置中启用。
                                </div>
                              ) : (
                                <div className="space-y-1 px-1 pb-1" role="listbox">
                                  {eligibleModels.map((model, index) => {
                                    const selected = composerSelectedIndex === index;
                                    return (
                                      <button
                                        aria-selected={selected}
                                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-[12px] transition-colors border ${
                                          selected
                                            ? 'bg-primary/10 border-primary/30 text-foreground'
                                            : 'border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                                        } ${activeTurn ? 'opacity-40' : ''}`}
                                        disabled={activeTurn}
                                        key={model.id}
                                        onClick={() => {
                                          setActiveModelId(model.id);
                                          setComposerPanel(undefined);
                                        }}
                                        role="option"
                                        type="button"
                                      >
                                        <Box size={13} className="shrink-0 text-primary" />
                                        <span className="truncate">{model.name}</span>
                                        {activeModel?.id === model.id && (
                                          <Check size={12} className="shrink-0 text-primary" />
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                          {composerPanel.kind === 'permission' && (
                            <div aria-label="Composer 权限选择" className="p-2" role="group">
                              <div className="flex items-center justify-between px-1 py-1">
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  切换权限模式
                                </span>
                                <button
                                  aria-label="关闭权限选择"
                                  className="text-muted-foreground hover:text-foreground p-1.5 hover:bg-secondary rounded"
                                  onClick={() => setComposerPanel(undefined)}
                                  type="button"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                              <div className="space-y-1 px-1 pb-1" role="listbox">
                                {PERMISSION_MODES.map((mode, index) => {
                                  const selected = composerSelectedIndex === index;
                                  return (
                                    <button
                                      aria-selected={selected}
                                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-[12px] transition-colors border ${
                                        selected
                                          ? 'bg-primary/10 border-primary/30 text-foreground'
                                          : 'border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                                      } ${activeTurn ? 'opacity-40' : ''}`}
                                      disabled={activeTurn}
                                      key={mode}
                                      onClick={() => {
                                        setPermissionMode(mode);
                                        setComposerPanel(undefined);
                                      }}
                                      role="option"
                                      type="button"
                                    >
                                      <ShieldAlert size={13} className="shrink-0 text-primary" />
                                      <span>{permissionLabels[mode]}</span>
                                      {permissionMode === mode && (
                                        <Check size={12} className="shrink-0 text-primary" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <textarea
                        aria-keyshortcuts={
                          api.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
                        }
                        disabled={coreClosed}
                        value={chatInput}
                        onChange={(e) => {
                          setChatInput(e.target.value);
                          setChatHistoryIndex(undefined);
                          setChatHistoryDraft(undefined);
                          if (e.target.value.trim() !== '') setComposerPanel(undefined);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            if (composerPanel !== undefined) {
                              event.preventDefault();
                              setComposerPanel(undefined);
                              return;
                            }
                            if (slashPopoverOpen) {
                              event.preventDefault();
                              setChatInput('');
                            }
                            return;
                          }
                          if (slashPopoverOpen) {
                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                              event.preventDefault();
                              if (slashEnabledIndices.length > 0) {
                                const currentPosition =
                                  slashEnabledIndices.indexOf(slashSelectedIndex);
                                const nextOffset = event.key === 'ArrowDown' ? 1 : -1;
                                const nextPosition =
                                  (currentPosition + nextOffset + slashEnabledIndices.length) %
                                  slashEnabledIndices.length;
                                setSlashSelectedIndex(slashEnabledIndices[nextPosition]!);
                              }
                              return;
                            }
                            if (event.key === 'Enter' && !event.shiftKey) {
                              const selected = slashCommands[slashSelectedIndex];
                              if (selected !== undefined && selected.disabled !== true) {
                                event.preventDefault();
                                executeSlashCommand(selected);
                                return;
                              }
                            }
                          }
                          if (composerPanel !== undefined) {
                            const optionCount =
                              composerPanel.kind === 'model'
                                ? eligibleModels.length
                                : PERMISSION_MODES.length;
                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                              if (optionCount > 0) {
                                event.preventDefault();
                                const offset = event.key === 'ArrowDown' ? 1 : -1;
                                setComposerSelectedIndex(
                                  (current) => (current + offset + optionCount) % optionCount,
                                );
                              }
                              return;
                            }
                            if (event.key === 'Enter' && !event.shiftKey && !activeTurn) {
                              event.preventDefault();
                              if (composerPanel.kind === 'model') {
                                const model = eligibleModels[composerSelectedIndex];
                                if (model !== undefined) {
                                  setActiveModelId(model.id);
                                  setComposerPanel(undefined);
                                }
                              } else {
                                const mode = PERMISSION_MODES[composerSelectedIndex];
                                if (mode !== undefined) {
                                  setPermissionMode(mode);
                                  setComposerPanel(undefined);
                                }
                              }
                              return;
                            }
                          }
                          if (
                            composerPanel === undefined &&
                            (event.key === 'ArrowUp' || event.key === 'ArrowDown')
                          ) {
                            const navigation = movePromptHistory(
                              event.key === 'ArrowUp' ? 'previous' : 'next',
                              promptHistory,
                              chatInput,
                              {
                                index: chatHistoryIndex,
                                draft: chatHistoryDraft,
                              },
                            );
                            if (navigation === undefined) return;
                            setChatInput(navigation.input);
                            setChatHistoryIndex(navigation.state.index);
                            setChatHistoryDraft(navigation.state.draft);
                            event.preventDefault();
                            return;
                          }
                          const modifierPressed =
                            api.platform === 'darwin' ? event.metaKey : event.ctrlKey;
                          if (event.key !== 'Enter' || event.shiftKey || !modifierPressed) {
                            return;
                          }
                          event.preventDefault();
                          void submitGoal();
                        }}
                        placeholder="输入目标，Command/Ctrl+Enter 发送"
                        className="w-full bg-transparent outline-none resize-none text-[13px] p-3.5 min-h-[60px] text-foreground placeholder:text-muted-foreground/70"
                      />
                      {pendingAttachments.length > 0 && (
                        <div className="px-3 pb-2 flex flex-wrap gap-2">
                          {pendingAttachments.map((attachment) => (
                            <span
                              className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-secondary/60 border border-border/70 text-[11px] text-muted-foreground"
                              key={attachment.attachmentId}
                            >
                              {attachment.kind === 'image' ? (
                                <ImageIcon size={13} className="text-primary shrink-0" />
                              ) : (
                                <FileText size={13} className="text-primary shrink-0" />
                              )}
                              <span className="max-w-[170px] truncate">{attachment.name}</span>
                              <span className="shrink-0 text-[10px] opacity-70">
                                {formatAttachmentSize(attachment.sizeBytes)}
                              </span>
                              <button
                                aria-label={`移除 ${attachment.name}`}
                                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => removeAttachment(attachment.attachmentId)}
                                type="button"
                              >
                                <X size={11} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {attachmentError !== undefined && (
                        <div aria-live="polite" className="px-3 pb-2 text-[11px] text-red-400">
                          {attachmentError}
                        </div>
                      )}
                      <div className="px-3 pb-2.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            aria-label="添加图片"
                            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={imageAttachmentsDisabled || attachmentBusy}
                            onClick={() => void pickAttachments('image')}
                            title={
                              driver === 'acp'
                                ? '外部 Agent 不支持附件'
                                : activeModel?.declaredCapabilities.multimodal === true
                                  ? '添加图片'
                                  : '当前模型不支持图片输入'
                            }
                            type="button"
                          >
                            <ImageIcon size={14} />
                          </button>
                          <button
                            aria-label="添加文件"
                            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={attachmentsDisabled || attachmentBusy}
                            onClick={() => void pickAttachments('file')}
                            title={driver === 'acp' ? '外部 Agent 不支持附件' : '添加任意本地文件'}
                            type="button"
                          >
                            <Paperclip size={14} />
                          </button>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            aria-label="提示词历史"
                            onClick={() => setIsSearchHistoryOpen(true)}
                            disabled={coreClosed}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition px-2 py-1 rounded hover:bg-secondary"
                            title="提示词历史"
                            type="button"
                          >
                            <Clock size={14} />
                          </button>
                          <button
                            aria-label={
                              composerAction.kind === 'stop'
                                ? '停止当前 Agent 任务'
                                : '发送给 Agent'
                            }
                            onClick={() =>
                              void (composerAction.kind === 'stop' ? cancelTurn() : submitGoal())
                            }
                            disabled={coreClosed || composerAction.disabled}
                            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-all duration-300 ${
                              composerAction.disabled
                                ? 'bg-white/5 text-muted-foreground/40 border border-white/5 cursor-not-allowed'
                                : composerAction.kind === 'stop'
                                  ? 'border border-red-400/35 bg-red-500/10 text-red-300 hover:bg-red-500/20 active:scale-[0.98]'
                                  : 'bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.15)] hover:bg-white/90 active:scale-[0.98]'
                            }`}
                            type="button"
                          >
                            {composerAction.kind === 'stop' ? (
                              composerAction.disabled ? (
                                <Loader2 className="animate-spin" size={12} />
                              ) : (
                                <Square fill="currentColor" size={11} />
                              )
                            ) : (
                              <Send size={12} />
                            )}
                            {composerAction.label}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {currentView === 'models' && (
            <ModelSettings
              api={api}
              models={models}
              onBack={() => setCurrentView('workspace')}
              onEdit={(model) => setModelEditor({ mode: 'edit', modelId: model.id })}
              onNew={() => setModelEditor({ mode: 'new' })}
              onModelsChange={setModels}
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
          {currentView === 'audit' && (
            <AuditSettings
              api={api}
              onBack={() => setCurrentView('workspace')}
              sessionId={activeSession?.id}
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
            </section>
          </div>
        )}
        {pendingConfirmView !== undefined && (
          <ConfirmDialog
            confirmLabel={pendingConfirmView.confirmLabel}
            danger
            description={pendingConfirmView.description}
            onCancel={() => setPendingConfirm(undefined)}
            onConfirm={() => void runPendingConfirm()}
            open
            pending={confirmBusy}
            title={pendingConfirmView.title}
          />
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
            sessions={sessions}
            onClose={() => setIsNewSessionModalOpen(false)}
            onCreate={createSession}
          />
        )}
        {sessionRename !== undefined && (
          <div className="session-rename-backdrop" role="presentation">
            <section
              aria-label="重命名会话"
              aria-modal="true"
              className="session-rename-dialog"
              role="dialog"
            >
              <div className="session-rename-header">
                <div>
                  <div className="session-rename-eyebrow">Session Alias</div>
                  <h2>重命名会话</h2>
                </div>
                <button
                  aria-label="关闭重命名会话"
                  className="session-rename-close"
                  onClick={() => setSessionRename(undefined)}
                  type="button"
                >
                  <X size={15} />
                </button>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitSessionRename();
                }}
              >
                <label htmlFor="session-rename-input">名称</label>
                <input
                  autoFocus
                  id="session-rename-input"
                  onChange={(event) =>
                    setSessionRename((current) =>
                      current === undefined ? current : { ...current, value: event.target.value },
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setSessionRename(undefined);
                  }}
                  value={sessionRename.value}
                />
                <div className="session-rename-actions">
                  <button onClick={() => setSessionRename(undefined)} type="button">
                    取消
                  </button>
                  <button
                    disabled={sessionRenameBusy || sessionRename.value.trim().length === 0}
                    type="submit"
                  >
                    {sessionRenameBusy ? '保存中…' : '保存'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
        {isSearchHistoryOpen && (
          <SearchHistoryModal
            onClose={() => setIsSearchHistoryOpen(false)}
            onSelect={(txt) => {
              setChatInput(txt);
              setChatHistoryIndex(undefined);
              setChatHistoryDraft(undefined);
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
            onDraftSaved={refreshConfigurations}
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
          isPermissionMenuOpen ||
          sessionContextMenu !== undefined) && (
          <div className="fixed inset-0 z-40" onClick={closeAllDropdowns}></div>
        )}
      </div>
    </ToastProvider>
  );
}

/** ACP 历史投影为 timeline 项（driver=acp），供面板展示与审计（specs/acp-driver 4.6） */

/** 合并 ACP 历史到时间线：保留实时事件，仅替换该会话的合成历史项（避免重复） */
