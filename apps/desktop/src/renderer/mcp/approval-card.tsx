import { ShieldAlert } from 'lucide-react';
import type { JSX } from 'react';

import type { McpApprovalDecision, McpApprovalRequest } from '../../shared/contracts.js';

const RISK_LABELS = {
  read_only: '只读',
  unknown: '未分类',
  mutating: '低危写',
  privileged: '特权',
  destructive: '破坏性',
} as const;

function formatReason(reason: string): string {
  const unknown = /^unknown (?:PowerShell )?executable: (.+)$/.exec(reason);
  if (unknown) return `未知可执行文件：${unknown[1]}`;

  const stateChange = /^(.+?) can change system state$/.exec(reason);
  if (stateChange) return `${stateChange[1]} 可能更改系统状态`;

  const destructive = /^(.+?) has (?:irreversible )?destructive semantics$/.exec(reason);
  if (destructive) return `${destructive[1]} 具有破坏性语义`;

  const explanations = new Map([
    ['command substitution is not proven safe', '命令替换存在不确定性'],
    ['command requests privilege escalation', '命令请求提升权限'],
    ['empty command', '命令为空'],
    ['redirection can change filesystem state', '重定向可能修改文件系统'],
    ['all commands match read-only rules', '所有命令均匹配只读规则'],
    ['irreversible', '命令具有不可逆的破坏性影响'],
  ]);
  return explanations.get(reason) ?? reason;
}

function formatBytes(value: number): string {
  return `${value.toLocaleString('en-US')} bytes`;
}

export function ApprovalCard({
  request,
  onDecide,
}: {
  request: McpApprovalRequest;
  onDecide: (decision: McpApprovalDecision) => void;
}): JSX.Element {
  return (
    <div aria-label="MCP 审批" aria-modal="true" className="approval-backdrop" role="dialog">
      <section aria-labelledby="approval-title" className="approval-card">
        <div className="approval-header">
          <div className="approval-header-icon">
            <ShieldAlert aria-hidden="true" size={20} />
          </div>
          <div>
            <p className="approval-eyebrow">审批卡片 / MANUAL DECISION</p>
            <h2 id="approval-title">需要人工裁决</h2>
            <p className="approval-header-note">外部客户端请求执行一条需要你确认的命令。</p>
          </div>
        </div>
        <div className="approval-content">
          <dl className="approval-details">
            <div className="approval-detail">
              <dt>目标 Session</dt>
              <dd>
                <code>{request.sessionId}</code>
              </dd>
            </div>
            <div className="approval-detail">
              <dt>风险分类</dt>
              <dd>
                <span className={`risk-badge is-${request.risk}`}>{RISK_LABELS[request.risk]}</span>
              </dd>
            </div>
          </dl>

          {request.kind === 'interactive' && request.inputGrantMode !== undefined && (
            <section className="approval-section" aria-labelledby="approval-input-title">
              <div className="approval-section-heading">
                <div>
                  <h3 id="approval-input-title">后续输入授权</h3>
                  <p>本次启动只授予固定范围的输入能力，不包含未来输入内容。</p>
                </div>
              </div>
              <dl className="approval-details" data-approval-input-grant="true">
                <div className="approval-detail">
                  <dt>授权档位</dt>
                  <dd>
                    <code>{request.inputGrantMode}</code>
                  </dd>
                </div>
                {request.inputLimits !== undefined && (
                  <>
                    <div className="approval-detail">
                      <dt>固定调用上限</dt>
                      <dd>{request.inputLimits.maxCalls.toLocaleString('en-US')} 次</dd>
                    </div>
                    <div className="approval-detail">
                      <dt>固定字节上限</dt>
                      <dd>{formatBytes(request.inputLimits.maxBytes)}</dd>
                    </div>
                    <div className="approval-detail">
                      <dt>连续空闲上限</dt>
                      <dd>{Math.round(request.inputLimits.idleTimeoutMs / 60_000)} 分钟</dd>
                    </div>
                  </>
                )}
              </dl>
            </section>
          )}

          {request.kind === 'free_input' && (
            <section className="approval-section" aria-labelledby="approval-free-input-title">
              <div className="approval-section-heading">
                <div>
                  <h3 id="approval-free-input-title">待发送的自由输入</h3>
                  <p>审批匹配使用规范化文本和按序键名。</p>
                </div>
              </div>
              {request.text !== undefined && request.text.length > 0 && (
                <pre className="approval-command-scroll" title={request.text}>
                  {request.text}
                </pre>
              )}
              {request.keys !== undefined && request.keys.length > 0 && (
                <p className="approval-reason">键名：{request.keys.join('、')}</p>
              )}
            </section>
          )}

          <section className="approval-section" aria-labelledby="approval-command-title">
            <div className="approval-section-heading">
              <div>
                <h3 id="approval-command-title">命令全文</h3>
                <p>请确认命令目标和参数后再选择裁决。</p>
              </div>
              <span className="approval-section-hint">可滚动查看</span>
            </div>
            <pre aria-label="命令全文" className="approval-command-scroll" title={request.command}>
              {request.command}
            </pre>
          </section>

          <section className="approval-section approval-reason-section">
            <h3>风险理由</h3>
            <p className="approval-reason">
              {request.reasons.map(formatReason).join('；') || '策略引擎未提供理由'}
            </p>
          </section>
        </div>
        <div className="approval-actions">
          <button
            className="primary"
            data-decision="allow_once"
            onClick={() => onDecide('allow_once')}
            type="button"
          >
            允许一次
          </button>
          <button
            data-decision="allow_session"
            onClick={() => onDecide('allow_session')}
            type="button"
          >
            本会话内放行该命令
          </button>
          <button
            className="danger"
            data-decision="denied"
            onClick={() => onDecide('denied')}
            type="button"
          >
            拒绝
          </button>
        </div>
      </section>
    </div>
  );
}
