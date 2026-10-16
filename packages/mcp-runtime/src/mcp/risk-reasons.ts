/**
 * 风险分类理由的词汇表。
 *
 * 理由以 `code`（＋ 需要指名触发规则的可执行文件时的 `subject`）这一结构化结论穿过 seam：
 * 对外的 MCP 工具响应在证据边界上由 `renderRiskReasonEn` 渲染成英文散文，本机审批卡片按
 * `code` 查本地文案。两侧都不再解析字符串。
 *
 * 两份 code 清单是唯一来源：联合类型、渲染表与展示层映射都从它们派生，因此新增一条规则时，
 * 少写任何一处文案都会是编译错误。
 */

/** 不携带参数的理由 code。 */
const SUBJECTLESS_RISK_REASON_CODES = [
  'empty-command',
  'command-substitution-unproven',
  'privilege-escalation',
  'redirection-changes-filesystem',
  'read-only-rules-matched',
  'dynamic-shell-structure',
  'sysctl-kernel-state',
  'sort-output-file',
  'free-input-writes-to-pty',
] as const;

/** 需要指名触发规则的可执行文件名的理由 code。 */
const SUBJECT_RISK_REASON_CODES = [
  'destructive-command',
  'state-changing-command',
  'unknown-powershell-executable',
  'irreversible-destructive-command',
  'destructive-system-command',
  'unknown-executable',
] as const;

export type SubjectlessRiskReasonCode = (typeof SUBJECTLESS_RISK_REASON_CODES)[number];

export type SubjectRiskReasonCode = (typeof SUBJECT_RISK_REASON_CODES)[number];

/** 全部理由 code；供展示层与测试遍历。 */
export const RISK_REASON_CODES = [
  ...SUBJECTLESS_RISK_REASON_CODES,
  ...SUBJECT_RISK_REASON_CODES,
] as const;

export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];

export type SubjectlessRiskReason = {
  readonly code: SubjectlessRiskReasonCode;
};

export type SubjectRiskReason = {
  readonly code: SubjectRiskReasonCode;
  /** 触发该规则的可执行文件名，例如 `remove-item`、`dd`、`rm`。 */
  readonly subject: string;
};

export type RiskReason = SubjectlessRiskReason | SubjectRiskReason;

const SUBJECTLESS_TEXT: Readonly<Record<SubjectlessRiskReasonCode, string>> = {
  'empty-command': 'empty command',
  'command-substitution-unproven': 'command substitution is not proven safe',
  'privilege-escalation': 'command requests privilege escalation',
  'redirection-changes-filesystem': 'redirection can change filesystem state',
  'read-only-rules-matched': 'all commands match read-only rules',
  'dynamic-shell-structure':
    'scripts, aliases, or dynamic shell structure cannot be fully expanded safely',
  'sysctl-kernel-state': 'sysctl write options can change kernel state',
  'sort-output-file': 'sort can change filesystem state with -o/--output',
  'free-input-writes-to-pty': 'free input writes directly to the current PTY',
};

const SUBJECT_TEXT: Readonly<Record<SubjectRiskReasonCode, (subject: string) => string>> = {
  'destructive-command': (subject) => `${subject} has destructive semantics`,
  'state-changing-command': (subject) => `${subject} can change system state`,
  'unknown-powershell-executable': (subject) => `unknown PowerShell executable: ${subject}`,
  'irreversible-destructive-command': (subject) =>
    `${subject} has irreversible destructive semantics`,
  'destructive-system-command': (subject) => `${subject} has destructive system semantics`,
  'unknown-executable': (subject) => `unknown executable: ${subject}`,
};

/**
 * 渲染对外的英文理由。这些字符串与收敛前 `policy-engine.ts` 和 `external-tool-pipeline.ts`
 * 里手写的字面量逐字相同，包括 `has destructive semantics` 与 `has destructive system
 * semantics` 之间刻意保留的措辞不一致——措辞统一是另一条需要 delta spec 的改动。
 */
export function renderRiskReasonEn(reason: RiskReason): string {
  if ('subject' in reason) return SUBJECT_TEXT[reason.code](reason.subject);
  return SUBJECTLESS_TEXT[reason.code];
}
