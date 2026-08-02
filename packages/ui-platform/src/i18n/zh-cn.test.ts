import { describe, expect, it } from 'vitest';

import {
  approvalReasonZh,
  commandRiskZh,
  errorMessageZh,
  providerReasonZh,
  providerStatusZh,
  providerTransportNoticeZh,
  sessionPtyStatusZh,
  sessionShellStatusZh,
  timelineStatusZh,
} from './zh-cn.js';

describe('zh-CN product copy', () => {
  it('maps runtime statuses to concise Simplified Chinese labels', () => {
    expect(sessionPtyStatusZh('running')).toBe('运行中');
    expect(sessionShellStatusZh('interaction_required')).toBe('等待人工交互');
    expect(timelineStatusZh('waiting_approval')).toBe('等待批准');
    expect(providerStatusZh('unavailable')).toBe('不可用');
  });

  it('turns stable Provider reason codes into actionable Chinese diagnostics', () => {
    expect(providerReasonZh('url_scheme_mismatch: wrong version number')).toContain(
      '检查 URL 使用的是 http:// 还是 https://',
    );
    expect(providerReasonZh('authentication_failed: bad key')).toContain('API Key');
    expect(providerReasonZh('provider_timeout: exceeded 20 ms')).toContain('超时');
    expect(providerReasonZh('provider_tool_call_missing: missing')).toContain('Tool Call');
  });

  it('distinguishes local HTTP development endpoints from exposed plaintext credentials', () => {
    expect(providerTransportNoticeZh('http://127.0.0.1:5090/v1')).toEqual({
      tone: 'info',
      text: '这是本机 HTTP 地址，适合本地模型服务；API Key 不会经过 TLS 加密。',
    });
    expect(providerTransportNoticeZh('http://models.example.com/v1')).toEqual({
      tone: 'danger',
      text: '该地址使用未加密 HTTP，API Key 和请求内容可能被窃听。请改用 HTTPS。',
    });
    expect(providerTransportNoticeZh('https://api.openai.com/v1')).toBeUndefined();
  });

  it('localizes known runtime errors while retaining useful technical details', () => {
    expect(errorMessageZh(new Error('Working directory does not exist'))).toBe('工作目录不存在');
    expect(errorMessageZh(new Error('File not found: C:\\missing.exe'))).toBe(
      '找不到文件：C:\\missing.exe',
    );
    expect(errorMessageZh('custom failure')).toBe('custom failure');
    expect(
      errorMessageZh(
        new Error(
          "Error invoking remote method 'agent:history': Error: Core request timed out: agent.history",
        ),
      ),
    ).toBe('Core 请求超时：agent.history');
  });

  it('localizes approval risk levels and known policy reasons', () => {
    expect(commandRiskZh('destructive')).toBe('高风险操作');
    expect(commandRiskZh('mutating')).toBe('会修改状态');
    expect(approvalReasonZh('command has irreversible or destructive semantics')).toBe(
      '命令包含不可逆或破坏性操作',
    );
    expect(approvalReasonZh('touch can change system state')).toBe('touch 可能修改系统状态');
  });
});
