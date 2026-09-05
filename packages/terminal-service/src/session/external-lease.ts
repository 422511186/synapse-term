export interface ExternalLease {
  sessionId: string;
  epoch: number;
}

/** 可跨多次调用持有的幂等租约句柄。 */
export interface ExternalLeaseHandle {
  readonly lease: ExternalLease;
  readonly released: boolean;
  release(): void;
}

interface LeaseOwner {
  id: string;
  epoch: number;
  legacyHeld: boolean;
  handleCount: number;
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
    const owner = this.#acquireOwner(sessionId, callerId);
    owner.legacyHeld = true;
    return { sessionId, epoch: owner.epoch };
  }

  acquireHandle(sessionId: string, callerId: string): ExternalLeaseHandle {
    const owner = this.#acquireOwner(sessionId, callerId);
    owner.handleCount += 1;
    const lease = { sessionId, epoch: owner.epoch };
    let released = false;
    return {
      lease,
      get released() {
        return released;
      },
      release: () => {
        if (released) return;
        released = true;
        const current = this.#owners.get(sessionId);
        if (current !== owner || current.id !== callerId) return;
        current.handleCount = Math.max(0, current.handleCount - 1);
        this.#deleteIfUnheld(sessionId, current);
      },
    };
  }

  release(sessionId: string, callerId: string): void {
    const existing = this.#owners.get(sessionId);
    if (existing?.id !== callerId) return;
    existing.legacyHeld = false;
    this.#deleteIfUnheld(sessionId, existing);
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

  #acquireOwner(sessionId: string, callerId: string): LeaseOwner {
    const existing = this.#owners.get(sessionId);
    if (existing !== undefined) {
      if (existing.id !== callerId) {
        throw new ExternalLeaseError(`session ${sessionId} is already leased`);
      }
      return existing;
    }

    this.#epoch += 1;
    const owner: LeaseOwner = {
      id: callerId,
      epoch: this.#epoch,
      legacyHeld: false,
      handleCount: 0,
    };
    this.#owners.set(sessionId, owner);
    return owner;
  }

  #deleteIfUnheld(sessionId: string, owner: LeaseOwner): void {
    if (!owner.legacyHeld && owner.handleCount === 0) this.#owners.delete(sessionId);
  }
}
