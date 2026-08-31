export interface ExternalLease {
  sessionId: string;
  epoch: number;
}

interface LeaseOwner {
  id: string;
  epoch: number;
}

export class ExternalLeaseError extends Error {
  constructor(message: string) {
    super(`SESSION_BUSY: ${message}. 请等待当前外部调用释放会话后再试。`);
    this.name = 'ExternalLeaseError';
  }
}

export class ExternalLeaseRegistry {
  readonly #owners = new Map<string, LeaseOwner>();
  #epoch = 0;

  acquire(sessionId: string, callerId: string): ExternalLease {
    const existing = this.#owners.get(sessionId);
    if (existing !== undefined) {
      if (existing.id !== callerId) {
        throw new ExternalLeaseError(`session ${sessionId} is already leased`);
      }
      return { sessionId, epoch: existing.epoch };
    }

    this.#epoch += 1;
    const owner = { id: callerId, epoch: this.#epoch };
    this.#owners.set(sessionId, owner);
    return { sessionId, epoch: owner.epoch };
  }

  release(sessionId: string, callerId: string): void {
    const existing = this.#owners.get(sessionId);
    if (existing?.id === callerId) this.#owners.delete(sessionId);
  }

  clear(sessionId: string): void {
    this.#owners.delete(sessionId);
  }

  owner(sessionId: string): (ExternalLease & { id: string }) | undefined {
    const existing = this.#owners.get(sessionId);
    return existing === undefined
      ? undefined
      : { sessionId, id: existing.id, epoch: existing.epoch };
  }
}
