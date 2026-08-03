/** 异步操作按钮：待命/进行中/成功三态 + 防连点 */
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { Check, Loader2 } from 'lucide-react';

export interface PendingButtonProps {
  onClick: () => Promise<unknown> | unknown;
  children: ReactNode;
  busyLabel?: string;
  successLabel?: string;
  successDurationMs?: number;
  disabled?: boolean;
  /** 受控进行中态（如列表行级共享 pending） */
  pending?: boolean;
  /** 受控成功态 */
  success?: boolean;
  onError?: (error: unknown) => void;
  className?: string;
  'aria-label'?: string;
  title?: string;
  type?: 'button' | 'submit';
}

export function PendingButton({
  onClick,
  children,
  busyLabel,
  successLabel,
  successDurationMs = 1_500,
  disabled = false,
  pending,
  success,
  onError,
  className,
  type = 'button',
  ...rest
}: PendingButtonProps): JSX.Element {
  const [internalPhase, setInternalPhase] = useState<'idle' | 'busy' | 'success'>('idle');
  const revertTimer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (revertTimer.current !== undefined) {
        globalThis.clearTimeout(revertTimer.current);
      }
    },
    [],
  );

  const busy = pending ?? internalPhase === 'busy';
  const showSuccess = success ?? internalPhase === 'success';

  const handleClick = (): void => {
    if (busy || disabled) return;
    setInternalPhase('busy');
    // 用 Promise.resolve().then(...) 而非 Promise.resolve(onClick())：
    // 后者会在 .then 链接管前先求值 onClick()，若 onClick 同步抛出，异常逃逸出 .catch。
    void Promise.resolve()
      .then(() => onClick())
      .then(() => {
        setInternalPhase('success');
        revertTimer.current = globalThis.setTimeout(() => {
          setInternalPhase('idle');
        }, successDurationMs);
      })
      .catch((error: unknown) => {
        setInternalPhase('idle');
        onError?.(error);
      });
  };

  const label = busy
    ? (busyLabel ?? children)
    : showSuccess
      ? (successLabel ?? children)
      : children;

  return (
    <button
      aria-busy={busy}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${className ?? ''}`}
      disabled={busy || disabled}
      onClick={handleClick}
      type={type}
      {...rest}
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {busy ? (
          <Loader2 className="animate-spin shrink-0" size={14} />
        ) : showSuccess ? (
          <Check className="shrink-0" size={14} />
        ) : null}
        {label}
      </span>
    </button>
  );
}
