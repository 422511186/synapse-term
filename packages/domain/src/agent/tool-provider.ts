/**
 * Tool Provider 契约（领域层）
 *
 * 架构文档 4.7：Tool Provider 提供工具名称、Schema、风险与副作用元数据；
 * Provider 不负责最终授权，所有 Tool 必须进入统一 Tool Pipeline。
 * 新增 Tool 应通过显式配置和版本化注册启用，不能因为安装 Provider 就自动扩大模型权限。
 */
import type { CommandRisk } from '../session/command-transaction.js';

/** 工具副作用分类：决定外部 read-only 审批是否可放行 */
export type ToolSideEffect = 'read' | 'write' | 'exec' | 'unknown';

/** 平台统一的工具定义（领域形态，与 Provider SDK 无关） */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema 形态的输入约束 */
  readonly inputSchema: Record<string, unknown>;
  readonly sideEffect: ToolSideEffect;
  /** 结构化执行类工具的风险等级（非执行类工具可省略） */
  readonly risk?: CommandRisk;
}

/** 一次工具调用的领域形态（驱动者提出，等待 Pipeline 授权） */
export interface ToolCallInvocation {
  readonly toolCallId: string;
  readonly name: string;
  readonly argumentsJson: string;
}

/** Tool Provider 元信息（供 Registry 注册与能力协商使用） */
export interface ToolProviderInfo {
  readonly id: string;
  readonly displayName: string;
  readonly tools: readonly ToolDefinition[];
}

/** 判断工具是否为只读（read-only 审批模式只放行这类工具） */
export function isReadOnlyTool(tool: ToolDefinition): boolean {
  return tool.sideEffect === 'read';
}

/** 在 Provider 的工具列表中查找指定名称的工具 */
export function findTool(provider: ToolProviderInfo, name: string): ToolDefinition | undefined {
  return provider.tools.find((tool) => tool.name === name);
}
