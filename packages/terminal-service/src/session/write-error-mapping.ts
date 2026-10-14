import type { ExternalErrorCode, WritePremiseError } from '@synapse-term/domain';

import type { WriteError } from './session-actor.js';

/**
 * 写入结果到对外稳定错误码的唯一映射。
 *
 * 前提码到错误码的判定只有这一份；原因与指引文本按写入形状给出，因为它们描述的是该形状的
 * 上下文（结构化执行、交互启动、事务内输入）。前提码到错误码的差异只有两处，且都是既有行为，
 * 在此显式保留而不是抹平：
 *
 * - 事务内输入把 `session-not-running` 报为 `INPUT_WRITE_UNKNOWN`，其余形状报 `SESSION_EXPIRED`；
 * - `write-unknown` 只出现在交互路径，报为 `INPUT_WRITE_UNKNOWN`。
 */
export interface WriteErrorDescription {
  code: ExternalErrorCode;
  reason: string;
  guidance: string;
}

const PREMISE_ERROR_CODES = {
  'stale-environment-epoch': 'SESSION_NOT_READY',
  'stale-execution-context': 'EXECUTION_CONTEXT_STALE',
  'environment-unverified': 'SESSION_NOT_READY',
  'session-not-running': 'SESSION_EXPIRED',
  'external-write-cancelled': 'SESSION_EXPIRED',
} as const satisfies Readonly<Record<WritePremiseError, ExternalErrorCode>>;

export function premiseErrorCode(error: WritePremiseError): ExternalErrorCode {
  return PREMISE_ERROR_CODES[error];
}

export function describeStructuredWriteError(error: WriteError): WriteErrorDescription {
  if (error === 'write-unknown') {
    return {
      code: 'EXECUTION_WRITE_UNKNOWN',
      reason: 'the PTY backend did not confirm delivery of the user command',
      guidance:
        '当前 environment/context 已失效；用户命令可能已经执行，请先重新 observe 并由用户判断后续动作，不要自动重试。',
    };
  }
  switch (error) {
    case 'stale-execution-context':
      return {
        code: premiseErrorCode(error),
        reason: 'the execution context changed before the command was written',
        guidance:
          '请先调用 synapse_observe（必要时使用 tail）获取当前终端内容和新的 executionContextId。',
      };
    case 'stale-environment-epoch':
      return {
        code: premiseErrorCode(error),
        reason: 'the verified PTY environment changed before the command was written',
        guidance: '请重新观察当前 Session，等待 environment 验证后再执行。',
      };
    case 'environment-unverified':
      return {
        code: premiseErrorCode(error),
        reason: 'current PTY environment is not verified',
        guidance: '请等待当前 PTY environment 验证完成后重试。',
      };
    case 'session-not-running':
      return {
        code: premiseErrorCode(error),
        reason: 'terminal session is no longer running',
        guidance: '请重新共享该 Session。',
      };
    case 'external-write-cancelled':
      return {
        code: premiseErrorCode(error),
        reason: 'external command dispatch was cancelled before the PTY write',
        guidance: '请重新共享 Session 后先观察再执行。',
      };
  }
}

export function describeInteractiveStartWriteError(
  error: WritePremiseError,
): WriteErrorDescription {
  switch (error) {
    case 'stale-execution-context':
      return {
        code: premiseErrorCode(error),
        reason: 'the execution context changed before the interactive command was written',
        guidance: '请先调用 synapse_observe 获取当前内容和新的 executionContextId。',
      };
    case 'stale-environment-epoch':
      return {
        code: premiseErrorCode(error),
        reason: 'the verified PTY environment changed before the interactive command was written',
        guidance: '请重新观察当前 Session 后再启动交互事务。',
      };
    case 'environment-unverified':
      return {
        code: premiseErrorCode(error),
        reason: 'current PTY environment is not verified',
        guidance: '请先验证当前 PTY environment。',
      };
    case 'session-not-running':
      return {
        code: premiseErrorCode(error),
        reason: 'terminal session is no longer running',
        guidance: '请重新共享 Session。',
      };
    case 'external-write-cancelled':
      return {
        code: premiseErrorCode(error),
        reason: 'interactive command dispatch was cancelled before the PTY write',
        guidance: '请重新共享 Session 后再试。',
      };
  }
}

export function describeTransactionalInputWriteError(
  error: WriteError,
  environmentInvalidated: boolean,
): WriteErrorDescription {
  if (error === 'write-unknown') {
    return {
      code: 'INPUT_WRITE_UNKNOWN',
      reason: 'the PTY backend did not confirm delivery of the input payload',
      guidance: '所属交互事务已进入 unknown；不要使用新的 inputRequestId 自动重放。',
    };
  }
  if (error === 'environment-unverified') {
    return {
      code: 'INPUT_WRITE_UNKNOWN',
      reason: 'the PTY environment was invalidated before input delivery was confirmed',
      guidance: '所属交互事务已进入 unknown；不要使用新的 inputRequestId 自动重放。',
    };
  }
  if (error === 'external-write-cancelled') {
    if (environmentInvalidated) {
      return {
        code: 'INPUT_WRITE_UNKNOWN',
        reason: 'the PTY environment was invalidated before input delivery was confirmed',
        guidance: '所属交互事务已进入 unknown；不要使用新的 inputRequestId 自动重放。',
      };
    }
    return {
      code: 'SESSION_EXPIRED',
      reason: 'input dispatch was cancelled before the PTY write',
      guidance: '请重新共享 Session。',
    };
  }
  // `session-not-running` 与事务内输入不可达的 `stale-*` 都落在这里：既有行为把「Session
  // 在输入交付前停止」报为 `INPUT_WRITE_UNKNOWN`，因为所属事务同时收敛为 unknown。
  return {
    code: 'INPUT_WRITE_UNKNOWN',
    reason: 'the terminal session stopped before input delivery was confirmed',
    guidance: '所属交互事务已进入 unknown；不要自动重放输入。',
  };
}
