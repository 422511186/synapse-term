/**
 * 公共 API 出口（自动生成）
 *
 * @synapse-term/platform-kernel 对外暴露的模块契约；包间依赖只能引用此入口，
 * 不得直接 import 包内实现文件（specs/core-modularization：Module Public API）。
 */
export * from './scheduler/agent-task-scheduler.js';
export * from './policy/approval-manager.js';
export * from './policy/authorization-policy.js';
export * from './policy/local-file-policy.js';
export * from './policy/policy-engine.js';
export * from './gateway/tool-gateway.js';
export * from './gateway/external-tool-pipeline.js';
