/**
 * MockTerminalBackend：可替换 Terminal 后端测试替身
 *
 * 遵循 packages/domain 的 TerminalBackend 契约：后端显式声明能力与方言，
 * 上层通过 hasTerminalCapability / supportsExecutionDialect 决策，而不是
 * 猜测后端行为。默认声明本地 PTY 常见能力，可通过选项裁剪以测试
 * "能力缺失必须显式报告" 的边界。
 */
import {
  hasTerminalCapability,
  supportsExecutionDialect,
  type ExecutionDialect,
  type TerminalBackendInfo,
  type TerminalCapability,
} from '@synapse-term/domain';

export interface MockTerminalBackendOptions {
  readonly id?: string;
  readonly displayName?: string;
  /** 声明的能力集合（默认：本地 PTY 全部能力） */
  readonly capabilities?: readonly TerminalCapability[];
  /** 支持的执行方言（默认 posix + powershell） */
  readonly dialects?: readonly ExecutionDialect[];
}

/** 本地 PTY 后端的默认能力集合 */
const DEFAULT_CAPABILITIES: readonly TerminalCapability[] = [
  'observeScreen',
  'replayOutput',
  'structuredExecute',
  'interrupt',
  'resize',
  'persistentShellState',
  'supportedDialects',
];

export class MockTerminalBackend {
  /** 平台视角的后端元信息 */
  readonly info: TerminalBackendInfo;

  constructor(options: MockTerminalBackendOptions = {}) {
    this.info = {
      id: options.id ?? 'mock-terminal',
      displayName: options.displayName ?? '模拟终端后端',
      capabilities: {
        capabilities: options.capabilities ?? DEFAULT_CAPABILITIES,
        dialects: options.dialects ?? ['posix', 'powershell'],
      },
    };
  }

  /** 便捷断言：后端是否声明了某能力 */
  has(capability: TerminalCapability): boolean {
    return hasTerminalCapability(this.info, capability);
  }

  /** 便捷断言：后端是否支持某方言 */
  supports(dialect: ExecutionDialect): boolean {
    return supportsExecutionDialect(this.info, dialect);
  }
}

/** 构造一个默认 MockTerminalBackend（方便一行创建） */
export function createMockTerminalBackend(
  options: MockTerminalBackendOptions = {},
): MockTerminalBackend {
  return new MockTerminalBackend(options);
}
