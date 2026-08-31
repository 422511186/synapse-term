import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { McpSettings } from './mcp-settings.js';

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
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
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
  try {
    return textResult(format(await runtime.callTool(name, input, authorizedToken)));
  } catch (error) {
    const message = error instanceof Error ? error.message : '外部调用失败。';
    return errorResult(message);
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
        sessionId: z.string().min(1).describe('用户共享的终端会话 ID'),
        command: z.string().min(1).max(100_000).describe('要执行的完整命令文本'),
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
        sessionId: z.string().min(1).describe('用户共享的终端会话 ID'),
        afterCursor: z.number().int().nonnegative().optional().describe('从此输出游标之后读取'),
      },
    },
    call('synapse_observe'),
  );

  server.registerTool(
    'synapse_wait',
    {
      title: '等待命令事务收敛',
      description: '等待 synapse_execute 返回的事务完成、被打断或失败。',
      inputSchema: {
        sessionId: z.string().min(1).describe('用户共享的终端会话 ID'),
        transactionId: z.string().min(1).describe('synapse_execute 返回的事务 ID'),
        timeoutMs: z.number().int().positive().max(3_600_000).optional().describe('最长等待毫秒数'),
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
        sessionId: z.string().min(1).describe('用户共享的终端会话 ID'),
        transactionId: z.string().min(1).describe('要中断的事务 ID'),
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
        sessionId: z.string().min(1).describe('用户共享的终端会话 ID'),
      },
    },
    call('synapse_status'),
  );
}
