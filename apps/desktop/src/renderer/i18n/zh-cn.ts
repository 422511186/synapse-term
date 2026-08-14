const ptyStatuses: Record<string, string> = {
  starting: '启动中',
  running: '运行中',
  exited: '已退出',
  failed: '失败',
  interrupted: '已中断',
};

export function sessionPtyStatusZh(status: string): string {
  return ptyStatuses[status] ?? status;
}

export function errorMessageZh(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, '');
  const exact: Record<string, string> = {
    'Working directory does not exist': '工作目录不存在',
    'Session not found': '未找到该终端会话',
    'Session is not running': '终端会话未在运行',
    'active Session limit reached': '已达到活动会话数量上限',
  };
  return exact[message] ?? message;
}
