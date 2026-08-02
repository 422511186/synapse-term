/**
 * MCP 工具定义与翻译层（specs/mcp-access、ADR-0022 / ADR-0024）
 *
 * 端点只做两件事：
 * 1. 把带 sessionId 的外部工具形态（MCP schema）翻译为内部 Core API 用例
 *    （external.*，内部 schema 不含 sessionId，翻译只发生在端点层）；
 * 2. 统一附加外部调用者身份（caller: mcp）与设置页配置的审批模式。
 *
 * 不在此实现任何业务或安全逻辑：会话校验、审批、租约、执行与审计
 * 全部由 Core 的 ExternalRequestHandler / ExternalToolPipeline 完成。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parseCoreRequest } from '@synapse-term/protocol';
import { z } from 'zod';

import type { McpApprovalMode, McpSettings } from './mcp-settings.js';

/** 工具执行依赖：Core 请求通道 + 实时读取当前设置（token / 审批模式） */
export interface McpToolRuntime {
  request(method: string, payload: unknown): Promise<unknown>;
  getSettings(): McpSettings;
}

/** 外部调用者固定身份：单用户本机应用，来源固定为 MCP 接入线 */
const MCP_CALLER = {
  kind: 'mcp' as const,
  id: 'mcp-client',
  displayName: 'MCP 外部客户端',
};

/** 工具结果统一文本化，便于 Codex / Claude Code 直接读取 */
function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * 稳定外部错误码（specs/mcp-access）：内部错误码 → 外部客户端可解析的错误码。
 * MCP CallToolResult 没有结构化错误码字段，统一以 `CODE: message（指引）` 前缀文本返回。
 */
const STABLE_ERROR_CODES: Readonly<Record<string, string>> = {
  session_not_ready: 'SESSION_NOT_READY',
  invalid_session: 'SESSION_EXPIRED',
  lease_unavailable: 'SESSION_BUSY',
  command_transaction_conflict: 'TERMINAL_BUSY',
  transaction_not_found: 'TRANSACTION_NOT_FOUND',
  policy_denied: 'POLICY_DENIED',
  command_not_found: 'COMMAND_NOT_FOUND',
  command_failed: 'COMMAND_FAILED',
  command_shell_lost: 'SHELL_LOST',
  command_interrupted: 'COMMAND_INTERRUPTED',
  command_protocol_error: 'PROTOCOL_ERROR',
  plaintext_protocol_error: 'PROTOCOL_ERROR',
  execution_environment_unverified: 'ENVIRONMENT_UNVERIFIED',
  command_not_auditable: 'NOT_AUDITABLE',
  local_file_service_unavailable: 'LOCAL_FILE_UNAVAILABLE',
  file_operation_failed: 'FILE_OPERATION_FAILED',
};

/** 恢复指引：让客户端明确下一步，而不是反复猜测或卡死 */
const ERROR_HINTS: Readonly<Record<string, string>> = {
  SESSION_NOT_READY: '会话 Shell 尚未就绪，请稍后重试或先调用 terminal_status 探测状态',
  SESSION_EXPIRED: '会话已失效，请在桌面端重新复制并共享会话 ID 后再调用',
  SESSION_BUSY: '会话正被用户或内置 Agent 占用，请稍后重试',
  TERMINAL_BUSY: '已有命令正在执行，请先调用 terminal_wait 等待其完成',
  TRANSACTION_NOT_FOUND: '事务不存在或已过期，请重新发起 terminal_execute',
  SHELL_LOST: '终端 Shell 已退出，请重新共享会话 ID 后再调用',
};

function formatExternalError(result: { error?: string; message?: string }): string {
  const error = result.error ?? 'external_error';
  const code = STABLE_ERROR_CODES[error] ?? error.toUpperCase();
  const hint = ERROR_HINTS[code];
  const message = result.message ?? '外部调用被拒绝';
  return hint === undefined ? `${code}: ${message}` : `${code}: ${message}（${hint}）`;
}

/** 稳定错误结果：不把内部堆栈或会话细节暴露给外部调用者 */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

interface ExternalToolResultLike {
  ok: boolean;
  result?: unknown;
  error?: string;
  message?: string;
}

function isExternalToolResult(value: unknown): value is ExternalToolResultLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof (value as { ok: unknown }).ok === 'boolean'
  );
}

function formatResult(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}

/** 翻译并执行一次外部工具调用，返回 MCP CallToolResult */
export async function runMcpTool(
  runtime: McpToolRuntime,
  method:
    | 'external.terminalExecute'
    | 'external.terminalObserve'
    | 'external.terminalWait'
    | 'external.terminalInterrupt'
    | 'external.terminalStatus',
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  const settings = runtime.getSettings();
  // 外部形态 → 内部 Core API：附加调用者身份与审批模式，其余字段透传。
  const request = parseCoreRequest(method, {
    ...input,
    caller: MCP_CALLER,
    approvalMode: settings.approvalMode,
  });
  try {
    const result = await runtime.request(request.method, request.payload);
    if (isExternalToolResult(result)) {
      if (result.ok) return textResult(formatResult(result.result));
      return errorResult(formatExternalError(result));
    }
    return textResult(formatResult(result));
  } catch (error) {
    // 无效会话统一返回稳定文案，不泄露其他会话的任何信息（ADR-0022）。
    if (error instanceof Error && 'code' in error && error.code === 'invalid_session') {
      return errorResult(
        formatExternalError({ error: 'invalid_session', message: '无效的会话标识' }),
      );
    }
    const message = error instanceof Error ? error.message : '外部调用失败';
    return errorResult(`外部调用失败：${message}`);
  }
}

/** 注册 MCP 工具集合：仅 terminal_*（execute / observe / wait / interrupt / status） */
export function registerMcpTools(server: McpServer, runtime: McpToolRuntime): void {
  server.registerTool(
    'terminal_execute',
    {
      title: '终端执行',
      description:
        '在用户共享的终端会话中执行一条命令。命令由本地策略引擎分类：read-only 模式拒绝一切写类命令；managed 模式只自动放行低危命令；full 完全权限模式不审查命令、全部放行。',
      inputSchema: {
        sessionId: z.string().min(1).describe('用户从桌面复制的会话 ID'),
        command: z.string().min(1).describe('要执行的命令文本'),
        observationWindowMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('执行后等待输出收敛的观察窗口（毫秒）'),
      },
    },
    async (args) =>
      runMcpTool(runtime, 'external.terminalExecute', {
        sessionId: args.sessionId,
        command: args.command,
        ...(args.observationWindowMs === undefined
          ? {}
          : { observationWindowMs: args.observationWindowMs }),
      }),
  );

  server.registerTool(
    'terminal_observe',
    {
      title: '终端观察',
      description:
        '读取共享终端会话的当前屏幕或增量输出（只读操作）。返回内容经过本地脱敏管线，不会替换本地终端显示。',
      inputSchema: {
        sessionId: z.string().min(1).describe('用户从桌面复制的会话 ID'),
        view: z
          .enum(['screen', 'output'])
          .optional()
          .describe('观察模式：screen 为当前屏幕，output 为增量输出'),
        afterCursor: z.number().int().nonnegative().optional().describe('增量输出的起始游标'),
        maxBytes: z.number().int().positive().optional().describe('返回内容上限（字节）'),
      },
    },
    async (args) =>
      runMcpTool(runtime, 'external.terminalObserve', {
        sessionId: args.sessionId,
        ...(args.view === undefined ? {} : { view: args.view }),
        ...(args.afterCursor === undefined ? {} : { afterCursor: args.afterCursor }),
        ...(args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes }),
      }),
  );

  server.registerTool(
    'terminal_wait',
    {
      title: '等待命令完成',
      description: '等待一次终端执行事务收敛，返回最终结果与完成证据。',
      inputSchema: {
        sessionId: z.string().min(1).describe('用户从桌面复制的会话 ID'),
        transactionId: z.string().min(1).describe('terminal_execute 返回的事务 ID'),
        afterCursor: z.number().int().nonnegative().optional().describe('增量输出的起始游标'),
        timeoutMs: z.number().int().positive().optional().describe('最长等待时间（毫秒）'),
      },
    },
    async (args) =>
      runMcpTool(runtime, 'external.terminalWait', {
        sessionId: args.sessionId,
        transactionId: args.transactionId,
        ...(args.afterCursor === undefined ? {} : { afterCursor: args.afterCursor }),
        ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      }),
  );

  server.registerTool(
    'terminal_interrupt',
    {
      title: '中断终端执行',
      description: '中断一次进行中的终端执行事务。',
      inputSchema: {
        sessionId: z.string().min(1).describe('用户从桌面复制的会话 ID'),
        transactionId: z.string().min(1).describe('terminal_execute 返回的事务 ID'),
      },
    },
    async (args) =>
      runMcpTool(runtime, 'external.terminalInterrupt', {
        sessionId: args.sessionId,
        transactionId: args.transactionId,
      }),
  );

  server.registerTool(
    'terminal_status',
    {
      title: '终端会话状态',
      description:
        '只读探测共享终端会话状态：ready / not_ready / expired。会话失效时返回 expired 与重新共享指引；不创建租约、不写入终端。',
      inputSchema: {
        sessionId: z.string().min(1).describe('用户从桌面复制的会话 ID'),
      },
    },
    async (args) =>
      runMcpTool(runtime, 'external.terminalStatus', {
        sessionId: args.sessionId,
      }),
  );
}

export type { McpApprovalMode };
