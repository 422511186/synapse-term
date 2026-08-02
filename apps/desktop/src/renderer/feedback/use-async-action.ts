/** React 侧 useAsyncAction：包装防连点核心并暴露响应式 pending */
import { useCallback, useMemo, useState } from 'react';

import { createAsyncAction, type AsyncActionHooks } from './async-action.js';

export interface UseAsyncActionResult {
  readonly pending: boolean;
  run<T>(action: () => Promise<T> | T, hooks?: AsyncActionHooks<T>): Promise<T | undefined>;
}

export function useAsyncAction(): UseAsyncActionResult {
  const core = useMemo(createAsyncAction, []);
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <T>(
      action: () => Promise<T> | T,
      hooks?: AsyncActionHooks<T>,
    ): Promise<T | undefined> => {
      if (core.pending) return undefined;
      setPending(true);
      try {
        return await core.run(action, hooks);
      } finally {
        setPending(false);
      }
    },
    [core],
  );

  return { pending, run };
}
