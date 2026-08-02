/** 模型列表操作纯逻辑：乐观更新与耗时格式化 */
import type { ModelConfigurationView } from '../../preload/preload-api.js';

export function optimisticSetEnabled(
  models: ModelConfigurationView[],
  id: string,
  enabled: boolean,
): { next: ModelConfigurationView[]; previous: ModelConfigurationView | undefined } {
  const previous = models.find((model) => model.id === id);
  if (previous === undefined) return { next: models, previous };
  return {
    next: models.map((model) => (model.id === id ? { ...model, enabled } : model)),
    previous,
  };
}

export function formatTestDuration(elapsedMs: number): string {
  return `${Math.max(0.1, Math.round(elapsedMs / 100) / 10).toFixed(1)}s`;
}

export function modelTestOutcome(
  view: ModelConfigurationView,
): { ok: true; message: string } | { ok: false; message: string } {
  if (view.status === 'available') return { ok: true, message: '' };
  const reason = view.validation.status === 'unavailable' ? view.validation.reason : '未通过校验';
  return { ok: false, message: `模型不可用：${reason}` };
}
