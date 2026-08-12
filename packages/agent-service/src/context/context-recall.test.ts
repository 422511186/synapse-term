import { describe, expect, it } from 'vitest';

import { ContextRecallService, type ContextRecallArgs } from './context-recall.js';
import type { ModelInputItem } from '@synapse-term/model-providers';

// =============================================================================
// context_recall 工具核心逻辑 TDD（Ch36 召回 API + Decision 2）
// -----------------------------------------------------------------------------
// 覆盖 task 1.13 七条断言：
//  1. 按 toolCallId 查 #items 中的原始 tool_result
//  2. 切片受 maxBytes 约束（含未传 / 超大走默认上限）
//  3. 只读不碰 PTY / 文件系统（ContextRecallService 无任何副作用依赖）
//  4. 召回片段作为新 tool_result 进 #items（由 Runtime #handleContextRecallResult 装配，
//     此处验证 recall() 返回的 payload 结构可序列化为 tool_result content）
//  5. #executeCalls 内部短路不经 Gateway（ContextRecallService 是纯内存查询，
//     无 Gateway 依赖；Runtime 短路路径在 agent-runtime.test.ts 覆盖）
//  6. 召回片段经脱敏路径（#items 源已脱敏——ContextRecallService 不再次脱敏，
//     只从已脱敏 #items 取片段；此处验证不引入原始密钥）
//  7. 崩溃恢复后返回已脱敏片段（#items 从持久化已脱敏项重建，recall 返回同源）
// =============================================================================

/** 构造含一条 tool_result 的 #items。 */
function itemsWithToolResult(toolCallId: string, content: string): ModelInputItem[] {
  return [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: '请检查磁盘' },
    {
      type: 'assistant_tool_call',
      toolCallId,
      name: 'terminal_execute',
      argumentsJson: '{"command":"df -h"}',
    },
    { type: 'tool_result', toolCallId, content, isError: false },
  ];
}

describe('ContextRecallService', () => {
  describe('按 toolCallId 查 #items 原始 tool_result', () => {
    it('命中 toolCallId 返回对应 tool_result 内容切片', () => {
      const service = new ContextRecallService();
      const items = itemsWithToolResult('call-1', 'line1\nline2\nline3');
      const result = service.recall(items, { toolCallId: 'call-1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toBe('line1\nline2\nline3');
        expect(result.originalBytes).toBe(Buffer.byteLength('line1\nline2\nline3', 'utf8'));
        expect(result.truncated).toBe(false);
      }
    });

    it('未命中 toolCallId 返回 tool_result_not_found', () => {
      const service = new ContextRecallService();
      const items = itemsWithToolResult('call-1', 'content');
      const result = service.recall(items, { toolCallId: 'call-missing' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('tool_result_not_found');
      }
    });

    it('忽略 role 消息与 assistant_tool_call，只匹配 tool_result', () => {
      const service = new ContextRecallService();
      const items: ModelInputItem[] = [
        { role: 'user', content: 'toolCallId=call-x 也算文本' },
        {
          type: 'assistant_tool_call',
          toolCallId: 'call-x',
          name: 'terminal_execute',
          argumentsJson: '{}',
        },
        { type: 'tool_result', toolCallId: 'call-x', content: 'real result', isError: false },
      ];
      const result = service.recall(items, { toolCallId: 'call-x' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.content).toBe('real result');
    });
  });

  describe('切片受 maxBytes 约束', () => {
    it('未传 maxBytes 时用默认上限 16KB', () => {
      const service = new ContextRecallService();
      const small = 'a'.repeat(100);
      const items = itemsWithToolResult('call-default', small);
      const result = service.recall(items, { toolCallId: 'call-default' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // 100 字节远低于 16KB 默认上限，不截断
        expect(result.truncated).toBe(false);
        expect(result.content).toBe(small);
      }
    });

    it('内容超过默认 16KB 上限时按默认上限截断', () => {
      const service = new ContextRecallService();
      const huge = 'B'.repeat(20_000); // 20KB > 16KB 默认上限
      const items = itemsWithToolResult('call-huge', huge);
      const result = service.recall(items, { toolCallId: 'call-huge' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.truncated).toBe(true);
        expect(Buffer.byteLength(result.content, 'utf8')).toBe(16_384);
      }
    });

    it('maxBytes 超过默认上限时回落到默认上限（MUST NOT 超过单条外溢预算）', () => {
      const service = new ContextRecallService();
      const huge = 'C'.repeat(20_000);
      const items = itemsWithToolResult('call-overmax', huge);
      const result = service.recall(items, {
        toolCallId: 'call-overmax',
        maxBytes: 100_000, // 显式传超大值，仍受默认上限约束
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.truncated).toBe(true);
        expect(Buffer.byteLength(result.content, 'utf8')).toBe(16_384);
      }
    });

    it('显式传小 maxBytes 按该值切片', () => {
      const service = new ContextRecallService();
      const huge = 'D'.repeat(2_000);
      const items = itemsWithToolResult('call-smallmax', huge);
      const result = service.recall(items, {
        toolCallId: 'call-smallmax',
        maxBytes: 50,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.truncated).toBe(true);
        expect(Buffer.byteLength(result.content, 'utf8')).toBe(50);
      }
    });

    it('maxBytes 非正数走默认上限', () => {
      const service = new ContextRecallService();
      const huge = 'E'.repeat(20_000);
      const items = itemsWithToolResult('call-invalidmax', huge);
      const result = service.recall(items, {
        toolCallId: 'call-invalidmax',
        maxBytes: -1,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.truncated).toBe(true);
        expect(Buffer.byteLength(result.content, 'utf8')).toBe(16_384);
      }
    });

    it('行切片（startLine/endLine，1-based 含首尾）先于字节切片', () => {
      const service = new ContextRecallService();
      const content = 'line1\nline2\nline3\nline4\nline5';
      const items = itemsWithToolResult('call-lines', content);
      const result = service.recall(items, {
        toolCallId: 'call-lines',
        startLine: 2,
        endLine: 4,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toBe('line2\nline3\nline4');
      }
    });

    it('startLine 超出总行数返回空内容', () => {
      const service = new ContextRecallService();
      const items = itemsWithToolResult('call-overflow', 'only\none\nline');
      const result = service.recall(items, {
        toolCallId: 'call-overflow',
        startLine: 100,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.content).toBe('');
    });

    it('多字节 UTF-8（CJK）字节切片不截断字符边界', () => {
      const service = new ContextRecallService();
      const content = '中'.repeat(1_000); // 3000 字节
      const items = itemsWithToolResult('call-cjk', content);
      const result = service.recall(items, {
        toolCallId: 'call-cjk',
        maxBytes: 10,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // 10 / 3 = 3.33 → 取 3 个完整 '中'（9 字节），不截断字符
        expect(Buffer.byteLength(result.content, 'utf8')).toBe(9);
        expect(result.content).toBe('中'.repeat(3));
      }
    });
  });

  describe('只读不碰 PTY / 文件系统', () => {
    it('ContextRecallService 无副作用：不持有也不调用任何外部 IO 句柄', () => {
      // 纯内存查询：构造、调用、断言返回值，无任何 PTY/文件系统/Provider 依赖。
      // 该断言以"可被任意环境实例化且 recall 只读 #items"为保证契约——
      // 服务本身不导入 node:fs/node:pty/Provider keys，只消费传入的 ModelInputItem[]。
      const service = new ContextRecallService();
      const items = itemsWithToolResult('call-readonly', 'read-only content');
      const before = items.map((i) => ({ ...i }));
      const result = service.recall(items, { toolCallId: 'call-readonly' });
      expect(result.ok).toBe(true);
      // 只读：#items 源未被 mutate
      expect(items).toEqual(before);
    });
  });

  describe('召回片段作为新 tool_result 进 #items', () => {
    it('recall 返回的 payload 可序列化为 tool_result content（Runtime #handleContextRecallResult 装配）', () => {
      const service = new ContextRecallService();
      const items = itemsWithToolResult('call-payload', 'payload content');
      const result = service.recall(items, { toolCallId: 'call-payload' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Runtime #handleContextRecallResult 把该 payload JSON.stringify 成新 tool_result.content
        const payload = {
          ok: true as const,
          content: result.content,
          truncated: result.truncated,
          originalBytes: result.originalBytes,
        };
        const newItem: ModelInputItem = {
          type: 'tool_result',
          // 新 toolCallId（本次 context_recall 的 call.id），非被召回的原始 toolCallId
          toolCallId: 'call-recall-new',
          content: JSON.stringify(payload),
          isError: false,
        };
        expect(JSON.parse(newItem.content).ok).toBe(true);
        expect(JSON.parse(newItem.content).content).toBe('payload content');
      }
    });

    it('recall 失败时返回 ok:false + error（装配为 isError=true 的 tool_result）', () => {
      const service = new ContextRecallService();
      const items = itemsWithToolResult('call-x', 'content');
      const result = service.recall(items, { toolCallId: 'call-missing' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const payload = {
          ok: false as const,
          error: result.error,
          message: result.message,
        };
        expect(JSON.stringify(payload)).toContain('tool_result_not_found');
      }
    });
  });

  describe('召回片段经脱敏路径 / 崩溃恢复后返回已脱敏片段', () => {
    it('从已脱敏 #items 取片段（recall 不再次脱敏，源已脱敏即足够）', () => {
      // #items 在 #emitItem 落盘时已过 SecretRedactor；context_recall 只从该已脱敏源取片段，
      // 不再次脱敏（无原始密钥残留）。此处验证：源 #items 含 [REDACTED] 占位时，
      // 召回片段直接携带该占位（不引入原始密钥）。
      const service = new ContextRecallService();
      const redactedContent = 'token=[REDACTED]\nsecret=[REDACTED]\nmore data';
      const items = itemsWithToolResult('call-redacted', redactedContent);
      const result = service.recall(items, { toolCallId: 'call-redacted' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('[REDACTED]');
        // 召回片段不引入原始密钥（源已脱敏）
        expect(result.content).not.toContain('supersecret');
        expect(result.content).not.toContain('Bearer abcdefghijklmnop');
      }
    });

    it('崩溃恢复后 #items 从已脱敏项重建，recall 返回同源已脱敏片段', () => {
      // 崩溃恢复路径：Runtime #items 从持久化（已脱敏）ModelItem 重建，
      // ContextRecallService 持有的 K2 预算也会重置（内存态），但召回内容来自
      // 已脱敏 #items——行为与崩溃前一致。此处验证重建后的 items 召回结果一致。
      const serviceBefore = new ContextRecallService();
      const redactedContent = 'key=[REDACTED]\nline2\nline3';
      const originalItems = itemsWithToolResult('call-crash', redactedContent);

      // 崩溃前
      const before = serviceBefore.recall(originalItems, { toolCallId: 'call-crash' });
      expect(before.ok).toBe(true);

      // 模拟崩溃恢复：#items 从持久化已脱敏项重建（深拷贝模拟重建语义）
      const restoredItems: ModelInputItem[] = structuredClone(originalItems);
      const serviceAfter = new ContextRecallService(); // K2 预算重置（内存态）
      const after = serviceAfter.recall(restoredItems, { toolCallId: 'call-crash' });

      expect(after.ok).toBe(true);
      if (before.ok && after.ok) {
        // 同源已脱敏 #items → 召回片段一致
        expect(after.content).toBe(before.content);
        expect(after.content).toContain('[REDACTED]');
      }
    });
  });

  describe('#executeCalls 内部短路不经 Gateway', () => {
    it('ContextRecallService 是纯内存查询，无 Gateway 依赖', () => {
      // Runtime #executeCalls 识别 name==='context_recall' 时直接调本服务 recall()，
      // MUST NOT 经 RuntimeToolGateway（Gateway 无权访问 #items）。
      // 此处以"recall() 签名只接受 items + args，无 gateway 入参"为保证契约——
      // 服务无法也不需要 Gateway 即可完成召回。
      const service = new ContextRecallService();
      const items = itemsWithToolResult('call-shortcircuit', 'shortcircuit content');
      const args: ContextRecallArgs = { toolCallId: 'call-shortcircuit' };
      // 直接调用，无任何 gateway 参数
      const result = service.recall(items, args);
      expect(result.ok).toBe(true);
    });
  });

  describe('K2 分片滥用兜底（Seen set + 预算约束）', () => {
    it('同一 toolCallId 累计召回次数超上限后拒绝', () => {
      const service = new ContextRecallService({ perToolCallIdMaxCount: 3 });
      const items = itemsWithToolResult('call-k2-count', 'k2 content');
      // 前 3 次允许
      for (let i = 0; i < 3; i++) {
        expect(service.recall(items, { toolCallId: 'call-k2-count' }).ok).toBe(true);
      }
      // 第 4 次拒绝（防分片滥用累积等价全量回灌）
      const blocked = service.recall(items, { toolCallId: 'call-k2-count' });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error).toBe('recall_budget_exceeded');
    });

    it('同一 toolCallId 累计召回字节超上限后拒绝', () => {
      // perToolCallIdMaxBytes 默认 = defaultMaxBytes × 4 = 64KB
      const service = new ContextRecallService();
      const huge = 'F'.repeat(20_000); // 每次召回 16KB（默认上限）
      const items = itemsWithToolResult('call-k2-bytes', huge);
      // 4 次 × 16KB = 64KB 达到上限
      for (let i = 0; i < 4; i++) {
        expect(service.recall(items, { toolCallId: 'call-k2-bytes' }).ok).toBe(true);
      }
      // 第 5 次字节预算耗尽
      const blocked = service.recall(items, { toolCallId: 'call-k2-bytes' });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.error).toBe('recall_budget_exceeded');
    });

    it('resetBudget 重置某 toolCallId 的 K2 预算（会话重置 / 测试用）', () => {
      const service = new ContextRecallService({ perToolCallIdMaxCount: 2 });
      const items = itemsWithToolResult('call-reset', 'reset content');
      service.recall(items, { toolCallId: 'call-reset' });
      service.recall(items, { toolCallId: 'call-reset' });
      expect(service.recall(items, { toolCallId: 'call-reset' }).ok).toBe(false);
      service.resetBudget('call-reset');
      expect(service.recall(items, { toolCallId: 'call-reset' }).ok).toBe(true);
    });

    it('不同 toolCallId 的 K2 预算相互独立', () => {
      const service = new ContextRecallService({ perToolCallIdMaxCount: 1 });
      const items: ModelInputItem[] = [
        { type: 'tool_result', toolCallId: 'call-a', content: 'a', isError: false },
        { type: 'tool_result', toolCallId: 'call-b', content: 'b', isError: false },
      ];
      expect(service.recall(items, { toolCallId: 'call-a' }).ok).toBe(true);
      expect(service.recall(items, { toolCallId: 'call-b' }).ok).toBe(true);
      // call-a 已达 1 次上限，call-b 独立计数仍允许
      expect(service.recall(items, { toolCallId: 'call-a' }).ok).toBe(false);
      expect(service.recall(items, { toolCallId: 'call-b' }).ok).toBe(false);
    });

    it('defaultMaxBytes 可在初始化时配置（Governor 注入）', () => {
      const service = new ContextRecallService({ defaultMaxBytes: 4_096 });
      expect(service.defaultMaxBytes).toBe(4_096);
      const huge = 'G'.repeat(8_000);
      const items = itemsWithToolResult('call-custom-default', huge);
      const result = service.recall(items, { toolCallId: 'call-custom-default' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Buffer.byteLength(result.content, 'utf8')).toBe(4_096);
      }
    });

    it('缺少 toolCallId 返回 invalid_arguments', () => {
      const service = new ContextRecallService();
      const items = itemsWithToolResult('call-x', 'content');
      const result = service.recall(items, {} as ContextRecallArgs);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('invalid_arguments');
    });
  });
});
