import { createHash } from 'node:crypto';

import type { CommandRisk, ExecutionDialect, ShellAstParser } from '@synapse-term/domain';
import type { ParsedShellAst } from '@synapse-term/domain';

export interface PolicyDecision {
  level: CommandRisk;
  reasons: string[];
  commandHash: string;
  requiresApproval: boolean;
  requiresSecondConfirmation: boolean;
}

export interface PolicyHints {
  modelRisk?: CommandRisk;
  executionDialect?: ExecutionDialect;
}

const RISK_ORDER: readonly CommandRisk[] = [
  'read_only',
  'unknown',
  'mutating',
  'privileged',
  'destructive',
];

const READ_ONLY_COMMANDS = new Set([
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
  'journalctl',
  'ls',
  'netstat',
  'printf',
  'ps',
  'pwd',
  'rg',
  'sed',
  'ss',
  'stat',
  'tail',
  'uname',
  'uptime',
  'whoami',
]);

const MUTATING_COMMANDS = new Set([
  'apt',
  'apt-get',
  'chmod',
  'chown',
  'cp',
  'kill',
  'mkdir',
  'mv',
  'npm',
  'pip',
  'pnpm',
  'rm',
  'rmdir',
  'systemctl',
  'touch',
  'truncate',
  'yarn',
]);

const DESTRUCTIVE_COMMANDS = new Set(['dd', 'mkfs', 'reboot', 'shutdown']);

const POWERSHELL_ALIASES = new Map<string, string>([
  ['ac', 'add-content'],
  ['cat', 'get-content'],
  ['cd', 'set-location'],
  ['chdir', 'set-location'],
  ['clc', 'clear-content'],
  ['copy', 'copy-item'],
  ['cp', 'copy-item'],
  ['cpi', 'copy-item'],
  ['del', 'remove-item'],
  ['dir', 'get-childitem'],
  ['echo', 'write-output'],
  ['erase', 'remove-item'],
  ['gc', 'get-content'],
  ['gci', 'get-childitem'],
  ['gl', 'get-location'],
  ['gps', 'get-process'],
  ['kill', 'stop-process'],
  ['ls', 'get-childitem'],
  ['md', 'new-item'],
  ['mi', 'move-item'],
  ['mkdir', 'new-item'],
  ['move', 'move-item'],
  ['mv', 'move-item'],
  ['ni', 'new-item'],
  ['ps', 'get-process'],
  ['pwd', 'get-location'],
  ['rd', 'remove-item'],
  ['ren', 'rename-item'],
  ['ri', 'remove-item'],
  ['rm', 'remove-item'],
  ['rmdir', 'remove-item'],
  ['rni', 'rename-item'],
  ['sc', 'set-content'],
  ['sl', 'set-location'],
  ['spps', 'stop-process'],
  ['type', 'get-content'],
  ['write', 'write-output'],
]);

const POWERSHELL_READ_ONLY_COMMANDS = new Set([
  'clear-host',
  'convertfrom-json',
  'convertfrom-stringdata',
  'convertto-csv',
  'convertto-html',
  'convertto-json',
  'format-custom',
  'format-list',
  'format-table',
  'format-wide',
  'ipconfig',
  'nslookup',
  'out-default',
  'out-host',
  'out-null',
  'out-string',
  'ping',
  'systeminfo',
  'tasklist',
  'tracert',
  'wait-process',
  'where.exe',
  'write-host',
  'write-output',
]);

const POWERSHELL_READ_ONLY_VERBS = new Set([
  'compare',
  'convertfrom',
  'convertto',
  'find',
  'get',
  'group',
  'measure',
  'resolve',
  'search',
  'select',
  'sort',
  'test',
]);

const POWERSHELL_MUTATING_VERBS = new Set([
  'add',
  'connect',
  'copy',
  'disable',
  'disconnect',
  'dismount',
  'enable',
  'exit',
  'export',
  'import',
  'install',
  'join',
  'mount',
  'move',
  'new',
  'publish',
  'register',
  'rename',
  'save',
  'set',
  'start',
  'uninstall',
  'unpublish',
  'unregister',
  'update',
]);

const POWERSHELL_PRIVILEGED_COMMANDS = new Set([
  'disable-psremoting',
  'enable-psremoting',
  'new-service',
  'remove-service',
  'restart-service',
  'set-executionpolicy',
  'set-service',
  'start-service',
  'stop-process',
  'stop-service',
]);

const POWERSHELL_DESTRUCTIVE_COMMANDS = new Set([
  'clear-content',
  'clear-disk',
  'clear-recyclebin',
  'format-volume',
  'initialize-disk',
  'remove-item',
  'remove-service',
  'restart-computer',
  'stop-computer',
]);

export class PolicyEngine {
  readonly #parser: ShellAstParser;

  constructor(parser: ShellAstParser) {
    this.#parser = parser;
  }

  async classify(command: string, hints: PolicyHints = {}): Promise<PolicyDecision> {
    void hints.modelRisk;
    const commandHash = `sha256:${createHash('sha256').update(command, 'utf8').digest('hex')}`;
    if (command.trim().length === 0) {
      return decision('unknown', ['empty command'], commandHash);
    }
    if (hints.executionDialect === 'observe_only') {
      return decision('unknown', ['observe-only Session cannot execute commands'], commandHash);
    }
    if (hints.executionDialect === 'powershell') {
      return classifyPowerShellCommand(command, commandHash);
    }

    const reasons: string[] = [];

    let ast: ParsedShellAst;
    try {
      ast = await this.#parser.parse(command);
    } catch {
      return decision('unknown', ['shell parser failed'], commandHash);
    }
    if (ast.hasError || /\bERROR\b/.test(ast.tree)) {
      return decision('unknown', ['shell syntax error'], commandHash);
    }

    if (/\b(?:alias|function)\b|\b\w+\s*\(\s*\)/.test(command)) {
      return decision('unknown', ['alias or function override is not trusted'], commandHash);
    }
    if (/\$\(|`|<\(|>\(/.test(command)) {
      return decision('unknown', ['command substitution is not proven safe'], commandHash);
    }

    let level: CommandRisk = 'read_only';
    const segments = splitCommandSegments(command);
    if (segments.length > 1) reasons.push('compound command evaluated segment by segment');
    for (const segment of segments) {
      const result = classifySegment(segment, reasons);
      level = higherRisk(level, result.level);
    }

    if (/[<>]/.test(command)) {
      level = higherRisk(level, 'mutating');
      reasons.push('redirection can change filesystem state');
    }
    if (level === 'read_only') reasons.push('all commands and arguments match read-only rules');
    return decision(level, unique(reasons), commandHash);
  }
}

export async function createDefaultPolicyEngine(): Promise<PolicyEngine> {
  const { WebTreeSitterBashParser } = await import('@synapse-term/terminal-service');
  return new PolicyEngine(await WebTreeSitterBashParser.create());
}

function classifySegment(segment: string, reasons: string[]): { level: CommandRisk } {
  const tokens = shellTokens(segment);
  if (tokens.length === 0) return { level: 'unknown' };
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')) index += 1;
  let privileged = false;
  if (tokens[index] === 'sudo' || tokens[index] === 'su' || tokens[index] === 'doas') {
    privileged = true;
    reasons.push('command requests privilege escalation');
    index += 1;
  }
  const name = tokens[index]?.toLowerCase();
  if (name === undefined) return { level: 'unknown' };
  const args = tokens.slice(index + 1);

  if (DESTRUCTIVE_COMMANDS.has(name) || (name === 'rm' && args.some((arg) => /(^|-)r/.test(arg)))) {
    reasons.push('command has irreversible or destructive semantics');
    return { level: 'destructive' };
  }
  if (name === 'find' && args.some((arg) => arg === '-delete' || arg === '-exec')) {
    reasons.push('find can delete or execute a mutating action');
    return { level: 'destructive' };
  }
  if (name === 'systemctl') {
    const action = args[0];
    if (
      action === 'status' ||
      action === 'is-active' ||
      action === 'is-enabled' ||
      action === 'show'
    ) {
      return { level: privileged ? 'privileged' : 'read_only' };
    }
    reasons.push('systemctl action changes service state');
    return { level: privileged ? 'privileged' : 'mutating' };
  }
  if (name === 'git') {
    const action = args[0];
    if (action === 'status' || action === 'log' || action === 'diff' || action === 'show') {
      return { level: privileged ? 'privileged' : 'read_only' };
    }
    reasons.push('git action can change repository state');
    return { level: action === 'clean' ? 'destructive' : privileged ? 'privileged' : 'mutating' };
  }
  if (name === 'docker') {
    const action = args[0];
    if (action === 'ps' || action === 'logs' || action === 'inspect' || action === 'stats') {
      return { level: privileged ? 'privileged' : 'read_only' };
    }
    reasons.push('docker action is not proven read-only');
    return { level: privileged ? 'privileged' : 'unknown' };
  }
  if (name === 'sed' && args.some((arg) => arg === '-i' || arg.startsWith('--in-place'))) {
    reasons.push('in-place editing changes files');
    return { level: privileged ? 'privileged' : 'mutating' };
  }
  if (MUTATING_COMMANDS.has(name)) {
    reasons.push(`${name} can change system state`);
    return { level: privileged ? 'privileged' : 'mutating' };
  }
  if (READ_ONLY_COMMANDS.has(name)) return { level: privileged ? 'privileged' : 'read_only' };

  reasons.push(`unknown executable: ${name}`);
  return { level: privileged ? 'privileged' : 'unknown' };
}

function classifyPowerShellCommand(command: string, commandHash: string): PolicyDecision {
  if (/\$\(|`|--%/.test(command)) {
    return decision('unknown', ['dynamic PowerShell expression is not proven safe'], commandHash);
  }
  if (/[{}]/.test(command)) {
    return decision('unknown', ['PowerShell script blocks require explicit approval'], commandHash);
  }
  if (/(?:^|[\s;(])&\s*(?:\$|['".\\])/.test(command)) {
    return decision('unknown', ['PowerShell invocation operator is not proven safe'], commandHash);
  }
  if (/^\s*\.\s+(?:\$|['".\\])/.test(command)) {
    return decision('unknown', ['PowerShell dot sourcing is not proven safe'], commandHash);
  }

  const reasons: string[] = [];
  let level: CommandRisk = 'read_only';
  const segments = splitCommandSegments(command);
  if (segments.length > 1) reasons.push('compound command evaluated segment by segment');
  for (const segment of segments) {
    const result = classifyPowerShellSegment(segment, reasons);
    level = higherRisk(level, result.level);
  }
  if (/[<>]/.test(command)) {
    level = higherRisk(level, 'mutating');
    reasons.push('redirection can change filesystem state');
  }
  if (level === 'read_only') reasons.push('all PowerShell commands match read-only rules');
  return decision(level, unique(reasons), commandHash);
}

function classifyPowerShellSegment(segment: string, reasons: string[]): { level: CommandRisk } {
  const tokens = shellTokens(segment);
  if (tokens.length === 0) return { level: 'unknown' };
  const rawName = tokens[0]?.toLowerCase();
  if (rawName === undefined) return { level: 'unknown' };
  if (rawName.startsWith('$') || rawName.endsWith('.ps1')) {
    reasons.push('dynamic or script-file execution is not proven safe');
    return { level: 'unknown' };
  }

  const name = POWERSHELL_ALIASES.get(rawName) ?? rawName;
  const args = tokens.slice(1);
  if (
    name === 'invoke-expression' ||
    name === 'iex' ||
    name === 'powershell' ||
    name === 'powershell.exe' ||
    name === 'pwsh' ||
    name === 'pwsh.exe' ||
    name === 'cmd' ||
    name === 'cmd.exe'
  ) {
    reasons.push('nested or dynamic command execution is not proven safe');
    return { level: 'unknown' };
  }
  if (name === 'runas' || name === 'runas.exe' || name === 'gsudo' || name === 'sudo') {
    reasons.push('command requests privilege escalation');
    return { level: 'privileged' };
  }
  if (
    name === 'start-process' &&
    args.some((argument, index) => {
      const normalized = argument.toLowerCase();
      return (
        normalized === '-verb:runas' ||
        (normalized === '-verb' && args[index + 1]?.toLowerCase() === 'runas')
      );
    })
  ) {
    reasons.push('Start-Process requests elevated execution');
    return { level: 'privileged' };
  }
  if (POWERSHELL_DESTRUCTIVE_COMMANDS.has(name) || name.startsWith('remove-')) {
    reasons.push(`${name} has destructive semantics`);
    return { level: 'destructive' };
  }
  if (POWERSHELL_PRIVILEGED_COMMANDS.has(name)) {
    reasons.push(`${name} changes privileged process, service, or policy state`);
    return { level: 'privileged' };
  }
  if (POWERSHELL_READ_ONLY_COMMANDS.has(name)) return { level: 'read_only' };

  const separator = name.indexOf('-');
  if (separator > 0) {
    const verb = name.slice(0, separator);
    if (POWERSHELL_READ_ONLY_VERBS.has(verb)) return { level: 'read_only' };
    if (verb === 'clear') {
      reasons.push(`${name} can clear persistent or in-memory state`);
      return { level: 'mutating' };
    }
    if (verb === 'stop' || verb === 'restart') {
      reasons.push(`${name} can interrupt a running process or service`);
      return { level: 'privileged' };
    }
    if (POWERSHELL_MUTATING_VERBS.has(verb)) {
      reasons.push(`${name} can change PowerShell or system state`);
      return { level: 'mutating' };
    }
  }

  return classifySegment([name, ...args].join(' '), reasons);
}

function decision(
  level: CommandRisk,
  reasons: readonly string[],
  commandHash: string,
): PolicyDecision {
  return {
    level,
    reasons: [...reasons],
    commandHash,
    requiresApproval: level !== 'read_only',
    requiresSecondConfirmation: level === 'destructive',
  };
}

function higherRisk(left: CommandRisk, right: CommandRisk): CommandRisk {
  return RISK_ORDER.indexOf(right) > RISK_ORDER.indexOf(left) ? right : left;
}

function splitCommandSegments(command: string): string[] {
  return command.split(/\s*(?:&&|\|\||[|;])\s*/).filter((segment) => segment.length > 0);
}

function shellTokens(segment: string): string[] {
  const tokens: string[] = [];
  const pattern = /'(?:[^']|'\\'')*'|"(?:[^"\\]|\\.)*"|\S+/g;
  for (const match of segment.matchAll(pattern)) {
    const token = match[0];
    if (token === undefined) continue;
    tokens.push(unquote(token));
  }
  return tokens;
}

function unquote(token: string): string {
  if (token.startsWith("'") && token.endsWith("'"))
    return token.slice(1, -1).replaceAll("'\\''", "'");
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1);
  return token;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
