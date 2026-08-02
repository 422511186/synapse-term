/**
 * ACP 外部驱动者控制器（specs/acp-driver、ADR-0025 ~ ADR-0031）
 *
 * 桌面主进程侧的单一入口：
 * 1. 持有 ACP 设置（userData/acp/settings.json），两级开关（设置允许 + 面板开始任务）都满足才 spawn；
 * 2. 以 CLI 子进程（opencode acp --pure，stdio）运行外部 Agent，
 *    通过 @zed-industries/agent-client-protocol 的 ClientSideConnection 建立 ACP 会话；
 * 3. 只声明 terminal（终端执行）与 fs.readTextFile（只读文件）能力；
 * 4. 所有平台工具调用统一走 Core API external.*（classify / execute / observe / wait /
 *    interrupt / readFile / recordRejection），不直接触碰 PTY、Policy 或审计内部实现；
 * 5. 单一审批通道：Policy 自动裁决回 allow_once；需人批时发出现有审批卡片，
 *    用户批准后以 approved_once 模式继续走同一执行管线；非平台工具拒绝并审计；
 * 6. 保存 Conversation Projection（user_text / assistant_text / 工具调用摘要）供展示与审计，
 *    完整上下文由外部 Agent 进程自管。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { Writable } from 'node:stream';
import type { Readable } from 'node:stream';

import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@zed-industries/agent-client-protocol';
import type { AgentTimelineItem } from '@synapse-term/ui-platform';

import {
  createAcpSettingsStore,
  type AcpApprovalMode,
  type AcpSettings,
  type AcpSettingsStore,
} from './acp-settings.js';

/**
 * 将子进程 stdout 包装为 ACP ndJsonStream 所需的 Web ReadableStream。
 * 手动包装以兼容不同 Node/TS 版本下 Readable.toWeb 的泛型差异，并处理 stdout 为空的情况。
 */
function childStdoutToWebStream(stdout: Readable | null): ReadableStream<Uint8Array> {
  if (!stdout) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stdout.on('data', (chunk: Buffer | string) => {
        controller.enqueue(
          Buffer.isBuffer(chunk)
            ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
            : new TextEncoder().encode(String(chunk)),
        );
      });
      stdout.on('end', () => controller.close());
      stdout.on('error', (error) => controller.error(error));
    },
    cancel() {
      stdout.destroy();
    },
  });
}

/** 外部调用者固定身份：单用户本机应用，来源固定为 ACP 接入线 */
const ACP_CALLER = {
  kind: 'acp' as const,
  id: 'acp-opencode',
  displayName: 'opencode（ACP 外部驱动者）',
};

/** ACP 客户端能力声明（ADR-0027）：只声明终端执行与只读文件，不声明任何写能力 */
const ACP_CLIENT_CAPABILITIES = {
  fs: { readTextFile: true },
  terminal: true,
} as const;

/** 平台工具名集合：外部 Agent 对这些工具发起 permission request 时走平台闸门 */
const PLATFORM_TOOL_NAMES: ReadonlySet<string> = new Set([
  'terminal_execute',
  'terminal_observe',
  'terminal_wait',
  'terminal_interrupt',
  'local_read_file',
  'local_list_files',
  'local_search_files',
  'createTerminal',
  'readTextFile',
]);

export interface AcpControllerStatus {
  enabled: boolean;
  running: boolean;
  approvalMode: AcpApprovalMode;
  activeSessionId?: string;
  activeTurn: boolean;
  agentName?: string;
}

/** ACP 审批请求：渲染进程通过审批卡片上的 id 回传决定（单一审批通道，ADR-0030） */
export interface AcpApprovalRequest {
  id: string;
  sessionId: string;
  command: string;
  risk: string;
  toolName: string;
  occurredAt: string;
}

/** Conversation Projection 视图：供 Agent 面板展示与审计（D20 / ADR-0031） */
export interface AcpHistoryView {
  sessionId: string;
  conversation?: {
    id: string;
    sessionId: string;
    driver: 'acp';
    status: 'active' | 'closed';
    revision: number;
  };
  turns: Array<{
    id: string;
    conversationId: string;
    sessionId: string;
    driver: 'acp';
    userMessage: string;
    status: string;
    revision: number;
    occurredAt: string;
  }>;
  projection: {
    userText: string[];
    assistantText: string[];
    toolCalls: Array<{
      toolCallId: string;
      title: string;
      status: string;
      command?: string;
      occurredAt: string;
    }>;
  };
}

/** 子进程宿主接口：真实实现 spawn opencode，测试注入内存双工流 */
export interface AcpAgentProcess {
  child: ChildProcess;
  /** 进程退出完成信号（code/signal 由 child exit 事件携带，这里仅用于协调） */
  exited: Promise<void>;
}

export type AcpAgentSpawner = (cwd: string) => AcpAgentProcess;

export interface AcpControllerOptions {
  settingsDirectory: string;
  /** Core API 请求通道（通常为 CoreSupervisor.request）：所有工具调用只经此通道 */
  request: (method: string, payload: unknown) => Promise<unknown>;
  /** 子进程启动器：默认 opencode acp --pure；测试可注入 */
  spawnAgent?: AcpAgentSpawner;
  /** opencode 可执行文件路径（打包后 PATH 可能不含 nvm 等自定义路径） */
  opencodePath?: string;
  /** 时间线事件出口：payload 为 AgentTimelineItem（含 sessionId），与内置 Agent 事件同构 */
  onTimeline?: (item: AgentTimelineItem) => void;
  /** 状态变化出口：驱动者切换、开始/结束任务、进程崩溃时通知渲染进程 */
  onStatusChanged?: (status: AcpControllerStatus) => void;
}

type TimelineRisk = NonNullable<AgentTimelineItem['risk']>;

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

interface TerminalBinding {
  transactionId: string;
  cursor: number;
}

interface Projection {
  userText: string[];
  assistantText: string[];
  toolCalls: Array<{
    toolCallId: string;
    title: string;
    status: string;
    command?: string;
    occurredAt: string;
  }>;
}

interface AcpConversation {
  platformSessionId: string;
  acpSessionId: string;
  conversationId: string;
  agent: AcpAgentProcess;
  connection: ClientSideConnection;
  cwd: string;
  activeTurn: boolean;
  turnId: string | undefined;
  turnStatus: string | undefined;
  exited: boolean;
  revision: number;
  pendingApprovals: Map<string, PendingApproval>;
  /** 用户已批准一次、尚未消费的命令许可（批准即放行同一条命令一次，执行后移除） */
  approvedOnceCommands: Set<string>;
  terminals: Map<string, TerminalBinding>;
  projection: Projection;
  assistantItemId: string | undefined;
  startedAt: string;
}

type GateResult =
  | { kind: 'allow_once'; executionMode: 'managed' | 'read_only' }
  | { kind: 'approved'; executionMode: 'approved_once' }
  | { kind: 'rejected' };

/** 默认启动器：opencode ACP stdio 模式，--pure 关闭外部插件（D18 进程边界即隔离边界） */
function createDefaultSpawner(opencodePath: string): AcpAgentSpawner {
  return (cwd: string): AcpAgentProcess => {
    const child = spawn(opencodePath, ['acp', '--pure', '--cwd', cwd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      // 保留子进程 stderr 便于本地调试（TERMINAL_AGENT_DEBUG=1 时打印）
      if (process.env.TERMINAL_AGENT_DEBUG === '1') {
        console.error('[acp-agent]', String(chunk).trimEnd());
      }
    });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    return { child, exited };
  };
}

export function createAcpController(options: AcpControllerOptions): AcpController {
  return createAcpControllerWithStore(createAcpSettingsStore(options.settingsDirectory), options);
}

/** 与真实实现同构的构造入口，供测试注入内存/临时目录设置存储 */
export function createAcpControllerWithStore(
  store: AcpSettingsStore,
  options: AcpControllerOptions,
): AcpController {
  return new AcpController(store, options);
}

export class AcpController {
  readonly #store: AcpSettingsStore;
  readonly #request: (method: string, payload: unknown) => Promise<unknown>;
  readonly #spawnAgent: AcpAgentSpawner;
  readonly #onTimeline: ((item: AgentTimelineItem) => void) | undefined;
  readonly #onStatusChanged: ((status: AcpControllerStatus) => void) | undefined;
  #settings: AcpSettings = { enabled: false, approvalMode: 'managed' };
  readonly #conversations = new Map<string, AcpConversation>();
  #boot: Promise<void>;
  #mutation: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(store: AcpSettingsStore, options: AcpControllerOptions) {
    this.#store = store;
    this.#request = options.request;
    this.#spawnAgent =
      options.spawnAgent ?? createDefaultSpawner(options.opencodePath ?? 'opencode');
    this.#onTimeline = options.onTimeline;
    this.#onStatusChanged = options.onStatusChanged;
    // 启动时加载持久化设置；上次退出时若仍启用，面板可直接使用（不自动 spawn）。
    this.#boot = store.load().then((loaded) => {
      this.#settings = loaded;
    });
  }

  async status(): Promise<AcpControllerStatus> {
    await this.#boot;
    await this.#mutation;
    return this.#toStatus();
  }

  async setEnabled(enabled: boolean): Promise<AcpControllerStatus> {
    return this.#mutate(async () => {
      this.#settings = { ...this.#settings, enabled };
      await this.#store.save(this.#settings);
      if (!enabled) {
        // 关闭全局开关时终止所有外部 Agent 子进程（生命周期收尾，ADR-0028）
        await this.#terminateAll('ACP 集成已关闭');
      }
      return this.#toStatus();
    });
  }

  async setApprovalMode(mode: AcpApprovalMode): Promise<AcpControllerStatus> {
    return this.#mutate(async () => {
      this.#settings = { ...this.#settings, approvalMode: mode };
      await this.#store.save(this.#settings);
      return this.#toStatus();
    });
  }

  /**
   * 开始一个 ACP Turn（两级开关：设置允许 + 面板选择驱动者后开始任务）。
   * 返回后 Prompt 在后台运行，进度经 timeline 事件流推送；不会阻塞调用方。
   */
  async startTurn(
    sessionId: string,
    goal: string,
    cwd?: string,
  ): Promise<{ turnId: string; conversationId: string }> {
    await this.#boot;
    return this.#mutate(async () => {
      if (!this.#settings.enabled) {
        throw new Error('ACP 集成未启用：请先在设置页打开“允许 ACP 集成”');
      }
      let conversation = this.#conversations.get(sessionId);
      if (conversation === undefined || conversation.exited) {
        conversation = await this.#spawnConversation(sessionId, cwd);
      }
      if (conversation.activeTurn) {
        throw new Error('外部 Agent 正在处理上一个任务，请先等待或取消');
      }
      const turnId = randomUUID();
      conversation.turnId = turnId;
      conversation.turnStatus = 'running';
      conversation.activeTurn = true;
      conversation.projection.userText.push(goal);
      this.#emitTimeline({
        id: randomUUID(),
        sessionId,
        kind: 'user',
        text: goal,
        conversationId: conversation.conversationId,
        turnId,
        occurredAt: new Date().toISOString(),
      });
      this.#emitStatus();
      const run = this.#runPrompt(conversation, goal);
      void run.catch(() => undefined);
      return { turnId, conversationId: conversation.conversationId };
    });
  }

  /** 取消当前 Turn：通知 Agent 停止，映射 stopReason=cancelled（不终止子进程） */
  async cancelTurn(sessionId: string): Promise<void> {
    await this.#boot;
    await this.#mutate(async () => {
      const conversation = this.#conversations.get(sessionId);
      if (conversation === undefined || conversation.exited || !conversation.activeTurn) return;
      try {
        await conversation.connection.cancel({ sessionId: conversation.acpSessionId });
      } catch {
        // 连接已断时由 crash 路径接管终态
      }
    });
  }

  /** 关闭 Conversation：终止子进程并清理状态（应用退出 / 关闭会话时调用） */
  async closeConversation(sessionId: string): Promise<void> {
    await this.#boot;
    await this.#mutate(async () => {
      await this.#terminateOne(sessionId, '对话已关闭');
    });
  }

  /** 用户对 ACP 审批卡片做出决定（单一审批通道：复用现有审批 UI） */
  async respondApproval(approvalId: string, approved: boolean): Promise<void> {
    await this.#boot;
    await this.#mutate(async () => {
      for (const conversation of this.#conversations.values()) {
        const pending = conversation.pendingApprovals.get(approvalId);
        if (pending === undefined) continue;
        conversation.pendingApprovals.delete(approvalId);
        pending.resolve(approved);
        // 更新审批卡片终态：completed / cancelled
        const request = approvalRequests.get(approvalId);
        // 批准即授予该命令一次执行许可，供后续实际执行请求消费（ACP 权限与执行分离）
        if (approved && request !== undefined) {
          conversation.approvedOnceCommands.add(request.command);
        }
        this.#emitTimeline({
          id: approvalId,
          sessionId: conversation.platformSessionId,
          kind: 'approval',
          text: request?.command ?? '外部权限请求',
          status: approved ? 'completed' : 'cancelled',
          risk: (request?.risk as TimelineRisk | undefined) ?? 'unknown',
          ...this.#timelineMeta(conversation),
          occurredAt: new Date().toISOString(),
        });
        return;
      }
    });
  }

  /** Conversation Projection 历史：外部驱动者独立于内置历史（D15 / ADR-0029） */
  async history(sessionId: string): Promise<AcpHistoryView> {
    await this.#boot;
    await this.#mutation;
    const conversation = this.#conversations.get(sessionId);
    if (conversation === undefined) {
      return {
        sessionId,
        turns: [],
        projection: { userText: [], assistantText: [], toolCalls: [] },
      };
    }
    return {
      sessionId,
      conversation: {
        id: conversation.conversationId,
        sessionId,
        driver: 'acp',
        status: conversation.exited ? 'closed' : 'active',
        revision: conversation.revision,
      },
      turns: [
        {
          id: conversation.turnId ?? '',
          conversationId: conversation.conversationId,
          sessionId,
          driver: 'acp',
          userMessage: conversation.projection.userText.at(-1) ?? '',
          status: conversation.turnStatus ?? 'idle',
          revision: conversation.revision,
          occurredAt: conversation.startedAt,
        },
      ],
      projection: conversation.projection,
    };
  }

  async dispose(): Promise<void> {
    await this.#boot;
    await this.#mutate(async () => {
      await this.#terminateAll('应用退出');
    });
    this.#disposed = true;
  }

  // ---------- 子进程与 ACP 会话 ----------

  async #spawnConversation(sessionId: string, cwd: string | undefined): Promise<AcpConversation> {
    const workingDirectory = cwd?.trim() || homedir();
    let agent: AcpAgentProcess;
    try {
      agent = this.#spawnAgent(workingDirectory);
    } catch (error) {
      throw new Error(
        `无法启动外部 Agent 进程：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const conversationId = randomUUID();
    const conversation: AcpConversation = {
      platformSessionId: sessionId,
      acpSessionId: '',
      conversationId,
      agent,
      // ClientSideConnection 构造时会立即调用 client 工厂，
      // 因此必须先注册会话，再创建连接（否则 #createClient 找不到会话）。
      connection: undefined as unknown as ClientSideConnection,
      cwd: workingDirectory,
      activeTurn: false,
      turnId: undefined,
      turnStatus: undefined,
      exited: false,
      revision: 0,
      pendingApprovals: new Map(),
      approvedOnceCommands: new Set(),
      terminals: new Map(),
      projection: { userText: [], assistantText: [], toolCalls: [] },
      assistantItemId: undefined,
      startedAt: new Date().toISOString(),
    };
    agent.child.once('exit', (code, signal) => {
      void this.#handleAgentExit(conversation, code, signal);
    });
    this.#conversations.set(sessionId, conversation);
    const connection = new ClientSideConnection(
      () => this.#createClient(conversationId),
      ndJsonStream(Writable.toWeb(agent.child.stdin!), childStdoutToWebStream(agent.child.stdout)),
    );
    conversation.connection = connection;

    // ACP 握手：initialize（协商协议版本与能力）→ newSession（创建对话）
    try {
      await connection.initialize({
        protocolVersion: 1,
        clientCapabilities: ACP_CLIENT_CAPABILITIES,
      });
      const created = await connection.newSession({
        cwd: workingDirectory,
        mcpServers: [],
      });
      conversation.acpSessionId = created.sessionId;
      this.#emitTimeline({
        id: randomUUID(),
        sessionId,
        kind: 'system',
        text: '外部驱动者已就绪：opencode（ACP）',
        conversationId,
        occurredAt: new Date().toISOString(),
      });
      this.#emitStatus();
      return conversation;
    } catch (error) {
      this.#conversations.delete(sessionId);
      agent.child.kill('SIGTERM');
      throw new Error(
        `外部 Agent 握手失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async #runPrompt(conversation: AcpConversation, goal: string): Promise<void> {
    try {
      const response = await conversation.connection.prompt({
        sessionId: conversation.acpSessionId,
        prompt: [{ type: 'text', text: goal }],
      });
      conversation.turnStatus = mapStopReason(response.stopReason);
      this.#finalizeAssistant(conversation, conversation.turnStatus);
    } catch (error) {
      // 进程崩溃时这里可能以协议错误结束；统一映射为 failed（ADR-0031）
      conversation.turnStatus = 'failed';
      this.#emitTimeline({
        id: randomUUID(),
        sessionId: conversation.platformSessionId,
        kind: 'system',
        text: `外部 Agent 执行失败：${error instanceof Error ? error.message : String(error)}`,
        status: 'failed',
        ...this.#timelineMeta(conversation),
        occurredAt: new Date().toISOString(),
      });
    } finally {
      conversation.activeTurn = false;
      conversation.revision += 1;
      this.#emitStatus();
    }
  }

  /** 子进程意外退出：当前 Turn 置 failed，不自动重启（ADR-0028） */
  async #handleAgentExit(
    conversation: AcpConversation,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    if (conversation.exited || this.#disposed) return;
    conversation.exited = true;
    // 挂起审批卡片置为取消终态，避免渲染进程留下永远等待的卡片
    this.#cancelPendingApprovals(conversation);
    // 唤醒挂起的审批，避免渲染进程卡片永远等待
    for (const pending of conversation.pendingApprovals.values()) pending.resolve(false);
    conversation.pendingApprovals.clear();
    if (conversation.activeTurn) {
      conversation.activeTurn = false;
      conversation.turnStatus = 'failed';
      this.#emitTimeline({
        id: randomUUID(),
        sessionId: conversation.platformSessionId,
        kind: 'system',
        text: `外部 Agent 进程已退出${signal !== null ? `（信号 ${signal}）` : `（代码 ${code ?? '未知'}）`}，当前任务已标记失败`,
        status: 'failed',
        ...this.#timelineMeta(conversation),
        occurredAt: new Date().toISOString(),
      });
    }
    this.#emitStatus();
  }

  async #terminateOne(sessionId: string, reason: string): Promise<void> {
    const conversation = this.#conversations.get(sessionId);
    if (conversation === undefined) return;
    this.#conversations.delete(sessionId);
    conversation.exited = true;
    this.#cancelPendingApprovals(conversation);
    for (const pending of conversation.pendingApprovals.values()) pending.resolve(false);
    conversation.pendingApprovals.clear();
    if (conversation.activeTurn) {
      conversation.activeTurn = false;
      conversation.turnStatus = 'cancelled';
    }
    try {
      conversation.agent.child.kill('SIGTERM');
      await conversation.agent.exited;
    } catch {
      // 进程可能已退出，忽略收尾错误
    }
    this.#emitTimeline({
      id: randomUUID(),
      sessionId,
      kind: 'system',
      text: `外部 Agent 对话已终止（${reason}）`,
      status: 'completed',
      ...this.#timelineMeta(conversation),
      occurredAt: new Date().toISOString(),
    });
    this.#emitStatus();
  }

  /** 将挂起的审批卡片置为取消终态（崩溃 / 对话关闭时不会留下永远等待的卡片） */
  #cancelPendingApprovals(conversation: AcpConversation): void {
    for (const approvalId of conversation.pendingApprovals.keys()) {
      const request = approvalRequests.get(approvalId);
      this.#emitTimeline({
        id: approvalId,
        sessionId: conversation.platformSessionId,
        kind: 'approval',
        text: request?.command ?? '外部权限请求',
        status: 'cancelled',
        risk: (request?.risk as TimelineRisk | undefined) ?? 'unknown',
        ...this.#timelineMeta(conversation),
        occurredAt: new Date().toISOString(),
      });
    }
  }

  async #terminateAll(reason: string): Promise<void> {
    for (const sessionId of [...this.#conversations.keys()]) {
      await this.#terminateOne(sessionId, reason);
    }
  }

  // ---------- ACP 客户端能力实现 ----------

  #createClient(conversationId: string): Client {
    const conversation = [...this.#conversations.values()].find(
      (item) => item.conversationId === conversationId,
    );
    if (conversation === undefined) {
      throw new Error('ACP 会话不存在');
    }
    return {
      requestPermission: (params) => this.#handleRequestPermission(conversation, params),
      sessionUpdate: (params) => this.#handleSessionUpdate(conversation, params),
      readTextFile: (params) => this.#readTextFile(conversation, params),
      createTerminal: (params) => this.#createTerminal(conversation, params),
      terminalOutput: (params) => this.#terminalOutput(conversation, params),
      waitForTerminalExit: (params) => this.#waitForTerminalExit(conversation, params),
      killTerminal: (params) => this.#killTerminal(conversation, params),
      releaseTerminal: (params) => this.#releaseTerminal(conversation, params),
    };
  }

  /** 权限请求单一闸门：平台工具走 Policy；非平台工具拒绝并审计（ADR-0030） */
  async #handleRequestPermission(
    conversation: AcpConversation,
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const tool = params.toolCall;
    const toolName = tool.title ?? 'unknown';
    if (!PLATFORM_TOOL_NAMES.has(toolName)) {
      // 外部 Agent 原生工具：平台无法执行，拒绝并审计，绝不回 allow_always
      await this.#recordRejection(conversation, toolName, 'undeclared_capability');
      return rejectResponse(params);
    }
    const rawCommand = tool.rawInput?.command;
    if (typeof rawCommand === 'string' && rawCommand.trim().length > 0) {
      const gate = await this.#gateCommand(conversation, rawCommand, toolName);
      if (gate.kind === 'rejected') return rejectResponse(params);
      return allowOnceResponse(params);
    }
    // 只读平台工具（observe / 只读文件）：策略模型下直接放行一次
    return allowOnceResponse(params);
  }

  /** 命令权限裁决：Policy 自动放行 / 人工审批 / 拒绝（单一审批通道） */
  async #gateCommand(
    conversation: AcpConversation,
    command: string,
    toolName: string,
  ): Promise<GateResult> {
    // 已授予的"允许一次"许可：批准即放行同一条命令一次（执行后消费，避免重复审批）
    if (conversation.approvedOnceCommands.delete(command)) {
      return { kind: 'approved', executionMode: 'approved_once' };
    }
    let classified: {
      risk: string;
      requiresApproval: boolean;
      authorization: 'allow_once' | 'approval_required';
    };
    try {
      classified = (await this.#request('external.classifyCommand', {
        sessionId: conversation.platformSessionId,
        caller: ACP_CALLER,
        approvalMode: this.#settings.approvalMode,
        command,
      })) as typeof classified;
    } catch (error) {
      throw new Error(
        `命令策略分类失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (classified.authorization === 'allow_once') {
      return {
        kind: 'allow_once',
        executionMode: this.#settings.approvalMode === 'managed' ? 'managed' : 'read_only',
      };
    }
    // 需要人工：复用现有审批 UI（timeline 卡片），批准后以 approved_once 继续执行
    const approvalId = randomUUID();
    const request: AcpApprovalRequest = {
      id: approvalId,
      sessionId: conversation.platformSessionId,
      command,
      risk: classified.risk,
      toolName,
      occurredAt: new Date().toISOString(),
    };
    approvalRequests.set(approvalId, request);
    this.#emitTimeline({
      id: approvalId,
      sessionId: conversation.platformSessionId,
      kind: 'approval',
      text: `外部 Agent 请求执行：${command}`,
      status: 'waiting_approval',
      risk: classified.risk as TimelineRisk,
      ...this.#timelineMeta(conversation),
      occurredAt: request.occurredAt,
    });
    const approved = await new Promise<boolean>((resolve) => {
      conversation.pendingApprovals.set(approvalId, { resolve });
    });
    if (approved) {
      return { kind: 'approved', executionMode: 'approved_once' };
    }
    await this.#recordRejection(conversation, toolName, 'user_rejected');
    return { kind: 'rejected' };
  }

  /** 只读文件能力：路径限制、脱敏与审计全部由 Core 的 external.localReadFile 完成 */
  async #readTextFile(
    conversation: AcpConversation,
    params: { path: string; line?: number | null; limit?: number | null },
  ): Promise<{ content: string }> {
    const result = await this.#request('external.localReadFile', {
      sessionId: conversation.platformSessionId,
      caller: ACP_CALLER,
      approvalMode: 'read_only',
      // ACP 文件请求使用绝对路径，Core 的本地文件策略要求相对 home 的路径；
      // 这里只做形态翻译（绝对 → 相对），路径逃逸校验仍由 Core 的 LocalFilePolicy 完成。
      path: toHomeRelativePath(params.path),
      ...(params.line === undefined || params.line === null ? {} : { startLine: params.line }),
      ...(params.line !== undefined && params.line !== null && params.limit != null
        ? { endLine: params.line + params.limit - 1 }
        : {}),
    });
    return { content: readFileText(result) };
  }

  /** 终端能力：新建“终端”= 在用户共享会话执行一条命令（与 MCP 对齐，不新建 PTY） */
  async #createTerminal(
    conversation: AcpConversation,
    params: { command: string },
  ): Promise<{ terminalId: string }> {
    const command = params.command.trim();
    if (command.length === 0) throw new Error('空命令');
    const gate = await this.#gateCommand(conversation, command, 'createTerminal');
    if (gate.kind === 'rejected') throw new Error('命令被用户拒绝');
    const result = await this.#request('external.terminalExecute', {
      sessionId: conversation.platformSessionId,
      caller: ACP_CALLER,
      approvalMode: gate.executionMode,
      command,
      observationWindowMs: 30_000,
    });
    const executed = asExternalResult(result);
    if (!executed.ok) {
      throw new Error(executed.message ?? executed.error ?? '命令执行失败');
    }
    const detail = executed.result as {
      transaction?: { id?: string };
      status?: string;
    };
    const transactionId = detail.transaction?.id;
    if (transactionId === undefined) throw new Error('命令执行未返回事务标识');
    const terminalId = `term-${transactionId}`;
    conversation.terminals.set(terminalId, { transactionId, cursor: 0 });
    this.#emitTimeline({
      id: randomUUID(),
      sessionId: conversation.platformSessionId,
      kind: 'command',
      text: command,
      status: detail.status === 'completed' ? 'completed' : 'running',
      ...this.#timelineMeta(conversation),
      occurredAt: new Date().toISOString(),
    });
    return { terminalId };
  }

  async #terminalOutput(
    conversation: AcpConversation,
    params: { terminalId: string },
  ): Promise<{ output: string; truncated: boolean }> {
    const binding = conversation.terminals.get(params.terminalId);
    if (binding === undefined) throw new Error('未知终端标识');
    const result = await this.#request('external.terminalObserve', {
      sessionId: conversation.platformSessionId,
      caller: ACP_CALLER,
      approvalMode: 'read_only',
      view: 'output',
      afterCursor: binding.cursor,
      maxBytes: 1024 * 1024,
    });
    const observed = asExternalResult(result);
    if (!observed.ok) throw new Error(observed.message ?? '终端输出读取失败');
    const detail = observed.result as { output?: string; cursor?: number; truncated?: boolean };
    if (typeof detail.cursor === 'number') binding.cursor = detail.cursor;
    return { output: detail.output ?? '', truncated: detail.truncated === true };
  }

  async #waitForTerminalExit(
    conversation: AcpConversation,
    params: { terminalId: string },
  ): Promise<{ exitCode?: number | null; signal?: string | null }> {
    const binding = conversation.terminals.get(params.terminalId);
    if (binding === undefined) throw new Error('未知终端标识');
    const result = await this.#request('external.terminalWait', {
      sessionId: conversation.platformSessionId,
      caller: ACP_CALLER,
      approvalMode: 'read_only',
      transactionId: binding.transactionId,
      timeoutMs: 120_000,
    });
    const waited = asExternalResult(result);
    if (!waited.ok) {
      // 非零退出 / 命令未找到统一映射为已退出（退出码 1）
      return { exitCode: 1 };
    }
    const detail = waited.result as { status?: string; transaction?: { exitCode?: number } };
    if (detail.status === 'completed') {
      return { exitCode: detail.transaction?.exitCode ?? 0 };
    }
    // running / interaction_required：超时未结束，由 Agent 决定重试或 kill
    return { exitCode: null };
  }

  async #killTerminal(
    conversation: AcpConversation,
    params: { terminalId: string },
  ): Promise<undefined> {
    const binding = conversation.terminals.get(params.terminalId);
    if (binding === undefined) throw new Error('未知终端标识');
    await this.#request('external.terminalInterrupt', {
      sessionId: conversation.platformSessionId,
      caller: ACP_CALLER,
      approvalMode: 'read_only',
      transactionId: binding.transactionId,
    });
    return undefined;
  }

  async #releaseTerminal(
    conversation: AcpConversation,
    params: { terminalId: string },
  ): Promise<undefined> {
    const binding = conversation.terminals.get(params.terminalId);
    if (binding === undefined) return undefined;
    await this.#request('external.terminalInterrupt', {
      sessionId: conversation.platformSessionId,
      caller: ACP_CALLER,
      approvalMode: 'read_only',
      transactionId: binding.transactionId,
    }).catch(() => undefined);
    conversation.terminals.delete(params.terminalId);
    return undefined;
  }

  // ---------- ACP 事件翻译（D19 / ADR-0031） ----------

  async #handleSessionUpdate(
    conversation: AcpConversation,
    params: SessionNotification,
  ): Promise<void> {
    const update = params.update;
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if ('content' in update && update.content.type === 'text') {
          conversation.projection.assistantText.push(update.content.text);
          if (conversation.assistantItemId === undefined) {
            conversation.assistantItemId = `acp-assistant-${conversation.turnId ?? 'turn'}`;
          }
          this.#emitTimeline({
            id: conversation.assistantItemId,
            sessionId: conversation.platformSessionId,
            kind: 'assistant',
            text: conversation.projection.assistantText.join(''),
            status: 'streaming',
            ...this.#timelineMeta(conversation),
            occurredAt: new Date().toISOString(),
          });
        }
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const call = update;
        const status = mapToolStatus(call.status ?? 'pending');
        const existing = conversation.projection.toolCalls.find(
          (item) => item.toolCallId === call.toolCallId,
        );
        if (existing === undefined) {
          conversation.projection.toolCalls.push({
            toolCallId: call.toolCallId,
            title: call.title ?? 'tool',
            status,
            ...(call.rawInput?.command === undefined
              ? {}
              : { command: String(call.rawInput.command) }),
            occurredAt: new Date().toISOString(),
          });
        } else {
          existing.status = status;
          if (call.title != null) existing.title = call.title;
        }
        this.#emitTimeline({
          id: `acp-tool-${call.toolCallId}`,
          sessionId: conversation.platformSessionId,
          kind: 'tool',
          toolRole: 'call',
          toolCallId: call.toolCallId,
          text: `${call.title ?? 'tool'}\n${JSON.stringify(call.rawInput ?? {}, null, 2)}`,
          status,
          ...this.#timelineMeta(conversation),
          occurredAt: new Date().toISOString(),
        });
        // 工具完成/失败时附上结果摘要（toolResult 卡片）
        if (status === 'completed' || status === 'failed') {
          const rawOutput = 'rawOutput' in call ? call.rawOutput : undefined;
          const outputText =
            rawOutput === undefined
              ? ''
              : typeof rawOutput === 'object' &&
                  rawOutput !== null &&
                  'output' in rawOutput &&
                  typeof rawOutput.output === 'string'
                ? (rawOutput.output as string)
                : JSON.stringify(rawOutput);
          this.#emitTimeline({
            id: `acp-tool-result-${call.toolCallId}`,
            sessionId: conversation.platformSessionId,
            kind: 'tool',
            toolRole: 'result',
            toolCallId: call.toolCallId,
            text: outputText,
            status: status === 'completed' ? 'completed' : 'failed',
            ...this.#timelineMeta(conversation),
            occurredAt: new Date().toISOString(),
          });
        }
        return;
      }
      default:
        // plan / user_message_chunk / available_commands_update / current_mode_update / usage_update
        // 不进入投影或时间线（外部 Agent 自管上下文，平台只存展示所需投影）
        return;
    }
  }

  #finalizeAssistant(conversation: AcpConversation, status: string): void {
    if (conversation.assistantItemId === undefined) return;
    this.#emitTimeline({
      id: conversation.assistantItemId,
      sessionId: conversation.platformSessionId,
      kind: 'assistant',
      text: conversation.projection.assistantText.join(''),
      status,
      ...this.#timelineMeta(conversation),
      occurredAt: new Date().toISOString(),
    });
  }

  async #recordRejection(
    conversation: AcpConversation,
    toolName: string,
    reason: 'undeclared_capability' | 'approval_mode_denied' | 'user_rejected',
  ): Promise<void> {
    try {
      await this.#request('external.recordRejection', {
        sessionId: conversation.platformSessionId,
        caller: ACP_CALLER,
        toolName,
        reason,
      });
    } catch {
      // 审计失败不阻断权限流程，但拒绝结果照常返回
    }
    this.#emitTimeline({
      id: randomUUID(),
      sessionId: conversation.platformSessionId,
      kind: 'system',
      text: `已拒绝外部工具：${toolName}（${rejectionReasonText(reason)}）`,
      status: 'failed',
      ...this.#timelineMeta(conversation),
      occurredAt: new Date().toISOString(),
    });
  }

  // ---------- 辅助 ----------

  #emitTimeline(item: AgentTimelineItem): void {
    // 统一打上驱动者标记，渲染进程按 driver 隔离内置与外部历史（specs/acp-driver 4.7）
    this.#onTimeline?.({ ...item, driver: 'acp' });
  }

  /** 时间线上下文：turnId 仅在 Turn 已建立时附带（exactOptionalPropertyTypes 兼容） */
  #timelineMeta(conversation: AcpConversation): { conversationId: string; turnId?: string } {
    return {
      conversationId: conversation.conversationId,
      ...(conversation.turnId === undefined ? {} : { turnId: conversation.turnId }),
    };
  }

  #emitStatus(): void {
    this.#onStatusChanged?.(this.#toStatus());
  }

  #toStatus(): AcpControllerStatus {
    const running = [...this.#conversations.values()].find((item) => !item.exited);
    return {
      enabled: this.#settings.enabled,
      running: running !== undefined,
      approvalMode: this.#settings.approvalMode,
      ...(running === undefined ? {} : { activeSessionId: running.platformSessionId }),
      activeTurn: running?.activeTurn ?? false,
      agentName: 'opencode',
    };
  }

  /** 串行化配置变更与对话操作，避免开关/任务并发竞态 */
  async #mutate<T>(next: () => Promise<T>): Promise<T> {
    await this.#boot;
    const run = this.#mutation.then(async () => {
      const result = await next();
      this.#emitStatus();
      return result;
    });
    this.#mutation = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** stopReason → Turn 终态（D19 / ADR-0031） */
function mapStopReason(
  stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled',
): string {
  if (stopReason === 'end_turn' || stopReason === 'refusal') return 'completed';
  if (stopReason === 'cancelled') return 'cancelled';
  return 'failed';
}

/** ACP 工具调用状态 → 现有 timeline 状态 */
function mapToolStatus(status: 'pending' | 'in_progress' | 'completed' | 'failed'): string {
  if (status === 'pending' || status === 'in_progress') return 'running';
  return status;
}

function rejectionReasonText(reason: string): string {
  switch (reason) {
    case 'undeclared_capability':
      return '未声明能力';
    case 'approval_mode_denied':
      return '审批模式拒绝';
    case 'user_rejected':
      return '用户拒绝';
    default:
      return reason;
  }
}

function allowOnceResponse(params: RequestPermissionRequest): RequestPermissionResponse {
  const option = params.options.find((item) => item.kind === 'allow_once');
  if (option === undefined) return { outcome: { outcome: 'cancelled' } };
  return { outcome: { outcome: 'selected', optionId: option.optionId } };
}

function rejectResponse(params: RequestPermissionRequest): RequestPermissionResponse {
  const option = params.options.find((item) => item.kind === 'reject_once');
  if (option === undefined) return { outcome: { outcome: 'cancelled' } };
  return { outcome: { outcome: 'selected', optionId: option.optionId } };
}

/** 审批请求索引：respondApproval 用 approvalId 找到卡片文案（与会话解耦） */
const approvalRequests = new Map<string, AcpApprovalRequest>();

function asExternalResult(value: unknown): {
  ok: boolean;
  result?: unknown;
  error?: string;
  message?: string;
} {
  if (typeof value === 'object' && value !== null && 'ok' in value) {
    const record = value as { ok: unknown; result?: unknown; error?: string; message?: string };
    return {
      ok: record.ok === true,
      ...(record.result === undefined ? {} : { result: record.result }),
      ...(record.error === undefined ? {} : { error: record.error }),
      ...(record.message === undefined ? {} : { message: record.message }),
    };
  }
  throw new Error('外部调用返回了无法识别的结果');
}

function readFileText(result: unknown): string {
  const external = asExternalResult(result);
  if (!external.ok) throw new Error(external.message ?? '文件读取失败');
  const detail = external.result as { content?: unknown };
  return typeof detail.content === 'string' ? detail.content : '';
}

/** 绝对路径 → 相对用户 home 的路径；超出 home 范围直接拒绝（不泄露原因之外的细节） */
function toHomeRelativePath(absolutePath: string): string {
  const home = resolve(homedir());
  const target = resolve(absolutePath);
  if (target === home) return '.';
  if (target.startsWith(`${home}${sep}`)) return target.slice(home.length + 1);
  throw new Error('路径超出本地文件策略允许的范围');
}
