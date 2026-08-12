export interface ContextBudget {
  inputTokens: number;
  /**
   * 单阈值压缩触发点（向后兼容：等于 preflightTokens 的历史语义）。
   * 新代码 MUST 优先使用 proactiveTokens / preflightTokens 三闸门阈值。
   */
  compactAtTokens: number;
  compactTargetTokens: number;
  reservedOutputTokens: number;
  reservedToolTokens: number;
  /** Proactive 闸门：估算达 inputTokens × 0.90 触发压缩（Ch35）。 */
  proactiveTokens: number;
  /** Preflight 闸门：发送前达 inputTokens × 0.95 触发压缩（Ch35）。 */
  preflightTokens: number;
  /** Reactive 闸门：命中 context_length_exceeded 后触发（never-reset 标志，阶段 2 落地）。 */
  reactiveOnOverflow: boolean;
}

export interface ContextWindowConfig {
  contextWindowTokens: number;
  maxOutputTokens: number;
  compactThresholdPercent: number;
}

/**
 * 从模型配置派生上下文预算（含 Ch35 三闸门阈值）。
 *
 - reservedOutputTokens：为模型输出预留的 token（不进输入预算）。
 - reservedToolTokens：为工具调用结构预留的头空间（封顶 4096，或上下文窗口 10%）。
 - inputTokens：上下文窗口扣除输出与工具头之后的可用输入预算（< 128 直接拒绝）。
 - proactiveTokens / preflightTokens：Ch35 三闸门，分别取 inputTokens 的 0.90 / 0.95。
 - compactAtTokens：保留单阈值语义（= preflightTokens），供未迁移到三闸门的过渡路径使用。
 */
export function calculateContextBudget(profile: ContextWindowConfig): ContextBudget {
  const reservedOutputTokens = profile.maxOutputTokens;
  const reservedToolTokens = Math.min(4_096, Math.floor(profile.contextWindowTokens * 0.1));
  const inputTokens = profile.contextWindowTokens - reservedOutputTokens - reservedToolTokens;
  if (inputTokens < 128) throw new RangeError('Model context window leaves no usable input budget');
  const proactiveTokens = Math.floor(inputTokens * 0.9);
  const preflightTokens = Math.floor(inputTokens * 0.95);
  return {
    inputTokens,
    compactAtTokens: Math.floor((inputTokens * profile.compactThresholdPercent) / 100),
    compactTargetTokens: Math.floor(inputTokens * 0.6),
    reservedOutputTokens,
    reservedToolTokens,
    proactiveTokens,
    preflightTokens,
    // Reactive 闸门在阶段 2 重构 #run() 为可重试结构后挂钩；阶段 1 预埋标志位。
    reactiveOnOverflow: true,
  };
}
