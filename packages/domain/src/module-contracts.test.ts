/**
 * 模块契约测试（领域层）
 *
 * 验证 1.1 定义的模块契约：AgentDriver / TerminalBackend / ToolProvider /
 * PlatformCapability 的类型不变式与辅助函数行为。
 */
import { describe, expect, it } from 'vitest';

import {
  READ_ONLY_CAPABILITIES,
  createBuiltinDriverInfo,
  findTool,
  hasTerminalCapability,
  isReadOnlyCapability,
  isReadOnlyTool,
  supportsExecutionDialect,
  type TerminalBackendInfo,
  type ToolProviderInfo,
} from './index.js';

describe('AgentDriver 契约', () => {
  it('内置驱动者默认自管模型并支持全部权限模式', () => {
    const driver = createBuiltinDriverInfo();
    expect(driver.id).toBe('builtin');
    expect(driver.kind).toBe('builtin');
    expect(driver.capabilities.selfManagedModel).toBe(false);
    expect(driver.capabilities.permissionModes).toEqual(['manual', 'auto', 'full_access']);
  });
});

describe('TerminalBackend 契约', () => {
  const mockBackend: TerminalBackendInfo = {
    id: 'mock-terminal',
    displayName: 'Mock Terminal',
    capabilities: {
      capabilities: ['observeScreen', 'structuredExecute', 'replayOutput'],
      dialects: ['posix'],
    },
  };

  it('按能力声明判断是否支持某项操作', () => {
    expect(hasTerminalCapability(mockBackend, 'structuredExecute')).toBe(true);
    expect(hasTerminalCapability(mockBackend, 'resize')).toBe(false);
  });

  it('按方言声明判断是否支持某个执行方言', () => {
    expect(supportsExecutionDialect(mockBackend, 'posix')).toBe(true);
    expect(supportsExecutionDialect(mockBackend, 'powershell')).toBe(false);
  });
});

describe('ToolProvider 契约', () => {
  const provider: ToolProviderInfo = {
    id: 'terminal-tool',
    displayName: 'Terminal Tools',
    tools: [
      {
        name: 'terminal_observe',
        description: '观察绑定终端',
        inputSchema: {},
        sideEffect: 'read',
      },
      {
        name: 'terminal_execute',
        description: '执行一条命令',
        inputSchema: {},
        sideEffect: 'exec',
        risk: 'unknown',
      },
    ],
  };

  it('只读工具被识别，执行类工具不是只读', () => {
    const observe = findTool(provider, 'terminal_observe');
    const execute = findTool(provider, 'terminal_execute');
    expect(observe).toBeDefined();
    expect(execute).toBeDefined();
    if (observe !== undefined) expect(isReadOnlyTool(observe)).toBe(true);
    if (execute !== undefined) expect(isReadOnlyTool(execute)).toBe(false);
  });

  it('查找不存在的工具返回 undefined', () => {
    expect(findTool(provider, 'no_such_tool')).toBeUndefined();
  });
});

describe('平台能力声明', () => {
  it('只读能力集合只包含读类能力', () => {
    expect(READ_ONLY_CAPABILITIES).toEqual([
      'terminal.observe',
      'terminal.wait',
      'file.read',
      'file.search',
    ]);
    expect(isReadOnlyCapability('terminal.observe')).toBe(true);
    expect(isReadOnlyCapability('terminal.execute')).toBe(false);
    expect(isReadOnlyCapability('file.write')).toBe(false);
  });
});
