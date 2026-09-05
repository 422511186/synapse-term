export class DesktopLifecycle {
  readonly #options: { stopMcp: () => Promise<void>; stopSessions: () => Promise<void> };
  readonly #creations = new Set<Promise<unknown>>();
  #shutdown: Promise<void> | null = null;
  #closing = false;

  constructor(options: { stopMcp: () => Promise<void>; stopSessions: () => Promise<void> }) {
    this.#options = options;
  }

  get closing(): boolean {
    return this.#closing;
  }
  get creatingSession(): boolean {
    return this.#creations.size > 0;
  }

  createSession<T>(create: () => Promise<T>): Promise<T> {
    if (this.#closing) throw new Error('应用正在退出，无法新建 Session');
    const operation = create();
    this.#creations.add(operation);
    return operation.finally(() => {
      this.#creations.delete(operation);
    });
  }

  shutdown(): Promise<void> {
    if (this.#shutdown) return this.#shutdown;
    this.#closing = true;
    this.#shutdown = this.#stop();
    return this.#shutdown;
  }

  async #stop(): Promise<void> {
    try {
      await this.#options.stopMcp();
    } finally {
      await Promise.allSettled(this.#creations);
      await this.#options.stopSessions();
    }
  }
}
