/**
 * Resource 请求处理
 *
 * resources.* 用例：会话资源快照读取与刷新。响应先过协议 schema
 * 校验再返回，刷新成功后推送 session.resources 事件。
 */
import type { CoreServiceEvent } from '@synapse-term/protocol';
import {
  sessionResourceRefreshResultSchema,
  sessionResourceSnapshotSchema,
} from '@synapse-term/protocol';

import { routerError } from '../contracts.js';
import type { SessionResourcesLike } from '../contracts.js';

export interface ResourceRequestHandlerOptions {
  resources?: SessionResourcesLike | undefined;
  emitEvent?: ((event: CoreServiceEvent) => void) | undefined;
}

export class ResourceRequestHandler {
  readonly #resources: SessionResourcesLike | undefined;
  readonly #emitEvent: (event: CoreServiceEvent) => void;

  constructor(options: ResourceRequestHandlerOptions) {
    this.#resources = options.resources;
    this.#emitEvent = options.emitEvent ?? (() => undefined);
  }

  getResources(sessionId: string): unknown {
    const snapshot = this.#requireResources().get(sessionId);
    return snapshot === undefined ? undefined : sessionResourceSnapshotSchema.parse(snapshot);
  }

  async refreshResources(sessionId: string): Promise<unknown> {
    const result = sessionResourceRefreshResultSchema.parse(
      await this.#requireResources().refresh(sessionId),
    );
    if (result.ok) {
      this.#emitEvent({
        type: 'session.resources',
        streamId: `resources:${sessionId}`,
        payload: { sessionId, snapshot: result.snapshot },
      });
    }
    return result;
  }

  #requireResources(): SessionResourcesLike {
    if (this.#resources === undefined) {
      throw routerError('internal_error', 'Session resource service is not configured');
    }
    return this.#resources;
  }
}
