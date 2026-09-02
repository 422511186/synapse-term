import { describe, expect, it } from 'vitest';

import { buildShareText } from './share-text.js';

describe('Share Text', () => {
  it('identifies one Session and gives an actionable POSIX workflow', () => {
    const text = buildShareText({
      sessionId: 'session-1',
      terminalType: 'Git Bash',
      title: '系统监控',
    });

    expect(text).toContain('Session Alias：系统监控');
    expect(text).toContain('sessionId：session-1');
    expect(text).toContain('启动 Shell 提示：Git Bash（仅供参考）');
    expect(text).toContain('先调用 synapse_status');
    expect(text).toContain('必须调用 synapse_observe');
    expect(text).toContain('expectedContextId');
    expect(text).toContain('tail: true');
    expect(text).toContain('nextCursor');
    expect(text).toContain('not_ready 时不要重复调用 synapse_status');
    expect(text).toContain('远端 Shell 提示符就绪后直接调用 synapse_execute');
    expect(text).toContain('Probe 失败');
    expect(text).toContain('synapse_execute');
    expect(text).toContain('synapse_wait');
    expect(text).toContain('命令会按原文发送到当前 Shell');
    expect(text).toContain('完成探针');
    expect(text).toContain('启动 Shell 提示');
    expect(text).toContain('当前 PTY environment');
    expect(text).not.toContain('不要直接发送 PowerShell cmdlet');
    expect(text).not.toContain('先在 MCP 配置中填入');
    expect((text.match(/session-1/g) ?? []).length).toBe(1);
  });

  it('does not treat a PowerShell launch hint as the current PTY environment', () => {
    const text = buildShareText({
      sessionId: 'session-2',
      terminalType: 'PowerShell',
      title: 'Windows 工作区',
    });

    expect(text).toContain('启动 Shell 提示：PowerShell（仅供参考）');
    expect(text).toContain('进入 SSH、容器、WSL 或嵌套 Shell 后');
    expect(text).toContain('命令会按原文发送到当前 Shell');
    expect(text).not.toContain('只发送 PowerShell 语法');
    expect(text).not.toContain('只发送 POSIX 语法');
  });

  it('keeps user-editable Share Text fields on one safe line', () => {
    const text = buildShareText({
      sessionId: 'session-3',
      terminalType: 'Power\nShell\u0007\u0085\u2028',
      title: '系统\n监控\u2029',
    });

    expect(text).toContain('Session Alias：系统 监控');
    expect(text).toContain('启动 Shell 提示：Power Shell（仅供参考）');
    expect(text).not.toContain('\u0007');
    expect(text).not.toContain('\u0085');
    expect(text).not.toContain('\u2028');
    expect(text).not.toContain('\u2029');
    expect(text).not.toContain('super-secret');
  });
});
