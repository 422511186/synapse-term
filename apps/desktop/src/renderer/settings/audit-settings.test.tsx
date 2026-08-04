import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { createMockDesktopApi } from '../mock-api.js';
import { AuditSettings } from './audit-settings.js';

describe('AuditSettings', () => {
  it('renders a read-only settings page instead of an Agent panel tab', () => {
    const markup = renderToStaticMarkup(
      <AuditSettings
        api={createMockDesktopApi()}
        onBack={() => undefined}
        sessionId="session-local"
      />,
    );

    expect(markup).toContain('审计日志');
    expect(markup).toContain('只读');
    expect(markup).not.toContain('Agent Timeline');
    expect(markup).not.toContain('aria-selected');
  });
});
