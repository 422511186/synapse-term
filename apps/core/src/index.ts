/**
 * Core 公共 API 出口（Composition Root 外观）
 *
 * apps/core 已收敛为进程入口与装配层：业务实现全部位于 packages/*，
 * 此文件仅转发各平台包与本地入口模块，不再新增业务实现。
 * 包间引用一律走公共 API，避免深路径导入（见 packages/domain 依赖方向测试）。
 */
export * from './core-application.js';
export * from './main-options.js';
export * from '@synapse-term/agent-service';
export * from '@synapse-term/application';
export * from '@synapse-term/infrastructure';
export * from '@synapse-term/model-providers';
export * from '@synapse-term/platform-kernel';
export * from '@synapse-term/terminal-service';
