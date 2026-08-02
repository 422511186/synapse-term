import { z } from 'zod';

const cursorSchema = z.number().int().nonnegative();
const sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const boundedPositiveInteger = (maximum: number) => z.number().int().positive().max(maximum);

const relativePathSchema = z.string().min(1).refine(isSafeRelativePath, {
  message: 'path must stay relative to the configured local root',
});

export const terminalObserveInputSchema = z.strictObject({
  view: z.enum(['screen', 'output']).optional(),
  afterCursor: cursorSchema.optional(),
  maxBytes: boundedPositiveInteger(1024 * 1024).optional(),
});

export const terminalExecuteInputSchema = z.strictObject({
  command: z.string().min(1),
  observationWindowMs: boundedPositiveInteger(60 * 60 * 1000).optional(),
});

export const terminalWaitInputSchema = z.strictObject({
  transactionId: z.string().min(1),
  afterCursor: cursorSchema.optional(),
  timeoutMs: boundedPositiveInteger(60 * 60 * 1000).optional(),
});

export const terminalInterruptInputSchema = z.strictObject({
  transactionId: z.string().min(1),
});

export const localListFilesInputSchema = z.strictObject({
  path: relativePathSchema.optional(),
  maxDepth: boundedPositiveInteger(64).optional(),
  maxResults: boundedPositiveInteger(10_000).optional(),
});

export const localSearchFilesInputSchema = z.strictObject({
  path: relativePathSchema.optional(),
  query: z.string().min(1).max(4_096),
  mode: z.enum(['filename', 'content']),
  maxDepth: boundedPositiveInteger(64).optional(),
  maxResults: boundedPositiveInteger(10_000).optional(),
  maxBytes: boundedPositiveInteger(64 * 1024 * 1024).optional(),
  timeoutMs: boundedPositiveInteger(60_000).optional(),
});

export const localReadFileInputSchema = z.strictObject({
  path: relativePathSchema,
  startLine: boundedPositiveInteger(Number.MAX_SAFE_INTEGER).optional(),
  endLine: boundedPositiveInteger(Number.MAX_SAFE_INTEGER).optional(),
  maxBytes: boundedPositiveInteger(4 * 1024 * 1024).optional(),
});

const localWriteCreateSchema = z.strictObject({
  path: relativePathSchema,
  mode: z.literal('create'),
  content: z.string(),
});

const localWriteReplaceSchema = z.strictObject({
  path: relativePathSchema,
  mode: z.literal('replace'),
  content: z.string(),
  expectedSha256: sha256Schema,
});

export const localWriteFileInputSchema = z.discriminatedUnion('mode', [
  localWriteCreateSchema,
  localWriteReplaceSchema,
]);

export const localEditFileInputSchema = z.strictObject({
  path: relativePathSchema,
  expectedSha256: sha256Schema,
  edits: z
    .array(
      z.strictObject({
        oldText: z.string().min(1),
        newText: z.string(),
        replaceAll: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(1_000),
});

export const terminalToolCallSchema = z.discriminatedUnion('name', [
  z.strictObject({ name: z.literal('terminal_observe'), arguments: terminalObserveInputSchema }),
  z.strictObject({ name: z.literal('terminal_execute'), arguments: terminalExecuteInputSchema }),
  z.strictObject({ name: z.literal('terminal_wait'), arguments: terminalWaitInputSchema }),
  z.strictObject({
    name: z.literal('terminal_interrupt'),
    arguments: terminalInterruptInputSchema,
  }),
  z.strictObject({ name: z.literal('local_list_files'), arguments: localListFilesInputSchema }),
  z.strictObject({ name: z.literal('local_search_files'), arguments: localSearchFilesInputSchema }),
  z.strictObject({ name: z.literal('local_read_file'), arguments: localReadFileInputSchema }),
  z.strictObject({ name: z.literal('local_write_file'), arguments: localWriteFileInputSchema }),
  z.strictObject({ name: z.literal('local_edit_file'), arguments: localEditFileInputSchema }),
]);

export type TerminalObserveInput = z.infer<typeof terminalObserveInputSchema>;
export type TerminalExecuteInput = z.infer<typeof terminalExecuteInputSchema>;
export type TerminalWaitInput = z.infer<typeof terminalWaitInputSchema>;
export type TerminalInterruptInput = z.infer<typeof terminalInterruptInputSchema>;
export type LocalListFilesInput = z.infer<typeof localListFilesInputSchema>;
export type LocalSearchFilesInput = z.infer<typeof localSearchFilesInputSchema>;
export type LocalReadFileInput = z.infer<typeof localReadFileInputSchema>;
export type LocalWriteFileInput = z.infer<typeof localWriteFileInputSchema>;
export type LocalEditFileInput = z.infer<typeof localEditFileInputSchema>;
export type TerminalToolCall = z.infer<typeof terminalToolCallSchema>;

function isSafeRelativePath(value: string): boolean {
  if (value.includes('\0') || value.includes(':')) return false;
  if (/^[\\/]/.test(value) || /^[a-zA-Z]:/.test(value) || /^\\\\/.test(value)) return false;
  const segments = value.split(/[\\/]+/);
  return !segments.some((segment) => segment === '..');
}
