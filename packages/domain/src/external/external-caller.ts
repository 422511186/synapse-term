/**
 * 外部接入领域类型（specs/mcp-access、ADR-0014 / ADR-0015）
 *
 * 外部调用以"外部调用者 + Session"为主体进行权限归属，
 * 不伪造 Task / Turn。MCP 客户端走该身份。
 */

export type ExternalCallerKind = 'mcp';

/** 外部调用者身份：kind 区分接入线，id 用于权限归属 */
export interface ExternalCaller {
  readonly kind: ExternalCallerKind;
  readonly id: string;
  readonly displayName?: string | undefined;
}

export function createExternalCaller(
  kind: ExternalCallerKind,
  id: string,
  displayName?: string,
): ExternalCaller {
  return {
    kind,
    id,
    ...(displayName === undefined ? {} : { displayName }),
  };
}

/** 命令风险分级：read_only 最低，destructive 最高 */
export type CommandRisk = 'read_only' | 'unknown' | 'mutating' | 'privileged' | 'destructive';

const RISK_ORDER: readonly CommandRisk[] = [
  'read_only',
  'unknown',
  'mutating',
  'privileged',
  'destructive',
];

export function higherRisk(left: CommandRisk, right: CommandRisk): CommandRisk {
  return RISK_ORDER.indexOf(right) > RISK_ORDER.indexOf(left) ? right : left;
}

/** 外部审批模式（ADR-0015）：配置损坏时回退 read_only */
export type McpApprovalMode = 'read_only' | 'managed' | 'full';

/** IPC/存储边界的模式归一化：只接受白名单值，未知值回退 read_only */
export function normalizeMcpApprovalMode(value: unknown): McpApprovalMode {
  return value === 'managed' || value === 'full' ? value : 'read_only';
}

/** 稳定外部错误码：MCP 工具错误结果必须以此开头返回（specs/mcp-access） */
export type ExternalErrorCode =
  | 'SESSION_EXPIRED'
  | 'SESSION_NOT_READY'
  | 'SESSION_BUSY'
  | 'TRANSACTION_NOT_FOUND'
  | 'POLICY_DENIED'
  | 'SHELL_MISMATCH'
  | 'APPROVAL_TIMEOUT'
  | 'APPROVAL_DENIED';
