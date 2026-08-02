/** 时间线展示工具函数（自 app.tsx 拆分，纯函数便于复用与测试） */

export function parseToolCallSummary(
  text: string,
): { name: string; command?: string; arguments?: string } | undefined {
  const newline = text.indexOf('\n');
  if (newline < 1) return undefined;
  const name = text.slice(0, newline).trim();
  const argumentsText = text.slice(newline + 1).trim();
  try {
    const argumentsValue: unknown = JSON.parse(argumentsText);
    const command =
      typeof argumentsValue === 'object' && argumentsValue !== null
        ? (argumentsValue as { command?: unknown }).command
        : undefined;
    return {
      name,
      ...(typeof command === 'string' ? { command } : {}),
      ...(typeof command === 'string' ? {} : { arguments: argumentsText }),
    };
  } catch {
    return { name, arguments: argumentsText };
  }
}
export function formatToolResult(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
export function timelineStatusLabel(status: string | undefined): string {
  if (
    status === 'completed' ||
    status === 'succeeded' ||
    status === 'success' ||
    status === 'done'
  ) {
    return '已完成';
  }
  if (
    status === 'failed' ||
    status === 'fatal_error' ||
    status === 'recoverable_error' ||
    status === 'shell_lost' ||
    status === 'protocol_error'
  ) {
    return '失败';
  }
  if (status === 'cancelled') return '已取消';
  if (status === 'interrupted') return '已中断';
  if (status === 'waiting_user' || status === 'interaction_required') return '等待接管';
  return '进行中';
}
