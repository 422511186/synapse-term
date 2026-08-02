/**
 * 公共 API 出口（自动生成）
 *
 * @synapse-term/terminal-service 对外暴露的模块契约；包间依赖只能引用此入口，
 * 不得直接 import 包内实现文件（specs/core-modularization：Module Public API）。
 */
export * from './shell/bash-parser.js';
export * from './execution/command-executor.js';
export * from './execution/command-output-collector.js';
export * from './execution/interaction-detector.js';
export * from './execution/output-journal.js';
export * from './execution/plaintext-dispatcher.js';
export * from './shell/pty-adapter.js';
export * from './session/session-actor.js';
export * from './session/session-manager.js';
export * from './session/session-recovery.js';
export * from './session/session-replay.js';
export * from './resources/session-resource-domain.js';
export * from './resources/session-resource-parser.js';
export * from './resources/session-resource-service.js';
export * from './shell/shell-driver.js';
export * from './shell/shell-locator.js';
export * from './shell/shell-probe.js';
export * from './model/terminal-model.js';
