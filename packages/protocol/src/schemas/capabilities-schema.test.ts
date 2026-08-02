/**
 * 能力声明 Schema 测试（协议层）
 *
 * 验证驱动者视图、Terminal 后端视图、Tool Provider 视图与能力集合 Schema 的解析行为。
 */
import { describe, expect, it } from 'vitest';

import {
  agentDriverViewSchema,
  platformCapabilitySetSchema,
  terminalBackendViewSchema,
  toolProviderViewSchema,
} from './capabilities-schema.js';

describe('能力声明 Schema', () => {
  it('解析合法的平台能力集合', () => {
    const set = { capabilities: ['terminal.execute', 'file.read'] };
    expect(platformCapabilitySetSchema.parse(set)).toEqual(set);
  });

  it('拒绝未知能力项', () => {
    expect(() => platformCapabilitySetSchema.parse({ capabilities: ['terminal.hack'] })).toThrow();
  });

  it('解析驱动者视图', () => {
    const driver = {
      id: 'opencode-acp',
      kind: 'acp',
      displayName: 'opencode',
      capabilities: { selfManagedModel: true, permissionModes: ['manual', 'auto'] },
    };
    expect(agentDriverViewSchema.parse(driver)).toEqual(driver);
  });

  it('解析 Terminal 后端视图并拒绝未知能力', () => {
    const backend = {
      id: 'local-pty',
      displayName: 'Local PTY',
      capabilities: {
        capabilities: ['observeScreen', 'structuredExecute'],
        dialects: ['posix', 'powershell'],
      },
    };
    expect(terminalBackendViewSchema.parse(backend)).toEqual(backend);
    expect(() =>
      terminalBackendViewSchema.parse({
        ...backend,
        capabilities: { ...backend.capabilities, capabilities: ['teleport'] },
      }),
    ).toThrow();
  });

  it('解析 Tool Provider 视图（含可选风险字段）', () => {
    const provider = {
      id: 'terminal-tool',
      displayName: 'Terminal Tools',
      tools: [
        {
          name: 'terminal_execute',
          description: '执行一条命令',
          inputSchema: { type: 'object' },
          sideEffect: 'exec',
          risk: 'unknown',
        },
      ],
    };
    expect(toolProviderViewSchema.parse(provider)).toEqual(provider);
    const withoutRisk = {
      ...provider,
      tools: [{ ...provider.tools[0], risk: undefined }],
    };
    expect(toolProviderViewSchema.parse(withoutRisk)).toEqual(withoutRisk);
  });
});
