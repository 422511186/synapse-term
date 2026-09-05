import { Download, ExternalLink, RefreshCw, RotateCw, X } from 'lucide-react';
import { useRef, useState, type JSX } from 'react';

import {
  RELEASES_URL,
  type InstallationImpact,
  type UpdateApi,
  type UpdateState,
} from '../../shared/update-contracts.js';
import { ConfirmDialog } from '../feedback/confirm-dialog.js';
import { useUpdateState } from './use-update-state.js';
import './update-settings.css';

function statusText(state: UpdateState): string {
  switch (state.phase) {
    case 'idle':
      return state.lastCheckedAt ? '已是最新版本' : '尚未检查更新';
    case 'checking':
      return '正在检查更新';
    case 'available':
      return `新版本 ${state.candidate?.version ?? ''} 可用`;
    case 'downloading':
      return state.progress === null ? '正在下载更新' : `正在下载 ${Math.floor(state.progress)}%`;
    case 'verifying':
      return '正在校验更新包';
    case 'ready':
      return '更新包已校验，可以安装';
    case 'installing':
      return '正在安装，请完成系统授权';
    case 'error':
      return state.error?.message ?? '更新失败';
    case 'unsupported':
      return state.unsupportedReason ?? '当前环境不支持应用内更新';
  }
}

export function UpdateSettings({
  api,
  isMac = false,
}: {
  api: UpdateApi;
  isMac?: boolean;
}): JSX.Element {
  const { state, error, setError } = useUpdateState(api);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [impact, setImpact] = useState<InstallationImpact | null>(null);
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : '更新操作失败，请重试');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const working =
    state && ['checking', 'downloading', 'verifying', 'installing'].includes(state.phase);
  const canInstall = state?.phase === 'ready' || state?.error?.stage === 'prepare';
  const canDownload =
    state?.candidate &&
    (state.phase === 'available' ||
      (state.phase === 'error' &&
        ['download', 'verify', 'prepare'].includes(state.error?.stage ?? '')));
  return (
    <section aria-labelledby="application-update-title" className="update-settings">
      <div className="update-heading">
        <div>
          <h2 id="application-update-title">软件更新</h2>
          <p>Synapse Term{state ? ` ${state.currentVersion}` : ''}</p>
        </div>
        {state && (
          <label className="mcp-switch-control">
            <input
              aria-label="自动检查更新"
              type="checkbox"
              checked={state.automaticChecks}
              disabled={busy || state.phase === 'unsupported' || state.phase === 'installing'}
              onChange={(event) => void run(() => api.setAutomaticChecks(event.target.checked))}
            />
            <span aria-hidden="true" className="mcp-switch-track">
              <span className="mcp-switch-thumb" />
            </span>
            <span className="mcp-switch-label">自动检查更新</span>
          </label>
        )}
      </div>
      <p role="status" aria-live="polite" className="update-status">
        {state ? statusText(state) : (error ?? '正在读取更新状态')}
      </p>
      {error && state && (
        <p role="alert" className="update-error">
          {error}
        </p>
      )}
      {state?.lastCheckedAt && (
        <p className="update-checked-at">
          上次检查：
          <time dateTime={state.lastCheckedAt}>
            {new Date(state.lastCheckedAt).toLocaleString()}
          </time>
        </p>
      )}
      {state && ['downloading', 'verifying'].includes(state.phase) && (
        <progress aria-label="更新下载进度" max={100} value={state.progress ?? undefined} />
      )}
      <div className="update-actions">
        {state &&
          !working &&
          state.phase !== 'unsupported' &&
          state.phase !== 'ready' &&
          state.error?.stage !== 'install' && (
            <button
              type="button"
              className="mcp-action-button"
              disabled={busy}
              onClick={() => void run(() => api.check())}
            >
              <RefreshCw size={15} aria-hidden="true" />
              {state.error?.stage === 'check' ? '重试检查' : '检查更新'}
            </button>
          )}
        {canDownload && (
          <button
            type="button"
            className="mcp-action-button"
            disabled={busy}
            onClick={() => void run(() => api.download(state.candidate!.id))}
          >
            <Download size={15} aria-hidden="true" />
            {state.phase === 'error' ? '重新下载' : '下载更新'}
          </button>
        )}
        {state && ['downloading', 'verifying'].includes(state.phase) && (
          <button
            type="button"
            className="mcp-action-button"
            onClick={() => void api.cancel().catch(() => setError('取消下载失败'))}
          >
            <X size={15} aria-hidden="true" />
            取消下载
          </button>
        )}
        {canInstall && state?.candidate && (
          <button
            type="button"
            className="mcp-action-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setImpact(await api.getInstallImpact(state.candidate!.id));
              })
            }
          >
            <RotateCw size={15} aria-hidden="true" />
            重启并更新
          </button>
        )}
        <a className="update-release-link" href={RELEASES_URL} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden="true" />
          GitHub Releases
        </a>
      </div>
      {state?.candidate?.releaseNotes && (
        <details className="update-release-notes">
          <summary>{state.candidate.version} 发布说明</summary>
          <pre>{state.candidate.releaseNotes}</pre>
        </details>
      )}
      {isMac && (
        <p className="update-checked-at">
          当前发行版没有 Apple Developer ID 签名和公证，安装可能需要系统授权。
        </p>
      )}
      <ConfirmDialog
        open={impact !== null}
        title={`安装 Synapse Term ${impact?.version ?? ''}`}
        description={`更新将结束当前 ${impact?.sessionCount ?? 0} 个 Session，并重新启动应用。已结束的 Session 无法恢复。${isMac ? '安装阶段仍需联网下载，并可能需要系统授权。' : ''}`}
        confirmLabel="结束 Session 并更新"
        onCancel={() => setImpact(null)}
        pending={busy}
        onConfirm={async () => {
          if (!impact) return;
          const confirmed = impact;
          setImpact(null);
          await run(() => api.install(confirmed.candidateId, confirmed.confirmationId));
        }}
      />
    </section>
  );
}
