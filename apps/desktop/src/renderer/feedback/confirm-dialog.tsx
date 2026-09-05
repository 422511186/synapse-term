/** 统一确认对话框：破坏性操作先确认，确认按钮 pending 与防连点 */
import { type JSX } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { PendingButton } from './pending-button.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => Promise<unknown> | unknown;
  onCancel: () => void;
  pending?: boolean;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  onConfirm,
  onCancel,
  pending = false,
  danger = true,
}: ConfirmDialogProps): JSX.Element | null {
  if (!open) return null;

  const dialog = (
    <div
      aria-label="操作确认"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="alertdialog"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/50 bg-background px-4 py-3 rounded-t-xl">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            aria-label="关闭确认对话框"
            className="text-muted-foreground hover:text-foreground"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-4 text-[13px] leading-relaxed text-foreground/90">
          {description}
        </div>
        <div className="flex justify-end gap-2 rounded-b-xl border-t border-border bg-background px-4 py-3">
          <button
            className="px-3 py-1.5 text-xs font-medium hover:bg-secondary rounded-lg transition-colors disabled:opacity-40"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <PendingButton
            busyLabel="处理中…"
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 ${
              danger
                ? 'bg-destructive text-foreground hover:bg-destructive/90'
                : 'bg-white text-black hover:bg-white/90'
            }`}
            onClick={onConfirm}
            pending={pending}
            type="button"
          >
            {confirmLabel}
          </PendingButton>
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
