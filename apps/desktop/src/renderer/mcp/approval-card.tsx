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
  ]);
  return explanations.get(reason) ?? reason;
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
          <ShieldAlert aria-hidden="true" size={18} />
          <h2 id="approval-title">外部工具请求审批</h2>
        </div>
        <dl>
          <dt>目标会话</dt>
          <dd>{request.sessionId}</dd>
          <dt>风险分类</dt>
          <dd>
            <span className={`risk-badge is-${request.risk}`}>{RISK_LABELS[request.risk]}</span>
          </dd>
          <dt>命令全文</dt>
          <dd>
            <pre>{request.command}</pre>
          </dd>
          <dt>风险理由</dt>
          <dd>{request.reasons.map(formatReason).join('；') || '策略引擎未提供理由'}</dd>
        </dl>
        <div className="approval-actions">
          <button className="primary" onClick={() => onDecide('allow_once')} type="button">
            允许一次
          </button>
          <button onClick={() => onDecide('allow_session')} type="button">
            本会话内放行该命令
          </button>
          <button className="danger" onClick={() => onDecide('denied')} type="button">
            拒绝
          </button>
        </div>
      </section>
    </div>
  );
}
