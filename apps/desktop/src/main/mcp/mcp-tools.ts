import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { McpSettings } from './mcp-settings.js';

export const MCP_TOOL_NAMES = [
  'synapse_execute',
  'synapse_observe',
  'synapse_wait',
  'synapse_interrupt',
  'synapse_status',
] as const;

const STABLE_ERROR_CODES = new Set([
  'AUTHORIZATION_REVOKED',
  'SESSION_EXPIRED',
  'SESSION_NOT_READY',
  'SESSION_BUSY',
  'TRANSACTION_NOT_FOUND',
  'POLICY_DENIED',
  'SHELL_MISMATCH',
  'COMMAND_NOT_AUDITABLE',
  'INTERACTIVE_COMMAND_UNSUPPORTED',
  'EXECUTION_CONTEXT_REQUIRED',
  'EXECUTION_CONTEXT_STALE',
  'OUTPUT_CURSOR_STALE',
  'APPROVAL_TIMEOUT',
  'APPROVAL_DENIED',
]);

export interface McpToolRuntime {
  getSettings(): McpSettings;
  callTool(name: string, input: Record<string, unknown>, authorizedToken: string): Promise<unknown>;
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? String(value) : serialized;
}

export function serializeMcpToolError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z][A-Z0-9_]*):\s*([\s\S]*)$/.exec(raw);
  if (match !== null && STABLE_ERROR_CODES.has(match[1]!)) {
    const body = sanitizeErrorText(match[2]!);
    if (body.length > 0) return `${match[1]}: ${body}`;
  }
  return 'SESSION_NOT_READY: 外部调用失败。请检查当前 Session 状态后重试。';
}

export async function runMcpTool(
  runtime: McpToolRuntime,
  name: string,
  input: Record<string, unknown>,
  authorizedToken: string,
): Promise<CallToolResult> {
  if (runtime.getSettings().token !== authorizedToken) {
    return errorResult(
      'AUTHORIZATION_REVOKED: token 已被吊销。请在桌面端生成新 token 并重建连接。',
    );
  }
  if (!(MCP_TOOL_NAMES as readonly string[]).includes(name)) {
    return errorResult('POLICY_DENIED: 请求的工具不存在。仅提供五个 synapse_* 工具。');
  }
  if (!isRecord(input)) {
    return errorResult('POLICY_DENIED: 工具输入必须是对象。请检查调用参数。');
  }
  const validationError = validateToolInput(name, input);
  if (validationError !== undefined) return errorResult(validationError);
  try {
    return textResult(format(await runtime.callTool(name, input, authorizedToken)));
  } catch (error) {
    return errorResult(serializeMcpToolError(error));
  }
}

export function registerMcpTools(
  server: McpServer,
  runtime: McpToolRuntime,
  authorizedToken: string,
): void {
  const call =
    (name: string) =>
    async (args: Record<string, unknown>): Promise<CallToolResult> =>
      runMcpTool(runtime, name, args, authorizedToken);

  server.registerTool(
    'synapse_execute',
    {
      title: '执行终端命令',
      description:
        '在用户共享的终端会话当前 Shell 中按原文发送命令并开启事务；服务随后发送独立完成探针报告退出状态。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的终端会话 ID'),
        command: z.string().min(1).max(100_000).describe('要执行的完整命令文本'),
        expectedContextId: z
          .string()
          .min(1)
          .max(256)
          .describe('最近一次 synapse_observe 返回的 executionContextId，必须原样回传'),
        observationWindowMs: z
          .number()
          .int()
          .positive()
          .max(60_000)
          .optional()
          .describe('首次返回前的输出观察窗口，毫秒'),
      },
    },
    call('synapse_execute'),
  );

  server.registerTool(
    'synapse_observe',
    {
      title: '观察终端输出',
      description: '读取共享终端会话的增量输出；只读且返回前会统一脱敏。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的终端会话 ID'),
        afterCursor: z
          .string()
          .min(1)
          .max(2_048)
          .optional()
          .describe('使用上一次响应的 nextCursor，从该游标之后读取'),
        tail: z
          .boolean()
          .optional()
          .describe('读取当前 Sharing 输出历史最近一页，不能与 afterCursor 同时使用'),
        maxBytes: z
          .number()
          .int()
          .positive()
          .max(65_536)
          .optional()
          .describe('本页最大 UTF-8 字节数，服务端仍会执行上限约束'),
      },
    },
    call('synapse_observe'),
  );

  server.registerTool(
    'synapse_wait',
    {
      title: '等待命令事务收敛',
      description:
        '等待 synapse_execute 返回的事务完成、被中断或进入不确定态；单次默认 30 秒，最多 60 秒。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的终端会话 ID'),
        transactionId: z.string().min(1).max(256).describe('synapse_execute 返回的事务 ID'),
        timeoutMs: z
          .number()
          .int()
          .nonnegative()
          .max(60_000)
          .optional()
          .describe('本次等待时限，默认 30 秒，最多 60 秒；超时不改变事务状态'),
      },
    },
    call('synapse_wait'),
  );

  server.registerTool(
    'synapse_interrupt',
    {
      title: '中断终端事务',
      description: '向进行中的事务所属 PTY 发送中断信号。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的终端会话 ID'),
        transactionId: z.string().min(1).max(256).describe('要中断的事务 ID'),
      },
    },
    call('synapse_interrupt'),
  );

  server.registerTool(
    'synapse_status',
    {
      title: '探测会话状态',
      description:
        '只读探测 ready / not_ready / expired；不创建租约、不写入终端、不会触发 Probe。返回 not_ready 时不要循环调用本工具；远端 Shell 提示符就绪后直接调用 synapse_execute，执行管线会先运行固定明文 Probe。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的终端会话 ID'),
      },
    },
    call('synapse_status'),
  );
}

function validateToolInput(name: string, input: Record<string, unknown>): string | undefined {
  const sessionIdError = validateStringField(input, 'sessionId', 256);
  if (sessionIdError !== undefined) {
    return `POLICY_DENIED: ${sessionIdError}。请使用当前 Sharing 提供的 sessionId。`;
  }
  if (name === 'synapse_execute') {
    if (!isBoundedString(input.expectedContextId, 256)) {
      return 'EXECUTION_CONTEXT_REQUIRED: 缺少 expectedContextId。请先调用 synapse_observe 获取当前终端内容和新的 executionContextId。';
    }
    if (!isBoundedString(input.command, 100_000)) {
      return 'COMMAND_NOT_AUDITABLE: command 必须是 1 到 100000 个字符的原文命令。请检查输入。';
    }
    if (
      input.observationWindowMs !== undefined &&
      !isPositiveBoundedInteger(input.observationWindowMs, 60_000)
    ) {
      return 'POLICY_DENIED: observationWindowMs 必须是 1 到 60000 之间的整数。请调整观察窗口。';
    }
  }
  if (name === 'synapse_observe') {
    if (input.afterCursor !== undefined && !isBoundedString(input.afterCursor, 2_048)) {
      return 'POLICY_DENIED: afterCursor 必须是 1 到 2048 个字符的字符串游标。请重新观察当前历史。';
    }
    if (typeof input.tail !== 'undefined' && typeof input.tail !== 'boolean') {
      return 'POLICY_DENIED: tail 必须是布尔值。请使用 tail: true 或省略该字段。';
    }
    if (input.tail === true && input.afterCursor !== undefined) {
      return 'POLICY_DENIED: tail 与 afterCursor 互斥。请选择 tail: true 或使用 afterCursor 分页。';
    }
    if (
      input.maxBytes !== undefined &&
      (typeof input.maxBytes !== 'number' ||
        !Number.isSafeInteger(input.maxBytes) ||
        input.maxBytes < 1 ||
        input.maxBytes > 65_536)
    ) {
      return 'POLICY_DENIED: maxBytes 必须是 1 到 65536 之间的整数。请调整分页大小。';
    }
  }
  if (name === 'synapse_wait' || name === 'synapse_interrupt') {
    const transactionIdError = validateStringField(input, 'transactionId', 256);
    if (transactionIdError !== undefined) {
      return `POLICY_DENIED: ${transactionIdError}。请使用 synapse_execute 返回的 transactionId。`;
    }
  }
  if (
    name === 'synapse_wait' &&
    input.timeoutMs !== undefined &&
    !isBoundedInteger(input.timeoutMs, 0, 60_000)
  ) {
    return 'POLICY_DENIED: timeoutMs 必须是 0 到 60000 之间的整数。请调整单次等待时限。';
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maxLength;
}

function validateStringField(
  input: Record<string, unknown>,
  field: string,
  maxLength: number,
): string | undefined {
  return isBoundedString(input[field], maxLength) ? undefined : `${field} 无效`;
}

function isPositiveBoundedInteger(value: unknown, maximum: number): value is number {
  return isBoundedInteger(value, 1, maximum);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function sanitizeErrorText(value: string): string {
  let sanitized = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized += isUnsafeErrorCodePoint(codePoint) ? ' ' : character;
  }
  return sanitized.replace(/\s+/g, ' ').trim();
}

function isUnsafeErrorCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);
}
