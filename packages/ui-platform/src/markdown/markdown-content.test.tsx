import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MarkdownContent } from './markdown-content.js';

describe('MarkdownContent', () => {
  it('renders GFM headings, tables, lists, links, and fenced code', () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>
        {
          '# 诊断结论\n\n- 第一项\n- 第二项\n\n| 资源 | 状态 |\n| --- | --- |\n| 磁盘 | 正常 |\n\n```bash\ndf -h\n```\n\n[运行手册](https://example.com/runbook)'
        }
      </MarkdownContent>,
    );

    expect(markup).toContain('<h1>诊断结论</h1>');
    expect(markup).toContain('<ul>');
    expect(markup).toContain('<table>');
    expect(markup).toContain('<pre>');
    expect(markup).toContain('href="https://example.com/runbook"');
  });

  it('does not execute raw HTML from assistant output', () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>{'<script>window.bad = true</script>\n\n安全文本'}</MarkdownContent>,
    );

    expect(markup).not.toContain('<script>');
    expect(markup).toContain('安全文本');
  });
});
