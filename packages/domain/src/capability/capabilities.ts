/**
 * 平台能力声明（领域层）
 *
 * 统一能力命名空间，用于：
 * - MCP / ACP 外部客户端的能力协商（specs/core-modularization、specs/acp-driver）；
 * - Tool Provider 能力归属判断（read-only / managed 两级审批，specs/mcp-access）。
 */

/** 平台对外暴露的能力项（点分命名，便于协议层翻译） */
export type PlatformCapability =
  | 'terminal.execute'
  | 'terminal.observe'
  | 'terminal.wait'
  | 'terminal.interrupt'
  | 'file.read'
  | 'file.write'
  | 'file.search'
  | 'file.index';

/** 一组能力声明（外部客户端协商时使用） */
export interface PlatformCapabilitySet {
  readonly capabilities: readonly PlatformCapability[];
}

/** 只读能力集合：read-only 审批模式允许放行的范围 */
export const READ_ONLY_CAPABILITIES: readonly PlatformCapability[] = [
  'terminal.observe',
  'terminal.wait',
  'file.read',
  'file.search',
];

/** 判断某能力是否属于只读 */
export function isReadOnlyCapability(capability: PlatformCapability): boolean {
  return READ_ONLY_CAPABILITIES.includes(capability);
}
