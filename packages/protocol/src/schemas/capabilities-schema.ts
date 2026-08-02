/**
 * 能力声明与驱动者视图的协议 Schema（packages/protocol）
 *
 * 架构文档 4.2：协议层只描述结构与兼容规则，不执行业务。
 * MCP / ACP 等外部协议的原始类型不直接进入 Domain，
 * 由 Adapter 翻译为内部 Core API 或 Agent Event。
 */
import { z } from 'zod';

import { agentDriverKindSchema, permissionModeSchema } from './domain-schemas.js';

/** 平台对外暴露的能力项（与领域层 PlatformCapability 一一对应） */
export const platformCapabilitySchema = z.enum([
  'terminal.execute',
  'terminal.observe',
  'terminal.wait',
  'terminal.interrupt',
  'file.read',
  'file.write',
  'file.search',
  'file.index',
]);
export type PlatformCapability = z.infer<typeof platformCapabilitySchema>;

/** 一组能力声明（外部客户端协商时使用） */
export const platformCapabilitySetSchema = z.strictObject({
  capabilities: z.array(platformCapabilitySchema),
});
export type PlatformCapabilitySet = z.infer<typeof platformCapabilitySetSchema>;

/** 驱动者种类：内置 Agent 或外部 ACP Agent */
export type AgentDriverKind = z.infer<typeof agentDriverKindSchema>;

/** 驱动者能力声明 Schema */
export const agentDriverCapabilitiesSchema = z.strictObject({
  selfManagedModel: z.boolean(),
  permissionModes: z.array(permissionModeSchema),
});

/** 驱动者视图 Schema（面板展示与 Registry 查询结果） */
export const agentDriverViewSchema = z.strictObject({
  id: z.string().min(1),
  kind: agentDriverKindSchema,
  displayName: z.string().min(1),
  capabilities: agentDriverCapabilitiesSchema,
});
export type AgentDriverView = z.infer<typeof agentDriverViewSchema>;

/** Terminal 能力声明项（架构文档 2.5） */
export const terminalCapabilitySchema = z.enum([
  'observeScreen',
  'replayOutput',
  'structuredExecute',
  'interrupt',
  'resize',
  'persistentShellState',
  'supportedDialects',
]);
export type TerminalCapability = z.infer<typeof terminalCapabilitySchema>;

/** Terminal 后端能力集合 Schema */
export const terminalBackendCapabilitiesSchema = z.strictObject({
  capabilities: z.array(terminalCapabilitySchema),
  dialects: z.array(z.enum(['posix', 'powershell', 'observe_only'])),
});
export type TerminalBackendCapabilities = z.infer<typeof terminalBackendCapabilitiesSchema>;

/** Terminal 后端视图 Schema（Registry 查询结果） */
export const terminalBackendViewSchema = z.strictObject({
  id: z.string().min(1),
  displayName: z.string().min(1),
  capabilities: terminalBackendCapabilitiesSchema,
});
export type TerminalBackendView = z.infer<typeof terminalBackendViewSchema>;

/** 工具副作用分类（决定外部 read-only 审批是否可放行） */
export const toolSideEffectSchema = z.enum(['read', 'write', 'exec', 'unknown']);
export type ToolSideEffect = z.infer<typeof toolSideEffectSchema>;

/** 平台统一工具定义 Schema */
export const toolDefinitionSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()),
  sideEffect: toolSideEffectSchema,
  risk: z.enum(['read_only', 'unknown', 'mutating', 'privileged', 'destructive']).optional(),
});
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

/** Tool Provider 视图 Schema（Registry 查询结果） */
export const toolProviderViewSchema = z.strictObject({
  id: z.string().min(1),
  displayName: z.string().min(1),
  tools: z.array(toolDefinitionSchema),
});
export type ToolProviderView = z.infer<typeof toolProviderViewSchema>;
