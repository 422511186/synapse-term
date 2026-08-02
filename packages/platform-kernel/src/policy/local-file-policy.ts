import type { CommandRisk } from '@synapse-term/domain';

export type LocalFileOperation = 'list' | 'search' | 'read' | 'write' | 'edit';

export interface LocalFilePolicyInput {
  operation: LocalFileOperation;
  path: string;
  content?: string;
}

export interface LocalFilePolicyDecision {
  level: CommandRisk;
  reasons: readonly string[];
}

const sensitivePathPatterns = [
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.aws(\/|$)/,
  /(^|\/)\.azure(\/|$)/,
  /(^|\/)\.kube(\/|$)/,
  /(^|\/)\.config\/gcloud(\/|$)/,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.pypirc$/,
  /(^|\/)\.docker\/config\.json$/,
  /appdata\/local\/(google\/chrome|microsoft\/edge)\/user data(\/|$)/,
  /appdata\/roaming\/mozilla\/firefox\/profiles(\/|$)/,
];

const highImpactPathPatterns = [
  /appdata\/roaming\/microsoft\/windows\/start menu\/programs\/startup(\/|$)/,
  /documents\/(windowspowershell|powershell)\/.*profile.*\.ps1$/,
];

const sensitiveContentPatterns = [
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*\S+/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
];

export class LocalFilePolicy {
  classify(input: LocalFilePolicyInput): LocalFilePolicyDecision {
    const path = input.path.replaceAll('\\', '/').toLocaleLowerCase('en-US');
    const mutating = input.operation === 'write' || input.operation === 'edit';
    if (mutating && highImpactPathPatterns.some((pattern) => pattern.test(path))) {
      return {
        level: 'destructive',
        reasons: ['修改启动项或 PowerShell Profile 会影响后续登录和命令执行'],
      };
    }

    const pathSensitive = sensitivePathPatterns.some((pattern) => pattern.test(path));
    const contentSensitive =
      input.content !== undefined &&
      sensitiveContentPatterns.some((pattern) => pattern.test(input.content!));
    if (pathSensitive || contentSensitive) {
      return {
        level: 'privileged',
        reasons: [pathSensitive ? '目标路径可能包含凭据或敏感配置' : '写入内容疑似包含凭据或私钥'],
      };
    }

    if (mutating) {
      return { level: 'mutating', reasons: ['普通本机文件写入会修改文件内容'] };
    }
    return { level: 'read_only', reasons: [] };
  }
}
