/**
 * Core API 路由共享契约
 *
 * 供 CoreRequestRouter 与各域 RequestHandler 共用的端口类型与错误构造。
 * 这些类型保持从 core-request-router.ts 重新导出，公共 API 不因拆分而改变。
 */
import type {
  AgentAttachmentInput,
  AgentPermissionMode,
  ModelConfiguration,
  ProviderProfile,
  ReasoningEffort,
} from '@synapse-term/domain';
import type { AuditEvent, AuditRecordInput } from '@synapse-term/infrastructure';
import type { ModelAdapter } from '@synapse-term/model-providers';
import type { ProviderModelDiscoveryService } from '@synapse-term/model-providers';
import type { AgentHistoryView } from '@synapse-term/protocol';

/** 密钥存储端口：引用式保存 Provider 凭据，不直接持有明文 */
export interface CoreSecretStore {
  set(reference: string, secret: string): Promise<void>;
  get(reference: string): Promise<string | undefined>;
  delete(reference: string): Promise<boolean>;
}

/** Provider Adapter 工厂：由 Composition Root 注入具体模型适配器实现 */
export type ProviderAdapterFactory = (
  profile: ProviderProfile,
  model: ModelConfiguration,
  secret: string,
) => ModelAdapter;

/** 模型发现服务端口（可取消） */
export interface ProviderModelDiscoveryLike {
  discover(
    profile: ProviderProfile,
    secret: string,
    signal?: AbortSignal,
  ): ReturnType<ProviderModelDiscoveryService['discover']>;
  cancel(providerProfileId: string): boolean;
}

/** Agent 协调器端口：外部入口只依赖此用例面，不触碰内部状态 */
export interface AgentCoordinatorLike {
  start(
    sessionId: string,
    goal: string,
    options?: {
      attachments?: readonly AgentAttachmentInput[];
      modelConfigurationId?: string;
      reasoningEffort?: ReasoningEffort;
      permissionMode?: AgentPermissionMode;
    },
  ): Promise<{ taskId: string; conversationId: string; turnId: string }>;
  cancel(sessionId: string, turnId?: string): Promise<void>;
  history(sessionId: string): Promise<AgentHistoryView>;
  resetConversation(sessionId: string, expectedConversationId: string): Promise<void>;
  interrupt(sessionId: string, transactionId: string): Promise<void>;
  approve(sessionId: string, approvalId: string, confirmedDestructive: boolean): Promise<void>;
  takeover(sessionId: string): Promise<void>;
  closeAll?(): Promise<void>;
}

/** 审计查询端口 */
export interface AuditQueryLike {
  query(filter?: { sessionId?: string; taskId?: string }): AuditEvent[];
  record?(input: AuditRecordInput): void;
}

/** 会话资源服务端口 */
export interface SessionResourcesLike {
  get(sessionId: string): unknown;
  refresh(sessionId: string): Promise<unknown>;
}

/** 终端输出推送通知 */
export interface TerminalOutputNotification {
  sessionId: string;
  sequence: number;
  data: string;
}

/** 路由层统一错误：携带稳定错误码，便于外部入口映射 */
export function routerError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
