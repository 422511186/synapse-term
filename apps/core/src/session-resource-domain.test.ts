import { describe, expect, it } from 'vitest';

import {
  SESSION_RESOURCE_REFRESH_ERROR_MESSAGES,
  sessionResourceRefreshError,
} from './session-resource-domain.js';

describe('Session resource refresh errors', () => {
  it('uses stable Simplified Chinese messages for refresh failures', () => {
    expect(SESSION_RESOURCE_REFRESH_ERROR_MESSAGES).toEqual({
      session_not_found: '终端会话不存在。',
      session_not_ready: '终端会话当前无法安全刷新资源。',
      execution_dialect_unsupported: '当前终端会话的执行方言不支持资源刷新。',
      lease_unavailable: '终端会话正忙，暂时无法刷新资源。',
      collection_timeout: '资源采集超时。',
      collection_failed: '资源采集失败。',
    });
    expect(sessionResourceRefreshError('session_not_ready')).toEqual({
      code: 'session_not_ready',
      message: '终端会话当前无法安全刷新资源。',
    });
  });
});
