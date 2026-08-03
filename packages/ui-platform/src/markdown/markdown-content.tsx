import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { JSX } from 'react';

/**
 * 渲染来自模型输出或外部 Agent 的不可信 Markdown 文本。
 *
 * 安全约束（H-16）：
 * - 使用 `react-markdown` 渲染，不使用 `dangerouslySetInnerHTML`，原始 HTML 标签被转义为文本。
 * - 链接强制 `rel="noreferrer"` 与 `target="_blank"`，避免同源导航与 referer 泄漏。
 */
export function MarkdownContent({ children }: { children: string }): JSX.Element {
  return (
    <div className="agent-markdown">
      <ReactMarkdown
        components={{
          a: (props) => {
            const { node, ...anchorProps } = props;
            void node;
            return <a {...anchorProps} rel="noreferrer" target="_blank" />;
          },
        }}
        remarkPlugins={[remarkGfm]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
