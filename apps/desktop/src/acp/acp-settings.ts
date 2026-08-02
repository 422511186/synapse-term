/**
 * ACP 外部驱动者设置（specs/acp-driver、ADR-0025 / ADR-0030）
 *
 * 设置持久化在桌面用户数据目录（userData/acp/settings.json）：
 * - enabled：全局开关，关闭时面板不提供 ACP 驱动者，任何已启动的子进程立即终止；
 * - approvalMode：managed（低危自动放行）/ manual（仅只读自动放行）两级审批配置，
 *   与 MCP 的 read_only / managed 语义对齐但独立存储。
 *
 * 与 MCP 设置一致：桌面主进程是唯一读写方，渲染进程经 IPC 访问；
 * 文件缺失或损坏时回退安全默认值（关闭）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AcpApprovalMode = 'managed' | 'manual';

export interface AcpSettings {
  enabled: boolean;
  approvalMode: AcpApprovalMode;
}

/** 设置存储端口：与 MCP 设置同构，便于测试注入内存实现 */
export interface AcpSettingsStore {
  load(): Promise<AcpSettings>;
  save(settings: AcpSettings): Promise<void>;
}

const DEFAULT_SETTINGS: AcpSettings = Object.freeze({
  enabled: false,
  approvalMode: 'managed',
});

/** 从 userData/acp/settings.json 加载设置；缺失或损坏时回退安全默认值 */
export function createAcpSettingsStore(directory: string): AcpSettingsStore {
  const settingsPath = join(directory, 'settings.json');
  return {
    async load(): Promise<AcpSettings> {
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
        return sanitizeAcpSettings(JSON.parse(raw) as unknown);
      } catch {
        // 解析失败以默认值重建，避免错误配置把外部驱动者意外打开。
        return { ...DEFAULT_SETTINGS };
      }
    },
    async save(settings: AcpSettings): Promise<void> {
      await mkdir(directory, { recursive: true });
      const temporaryPath = `${settingsPath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
      await rename(temporaryPath, settingsPath);
    },
  };
}

/** 字段级白名单校验：未知字段丢弃，非法值回退默认（与 mcp-settings 同策略） */
export function sanitizeAcpSettings(value: unknown): AcpSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    approvalMode: record.approvalMode === 'manual' ? 'manual' : 'managed',
  };
}
