/**
 * 外部调用者身份（specs/agent-execution、设计 D10 / ADR-0024）
 *
 * 外部调用以"外部调用者 + Session"为主体进行审计与权限归属，
 * 不伪造 Task / Turn。MCP 客户端与 ACP 子进程都走该身份。
 */
export type ExternalCallerKind = 'mcp' | 'acp';

/** 外部调用者身份：kind 区分接入线，id 用于审计归属 */
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
