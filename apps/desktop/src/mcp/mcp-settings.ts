/**
 * MCP 内嵌端点设置（specs/mcp-access、ADR-0021 / ADR-0023）
 *
 * 设置持久化在桌面用户数据目录（userData/mcp/settings.json）：
 * - enabled：设置页开关，关闭时端点完全不监听回环端口；
 * - approvalMode：read_only / managed / full 三级外部审批配置；
 * - token：可吊销、无过期的 Bearer token，吊销后立即拒绝所有新调用；
 * - port：稳定监听端口（首次启用分配并持久化，重启/停用-启用保持不变）。
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type McpApprovalMode = 'read_only' | 'managed' | 'full';

/** IPC/存储边界的模式归一化：只接受白名单值，未知值回退 read_only */
export function normalizeMcpApprovalMode(value: unknown): McpApprovalMode {
  return value === 'managed' || value === 'full' ? value : 'read_only';
}

export interface McpSettings {
  enabled: boolean;
  approvalMode: McpApprovalMode;
  token?: string;
  /** 稳定监听端口：1-65535 整数，首次启用时分配，之后保持不变 */
  port?: number;
}

/** 设置存储端口：桌面主进程唯一读写方，渲染进程经 IPC 访问 */
export interface McpSettingsStore {
  load(): Promise<McpSettings>;
  save(settings: McpSettings): Promise<void>;
}

/** 生成新的 Bearer token：32 字节随机数，URL 安全编码，无过期时间 */
export function generateMcpToken(): string {
  return randomBytes(32).toString('base64url');
}

const DEFAULT_SETTINGS: McpSettings = Object.freeze({
  enabled: false,
  approvalMode: 'read_only',
});

/**
 * 从 userData/mcp/settings.json 加载设置。
 * 文件缺失或内容损坏时回退到安全默认值（关闭、read-only、无 token）。
 */
export function createMcpSettingsStore(directory: string): McpSettingsStore {
  const settingsPath = join(directory, 'settings.json');
  return {
    async load(): Promise<McpSettings> {
      let raw: string;
      try {
        raw = await readFile(settingsPath, 'utf8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return { ...DEFAULT_SETTINGS };
        }
        throw error;
      }
      try {
        return sanitizeMcpSettings(JSON.parse(raw) as unknown);
      } catch {
        // 解析失败时以默认值重建，避免错误配置把外部接入意外打开。
        return { ...DEFAULT_SETTINGS };
      }
    },
    async save(settings: McpSettings): Promise<void> {
      await mkdir(directory, { recursive: true });
      const temporaryPath = `${settingsPath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
      await rename(temporaryPath, settingsPath);
    },
  };
}

/** 字段级白名单校验：未知字段丢弃，非法值回退默认，防止脏数据进入运行时 */
export function sanitizeMcpSettings(value: unknown): McpSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  const enabled = record.enabled === true;
  const approvalMode = normalizeMcpApprovalMode(record.approvalMode);
  const token =
    typeof record.token === 'string' && record.token.length > 0 ? record.token : undefined;
  const port =
    typeof record.port === 'number' &&
    Number.isInteger(record.port) &&
    record.port >= 1 &&
    record.port <= 65_535
      ? record.port
      : undefined;
  return {
    enabled,
    approvalMode,
    ...(token === undefined ? {} : { token }),
    ...(port === undefined ? {} : { port }),
  };
}
