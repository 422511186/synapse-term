export interface TerminalSubscription {
  dispose(): void;
}

export interface TerminalExitEvent {
  exitCode: number;
  signal?: number | undefined;
}

/**
 * 终端后端抽象：本地 PTY、Fake PTY 或未来其他实现都必须满足的契约。
 * 上层（terminal-service / desktop）只依赖此抽象。
 */
export interface TerminalBackend {
  readonly pid: number;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  interrupt(): void;
  terminate(): void;
  onData(listener: (data: string) => void): TerminalSubscription;
  onExit(listener: (event: TerminalExitEvent) => void): TerminalSubscription;
}
