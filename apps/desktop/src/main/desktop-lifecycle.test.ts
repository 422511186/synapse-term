import { describe, expect, it } from 'vitest';

import { DesktopLifecycle } from './desktop-lifecycle.js';

describe('desktop shutdown coordination', () => {
  it('closes ingress immediately, drains pending creation, and stops MCP before Sessions exactly once', async () => {
    const events: string[] = [];
    let finishCreation = (): void => undefined;
    const lifecycle = new DesktopLifecycle({
      stopMcp: async () => {
        events.push('mcp-stopped');
      },
      stopSessions: async () => {
        events.push('sessions-stopped');
      },
    });
    const created = lifecycle.createSession(
      () =>
        new Promise<void>((resolve) => {
          finishCreation = resolve;
        }),
    );
    const stopped = lifecycle.shutdown();
    expect(lifecycle.closing).toBe(true);
    expect(() => lifecycle.createSession(async () => undefined)).toThrow();
    finishCreation();
    await created;
    await Promise.all([stopped, lifecycle.shutdown()]);
    expect(events).toEqual(['mcp-stopped', 'sessions-stopped']);
  });
});
