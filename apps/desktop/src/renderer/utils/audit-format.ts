/** 审计时间格式化（自 app.tsx 拆分） */

export function formatAuditTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}
