export type {
  CompletionMetadata,
  CommandRiskEvidence,
  ExecutionContextId,
  ExternalTransactionKind,
  ExternalErrorCode,
  ExternalTransactionStatus,
  InputGrantId,
  InputGrantMode,
  InputKey,
  InputRequestId,
  OutputCursor,
  TransactionId,
  TransactionOutputRange,
} from '@synapse-term/domain';

export * from './shell/pty-adapter.js';
export * from './shell/shell-locator.js';
export * from './shell/shell-driver.js';
export * from './shell/shell-probe.js';
export * from './session/session-actor.js';
export * from './session/session-manager.js';
export * from './session/output-buffer.js';
export * from './session/terminal-text-sanitizer.js';
export * from './session/external-lease.js';
export * from './session/command-executor.js';
export * from './session/interactive-command-executor.js';
