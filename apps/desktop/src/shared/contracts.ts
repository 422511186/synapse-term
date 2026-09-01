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

export interface AppStatus {
  connected: boolean;
  version: string;
  sessions: number;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export interface CustomThemePalette {
  enabled: boolean;
  background: string;
  foreground: string;
  accent: string;
  /** 终端文字 16 色；未定制（undefined）时回退当前 scheme 的内置色板。 */
  terminalText?: TerminalTextPalette | undefined;
}

export interface TerminalTextPalette {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface GeneralSettings {
  hideCompletionProbeEcho: boolean;
  themeMode: ThemeMode;
  customTheme: CustomThemePalette;
}

export interface ThemeState {
  mode: ThemeMode;
  scheme: 'light' | 'dark';
  customTheme: CustomThemePalette;
}

export type McpApprovalMode = 'read_only' | 'managed' | 'full';

export interface McpSettings {
  enabled: boolean;
  approvalMode: McpApprovalMode;
  port: number;
  token?: string | undefined;
}

export interface McpRuntimeStatus {
  running: boolean;
  port?: number | undefined;
  connectionString?: string | undefined;
}

export interface SharedMcpSession {
  id: string;
  title: string;
  sharedAt: string;
}

export interface McpApprovalRequest {
  id: string;
  sessionId: string;
  command: string;
  risk: 'read_only' | 'unknown' | 'mutating' | 'privileged' | 'destructive';
  reasons: readonly string[];
}

export type McpApprovalDecision = 'allow_once' | 'allow_session' | 'denied';

export interface McpApprovalClosure {
  id: string;
}

export interface McpExecutionEvent {
  sessionId: string;
  transactionId: string;
  command: string;
  source: string;
  phase: 'started' | 'finished';
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
  app: {
    status(): Promise<AppStatus>;
  };
  general: {
    getSettings(): Promise<GeneralSettings>;
    updateSettings(patch: Partial<GeneralSettings>): Promise<GeneralSettings>;
  };
  theme: {
    getState(): Promise<ThemeState>;
    onChanged(listener: (state: ThemeState) => void): () => void;
  };
  mcp: {
    getSettings(): Promise<McpSettings>;
    updateSettings(
      patch: Partial<Omit<McpSettings, 'token'>> & { token?: string | null },
    ): Promise<McpSettings>;
    regenerateToken(): Promise<McpSettings>;
    revokeToken(): Promise<McpSettings>;
    getStatus(): Promise<McpRuntimeStatus>;
    listSharedSessions(): Promise<SharedMcpSession[]>;
    shareSession(sessionId: string): Promise<SharedMcpSession[]>;
    unshareSession(sessionId: string): Promise<SharedMcpSession[]>;
    decideApproval(id: string, decision: McpApprovalDecision): Promise<void>;
    onApproval(listener: (request: McpApprovalRequest) => void): () => void;
    onApprovalClosed(listener: (closure: McpApprovalClosure) => void): () => void;
    onExecution(listener: (event: McpExecutionEvent) => void): () => void;
  };
}
