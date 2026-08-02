/**
 * Audit 请求处理
 *
 * audit.* 用例：查询审计事件（按会话/任务过滤）与清理。事件载荷
 * 只返回摘要字段，不把完整 payload 透传给客户端。
 */
import type { AuditEvent } from '@synapse-term/infrastructure';

import type { AuditQueryLike } from '../contracts.js';

export interface AuditRequestHandlerOptions {
  audit?: AuditQueryLike | undefined;
  cleanup?: (() => Promise<{ rawLogs: number; auditEvents: number }>) | undefined;
}

export class AuditRequestHandler {
  readonly #audit: AuditQueryLike | undefined;
  readonly #cleanup: (() => Promise<{ rawLogs: number; auditEvents: number }>) | undefined;

  constructor(options: AuditRequestHandlerOptions) {
    this.#audit = options.audit;
    this.#cleanup = options.cleanup;
  }

  listAudit(sessionId?: string, taskId?: string): unknown[] {
    if (this.#audit === undefined) return [];
    const events = this.#audit.query({
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(taskId === undefined ? {} : { taskId }),
    });
    return events.map((event) => ({
      id: event.id,
      type: event.type,
      ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
      ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      occurredAt: event.occurredAt,
      summary: summarizeAudit(event),
    }));
  }

  async cleanup(): Promise<{ rawLogs: number; auditEvents: number }> {
    if (this.#cleanup === undefined) return { rawLogs: 0, auditEvents: 0 };
    return this.#cleanup();
  }
}

function summarizeAudit(event: AuditEvent): string {
  const payload = event.payload;
  for (const key of ['reason', 'commandHash', 'status', 'mode']) {
    const value = payload[key];
    if (typeof value === 'string') return value;
  }
  return event.type;
}
