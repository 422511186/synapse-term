import type { CommandRisk } from '@synapse-term/domain';

export interface ApprovalRequest {
  sessionId: string;
  command: string;
  risk: CommandRisk;
  reasons: readonly string[];
}

export type ApprovalDecision = 'allow_once' | 'allow_session' | 'denied';
export type ApprovalDenialReason = 'user' | 'timeout' | 'cancelled';

export interface VisibleApprovalRequest extends ApprovalRequest {
  id: string;
}

export interface ApprovalResolution {
  decision: ApprovalDecision;
  reason: 'user' | ApprovalDenialReason;
}

export interface ApprovalQueueOptions {
  timeoutMs?: number;
  idFactory?: () => string;
}

interface PendingItem extends VisibleApprovalRequest {
  resolve: (resolution: ApprovalResolution) => void;
  timer?: NodeJS.Timeout | undefined;
}

export class ApprovalQueue {
  readonly #timeoutMs: number;
  readonly #idFactory: () => string;
  readonly #pending: PendingItem[] = [];
  readonly #listeners = new Set<(request: VisibleApprovalRequest) => void>();
  readonly #resolutionListeners = new Set<
    (id: string, reason: ApprovalDenialReason | 'user') => void
  >();
  #current: PendingItem | undefined;

  constructor(options: ApprovalQueueOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#idFactory = options.idFactory ?? (() => Math.random().toString(36).slice(2));
  }

  get current(): VisibleApprovalRequest | undefined {
    const current = this.#current;
    if (current === undefined) return undefined;
    return {
      id: current.id,
      sessionId: current.sessionId,
      command: current.command,
      risk: current.risk,
      reasons: current.reasons,
    };
  }

  onRequest(listener: (request: VisibleApprovalRequest) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onResolution(listener: (id: string, reason: ApprovalDenialReason | 'user') => void): () => void {
    this.#resolutionListeners.add(listener);
    return () => this.#resolutionListeners.delete(listener);
  }

  request(input: ApprovalRequest): Promise<ApprovalResolution> {
    return new Promise((resolve) => {
      const item: PendingItem = {
        ...input,
        id: this.#idFactory(),
        resolve,
      };
      this.#pending.push(item);
      this.#showNext();
    });
  }

  decide(id: string, decision: Exclude<ApprovalDecision, never>): boolean {
    if (this.#current?.id !== id) return false;
    this.#finish(this.#current, decision, 'user');
    return true;
  }

  cancelAll(): void {
    for (const item of [...this.#pending]) this.#finish(item, 'denied', 'cancelled');
    if (this.#current !== undefined) this.#finish(this.#current, 'denied', 'cancelled');
  }

  cancelSession(sessionId: string): void {
    for (const item of [...this.#pending]) {
      if (item.sessionId === sessionId) this.#finish(item, 'denied', 'cancelled');
    }
    if (this.#current?.sessionId === sessionId) {
      this.#finish(this.#current, 'denied', 'cancelled');
    }
  }

  #showNext(): void {
    if (this.#current !== undefined || this.#pending.length === 0) return;
    const item = this.#pending.shift()!;
    this.#current = item;
    item.timer = setTimeout(
      () => this.#finish(this.#current, 'denied', 'timeout'),
      this.#timeoutMs,
    );
    const visible = this.current;
    if (visible !== undefined) {
      for (const listener of this.#listeners) listener(visible);
    }
  }

  #finish(
    item: PendingItem | undefined,
    decision: ApprovalDecision,
    reason: ApprovalDenialReason,
  ): void {
    if (item === undefined) return;
    const isCurrent = this.#current === item;
    const pendingIndex = this.#pending.indexOf(item);
    if (!isCurrent && pendingIndex < 0) return;
    clearTimeout(item.timer);
    if (pendingIndex >= 0) this.#pending.splice(pendingIndex, 1);
    if (isCurrent) this.#current = undefined;
    item.resolve({ decision, reason });
    for (const listener of this.#resolutionListeners) listener(item.id, reason);
    if (isCurrent) this.#showNext();
  }
}
