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
    | 'external.localListFiles'
    | 'external.localSearchFiles'
    | 'external.localReadFile',
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
      return errorResult(result.message ?? result.error ?? '外部调用被拒绝');
    }
    return textResult(formatResult(result));
  } catch (error) {
    // 无效会话统一返回稳定文案，不泄露其他会话的任何信息（ADR-0022）。
    if (error instanceof Error && 'code' in error && error.code === 'invalid_session') {
      return errorResult('无效的会话标识');
    }
    const message = error instanceof Error ? error.message : '外部调用失败';
    return errorResult(`外部调用失败：${message}`);
  }
}

/** 注册 MCP 工具集合：终端执行 / observe / wait / interrupt + 只读文件能力 */
export function registerMcpTools(server: McpServer, runtime: McpToolRuntime): void {
  server.registerTool(
    'terminal_execute',
    {
      title: '终端执行',
      description:
        '在用户共享的终端会话中执行一条命令。命令由本地策略引擎分类：read-only 模式拒绝一切写类命令；managed 模式只自动放行低危命令，破坏性命令一律拒绝。',
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
    'local_list_files',
    {
      title: '列出目录',
      description: '只读列出用户共享会话下的本地目录内容，路径受本地文件策略限制。',
      inputSchema: {
        sessionId: z.string().min(1).describe('用户从桌面复制的会话 ID'),
        path: z.string().optional().describe('要列出的目录路径（缺省为会话工作目录）'),
        maxDepth: z.number().int().positive().optional().describe('递归深度上限'),
        maxResults: z.number().int().positive().optional().describe('返回条目数上限'),
      },
    },
    async (args) =>
      runMcpTool(runtime, 'external.localListFiles', {
        sessionId: args.sessionId,
        ...(args.path === undefined ? {} : { path: args.path }),
        ...(args.maxDepth === undefined ? {} : { maxDepth: args.maxDepth }),
        ...(args.maxResults === undefined ? {} : { maxResults: args.maxResults }),
      }),
  );

  server.registerTool(
    'local_search_files',
    {
      title: '搜索文件',
      description: '只读搜索目录中的文件与内容，路径受本地文件策略限制。',
      inputSchema: {
        sessionId: z.string().min(1).describe('用户从桌面复制的会话 ID'),
        path: z.string().describe('搜索根目录'),
        query: z.string().min(1).describe('搜索关键字'),
        mode: z.enum(['filename', 'content']).describe('按文件名或文件内容搜索'),
        maxDepth: z.number().int().positive().optional(),
        maxResults: z.number().int().positive().optional(),
        maxBytes: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
      },
    },
    async (args) =>
      runMcpTool(runtime, 'external.localSearchFiles', {
        sessionId: args.sessionId,
        path: args.path,
        query: args.query,
        mode: args.mode,
        ...(args.maxDepth === undefined ? {} : { maxDepth: args.maxDepth }),
        ...(args.maxResults === undefined ? {} : { maxResults: args.maxResults }),
        ...(args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes }),
        ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      }),
  );

  server.registerTool(
    'local_read_file',
    {
      title: '读取文件',
      description: '只读读取文件内容，路径受本地文件策略限制。',
      inputSchema: {
        sessionId: z.string().min(1).describe('用户从桌面复制的会话 ID'),
        path: z.string().describe('要读取的文件路径'),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        maxBytes: z.number().int().positive().optional(),
      },
    },
    async (args) =>
      runMcpTool(runtime, 'external.localReadFile', {
        sessionId: args.sessionId,
        path: args.path,
        ...(args.startLine === undefined ? {} : { startLine: args.startLine }),
        ...(args.endLine === undefined ? {} : { endLine: args.endLine }),
        ...(args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes }),
      }),
  );
}

export type { McpApprovalMode };
