/** Toast 轻提示纯状态存储（可脱离 React 测试） */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  kind: ToastKind;
  text: string;
}

export interface ToastStoreOptions {
  maxVisible?: number;
  successDurationMs?: number;
  createId?: () => string;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface ToastStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ToastMessage[];
  push(kind: ToastKind, text: string): void;
  dismiss(id: string): void;
}

const DEFAULT_MAX_VISIBLE = 3;
const DEFAULT_SUCCESS_DURATION_MS = 3_000;

export function createToastStore(options: ToastStoreOptions = {}): ToastStore {
  const maxVisible = options.maxVisible ?? DEFAULT_MAX_VISIBLE;
  const successDurationMs = options.successDurationMs ?? DEFAULT_SUCCESS_DURATION_MS;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs: number): unknown => globalThis.setTimeout(callback, delayMs));
  const cancel =
    options.cancel ??
    ((handle: unknown): void => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    });

  let messages: ToastMessage[] = [];
  const timers = new Map<string, unknown>();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const clearTimer = (id: string): void => {
    const handle = timers.get(id);
    if (handle === undefined) return;
    cancel(handle);
    timers.delete(id);
  };

  const dismiss = (id: string): void => {
    if (!messages.some((message) => message.id === id)) return;
    clearTimer(id);
    messages = messages.filter((message) => message.id !== id);
    emit();
  };

  const scheduleDismiss = (id: string): void => {
    clearTimer(id);
    timers.set(
      id,
      schedule(() => dismiss(id), successDurationMs),
    );
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => messages,
    push(kind: ToastKind, text: string): void {
      const existing = messages.find((message) => message.kind === kind && message.text === text);
      if (existing !== undefined) {
        // 同类同文案合并：刷新自动消失计时，不重复渲染
        if (kind === 'success') scheduleDismiss(existing.id);
        return;
      }
      const id = createId();
      const next = [...messages, { id, kind, text }];
      while (next.length > maxVisible) {
        const dropped = next.shift();
        if (dropped !== undefined) clearTimer(dropped.id);
      }
      messages = next;
      if (kind === 'success') scheduleDismiss(id);
      emit();
    },
    dismiss,
  };
}
