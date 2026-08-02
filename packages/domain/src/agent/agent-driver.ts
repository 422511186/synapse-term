/**
 * Agent 驱动者契约（领域层）
 *
 * 驱动者是"谁能作为主驾驶推进一个 Agent 任务"的抽象（架构文档 4.5）：
 * - builtin：内置 AgentRuntime，由平台管理模型与推理循环；
 * - acp：外部 Agent（如 opencode）以 CLI 子进程 + ACP 协议接入，自带模型与推理循环。
 *
 * 无论哪种驱动者，其提出的 Tool Call 都必须进入统一的 Tool Pipeline
 * （Policy / Approval / Lease / Audit），不得绕过（见 specs/agent-execution）。
 */
import type { AgentPermissionMode } from './agent-conversation.js';

/** 驱动者种类：内置 Agent 或外部 ACP Agent */
export type AgentDriverKind = 'builtin' | 'acp';

/** 驱动者唯一标识，如 'builtin'、'opencode-acp' */
export type AgentDriverId = string;

/** 驱动者能力声明：描述驱动者是否自管模型与允许的权限模式 */
export interface AgentDriverCapabilities {
  /** 是否自带模型与推理循环（外部 ACP 为 true，内置 Agent 为 false） */
  readonly selfManagedModel: boolean;
  /** 该驱动者允许使用的权限模式子集（外部驱动者默认仅 manual / auto） */
  readonly permissionModes: readonly AgentPermissionMode[];
}

/** 平台可展示的驱动者元信息（供 Registry 注册与面板展示使用） */
export interface AgentDriverInfo {
  readonly id: AgentDriverId;
  readonly kind: AgentDriverKind;
  readonly displayName: string;
  readonly capabilities: AgentDriverCapabilities;
}

/**
 * 驱动者统一输出事件（架构文档 4.5）
 *
 * 外部 ACP 事件经适配层翻译后进入该形态；内置 Agent 直接产出该形态。
 * 平台只消费这一种事件流，避免每个驱动者一套时间线格式。
 */
export type AgentDriverEvent =
  | { type: 'AgentStarted' }
  | { type: 'AgentTextDelta'; delta: string }
  | {
      type: 'AgentToolCallRequested';
      toolCallId: string;
      name: string;
      argumentsJson: string;
    }
  | { type: 'AgentWaiting'; reason: 'approval' | 'user' | 'input' }
  | { type: 'AgentFailed'; message: string }
  | { type: 'AgentCompleted'; stopReason?: string };

/** 内置驱动者的标准 id */
export const BUILTIN_DRIVER_ID = 'builtin';

/** 构造内置驱动者元信息（默认能力：自管模型、支持全部权限模式） */
export function createBuiltinDriverInfo(): AgentDriverInfo {
  return {
    id: BUILTIN_DRIVER_ID,
    kind: 'builtin',
    displayName: '内置 Agent',
    capabilities: {
      selfManagedModel: false,
      permissionModes: ['manual', 'auto', 'full_access'],
    },
  };
}
