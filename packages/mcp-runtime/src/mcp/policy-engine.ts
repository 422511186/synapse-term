import type { CommandRisk } from '@synapse-term/domain';

import type { RiskReason } from './risk-reasons.js';

export interface PolicyDecision {
  level: CommandRisk;
  risk: CommandRisk;
  confidence: 'high' | 'medium' | 'low';
  reasons: readonly RiskReason[];
  requiresConfirmation: boolean;
}

export interface PolicyHints {
  terminalType?: string | undefined;
}

const POSIX_READ_ONLY = new Set([
  '[',
  'cat',
  'cut',
  'date',
  'df',
  'diff',
  'du',
  'echo',
  'env',
  'false',
  'find',
  'free',
  'grep',
  'head',
  'hostname',
  'id',
  'ls',
  'printf',
  'ps',
  'pwd',
  'rg',
  'sed',
  'sort',
  'stat',
  'tail',
  'test',
  'true',
  'uname',
  'vm_stat',
  'whoami',
]);

const POSIX_MUTATING = new Set([
  'chmod',
  'chown',
  'cp',
  'kill',
  'mkdir',
  'mv',
  'npm',
  'pnpm',
  'touch',
  'truncate',
  'yarn',
]);

const POWERSHELL_READ_ONLY = new Set([
  'convertfrom-json',
  'convertto-json',
  'get-childitem',
  'get-content',
  'get-location',
  'get-process',
  'out-string',
  'select-object',
  'sort-object',
  'where-object',
  'write-output',
]);

const POWERSHELL_MUTATING = new Set([
  'copy-item',
  'move-item',
  'new-item',
  'set-content',
  'set-location',
  'start-process',
]);

const POSIX_CONTROL_KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'fi']);

function higherRisk(left: CommandRisk, right: CommandRisk): CommandRisk {
  const order: CommandRisk[] = ['read_only', 'unknown', 'mutating', 'privileged', 'destructive'];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

export class PolicyEngine {
  classify(command: string, hints: PolicyHints = {}): Promise<PolicyDecision> {
    if (command.trim().length === 0) {
      return Promise.resolve(decision('unknown', 'low', [{ code: 'empty-command' }]));
    }
    if (/[$(`]|\b(?:sudo|doas)\b/.test(command)) {
      const dynamic = /\$|`/.test(command);
      return Promise.resolve(
        decision(
          dynamic ? 'unknown' : 'privileged',
          'low',
          dynamic
            ? [{ code: 'command-substitution-unproven' }]
            : [{ code: 'privilege-escalation' }],
        ),
      );
    }

    const reasons: RiskReason[] = [];
    let level: CommandRisk = 'read_only';
    let confidence: PolicyDecision['confidence'] = 'high';
    let hasUnknownSegment = false;
    for (const segment of splitCommandSegments(command)) {
      const classified = this.#classifySegment(segment, hints.terminalType, reasons);
      level = higherRisk(level, classified);
      if (classified === 'unknown') {
        hasUnknownSegment = true;
        confidence = 'low';
      } else if (
        confidence === 'high' &&
        (command.includes('|') ||
          command.includes('&&') ||
          command.includes('||') ||
          /\b(?:if|then|elif|else|fi)\b/.test(command))
      ) {
        confidence = 'medium';
      }
    }
    if (/[<>]/.test(command)) {
      level = higherRisk(level, 'mutating');
      reasons.push({ code: 'redirection-changes-filesystem' });
      confidence = 'low';
    }
    if (level === 'read_only') reasons.push({ code: 'read-only-rules-matched' });
    if (hasUnresolvedShellStructure(command)) {
      confidence = 'low';
      reasons.push({ code: 'dynamic-shell-structure' });
      level = higherRisk(level, 'unknown');
    }
    if (hasUnknownSegment && level !== 'destructive') level = 'unknown';
    return Promise.resolve(decision(level, confidence, unique(reasons)));
  }

  #classifySegment(
    segment: string,
    terminalType: string | undefined,
    reasons: RiskReason[],
  ): CommandRisk {
    const tokens = tokenize(segment);
    const commandToken = tokens.find((token) => !POSIX_CONTROL_KEYWORDS.has(token.toLowerCase()));
    const name = commandToken?.toLowerCase();
    if (name === undefined && POSIX_CONTROL_KEYWORDS.has(tokens[0]?.toLowerCase() ?? '')) {
      return 'read_only';
    }
    if (name === undefined) return 'unknown';
    if (/powershell|pwsh/i.test(terminalType ?? '')) {
      if (name.startsWith('remove-')) {
        reasons.push({ code: 'destructive-command', subject: name });
        return 'destructive';
      }
      if (POWERSHELL_READ_ONLY.has(name)) return 'read_only';
      if (POWERSHELL_MUTATING.has(name)) {
        reasons.push({ code: 'state-changing-command', subject: name });
        return 'mutating';
      }
      reasons.push({ code: 'unknown-powershell-executable', subject: name });
      return 'unknown';
    }

    if (name === 'git' && ['status', 'log', 'diff', 'show'].includes(tokens[1] ?? '')) {
      return 'read_only';
    }
    if (name === 'systemctl' && ['status', 'is-active', 'show'].includes(tokens[1] ?? '')) {
      return 'read_only';
    }
    if (name === 'sysctl') {
      if (hasSysctlWriteOption(tokens)) {
        reasons.push({ code: 'sysctl-kernel-state' });
        return 'privileged';
      }
      return 'read_only';
    }
    if (name === 'sort' && hasSortOutputOption(tokens)) {
      reasons.push({ code: 'sort-output-file' });
      return 'mutating';
    }
    if (
      name === 'rm' &&
      tokens.slice(1).some((argument) => argument.startsWith('-') && /r/i.test(argument))
    ) {
      reasons.push({ code: 'irreversible-destructive-command', subject: 'rm' });
      return 'destructive';
    }
    if (['dd', 'mkfs', 'reboot', 'shutdown'].includes(name)) {
      reasons.push({ code: 'destructive-system-command', subject: name });
      return 'destructive';
    }
    if (POSIX_MUTATING.has(name) || name === 'rm') {
      reasons.push({ code: 'state-changing-command', subject: name });
      return 'mutating';
    }
    if (POSIX_READ_ONLY.has(name)) return 'read_only';
    reasons.push({ code: 'unknown-executable', subject: name });
    return 'unknown';
  }
}

function hasSortOutputOption(tokens: string[]): boolean {
  return tokens.slice(1).some((token) => {
    const normalized = stripSimpleShellQuotes(token).toLowerCase();
    return (
      normalized === '-o' ||
      normalized.startsWith('-o') ||
      normalized === '--output' ||
      normalized.startsWith('--output=')
    );
  });
}

function hasSysctlWriteOption(tokens: string[]): boolean {
  return tokens.slice(1).some((token) => {
    const normalized = stripSimpleShellQuotes(token).toLowerCase();
    return (
      normalized === '-w' ||
      normalized.startsWith('-w') ||
      normalized === '--write' ||
      normalized.startsWith('--write=') ||
      normalized === '-p' ||
      normalized.startsWith('-p') ||
      normalized === '--system' ||
      normalized.startsWith('--system=') ||
      normalized.includes('=')
    );
  });
}

function stripSimpleShellQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === "'" || first === '"') && first === last) {
      return token.slice(1, -1);
    }
  }
  return token;
}

function decision(
  level: CommandRisk,
  confidence: PolicyDecision['confidence'],
  reasons: readonly RiskReason[],
): PolicyDecision {
  return {
    level,
    risk: level,
    confidence,
    reasons,
    requiresConfirmation: !['read_only', 'mutating'].includes(level),
  };
}

function tokenize(segment: string): string[] {
  return segment.match(/'(?:[^']|'\\'')*'|"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
}

function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let segment = '';
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const pushSegment = (): void => {
    const value = segment.trim();
    if (value.length > 0) segments.push(value);
    segment = '';
  };

  for (const character of command) {
    if (escaped) {
      segment += character;
      escaped = false;
      continue;
    }
    if (quote !== undefined) {
      segment += character;
      if (character === quote) quote = undefined;
      else if (quote === '"' && character === '\\') escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      segment += character;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      segment += character;
      continue;
    }
    if (
      character === ';' ||
      character === '|' ||
      character === '&' ||
      character === '\n' ||
      character === '\r'
    ) {
      pushSegment();
      continue;
    }
    segment += character;
  }
  pushSegment();
  return segments;
}

/** 按 code 与 subject 去重；同一 code 指名不同可执行文件时是两条不同的理由。 */
function unique(reasons: readonly RiskReason[]): RiskReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = 'subject' in reason ? `${reason.code}\u0000${reason.subject}` : reason.code;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasUnresolvedShellStructure(command: string): boolean {
  return (
    /(^|[\s;&|])(alias|source|\.)\b/.test(command) ||
    /\b(?:eval|exec)\b/.test(command) ||
    /\b(?:function|for|while|until|case)\b/.test(command) ||
    /\$\{?\w+|\$\(/.test(command)
  );
}
