import { createHash } from 'node:crypto';

import type { CommandRisk } from '@synapse-term/domain';

export interface PolicyDecision {
  level: CommandRisk;
  risk: CommandRisk;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  requiresConfirmation: boolean;
  commandHash: string;
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
      return Promise.resolve(decision('unknown', 'low', ['empty command'], commandHash));
    }
    if (/[$(`]|\b(?:sudo|doas)\b/.test(command)) {
      const dynamic = /\$|`/.test(command);
      return Promise.resolve(
        decision(
          dynamic ? 'unknown' : 'privileged',
          'low',
          dynamic
            ? ['command substitution is not proven safe']
            : ['command requests privilege escalation'],
          commandHash,
        ),
      );
    }

    const reasons: string[] = [];
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
      reasons.push('redirection can change filesystem state');
      confidence = 'low';
    }
    if (level === 'read_only') reasons.push('all commands match read-only rules');
    if (hasUnresolvedShellStructure(command)) {
      confidence = 'low';
      reasons.push('scripts, aliases, or dynamic shell structure cannot be fully expanded safely');
      level = higherRisk(level, 'unknown');
    }
    if (hasUnknownSegment && level !== 'destructive') level = 'unknown';
    return Promise.resolve(decision(level, confidence, unique(reasons), commandHash));
  }

  #classifySegment(
    segment: string,
    terminalType: string | undefined,
    reasons: string[],
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
    if (name === 'sysctl') {
      if (hasSysctlWriteOption(tokens)) {
        reasons.push('sysctl write options can change kernel state');
        return 'privileged';
      }
      return 'read_only';
    }
    if (name === 'sort' && hasSortOutputOption(tokens)) {
      reasons.push('sort can change filesystem state with -o/--output');
      return 'mutating';
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
  reasons: string[],
  commandHash: string,
): PolicyDecision {
  return {
    level,
    risk: level,
    confidence,
    reasons,
    requiresConfirmation: !['read_only', 'mutating'].includes(level),
    commandHash,
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function hasUnresolvedShellStructure(command: string): boolean {
  return (
    /(^|[\s;&|])(alias|source|\.)\b/.test(command) ||
    /\b(?:eval|exec)\b/.test(command) ||
    /\b(?:function|for|while|until|case)\b/.test(command) ||
    /\$\{?\w+|\$\(/.test(command)
  );
}
