/** Toast 轻提示 React Provider 与 useToast 入口 */
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

import { createToastStore, type ToastMessage } from './toast-store.js';

export interface ToastApi {
  success(text: string): void;
  error(text: string): void;
  info(text: string): void;
  dismiss(id: string): void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const store = useMemo(createToastStore, []);
  const messages = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => store.push('success', text),
      error: (text) => store.push('error', text),
      info: (text) => store.push('info', text),
      dismiss: (id) => store.dismiss(id),
    }),
    [store],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-label="操作提示"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2"
      >
        {messages.map((message) => (
          <ToastCard key={message.id} message={message} onDismiss={api.dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === undefined) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return api;
}

function ToastCard({
  message,
  onDismiss,
}: {
  message: ToastMessage;
  onDismiss: (id: string) => void;
}): JSX.Element {
  const Icon =
    message.kind === 'error' ? XCircle : message.kind === 'success' ? CheckCircle2 : Info;
  const toneClass =
    message.kind === 'error'
      ? 'border-red-500/40 bg-red-500/10 text-red-300'
      : message.kind === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
        : 'border-border bg-[#18181b] text-foreground';
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs shadow-2xl backdrop-blur-md ${toneClass}`}
      role={message.kind === 'error' ? 'alert' : 'status'}
    >
      <Icon className="mt-0.5 shrink-0" size={14} />
      <span className="flex-1 leading-relaxed">{message.text}</span>
      <button
        aria-label="关闭提示"
        className="shrink-0 opacity-70 hover:opacity-100"
        onClick={() => onDismiss(message.id)}
        type="button"
      >
        <X size={13} />
      </button>
    </div>
  );
}
