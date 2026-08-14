import { describe, expect, it } from 'vitest';

import type { SessionSummary } from '../preload/preload-api.js';
import { getDefaultSessionAlias, resolveSessionAlias } from './session-alias.js';

function session(id: string, title: string): SessionSummary {
  return {
    id,
    title,
    terminalType: 'Git Bash',
    pty: 'running',
  };
}

describe('session aliases', () => {
  it('chooses the smallest unused default terminal alias', () => {
    expect(
      getDefaultSessionAlias([
        session('session-1', '终端 1'),
        session('session-3', '终端 3'),
        session('custom', '终端 8'),
      ]),
    ).toBe('终端 2');
  });

  it('falls back to the default alias when the submitted value is blank', () => {
    const sessions = [session('session-1', '终端 1')];
    expect(resolveSessionAlias('   ', sessions)).toBe('终端 2');
    expect(resolveSessionAlias('我的终端', sessions)).toBe('我的终端');
  });
});
