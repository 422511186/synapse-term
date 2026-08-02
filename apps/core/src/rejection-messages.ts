/**
 * Human-readable rejection reason messages for terminal execution.
 * Maps internal error codes and observation-only reasons to user-facing strings
 * in both English and Chinese.
 */

export type RejectionErrorCode =
  | 'execution_environment_unverified'
  | 'command_not_auditable'
  | 'plaintext_protocol_error'
  | 'execution_dialect_observe_only';

export type ObservationOnlyReason =
  'timeout' | 'nonzero_exit' | 'pty_exit' | 'write_rejected' | 'invalidated' | 'busy';

export interface LocalizedMessage {
  readonly en: string;
  readonly zh: string;
}

const REJECTION_MESSAGES: Record<RejectionErrorCode, LocalizedMessage> = {
  execution_environment_unverified: {
    en: 'Current environment is not verified; cannot execute commands',
    zh: '当前环境未验证，无法执行命令',
  },
  command_not_auditable: {
    en: 'Command cannot be safely wrapped for plaintext audit',
    zh: '命令无法安全封装为明文审计格式',
  },
  plaintext_protocol_error: {
    en: 'Plaintext protocol error occurred during command dispatch',
    zh: '命令分发过程中发生明文协议错误',
  },
  execution_dialect_observe_only: {
    en: 'Session is in observation-only mode; command execution is disabled',
    zh: '会话处于仅观察模式，命令执行已禁用',
  },
};

const OBSERVATION_ONLY_MESSAGES: Record<ObservationOnlyReason, LocalizedMessage> = {
  timeout: {
    en: 'Environment probe timed out',
    zh: '环境探测超时',
  },
  nonzero_exit: {
    en: 'Environment probe returned non-zero exit code',
    zh: '环境探测返回非零退出码',
  },
  pty_exit: {
    en: 'PTY exited during environment probe',
    zh: '环境探测期间 PTY 已退出',
  },
  write_rejected: {
    en: 'PTY write was rejected during environment probe',
    zh: '环境探测期间 PTY 写入被拒绝',
  },
  invalidated: {
    en: 'Environment capability was invalidated',
    zh: '环境能力已被失效',
  },
  busy: {
    en: 'Environment probe is already in progress',
    zh: '环境探测正在进行中',
  },
};

/**
 * Get localized rejection message for an error code.
 */
export function getRejectionMessage(code: RejectionErrorCode, locale: 'en' | 'zh' = 'en'): string {
  return REJECTION_MESSAGES[code][locale];
}

/**
 * Get localized message for an observation-only reason.
 */
export function getObservationOnlyMessage(
  reason: ObservationOnlyReason,
  locale: 'en' | 'zh' = 'en',
): string {
  return OBSERVATION_ONLY_MESSAGES[reason][locale];
}

/**
 * Get all rejection messages for a given locale (for UI display).
 */
export function getAllRejectionMessages(
  locale: 'en' | 'zh' = 'en',
): Record<RejectionErrorCode, string> {
  return {
    execution_environment_unverified: REJECTION_MESSAGES.execution_environment_unverified[locale],
    command_not_auditable: REJECTION_MESSAGES.command_not_auditable[locale],
    plaintext_protocol_error: REJECTION_MESSAGES.plaintext_protocol_error[locale],
    execution_dialect_observe_only: REJECTION_MESSAGES.execution_dialect_observe_only[locale],
  };
}

/**
 * Get all observation-only messages for a given locale.
 */
export function getAllObservationOnlyMessages(
  locale: 'en' | 'zh' = 'en',
): Record<ObservationOnlyReason, string> {
  return {
    timeout: OBSERVATION_ONLY_MESSAGES.timeout[locale],
    nonzero_exit: OBSERVATION_ONLY_MESSAGES.nonzero_exit[locale],
    pty_exit: OBSERVATION_ONLY_MESSAGES.pty_exit[locale],
    write_rejected: OBSERVATION_ONLY_MESSAGES.write_rejected[locale],
    invalidated: OBSERVATION_ONLY_MESSAGES.invalidated[locale],
    busy: OBSERVATION_ONLY_MESSAGES.busy[locale],
  };
}
