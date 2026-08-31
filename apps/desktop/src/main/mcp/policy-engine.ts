import { createHash } from 'node:crypto';

import type { CommandRisk } from '@synapse-term/domain';

export interface PolicyDecision {
  level: CommandRisk;
  reasons: string[];
  commandHash: string;
}

export interface PolicyHints {
  terminalType?: string | undefined;
}

const POSIX_READ_ONLY = new Set([
  'cat',
  'cut',
  'date',
  'df',
  'diff',
  'du',
  'echo',
  'env',
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
  'stat',
  'tail',
  'uname',
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

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function higherRisk(left: CommandRisk, right: CommandRisk): CommandRisk {
  const order: CommandRisk[] = ['read_only', 'unknown', 'mutating', 'privileged', 'destructive'];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

export class PolicyEngine {
  classify(command: string, hints: PolicyHints = {}): Promise<PolicyDecision> {
    const commandHash = hash(command);
    if (command.trim().length === 0) {
      return Promise.resolve(decision('unknown', ['empty command'], commandHash));
    }
    if (/[$(`]|\b(?:sudo|doas)\b/.test(command)) {
      const dynamic = /\$|`/.test(command);
      return Promise.resolve(
        decision(
          dynamic ? 'unknown' : 'privileged',
          dynamic
            ? ['command substitution is not proven safe']
            : ['command requests privilege escalation'],
          commandHash,
        ),
      );
    }

    const reasons: string[] = [];
    let level: CommandRisk = 'read_only';
    for (const segment of command.split(/\s*(?:&&|\|\||[|;])\s*/).filter(Boolean)) {
      const classified = this.#classifySegment(segment, hints.terminalType, reasons);
      level = higherRisk(level, classified);
    }
    if (/[<>]/.test(command)) {
      level = higherRisk(level, 'mutating');
      reasons.push('redirection can change filesystem state');
    }
    if (level === 'read_only') reasons.push('all commands match read-only rules');
    return Promise.resolve(decision(level, unique(reasons), commandHash));
  }

  #classifySegment(
    segment: string,
    terminalType: string | undefined,
    reasons: string[],
  ): CommandRisk {
    const tokens = tokenize(segment);
    const name = tokens[0]?.toLowerCase();
    if (name === undefined) return 'unknown';
    if (/powershell|pwsh/i.test(terminalType ?? '')) {
      if (name.startsWith('remove-')) {
        reasons.push(`${name} has destructive semantics`);
        return 'destructive';
      }
      if (POWERSHELL_READ_ONLY.has(name)) return 'read_only';
      if (POWERSHELL_MUTATING.has(name)) {
        reasons.push(`${name} can change system state`);
        return 'mutating';
      }
      reasons.push(`unknown PowerShell executable: ${name}`);
      return 'unknown';
    }

    if (name === 'git' && ['status', 'log', 'diff', 'show'].includes(tokens[1] ?? '')) {
      return 'read_only';
    }
    if (name === 'systemctl' && ['status', 'is-active', 'show'].includes(tokens[1] ?? '')) {
      return 'read_only';
    }
    if (
      name === 'rm' &&
      tokens.slice(1).some((argument) => argument.startsWith('-') && /r/i.test(argument))
    ) {
      reasons.push('rm has irreversible destructive semantics');
      return 'destructive';
    }
    if (['dd', 'mkfs', 'reboot', 'shutdown'].includes(name)) {
      reasons.push(`${name} has destructive system semantics`);
      return 'destructive';
    }
    if (POSIX_MUTATING.has(name) || name === 'rm') {
      reasons.push(`${name} can change system state`);
      return 'mutating';
    }
    if (POSIX_READ_ONLY.has(name)) return 'read_only';
    reasons.push(`unknown executable: ${name}`);
    return 'unknown';
  }
}

function decision(level: CommandRisk, reasons: string[], commandHash: string): PolicyDecision {
  return { level, reasons, commandHash };
}

function tokenize(segment: string): string[] {
  return segment.match(/'(?:[^']|'\\'')*'|"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
