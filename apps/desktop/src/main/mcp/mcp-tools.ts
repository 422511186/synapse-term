import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { InputKey } from '@synapse-term/domain';

import type { McpSettings } from './mcp-settings.js';
import {
  encodeInput,
  InputEncoderError,
  INPUT_KEYS,
  validateInputRequestId,
} from './input-encoder.js';

export const MCP_TOOL_NAMES = [
  'synapse_execute',
  'synapse_start_interactive',
  'synapse_input',
  'synapse_finish_interactive',
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
  'INPUT_GRANT_EXHAUSTED',
  'INPUT_WRITE_UNKNOWN',
  'INTERACTIVE_START_WRITE_UNKNOWN',
]);

const INPUT_KEY_ENUM = z.enum(INPUT_KEYS as [InputKey, ...InputKey[]]);

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
    return errorResult('POLICY_DENIED: 请求的工具不存在。仅提供八个 synapse_* 工具。');
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
      title: '执行结构化终端命令',
      description:
        '在用户共享的 Terminal Session 当前 Shell 中按原文发送结构化命令并开启事务；服务随后发送独立完成 Probe。预期会读取 stdin 的 command 必须改用 synapse_start_interactive。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的 Terminal Session ID'),
        command: z.string().min(1).max(100_000).describe('要执行的完整原文命令'),
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
    'synapse_start_interactive',
    {
      title: '启动交互事务',
      description:
        '启动显式交互事务，只写入 command 及终止回车，不附加完成 Probe；成功后返回 transactionId 和有限 inputGrantId。调用方必须通过 synapse_input 驱动 stdin，并在观察到回到 Shell 后调用 synapse_finish_interactive。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的 Terminal Session ID'),
        command: z.string().min(1).max(100_000).describe('要启动的完整原文交互命令'),
        expectedContextId: z
          .string()
          .min(1)
          .max(256)
          .describe('最近一次 synapse_observe 返回的 executionContextId'),
        inputGrantMode: z
          .enum(['one_shot', 'bounded'])
          .describe('后续输入授权档位：一次性 one_shot 或固定配额 bounded'),
      },
    },
    call('synapse_start_interactive'),
  );

  server.registerTool(
    'synapse_input',
    {
      title: '发送受限终端输入',
      description:
        '向共享 PTY 发送一次受限输入。事务内模式必须同时提供 transactionId 与 inputGrantId；自由模式只能提供 expectedContextId，且 Session 不得有活动事务。两种模式都必须提供 inputRequestId 和 text/keys 之一；换行会规范化为回车，响应只返回发送元数据、输出窗口和游标，不回显 text 原文。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的 Terminal Session ID'),
        transactionId: z.string().min(1).max(256).optional().describe('交互启动返回的事务 ID'),
        inputGrantId: z.string().min(1).max(256).optional().describe('交互启动返回的输入授权 ID'),
        expectedContextId: z
          .string()
          .min(1)
          .max(256)
          .optional()
          .describe('自由输入模式使用的最近 executionContextId'),
        inputRequestId: z
          .string()
          .min(1)
          .max(256)
          .describe('调用方生成的幂等输入请求标识，不得含控制字符'),
        text: z.string().max(100_000).optional().describe('可打印文本；其中换行转换为回车'),
        keys: z
          .array(INPUT_KEY_ENUM)
          .max(128)
          .optional()
          .describe('固定 xterm normal-mode 键名数组，不接受原始转义序列'),
      },
    },
    call('synapse_input'),
  );

  server.registerTool(
    'synapse_finish_interactive',
    {
      title: '终结交互事务',
      description:
        '终结交互事务。调用方必须先用 synapse_observe 观察到程序已回到 Shell，并把最近一次 observe 的 nextCursor 作为 observedCursor；服务随后单独发送完成 Probe。过早终结可能进入 unknown，不会自动重试。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的 Terminal Session ID'),
        transactionId: z
          .string()
          .min(1)
          .max(256)
          .describe('synapse_start_interactive 返回的事务 ID'),
        observedCursor: z
          .string()
          .min(1)
          .max(2_048)
          .describe('最近一次 synapse_observe 返回的 nextCursor'),
      },
    },
    call('synapse_finish_interactive'),
  );

  server.registerTool(
    'synapse_observe',
    {
      title: '观察终端输出',
      description: '读取共享 Terminal Session 的 PTY 输出历史分页；只读且返回前会统一脱敏。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的 Terminal Session ID'),
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
          .describe('本页最大 UTF-8 字节数，服务端仍执行上限约束'),
      },
    },
    call('synapse_observe'),
  );

  server.registerTool(
    'synapse_wait',
    {
      title: '等待外部事务收敛',
      description:
        '等待结构化或交互事务完成、被中断或进入不确定态；交互事务在 finish 前只返回 running，不自动注入完成 Probe。单次默认 30 秒，最多 60 秒。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的 Terminal Session ID'),
        transactionId: z.string().min(1).max(256).describe('外部事务 ID'),
        timeoutMs: z
          .number()
          .int()
          .nonnegative()
          .max(60_000)
          .optional()
          .describe('本次等待时限，默认 30 秒，超时不改变事务状态'),
      },
    },
    call('synapse_wait'),
  );

  server.registerTool(
    'synapse_interrupt',
    {
      title: '中断外部事务',
      description: '向进行中的结构化或交互事务所属 PTY 发送 Ctrl+C；不承诺远程进程组已终止。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的 Terminal Session ID'),
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
        '只读探测 ready / not_ready / expired；不创建租约、不写入终端、不会触发 Probe。not_ready 时不要循环调用本工具，Shell 就绪后直接调用 synapse_execute 或 synapse_start_interactive。',
      inputSchema: {
        sessionId: z.string().min(1).max(256).describe('用户共享的 Terminal Session ID'),
      },
    },
    call('synapse_status'),
  );
}

export function validateToolInput(
  name: string,
  input: Record<string, unknown>,
): string | undefined {
  const sessionIdError = validateStringField(input, 'sessionId', 256);
  if (sessionIdError !== undefined) {
    return `POLICY_DENIED: ${sessionIdError}。请使用当前 Sharing 提供的 sessionId。`;
  }
  if (name === 'synapse_execute' || name === 'synapse_start_interactive') {
    if (!isBoundedString(input.expectedContextId, 256)) {
      return 'EXECUTION_CONTEXT_REQUIRED: 缺少 expectedContextId。请先调用 synapse_observe 获取当前终端内容和新的 executionContextId。';
    }
    if (!isBoundedString(input.command, 100_000)) {
      return 'COMMAND_NOT_AUDITABLE: command 必须是 1 到 100000 个字符的原文命令。请检查输入。';
    }
    if (
      name === 'synapse_execute' &&
      input.observationWindowMs !== undefined &&
      !isPositiveBoundedInteger(input.observationWindowMs, 60_000)
    ) {
      return 'POLICY_DENIED: observationWindowMs 必须是 1 到 60000 之间的整数。请调整观察窗口。';
    }
    if (
      name === 'synapse_start_interactive' &&
      input.inputGrantMode !== 'one_shot' &&
      input.inputGrantMode !== 'bounded'
    ) {
      return 'POLICY_DENIED: inputGrantMode 必须是 one_shot 或 bounded。请选择明确的有限输入授权档位。';
    }
  }
  if (name === 'synapse_input') return validateInputTool(input);
  if (name === 'synapse_finish_interactive') {
    const transactionIdError = validateStringField(input, 'transactionId', 256);
    if (transactionIdError !== undefined) {
      return `POLICY_DENIED: ${transactionIdError}。请使用 synapse_start_interactive 返回的 transactionId。`;
    }
    if (!isBoundedString(input.observedCursor, 2_048)) {
      return 'OUTPUT_CURSOR_STALE: observedCursor 必须是最近一次 synapse_observe 返回的 nextCursor。请重新观察后再终结。';
    }
  }
  if (name === 'synapse_observe') {
    if (input.afterCursor !== undefined && !isBoundedString(input.afterCursor, 2_048)) {
      return 'POLICY_DENIED: afterCursor 必须是 1 到 2048 个字符的字符串游标。请重新观察当前历史。';
    }
    if (input.tail !== undefined && typeof input.tail !== 'boolean') {
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
      return `POLICY_DENIED: ${transactionIdError}。请使用外部事务返回的 transactionId。`;
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

function validateInputTool(input: Record<string, unknown>): string | undefined {
  const transactionId = input.transactionId;
  const inputGrantId = input.inputGrantId;
  const expectedContextId = input.expectedContextId;
  const hasTransactionFields = transactionId !== undefined || inputGrantId !== undefined;
  const hasContext = expectedContextId !== undefined;
  if (hasTransactionFields && hasContext) {
    return 'POLICY_DENIED: transactionId/inputGrantId 与 expectedContextId 互斥。请在事务内或自由输入模式中二选一。';
  }
  if (hasTransactionFields) {
    if (!isBoundedString(transactionId, 256) || !isBoundedString(inputGrantId, 256)) {
      return 'POLICY_DENIED: 事务内输入必须同时提供有效的 transactionId 和 inputGrantId。';
    }
  } else if (!isBoundedString(expectedContextId, 256)) {
    return 'EXECUTION_CONTEXT_REQUIRED: 自由输入必须提供当前 expectedContextId；事务内输入请提供 transactionId/inputGrantId。';
  }
  if (!validateInputRequestId(input.inputRequestId)) {
    return 'POLICY_DENIED: inputRequestId 必须是 1 到 256 个不含控制字符的字符串。请生成合法标识。';
  }
  if (input.text !== undefined && typeof input.text !== 'string') {
    return 'COMMAND_NOT_AUDITABLE: text 必须是字符串。请检查输入。';
  }
  if (input.text !== undefined && (input.text as string).length > 100_000) {
    return 'COMMAND_NOT_AUDITABLE: text 字符数超过工具上限。请缩短输入。';
  }
  if (input.keys !== undefined && !Array.isArray(input.keys)) {
    return 'COMMAND_NOT_AUDITABLE: keys 必须是固定键名数组。请检查输入。';
  }
  if (Array.isArray(input.keys)) {
    if (input.keys.length > 128) {
      return 'COMMAND_NOT_AUDITABLE: keys 数量不得超过 128。请缩短输入。';
    }
    if (input.keys.some((key) => typeof key !== 'string' || !isInputKey(key))) {
      return 'COMMAND_NOT_AUDITABLE: keys 包含不在白名单中的键名。请使用固定 xterm normal-mode 键名。';
    }
  }
  try {
    encodeInput({ text: input.text, keys: input.keys });
  } catch (error) {
    if (error instanceof InputEncoderError) return error.message;
    return 'COMMAND_NOT_AUDITABLE: 输入无法通过协议校验。请检查 text 和 keys。';
  }
  return undefined;
}

function isInputKey(value: string): value is InputKey {
  return (INPUT_KEYS as readonly string[]).includes(value);
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
