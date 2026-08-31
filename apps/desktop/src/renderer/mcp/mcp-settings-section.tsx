import {
  AlertTriangle,
  Check,
  CircleCheck,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';

import type {
  McpApprovalMode,
  McpRuntimeStatus,
  McpSettings,
  SharedMcpSession,
} from '../../shared/contracts.js';

const MODES: Array<{
  label: string;
  value: McpApprovalMode;
  description: string;
}> = [
  {
    value: 'read_only',
    label: '只读',
    description: '仅允许观察类外部调用，不执行命令。',
  },
  {
    value: 'managed',
    label: '托管',
    description: '低危调用自动通过，高危调用显示审批卡片。',
  },
  {
    value: 'full',
    label: '完全权限',
    description: '自动放行执行权，但输出仍统一脱敏。',
  },
];

type CopyTarget = 'endpoint' | 'header' | 'token';

export interface McpSettingsViewProps {
  busy: boolean;
  onRegenerateToken: () => void;
  onRevokeToken: () => void;
  onSetMode: (mode: McpApprovalMode) => void;
  onSetPort: (port: number) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onUnshare: (sessionId: string) => void;
  shared: SharedMcpSession[];
  showToken: boolean;
  status: McpRuntimeStatus;
  settings: McpSettings;
  onToggleShowToken: () => void;
}

export interface GeneralSettingsViewProps {
  busy: boolean;
  onToggleHideProbeEcho: (hide: boolean) => void;
  settings: { hideCompletionProbeEcho: boolean };
}

export function GeneralSettingsView({
  busy,
  onToggleHideProbeEcho,
  settings,
}: GeneralSettingsViewProps): JSX.Element {
  return (
    <section
      aria-labelledby="general-settings-title"
      className="mcp-settings-card general-settings-card"
      data-testid="general-settings-section"
    >
      <div className="general-settings-copy">
        <div className="mcp-card-kicker">
          <EyeOff aria-hidden="true" size={14} /> 通用
        </div>
        <h2 id="general-settings-title">终端显示</h2>
        <p>
          调整本地终端 UI 的诊断显示。这个选项不会改变 PTY
          的实际输入，也不会改变外部调用的输出脱敏。
        </p>
      </div>
      <label className="mcp-switch-control general-settings-toggle">
        <input
          aria-label="隐藏自动 Probe 回显"
          checked={settings.hideCompletionProbeEcho}
          disabled={busy}
          onChange={(event) => onToggleHideProbeEcho(event.target.checked)}
          type="checkbox"
        />
        <span aria-hidden="true" className="mcp-switch-track">
          <span className="mcp-switch-thumb" />
        </span>
        <span className="mcp-switch-label">隐藏自动 Probe 回显</span>
      </label>
      <p className="general-settings-safety-note">
        仅控制本地终端 UI 是否显示 Synapse Term 自动 Probe 的回显。Probe 仍会写入当前
        PTY；关闭隐藏不会阻止目标 Shell、SSH 或远程服务器记录 Probe。
      </p>
    </section>
  );
}

function endpointFor(settings: McpSettings, status: McpRuntimeStatus): string {
  return status.connectionString ?? `http://127.0.0.1:${settings.port}/mcp`;
}

function maskedToken(token: string | undefined): string {
  if (token === undefined) return '未生成 Token';
  return '•'.repeat(Math.max(12, Math.min(28, token.length)));
}

function copyValue(
  value: string,
  target: CopyTarget,
  setCopied: (target: CopyTarget) => void,
): void {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined || value.length === 0) {
    return;
  }
  void navigator.clipboard
    .writeText(value)
    .then(() => setCopied(target))
    .catch(() => undefined);
}

function statusLabel(settings: McpSettings, status: McpRuntimeStatus): string {
  if (status.running) return '运行中';
  return settings.enabled ? '启动中或端口不可用' : '已停用';
}

export function McpSettingsView(props: McpSettingsViewProps): JSX.Element {
  const [portDraft, setPortDraft] = useState(String(props.settings.port));
  const [copied, setCopied] = useState<CopyTarget>();
  const endpoint = endpointFor(props.settings, props.status);
  const token = props.settings.token;
  const authorizationHeader = token === undefined ? '' : `Authorization: Bearer ${token}`;
  const displayedAuthorization =
    token === undefined
      ? '未生成 Token'
      : `Authorization: Bearer ${props.showToken ? token : maskedToken(token)}`;

  useEffect(() => {
    setPortDraft(String(props.settings.port));
  }, [props.settings.port]);

  useEffect(() => {
    if (copied === undefined) return;
    const timer = setTimeout(() => setCopied(undefined), 1_800);
    return () => clearTimeout(timer);
  }, [copied]);

  const commitPort = (): void => {
    const port = Number(portDraft);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setPortDraft(String(props.settings.port));
      return;
    }
    setPortDraft(String(port));
    if (port !== props.settings.port) props.onSetPort(port);
  };

  return (
    <div className="mcp-settings-page" data-testid="mcp-service-section">
      <section className="mcp-settings-hero" aria-labelledby="mcp-settings-title">
        <div className="mcp-settings-hero-copy">
          <div className="mcp-settings-hero-icon" aria-hidden="true">
            <Server size={22} />
          </div>
          <div>
            <p className="mcp-settings-eyebrow">LOCAL SERVICE / MCP</p>
            <h2 id="mcp-settings-title">MCP 服务</h2>
            <p className="mcp-settings-subtitle">
              让本机外部客户端安全操作已共享的 Terminal Session。
            </p>
          </div>
        </div>
        <div className={`mcp-runtime-pill ${props.status.running ? 'is-running' : 'is-stopped'}`}>
          <span aria-hidden="true" className="mcp-runtime-dot" />
          <span>运行状态：{statusLabel(props.settings, props.status)}</span>
        </div>
      </section>

      <div className="mcp-settings-grid">
        <section
          className="mcp-settings-card mcp-settings-card-wide"
          aria-labelledby="mcp-connection-title"
        >
          <div className="mcp-card-heading mcp-card-heading-split">
            <div>
              <div className="mcp-card-kicker">
                <Server aria-hidden="true" size={14} /> 连接配置
              </div>
              <h3 id="mcp-connection-title">内嵌 MCP Server</h3>
              <p>仅监听本机回环地址。端口固定保存，重启应用后仍保持不变。</p>
            </div>
            <label className="mcp-switch-control">
              <input
                aria-label="启用本机 MCP 端点"
                checked={props.settings.enabled}
                disabled={props.busy}
                onChange={(event) => props.onToggleEnabled(event.target.checked)}
                type="checkbox"
              />
              <span aria-hidden="true" className="mcp-switch-track">
                <span className="mcp-switch-thumb" />
              </span>
              <span className="mcp-switch-label">启用本机 MCP 端点</span>
            </label>
          </div>

          <div className="mcp-connection-grid">
            <div className="mcp-field mcp-field-wide">
              <label htmlFor="mcp-endpoint">服务地址</label>
              <div className="mcp-input-action-row">
                <input
                  aria-label="MCP 连接串"
                  className="mcp-readonly-input"
                  id="mcp-endpoint"
                  readOnly
                  value={endpoint}
                />
                <button
                  className="mcp-action-button"
                  disabled={!props.status.running}
                  onClick={() => copyValue(endpoint, 'endpoint', setCopied)}
                  type="button"
                >
                  {copied === 'endpoint' ? <Check size={15} /> : <Copy size={15} />}
                  {copied === 'endpoint' ? '已复制' : '复制连接串'}
                </button>
              </div>
              <p className="mcp-field-help">外部客户端连接到此 URL 的 `/mcp` 路径。</p>
            </div>

            <div className="mcp-field mcp-port-field">
              <label htmlFor="mcp-port">MCP 服务端口</label>
              <div className="mcp-port-input-wrap">
                <input
                  aria-label="MCP 服务端口"
                  className="mcp-number-input"
                  disabled={props.busy}
                  id="mcp-port"
                  inputMode="numeric"
                  max={65_535}
                  min={1}
                  onBlur={commitPort}
                  onChange={(event) => setPortDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitPort();
                    }
                  }}
                  type="number"
                  value={portDraft}
                />
                <span aria-hidden="true" className="mcp-port-suffix">
                  TCP
                </span>
              </div>
              <p className="mcp-field-help">1–65,535；修改后端点会重新启动。</p>
            </div>

            <div className="mcp-field mcp-field-wide">
              <div className="mcp-label-with-badge">
                <label>请求头</label>
                <span className="mcp-inline-code">Authorization</span>
              </div>
              <div className="mcp-secret-row">
                <code aria-label="Authorization 请求头" className="mcp-secret-value">
                  {displayedAuthorization}
                </code>
                <button
                  aria-label="复制 Authorization 请求头"
                  className="mcp-action-button"
                  disabled={!props.status.running || authorizationHeader.length === 0}
                  onClick={() => copyValue(authorizationHeader, 'header', setCopied)}
                  type="button"
                >
                  {copied === 'header' ? <Check size={15} /> : <Copy size={15} />}
                  {copied === 'header' ? '已复制' : '复制请求头'}
                </button>
              </div>
              <p className="mcp-field-help">
                外部客户端必须发送这个 HTTP 请求头；Token 不放进 URL、sessionId 或 command。
              </p>
            </div>
          </div>
        </section>

        <section className="mcp-settings-card" aria-labelledby="mcp-approval-title">
          <div className="mcp-card-heading">
            <div className="mcp-card-kicker">
              <ShieldCheck aria-hidden="true" size={14} /> 风险控制
            </div>
            <h3 id="mcp-approval-title">审批模式</h3>
            <p>决定外部调用何时自动通过，以及何时需要你的审批。</p>
          </div>
          <div aria-labelledby="mcp-approval-title" className="mcp-mode-options" role="radiogroup">
            {MODES.map((mode) => (
              <label
                className={`mcp-mode-option ${props.settings.approvalMode === mode.value ? 'is-selected' : ''}`}
                key={mode.value}
              >
                <input
                  aria-label={mode.label}
                  checked={props.settings.approvalMode === mode.value}
                  disabled={props.busy}
                  name="approval-mode"
                  onChange={() => props.onSetMode(mode.value)}
                  type="radio"
                  value={mode.value}
                />
                <span className="mcp-mode-radio" aria-hidden="true" />
                <span className="mcp-mode-copy">
                  <span className="mcp-mode-title">{mode.label}</span>
                  <span className="mcp-mode-description">{mode.description}</span>
                </span>
                {props.settings.approvalMode === mode.value && (
                  <Check aria-hidden="true" className="mcp-mode-check" size={16} />
                )}
              </label>
            ))}
          </div>
          {props.settings.approvalMode === 'full' && (
            <p className="mcp-warning" role="note">
              <AlertTriangle aria-hidden="true" size={16} />
              <span>
                完全权限会自动执行高风险命令，仅建议在可恢复的隔离环境中使用。输出仍会经过脱敏。
              </span>
            </p>
          )}
        </section>

        <section className="mcp-settings-card" aria-labelledby="mcp-token-title">
          <div className="mcp-card-heading">
            <div className="mcp-card-kicker">
              <KeyRound aria-hidden="true" size={14} /> 身份验证
            </div>
            <h3 id="mcp-token-title">访问 Token</h3>
            <p>Token 会作为 MCP 服务的 `Authorization: Bearer …` 请求头使用。</p>
          </div>
          <div className="mcp-token-display">
            <code className={token === undefined ? 'is-empty' : ''}>
              {props.showToken ? (token ?? '未生成 Token') : maskedToken(token)}
            </code>
            <button
              aria-label={props.showToken ? '隐藏 Token' : '显示 Token'}
              className="mcp-icon-button"
              onClick={props.onToggleShowToken}
              type="button"
            >
              {props.showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="mcp-token-actions">
            <button
              className="mcp-action-button"
              disabled={token === undefined}
              onClick={() => copyValue(token ?? '', 'token', setCopied)}
              type="button"
            >
              {copied === 'token' ? <Check size={15} /> : <Copy size={15} />}
              {copied === 'token' ? '已复制' : '复制 Token'}
            </button>
            <button
              className="mcp-action-button"
              disabled={props.busy}
              onClick={props.onRegenerateToken}
              type="button"
            >
              <RefreshCw size={15} /> 生成新 Token
            </button>
            <button
              className="mcp-action-button is-danger"
              disabled={props.busy || token === undefined}
              onClick={props.onRevokeToken}
              type="button"
            >
              <Trash2 size={15} /> 吊销
            </button>
          </div>
        </section>

        <section
          className="mcp-settings-card mcp-settings-card-wide"
          aria-labelledby="mcp-shared-title"
        >
          <div className="mcp-card-heading mcp-shared-heading">
            <div>
              <div className="mcp-card-kicker">
                <CircleCheck aria-hidden="true" size={14} /> Sharing
              </div>
              <h3 id="mcp-shared-title">已共享 Session</h3>
              <p>只有列在这里的 Session 才能被外部客户端寻址；取消共享会立即失效。</p>
            </div>
            <span className="mcp-count-badge">{props.shared.length}</span>
          </div>
          {props.shared.length === 0 ? (
            <div className="mcp-empty-state">
              <span className="mcp-empty-icon" aria-hidden="true">
                <Server size={17} />
              </span>
              <div>
                <strong>暂无共享 Session</strong>
                <p>在终端标签上打开会话操作菜单，选择“共享到 MCP”。</p>
              </div>
            </div>
          ) : (
            <ul className="mcp-shared-list">
              {props.shared.map((session) => (
                <li className="mcp-shared-row" key={session.id}>
                  <span className="mcp-shared-status-dot" aria-hidden="true" />
                  <div className="mcp-shared-identity">
                    <strong>{session.title}</strong>
                    <code>{session.id}</code>
                  </div>
                  <time dateTime={session.sharedAt}>
                    {new Date(session.sharedAt).toLocaleString()}
                  </time>
                  <button
                    className="mcp-action-button is-danger is-compact"
                    onClick={() => props.onUnshare(session.id)}
                    type="button"
                  >
                    取消共享
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
