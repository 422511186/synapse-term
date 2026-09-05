import { useEffect, useState } from 'react';

import type { UpdateApi, UpdateState } from '../../shared/update-contracts.js';

export function useUpdateState(api: UpdateApi | undefined) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!api) return;
    let alive = true;
    let receivedEvent = false;
    const unsubscribe = api.onChanged((next) => {
      receivedEvent = true;
      setState(next);
    });
    void api
      .getState()
      .then((next) => {
        if (alive && !receivedEvent) setState(next);
      })
      .catch(() => {
        if (alive) setError('无法读取更新状态');
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [api]);
  return { state, error, setError };
}
