import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { ConfirmDialog } from './confirm-dialog.js';

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const html = renderToString(
      <ConfirmDialog
        confirmLabel="删除"
        description="将删除该模型配置"
        onCancel={() => undefined}
        onConfirm={() => Promise.resolve()}
        open={false}
        title="确认删除"
      />,
    );

    expect(html).toBe('');
  });

  it('renders title, description and confirm/cancel actions when open', () => {
    const html = renderToString(
      <ConfirmDialog
        confirmLabel="删除"
        description="将删除该模型配置"
        onCancel={() => undefined}
        onConfirm={() => Promise.resolve()}
        open
        title="确认删除"
      />,
    );

    expect(html).toContain('确认删除');
    expect(html).toContain('将删除该模型配置');
    expect(html).toContain('删除');
    expect(html).toContain('取消');
  });

  it('disables the confirm button while pending', () => {
    const html = renderToString(
      <ConfirmDialog
        confirmLabel="删除"
        description="将删除该模型配置"
        onCancel={() => undefined}
        onConfirm={() => Promise.resolve()}
        open
        pending
        title="确认删除"
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled');
  });
});
