import type { LocalShellDescriptor } from '@synapse-term/terminal-service';

export interface SessionSummary {
  id: string;
  title: string;
  terminalType: string;
  pty: 'starting' | 'running' | 'exited' | 'failed' | 'interrupted';
}

export interface SessionEnvironment {
  home: string;
  shells: LocalShellDescriptor[];
}

export interface SessionLaunchInput {
  title: string;
  terminalType: string;
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  columns?: number;
  rows?: number;
}

export interface TerminalOutputEvent {
  sessionId: string;
  sequence: number;
  data: string;
}

export interface CoreStatus {
  connected: boolean;
  version: string;
  sessions: number;
}

export interface DesktopApi {
  readonly platform?: string;
  sessions: {
    list(): Promise<SessionSummary[]>;
    environment(): Promise<SessionEnvironment>;
    create(input: SessionLaunchInput): Promise<SessionSummary>;
    rename(sessionId: string, alias: string): Promise<SessionSummary>;
    close(sessionId: string): Promise<boolean>;
    onChanged(listener: (session: SessionSummary) => void): () => void;
  };
  terminal: {
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, columns: number, rows: number): Promise<void>;
    onOutput(listener: (event: TerminalOutputEvent) => void): () => void;
  };
  core: {
    status(): Promise<CoreStatus>;
    exit(mode: 'terminate_sessions'): Promise<void>;
  };
}
