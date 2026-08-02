/** 异步操作防连点核心（leading-edge lock，可脱离 React 测试） */

export interface AsyncActionHooks<T> {
  onSuccess?: (result: T) => void;
  onError?: (error: unknown) => void;
}

export interface AsyncActionRunner {
  readonly pending: boolean;
  run<T>(action: () => Promise<T> | T, hooks?: AsyncActionHooks<T>): Promise<T | undefined>;
}

export function createAsyncAction(): AsyncActionRunner {
  let pending = false;
  return {
    get pending(): boolean {
      return pending;
    },
    async run<T>(
      action: () => Promise<T> | T,
      hooks?: AsyncActionHooks<T>,
    ): Promise<T | undefined> {
      if (pending) return undefined;
      pending = true;
      try {
        const result = await action();
        hooks?.onSuccess?.(result);
        return result;
      } catch (error) {
        hooks?.onError?.(error);
        return undefined;
      } finally {
        pending = false;
      }
    },
  };
}
