/**
 * 命令哈希（领域层）
 *
 * 命令的 SHA-256 指纹，用于审批与会话内放行的比对。
 */
import { createHash } from 'node:crypto';

/** 计算命令的稳定哈希（前缀 sha256:） */
export function hashCommand(command: string): string {
  return `sha256:${createHash('sha256').update(command, 'utf8').digest('hex')}`;
}
