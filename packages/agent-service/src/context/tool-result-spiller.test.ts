import { describe, expect, it } from 'vitest';

import type { ToolResultSpillRecord } from '@synapse-term/domain';

import {
  ToolResultSpiller,
  buildPointer,
  buildReplacement,
  buildSpillReplacementFromRecord,
  byteLength,
  takeFromEnd,
  takeFromStart,
  type SpillInput,
} from './tool-result-spiller.js';

// =============================================================================
// ToolResultSpiller TDD（Ch36：超大 tool_result 外溢为 Preview+Pointer）
// -----------------------------------------------------------------------------
// 覆盖 task 1.12 五条断言：
//  1. 超大 re-issuable 工具结果激进溢 + 指针（local_read_file 自带 bound 故豁免，
//     激进溢适用于 terminal_observe/local_search_files 等 re-issuable 工具）
//  2. 有副作用命令保守 preview 标 not-replayable
//  3. Seen set 防全量回灌但允许 context_recall 召回（投影替换不含全量原件，但含指针）
//  4. self-bounded 豁免（local_read_file / context_recall 即便超大也不外溢）
//  5. preview 头尾各 ≤512 字节（含多字节 UTF-8 字节安全切片）
// =============================================================================

/** 生成超阈值内容：头段 + 中段唯一标记 + 尾段，保证头尾 preview 都拿不到中段标记。 */
function largeContentWithMiddleToken(prefix: string, suffix: string): string {
  const head = prefix.repeat(4_500);
  const tail = suffix.repeat(4_500);
  return `${head}MIDDLE_TOKEN_ZZZ${tail}`;
}

describe('ToolResultSpiller', () => {
  describe('re-issuable 工具：超大结果激进溢 + 指针', () => {
    it('terminal_observe（re-issuable）超大结果外溢并产出 re-issuable 指针', () => {
      const spiller = new ToolResultSpiller();
      const content = largeContentWithMiddleToken('a', 'b'); // ~9016 字节 > 8KB 阈值
      const input: SpillInput = {
        toolCallId: 'call-observe-1',
        toolName: 'terminal_observe',
        content,
      };

      const output = spiller.spill(input);

      expect(output.shouldSpill).toBe(true);
      expect(output.record).toBeDefined();
      expect(output.record!.reissuability).toBe('re-issuable');
      expect(output.record!.toolCallId).toBe('call-observe-1');
      // 指针标注 re-issuable——模型据此优先重发拿最新，context_recall 仅作备选
      expect(output.replacement).toContain('[spilled:call-observe-1, re-issuable]');
    });

    it('local_search_files / local_list_files 同样按 re-issuable 激进外溢', () => {
      const spiller = new ToolResultSpiller();
      const content = 'x'.repeat(10_000);
      for (const toolName of ['local_search_files', 'local_list_files']) {
        const output = spiller.spill({ toolCallId: `call-${toolName}`, toolName, content });
        expect(output.shouldSpill, toolName).toBe(true);
        expect(output.record!.reissuability, toolName).toBe('re-issuable');
      }
    });

    it('外溢记录的 originalBytes 等于原始内容 UTF-8 字节长度', () => {
      const spiller = new ToolResultSpiller();
      const content = '中'.repeat(3_000); // 9000 字节 > 8KB
      const output = spiller.spill({
        toolCallId: 'call-cjk',
        toolName: 'terminal_observe',
        content,
      });
      expect(output.shouldSpill).toBe(true);
      expect(output.record!.originalBytes).toBe(byteLength(content));
    });
  });

  describe('有副作用命令保守 preview 标 not-replayable', () => {
    it('terminal_execute 超大结果外溢并标 not-replayable', () => {
      const spiller = new ToolResultSpiller();
      const content = largeContentWithMiddleToken('c', 'd');
      const output = spiller.spill({
        toolCallId: 'call-exec-1',
        toolName: 'terminal_execute',
        content,
      });

      expect(output.shouldSpill).toBe(true);
      expect(output.record!.reissuability).toBe('not-replayable');
      // not-replayable 指针——模型据此知道不可重发，必须走 context_recall 召回
      expect(output.replacement).toContain('[spilled:call-exec-1, not-replayable]');
    });

    it.each([
      'terminal_execute',
      'terminal_wait',
      'terminal_interrupt',
      'local_write_file',
      'local_edit_file',
    ])('%s 超大结果一律标 not-replayable（保守 preview）', (toolName) => {
      const spiller = new ToolResultSpiller();
      const output = spiller.spill({
        toolCallId: `call-${toolName}`,
        toolName,
        content: 'y'.repeat(10_000),
      });
      expect(output.shouldSpill).toBe(true);
      expect(output.record!.reissuability).toBe('not-replayable');
    });

    it('未登记的未知工具走兜底条款默认 not-replayable', () => {
      const spiller = new ToolResultSpiller();
      expect(spiller.classifyReissuability('some_future_tool')).toBe('not-replayable');
      const output = spiller.spill({
        toolCallId: 'call-unknown',
        toolName: 'some_future_tool',
        content: 'z'.repeat(10_000),
      });
      expect(output.shouldSpill).toBe(true);
      expect(output.record!.reissuability).toBe('not-replayable');
    });
  });

  describe('Seen set 防全量回灌但允许 context_recall 召回', () => {
    it('投影替换文本不含被外溢原件的中段全量内容（防全量回灌）', () => {
      const spiller = new ToolResultSpiller();
      // 头 4500 + 中段唯一标记 + 尾 4500；头尾 preview 各 ≤512 字节都拿不到中段标记
      const content = largeContentWithMiddleToken('a', 'b');
      const output = spiller.spill({
        toolCallId: 'call-spill-1',
        toolName: 'terminal_observe',
        content,
      });

      expect(output.shouldSpill).toBe(true);
      // 投影路径已用 preview+指针替换，中段全量内容不回灌给模型
      expect(output.replacement).not.toContain('MIDDLE_TOKEN_ZZZ');
    });

    it('投影替换文本含指针，模型可凭指针经 context_recall 召回所需片段', () => {
      const spiller = new ToolResultSpiller();
      const content = 'h'.repeat(10_000);
      const output = spiller.spill({
        toolCallId: 'call-recallable',
        toolName: 'terminal_execute',
        content,
      });

      expect(output.shouldSpill).toBe(true);
      // 指针即召回入口——context_recall 据此按 toolCallId 从 #items 取回片段
      expect(output.replacement).toContain('[spilled:call-recallable, not-replayable]');
      expect(output.replacement).toContain('context_recall');
    });

    it('头尾 preview 仍可见（模型能看到结果首尾，中间用指针召回）', () => {
      const spiller = new ToolResultSpiller();
      const headMarker = 'HEAD_VISIBLE';
      const tailMarker = 'TAIL_VISIBLE';
      const content = `${headMarker}${'m'.repeat(10_000)}${tailMarker}`;
      const output = spiller.spill({
        toolCallId: 'call-ht',
        toolName: 'terminal_observe',
        content,
      });

      expect(output.shouldSpill).toBe(true);
      expect(output.replacement).toContain('HEAD_VISIBLE');
      expect(output.replacement).toContain('TAIL_VISIBLE');
    });
  });

  describe('self-bounded 豁免', () => {
    it('local_read_file 即便结果超大也不外溢（自带 startLine/endLine/maxBytes bound）', () => {
      const spiller = new ToolResultSpiller();
      const output = spiller.spill({
        toolCallId: 'call-readfile',
        toolName: 'local_read_file',
        content: 'f'.repeat(100_000), // 远超阈值
      });
      // self-bounded：工具自带 bound，LayeredCompactor Tier2 floor 保护其内容，
      // Spiller 信任其 bound，不外溢——投影保留原内容
      expect(output.shouldSpill).toBe(false);
      expect(output.record).toBeUndefined();
      expect(output.replacement).toBeUndefined();
    });

    it('context_recall 结果不外溢（返回的即是受限召回片段，外溢会致无意义递归）', () => {
      const spiller = new ToolResultSpiller();
      const output = spiller.spill({
        toolCallId: 'call-recall',
        toolName: 'context_recall',
        content: 'r'.repeat(100_000),
      });
      expect(output.shouldSpill).toBe(false);
    });

    it('未达阈值的结果不外溢（投影保留原内容）', () => {
      const spiller = new ToolResultSpiller();
      const output = spiller.spill({
        toolCallId: 'call-small',
        toolName: 'terminal_execute',
        content: 'small result', // 远低于 8KB 阈值
      });
      expect(output.shouldSpill).toBe(false);
    });

    it('外溢后若无空间收益则不外溢（replacement ≥ original 时放弃）', () => {
      // 阈值设为 100，内容 101 字节：头尾各取全量 101 字节，replacement 必 > original
      const spiller = new ToolResultSpiller({ spillThresholdBytes: 100 });
      const output = spiller.spill({
        toolCallId: 'call-nogain',
        toolName: 'terminal_execute',
        content: 'x'.repeat(101),
      });
      expect(output.shouldSpill).toBe(false);
    });
  });

  describe('preview 头尾各 ≤512 字节（字节安全切片）', () => {
    it('previewHead / previewTail 字节长度均 ≤512', () => {
      const spiller = new ToolResultSpiller();
      const output = spiller.spill({
        toolCallId: 'call-bytes',
        toolName: 'terminal_observe',
        content: 'A'.repeat(10_000),
      });
      expect(output.shouldSpill).toBe(true);
      expect(byteLength(output.record!.previewHead)).toBeLessThanOrEqual(512);
      expect(byteLength(output.record!.previewTail)).toBeLessThanOrEqual(512);
    });

    it('previewHead 是原始内容前缀，previewTail 是原始内容后缀', () => {
      const spiller = new ToolResultSpiller();
      const head = 'H'.repeat(600);
      const middle = 'M'.repeat(8_000);
      const tail = 'T'.repeat(600);
      const content = head + middle + tail;
      const output = spiller.spill({
        toolCallId: 'call-prefix-suffix',
        toolName: 'terminal_observe',
        content,
      });
      expect(output.shouldSpill).toBe(true);
      // previewHead 是原始内容的前 512 字节子串
      expect(content.startsWith(output.record!.previewHead)).toBe(true);
      // previewTail 是原始内容的后 512 字节子串
      expect(content.endsWith(output.record!.previewTail)).toBe(true);
    });

    it('多字节 UTF-8（CJK）内容不截断字符边界', () => {
      const spiller = new ToolResultSpiller();
      const content = '中'.repeat(3_000); // 9000 字节，每字符 3 字节
      const output = spiller.spill({
        toolCallId: 'call-cjk-boundary',
        toolName: 'terminal_observe',
        content,
      });
      expect(output.shouldSpill).toBe(true);
      // 512 / 3 = 170.67 → 取 170 个完整 '中'（510 字节），不截断字符
      expect(byteLength(output.record!.previewHead)).toBe(510);
      expect(byteLength(output.record!.previewTail)).toBe(510);
      // preview 全部由完整 '中' 组成（无残缺字节）
      expect(output.record!.previewHead).toBe('中'.repeat(170));
      expect(output.record!.previewTail).toBe('中'.repeat(170));
    });
  });

  describe('可重发性分级覆盖', () => {
    it('Governor 持有风险分类时可经 grade 显式覆盖（如判定某 terminal_execute 只读）', () => {
      const spiller = new ToolResultSpiller();
      const output = spiller.spill({
        toolCallId: 'call-readonly-exec',
        toolName: 'terminal_execute',
        content: 'q'.repeat(10_000),
        // Governor 判定此条 terminal_execute 为只读诊断命令 → re-issuable
        grade: 're-issuable',
      });
      expect(output.shouldSpill).toBe(true);
      expect(output.record!.reissuability).toBe('re-issuable');
      expect(output.replacement).toContain('[spilled:call-readonly-exec, re-issuable]');
    });

    it('classifyReissuability 按工具名查分级表', () => {
      const spiller = new ToolResultSpiller();
      expect(spiller.classifyReissuability('local_read_file')).toBe('re-issuable');
      expect(spiller.classifyReissuability('terminal_observe')).toBe('re-issuable');
      expect(spiller.classifyReissuability('terminal_execute')).toBe('not-replayable');
      expect(spiller.classifyReissuability('local_write_file')).toBe('not-replayable');
    });

    it('自定义分级表与豁免集合可注入（一般用于测试）', () => {
      const spiller = new ToolResultSpiller({
        reissuabilityTable: { custom_tool: 're-issuable' },
        exemptTools: new Set(['custom_exempt']),
      });
      expect(spiller.classifyReissuability('custom_tool')).toBe('re-issuable');
      // 自定义豁免集合替换默认（local_read_file 不再豁免）
      const output = spiller.spill({
        toolCallId: 'call-custom-exempt',
        toolName: 'custom_exempt',
        content: 'x'.repeat(10_000),
      });
      expect(output.shouldSpill).toBe(false);
    });
  });

  describe('辅助函数', () => {
    it('buildPointer 产出 [spilled:toolCallId, grade] 格式', () => {
      expect(buildPointer('call-1', 're-issuable')).toBe('[spilled:call-1, re-issuable]');
      expect(buildPointer('call-2', 'not-replayable')).toBe('[spilled:call-2, not-replayable]');
    });

    it('buildReplacement 组装指针 + 头部 preview + 外溢标记 + 尾部 preview', () => {
      const replacement = buildReplacement('[spilled:call-1, not-replayable]', 'HEAD', 'TAIL');
      expect(replacement).toContain('[spilled:call-1, not-replayable]');
      expect(replacement).toContain('HEAD');
      expect(replacement).toContain('TAIL');
      expect(replacement).toContain('context_recall');
    });

    it('buildSpillReplacementFromRecord 从持久化记录重建稳定替换文本（崩溃恢复不重新外溢）', () => {
      const record: ToolResultSpillRecord = {
        toolCallId: 'call-rebuilt',
        reissuability: 'not-replayable',
        previewHead: 'REBUILT_HEAD',
        previewTail: 'REBUILT_TAIL',
        originalBytes: 10_000,
      };
      const replacement = buildSpillReplacementFromRecord(record);
      // 崩溃恢复路径：不访问原始内容，直接用持久化 preview 头尾重构
      expect(replacement).toContain('[spilled:call-rebuilt, not-replayable]');
      expect(replacement).toContain('REBUILT_HEAD');
      expect(replacement).toContain('REBUILT_TAIL');
    });

    it('byteLength / takeFromStart / takeFromEnd 字节安全', () => {
      expect(byteLength('ABC')).toBe(3);
      expect(byteLength('中')).toBe(3);
      // takeFromStart：正向迭代累加 UTF-8 字节，超 maxBytes 即停，不截断多字节字符。
      // '中文ab' 逐字符：'中'(3) → 累计 3 ≤4；'文'(3) → 3+3=6>4 停 → 取 '中'
      expect(takeFromStart('中文ab', 4)).toBe('中');
      // '中文ab'，maxBytes=7：'中'(3)→3，'文'(3)→6，'a'(1)→7 ≤7 ✓ → '中文a'
      expect(takeFromStart('中文ab', 7)).toBe('中文a');
      // takeFromEnd：反向迭代取尾部字符，再正序拼回。
      // '中文ab' 反向：'b'(1)→1，'a'(1)→2，'文'(3)→2+3=5>4 停 → 'ab'
      expect(takeFromEnd('中文ab', 4)).toBe('ab');
      // '中文ab'，maxBytes=6：'b'(1)→1，'a'(1)→2，'文'(3)→5 ≤6，'中'(3)→8>6 停 → '文ab'
      expect(takeFromEnd('中文ab', 6)).toBe('文ab');
    });
  });
});
