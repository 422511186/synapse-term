/**
 * 公共 API 出口（自动生成）
 *
 * @synapse-term/infrastructure 对外暴露的模块契约；包间依赖只能引用此入口，
 * 不得直接 import 包内实现文件（specs/core-modularization：Module Public API）。
 */
export * from './audit/audit-service.js';
export * from './ipc/core-ipc-endpoint.js';
export * from './ipc/core-ipc-server.js';
export * from './lifecycle/core-lifecycle.js';
export * from './paths/core-paths.js';
export * from './store/core-schema.js';
export * from './security/data-security.js';
export * from './store/database-backup.js';
export * from './paths/home-resolver.js';
export * from './ipc/named-pipe.js';
export * from './store/repositories.js';
export * from './store/retention.js';
export * from './security/secret-protection.js';
export * from './security/secret-store.js';
export * from './store/sqlite-store.js';
export * from './lifecycle/startup-lock.js';
export * from './lifecycle/upgrade-state.js';
