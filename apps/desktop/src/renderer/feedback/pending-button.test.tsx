import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { PendingButton } from './pending-button.js';

describe('PendingButton', () => {
  it('renders idle children by default without busy attributes', () => {
    const html = renderToString(
      <PendingButton onClick={() => Promise.resolve()}>检测模型</PendingButton>,
    );

    expect(html).toContain('检测模型');
    expect(html).not.toContain('aria-busy="true"');
    expect(html).not.toContain('disabled');
  });

  it('renders busy label with aria-busy and disabled while pending', () => {
    const html = renderToString(
      <PendingButton busyLabel="检测中…" onClick={() => Promise.resolve()} pending>
        检测模型
      </PendingButton>,
    );

    expect(html).toContain('检测中…');
    expect(html).not.toContain('检测模型');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled');
  });

  it('renders success label when success is set', () => {
    const html = renderToString(
      <PendingButton onClick={() => Promise.resolve()} success successLabel="检测通过">
        检测模型
      </PendingButton>,
    );

    expect(html).toContain('检测通过');
    expect(html).not.toContain('检测模型');
  });

  it('stays disabled when an external disabled flag is set', () => {
    const html = renderToString(
      <PendingButton disabled onClick={() => Promise.resolve()}>
        删除
      </PendingButton>,
    );

    expect(html).toContain('disabled');
  });
});
