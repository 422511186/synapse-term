import { describe, expect, it } from 'vitest';

import { RISK_REASON_CODES, renderRiskReasonEn, type RiskReason } from './risk-reasons.js';

/**
 * 今天 `policy-engine.ts:103-213` 与 `external-tool-pipeline.ts:971` 产生的字面量，逐字对照。
 *
 * 这份表是本次改动「对外工具响应逐字不变」的对照基准：每一条都必须与收敛前的字面量完全相同，
 * 包括 `has destructive semantics` 与 `has destructive system semantics` 之间刻意保留的措辞不一致。
 */
const TODAYS_LITERALS: ReadonlyArray<readonly [RiskReason, string]> = [
  [{ code: 'empty-command' }, 'empty command'],
  [{ code: 'command-substitution-unproven' }, 'command substitution is not proven safe'],
  [{ code: 'privilege-escalation' }, 'command requests privilege escalation'],
  [{ code: 'redirection-changes-filesystem' }, 'redirection can change filesystem state'],
  [{ code: 'read-only-rules-matched' }, 'all commands match read-only rules'],
  [
    { code: 'dynamic-shell-structure' },
    'scripts, aliases, or dynamic shell structure cannot be fully expanded safely',
  ],
  [
    { code: 'destructive-command', subject: 'remove-item' },
    'remove-item has destructive semantics',
  ],
  // 引擎里同一模板出现在两处：PowerShell 的 mutating 分支与 POSIX 的 mutating 分支。
  [
    { code: 'state-changing-command', subject: 'set-content' },
    'set-content can change system state',
  ],
  [{ code: 'state-changing-command', subject: 'touch' }, 'touch can change system state'],
  [
    { code: 'unknown-powershell-executable', subject: 'get-widget' },
    'unknown PowerShell executable: get-widget',
  ],
  [{ code: 'sysctl-kernel-state' }, 'sysctl write options can change kernel state'],
  [{ code: 'sort-output-file' }, 'sort can change filesystem state with -o/--output'],
  [
    { code: 'irreversible-destructive-command', subject: 'rm' },
    'rm has irreversible destructive semantics',
  ],
  [{ code: 'destructive-system-command', subject: 'dd' }, 'dd has destructive system semantics'],
  [{ code: 'unknown-executable', subject: 'frobnicate' }, 'unknown executable: frobnicate'],
  [{ code: 'free-input-writes-to-pty' }, 'free input writes directly to the current PTY'],
];

describe('renderRiskReasonEn', () => {
  it('renders every baseline literal exactly as today', () => {
    for (const [reason, expected] of TODAYS_LITERALS) {
      expect(renderRiskReasonEn(reason), JSON.stringify(reason)).toBe(expected);
    }
  });

  it('keeps the vocabulary and the baseline table covering the same codes', () => {
    const baseline = new Set(TODAYS_LITERALS.map(([reason]) => reason.code));

    expect(RISK_REASON_CODES, 'vocabulary must not repeat a code').toHaveLength(
      new Set(RISK_REASON_CODES).size,
    );
    expect([...baseline].sort()).toEqual([...RISK_REASON_CODES].sort());
  });
});
