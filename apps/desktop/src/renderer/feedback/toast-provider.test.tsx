import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { ToastProvider } from './toast-provider.js';

describe('ToastProvider', () => {
  it('renders children and an aria-live toast region', () => {
    const html = renderToString(
      <ToastProvider>
        <div id="app-child">app content</div>
      </ToastProvider>,
    );

    expect(html).toContain('app content');
    expect(html).toContain('aria-live="polite"');
  });
});
