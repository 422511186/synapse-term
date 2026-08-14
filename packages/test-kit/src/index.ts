import type {
  TerminalBackend,
  TerminalExitEvent,
  TerminalSubscription,
} from '@synapse-term/domain';

export class FakeTerminalBackend implements TerminalBackend {
  readonly pid = 1;
  readonly writes: string[] = [];
  readonly resizes: Array<{ columns: number; rows: number }> = [];
  interrupted = 0;
  terminated = false;
  readonly #dataListeners = new Set<(data: string) => void>();
  readonly #exitListeners = new Set<(event: TerminalExitEvent) => void>();

  write(data: string): void {
    this.writes.push(data);
  }

  resize(columns: number, rows: number): void {
    this.resizes.push({ columns, rows });
  }

  interrupt(): void {
    this.interrupted += 1;
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.emitExit(0);
  }

  onData(listener: (data: string) => void): TerminalSubscription {
    this.#dataListeners.add(listener);
    return { dispose: () => this.#dataListeners.delete(listener) };
  }

  onExit(listener: (event: TerminalExitEvent) => void): TerminalSubscription {
    this.#exitListeners.add(listener);
    return { dispose: () => this.#exitListeners.delete(listener) };
  }

  emitData(data: string): void {
    for (const listener of this.#dataListeners) listener(data);
  }

  emitExit(exitCode: number, signal?: number): void {
    for (const listener of this.#exitListeners) listener({ exitCode, signal });
  }
}

export function createFakeTerminalBackend(): FakeTerminalBackend {
  return new FakeTerminalBackend();
}
