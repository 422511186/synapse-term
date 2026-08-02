/**
 * 命令哈希（领域层）
 *
 * 结构化命令的 SHA-256 指纹，用于审批比对、Lease 令牌与审计记录。
 * 下沉到领域层是因为 audit-service（infrastructure）与 plaintext-dispatcher
 * （terminal-service）都需要它，避免下层反向依赖 platform-kernel。
 */
import { createHash } from 'node:crypto';

/** 计算命令的稳定哈希（前缀 sha256:，与 ApprovalGrant 存储格式一致） */
export function hashCommand(command: string): string {
  return `sha256:${createHash('sha256').update(command, 'utf8').digest('hex')}`;
}
