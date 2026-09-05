import type {
  ApprovalDecision,
  McpExecutionEvent,
  McpRuntimeStatus,
  McpSettings,
  SharedMcpSession,
  VisibleApprovalRequest,
} from '@synapse-term/mcp-runtime';
import type {
  AppStatus,
  SessionEnvironment,
  SessionLaunchInput,
  SessionSummary,
  TerminalOutputEvent,
} from '@synapse-term/session-runtime';

export type {
  AppStatus,
  SessionEnvironment,
  SessionLaunchInput,
  SessionSummary,
  TerminalOutputEvent,
} from '@synapse-term/session-runtime';
export type {
  McpApprovalMode,
  McpExecutionEvent,
  McpRuntimeStatus,
  McpSettings,
  SharedMcpSession,
} from '@synapse-term/mcp-runtime';

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

export type McpApprovalRequest = VisibleApprovalRequest;

export type McpApprovalDecision = ApprovalDecision;

export interface McpApprovalClosure {
  id: string;
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
