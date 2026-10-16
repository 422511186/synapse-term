import type { InputGrantMode } from '../session/command-protocol.js';

/** 单次外部输入的规范化文本 UTF-8 字节上限（specs/mcp-access）。 */
export const MAX_INPUT_TEXT_BYTES = 8 * 1024;

/** 单次外部输入的按键数量上限（specs/mcp-access）。 */
export const MAX_INPUT_KEYS = 128;

/** 单次外部输入的合并 payload UTF-8 字节上限（specs/mcp-access）。 */
export const MAX_INPUT_PAYLOAD_BYTES = 16 * 1024;

/** 交互事务连续无输入后失效的空闲上限（specs/mcp-access）。 */
export const EXTERNAL_INPUT_IDLE_TIMEOUT_MS = 10 * 60_000;

/** 交互事务输入授权档位的固定上限。 */
export interface ExternalInputGrantLimits {
  maxCalls: number;
  maxBytes: number;
  idleTimeoutMs: number;
}

/**
 * 输入授权档位上限的唯一来源：审批卡片展示的数值与执行器实际执行的上限都取自这里。
 *
 * `one_shot` 的字节上限等于单次 payload 上限——它只允许一次输入，因此上限就是一次 payload 的容量。
 */
export const EXTERNAL_INPUT_GRANT_LIMITS: Readonly<
  Record<InputGrantMode, ExternalInputGrantLimits>
> = {
  one_shot: {
    maxCalls: 1,
    maxBytes: MAX_INPUT_PAYLOAD_BYTES,
    idleTimeoutMs: EXTERNAL_INPUT_IDLE_TIMEOUT_MS,
  },
  bounded: {
    maxCalls: 256,
    maxBytes: 256 * 1024,
    idleTimeoutMs: EXTERNAL_INPUT_IDLE_TIMEOUT_MS,
  },
};
