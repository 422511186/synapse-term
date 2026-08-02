export interface Disposable {
  dispose(): void;
}

export interface FakePtyExitEvent {
  exitCode: number;
  signal?: number | undefined;
}

export class FakePty {
  readonly pid: number;
  readonly writes: string[] = [];
  readonly resizes: Array<{ columns: number; rows: number }> = [];
  interruptCount = 0;
  terminateCount = 0;
  #dataListeners = new Set<(data: string) => void>();
  #exitListeners = new Set<(event: FakePtyExitEvent) => void>();

  constructor(pid = 1) {
    this.pid = pid;
  }

  onData(listener: (data: string) => void): Disposable {
    this.#dataListeners.add(listener);
    return { dispose: () => this.#dataListeners.delete(listener) };
  }

  onExit(listener: (event: FakePtyExitEvent) => void): Disposable {
    this.#exitListeners.add(listener);
    return { dispose: () => this.#exitListeners.delete(listener) };
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(columns: number, rows: number): void {
    this.resizes.push({ columns, rows });
  }

  interrupt(): void {
    this.interruptCount += 1;
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emitData(data: string): void {
    for (const listener of this.#dataListeners) listener(data);
  }

  emitExit(event: FakePtyExitEvent): void {
    for (const listener of this.#exitListeners) listener(event);
  }
}
