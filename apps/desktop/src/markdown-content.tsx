import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { JSX } from 'react';

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
