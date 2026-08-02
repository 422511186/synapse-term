import { describe, expect, it } from 'vitest';

import {
  getRejectionMessage,
  getObservationOnlyMessage,
  getAllRejectionMessages,
  getAllObservationOnlyMessages,
  type RejectionErrorCode,
  type ObservationOnlyReason,
} from './rejection-messages.js';

describe('Rejection messages Chinese UI mapping', () => {
  const allErrorCodes: RejectionErrorCode[] = [
    'execution_environment_unverified',
    'command_not_auditable',
    'plaintext_protocol_error',
    'execution_dialect_observe_only',
  ];

  const allObservationReasons: ObservationOnlyReason[] = [
    'timeout',
    'nonzero_exit',
    'pty_exit',
    'write_rejected',
    'invalidated',
    'busy',
  ];

  it('every rejection error code has both English and Chinese messages', () => {
    for (const code of allErrorCodes) {
      const en = getRejectionMessage(code, 'en');
      const zh = getRejectionMessage(code, 'zh');
      expect(en).toBeTruthy();
      expect(zh).toBeTruthy();
      expect(en).not.toBe(zh);
      // Chinese messages should contain CJK characters
      expect(zh).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('every observation-only reason has both English and Chinese messages', () => {
    for (const reason of allObservationReasons) {
      const en = getObservationOnlyMessage(reason, 'en');
      const zh = getObservationOnlyMessage(reason, 'zh');
      expect(en).toBeTruthy();
      expect(zh).toBeTruthy();
      expect(en).not.toBe(zh);
      expect(zh).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('getAllRejectionMessages returns complete mapping for Chinese', () => {
    const messages = getAllRejectionMessages('zh');
    for (const code of allErrorCodes) {
      expect(messages[code]).toBeTruthy();
      expect(messages[code]).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('getAllObservationOnlyMessages returns complete mapping for Chinese', () => {
    const messages = getAllObservationOnlyMessages('zh');
    for (const reason of allObservationReasons) {
      expect(messages[reason]).toBeTruthy();
      expect(messages[reason]).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('manual dialect selection message warns about verification requirement', () => {
    // The message for unverified environment should make clear
    // that manual selection only changes the candidate, not bypasses verification
    const zh = getRejectionMessage('execution_environment_unverified', 'zh');
    expect(zh).toContain('未验证');
    expect(zh).not.toContain('绕过');
  });

  it('observation-only mode message is distinct from unverified', () => {
    const unverifiedZh = getRejectionMessage('execution_environment_unverified', 'zh');
    const observeOnlyZh = getRejectionMessage('execution_dialect_observe_only', 'zh');
    expect(unverifiedZh).not.toBe(observeOnlyZh);
    expect(observeOnlyZh).toContain('仅观察');
  });

  it('command_not_auditable Chinese message mentions plaintext', () => {
    const zh = getRejectionMessage('command_not_auditable', 'zh');
    expect(zh).toContain('明文');
    expect(zh).toContain('审计');
  });

  it('timeout observation reason mentions timeout in Chinese', () => {
    const zh = getObservationOnlyMessage('timeout', 'zh');
    expect(zh).toContain('超时');
  });
});
