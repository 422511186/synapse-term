import type {
  RiskReason,
  SubjectlessRiskReasonCode,
  SubjectRiskReasonCode,
} from '../../shared/contracts.js';

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

/**
 * 风险分类理由的本地文案，与 `mcp-runtime` 的英文表同构：两张表各自被 `Record<…>` 约束穷尽，
 * 新增一个 code 而不写文案会是编译错误，因此不会再出现「卡片上悄悄显示英文」。
 */
const subjectlessRiskReasonText = {
  'empty-command': '命令为空',
  'command-substitution-unproven': '命令替换存在不确定性',
  'privilege-escalation': '命令请求提升权限',
  'redirection-changes-filesystem': '重定向可能修改文件系统',
  'read-only-rules-matched': '所有命令均匹配只读规则',
  'dynamic-shell-structure': '脚本、别名或动态 shell 结构无法被完整安全地展开',
  'sysctl-kernel-state': 'sysctl 写选项可能更改内核状态',
  'sort-output-file': 'sort 的 -o/--output 可能修改文件系统',
  'free-input-writes-to-pty': '自由输入直接写入当前 PTY',
} satisfies Record<SubjectlessRiskReasonCode, string>;

const subjectRiskReasonText = {
  'unknown-executable': (subject: string) => `未知可执行文件：${subject}`,
  // PowerShell 变体今天也渲染成同一句中文（正则把方言当成可选词丢掉），保持逐字相同。
  'unknown-powershell-executable': (subject: string) => `未知可执行文件：${subject}`,
  'destructive-command': (subject: string) => `${subject} 具有破坏性语义`,
  // 同理：正则把 irreversible 当成可选词丢掉，这条的中文与上一条相同。
  'irreversible-destructive-command': (subject: string) => `${subject} 具有破坏性语义`,
  'destructive-system-command': (subject: string) => `${subject} 具有破坏性系统语义`,
  'state-changing-command': (subject: string) => `${subject} 可能更改系统状态`,
} satisfies Record<SubjectRiskReasonCode, (subject: string) => string>;

export function riskReasonZh(reason: RiskReason): string {
  return 'subject' in reason
    ? subjectRiskReasonText[reason.code](reason.subject)
    : subjectlessRiskReasonText[reason.code];
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
