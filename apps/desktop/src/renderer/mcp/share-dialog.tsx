import { Check, Copy, Share2, Terminal, X } from 'lucide-react';
import { useState, type JSX } from 'react';

import type { McpRuntimeStatus } from '../../shared/contracts.js';
import { buildShareText } from './share-text.js';

export function ShareDialog({
  onClose,
  sessionId,
  terminalType,
  title,
  mcpStatus,
}: {
  onClose: () => void;
  sessionId: string;
  terminalType: string;
  title: string;
  mcpStatus: McpRuntimeStatus;
}): JSX.Element {
  const [copied, setCopied] = useState<'share' | 'id' | undefined>();
  const shareText = buildShareText({ sessionId, terminalType, title });

  const copy = (value: string, target: 'share' | 'id'): void => {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return;
    void navigator.clipboard
      .writeText(value)
      .then(() => setCopied(target))
      .catch(() => undefined);
  };

  return (
    <div
      aria-label="共享终端会话"
      aria-modal="true"
      className="share-dialog-backdrop"
      role="dialog"
    >
      <section className="share-dialog-card" aria-labelledby="share-dialog-title">
        <header className="share-dialog-header">
          <div className="share-dialog-heading">
            <div className="share-dialog-icon" aria-hidden="true">
              <Share2 size={18} />
            </div>
            <div>
              <p className="mcp-settings-eyebrow">SHARING / MCP</p>
              <h2 id="share-dialog-title">共享 Terminal Session</h2>
            </div>
          </div>
          <button
            aria-label="关闭共享"
            className="share-dialog-close"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </header>

        <div className="share-dialog-body">
          <div className="share-session-identity">
            <div className="share-session-icon" aria-hidden="true">
              <Terminal size={17} />
            </div>
            <div className="share-session-copy">
              <strong>{title}</strong>
              <span>
                启动 Shell 提示：{terminalType}（仅供参考） <span aria-hidden="true">·</span>{' '}
                <code>{sessionId}</code>
              </span>
            </div>
            <span className="share-session-badge">已共享</span>
          </div>

          <div className="share-setup-callout">
            <div className="share-setup-check" aria-hidden="true">
              <Check size={15} />
            </div>
            <div>
              <strong>{mcpStatus.running ? '内嵌 MCP Server 可连接' : 'Session 已共享'}</strong>
              <p>
                {mcpStatus.running
                  ? '外部客户端可以使用设置页里的服务地址，并在 MCP 服务中配置 Authorization: Bearer <Token> 请求头。'
                  : '内嵌 MCP Server 当前未运行；请先到 MCP 服务设置启用服务并配置 Token。'}{' '}
                下面的 Share Text 不包含真实 Token。
              </p>
            </div>
          </div>

          <div className="share-preview">
            <div className="share-preview-heading">
              <div>
                <span className="share-preview-label">Share Text 预览</span>
                <span className="share-preview-hint">可直接粘贴给外部客户端</span>
              </div>
              <span className="share-preview-safe">不含 Token</span>
            </div>
            <pre aria-label="共享提示词预览">{shareText}</pre>
          </div>

          <div className="share-dialog-actions">
            <button
              className="share-dialog-button is-primary"
              onClick={() => copy(shareText, 'share')}
              type="button"
            >
              {copied === 'share' ? <Check size={16} /> : <Share2 size={16} />}
              {copied === 'share' ? '已复制 Share Text' : '复制共享提示词块'}
            </button>
            <button
              className="share-dialog-button"
              onClick={() => copy(sessionId, 'id')}
              type="button"
            >
              {copied === 'id' ? <Check size={16} /> : <Copy size={16} />}
              {copied === 'id' ? '已复制裸 ID' : '仅复制裸 ID'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
