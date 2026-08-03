import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import {
  AGENT_ATTACHMENT_IMAGE_MIME_TYPES,
  AGENT_ATTACHMENT_MAX_FILE_BYTES,
  AGENT_ATTACHMENT_MAX_IMAGE_BYTES,
  AGENT_ATTACHMENT_MAX_ITEMS,
  type AgentAttachmentInput,
  type AgentImageMimeType,
  type StagedAgentAttachment,
} from '@synapse-term/domain';
import { LocalFileService } from '@synapse-term/tooling';

const ATTACHMENT_DIRECTORY = '.synapse-term-attachments';

export class AgentAttachmentValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentAttachmentValidationError';
    this.code = code;
  }
}

export interface StageAgentAttachmentsOptions {
  sessionId: string;
  taskId: string;
  attachments: readonly AgentAttachmentInput[];
  multimodal: boolean;
  localFiles?: LocalFileService | undefined;
}

export interface StagedAgentAttachmentBundle {
  attachments: readonly StagedAgentAttachment[];
  root: string | undefined;
  localFiles: LocalFileService | undefined;
  dispose(): Promise<void>;
}

export function validateAgentAttachmentInputs(
  attachments: readonly AgentAttachmentInput[],
  multimodal: boolean,
): void {
  if (attachments.length > AGENT_ATTACHMENT_MAX_ITEMS) {
    throw new AgentAttachmentValidationError(
      'agent_attachment_limit',
      `一次任务最多可携带 ${AGENT_ATTACHMENT_MAX_ITEMS} 个附件。`,
    );
  }
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      if (!multimodal) {
        throw new AgentAttachmentValidationError(
          'multimodal_unsupported',
          '当前模型不支持图片输入。',
        );
      }
      if (!AGENT_ATTACHMENT_IMAGE_MIME_TYPES.includes(attachment.mimeType as AgentImageMimeType)) {
        throw new AgentAttachmentValidationError(
          'unsupported_image_mime',
          `不支持的图片类型：${attachment.mimeType}。`,
        );
      }
      if (attachment.sizeBytes > AGENT_ATTACHMENT_MAX_IMAGE_BYTES) {
        throw new AgentAttachmentValidationError(
          'attachment_too_large',
          `图片不能超过 ${AGENT_ATTACHMENT_MAX_IMAGE_BYTES / 1024 / 1024} MiB。`,
        );
      }
      continue;
    }
    if (attachment.sizeBytes > AGENT_ATTACHMENT_MAX_FILE_BYTES) {
      throw new AgentAttachmentValidationError(
        'attachment_too_large',
        `文件不能超过 ${AGENT_ATTACHMENT_MAX_FILE_BYTES / 1024 / 1024} MiB。`,
      );
    }
  }
}

export async function stageAgentAttachments(
  options: StageAgentAttachmentsOptions,
): Promise<StagedAgentAttachmentBundle> {
  validateAgentAttachmentInputs(options.attachments, options.multimodal);
  if (options.attachments.length === 0) {
    return {
      attachments: [],
      root: undefined,
      localFiles: undefined,
      dispose: async () => undefined,
    };
  }

  const base = options.localFiles?.root ?? join(tmpdir(), 'synapse-term-agent-attachments');
  const root = join(base, ATTACHMENT_DIRECTORY, options.sessionId, options.taskId);
  await mkdir(root, { recursive: true });
  const staged: StagedAgentAttachment[] = [];
  try {
    for (let index = 0; index < options.attachments.length; index += 1) {
      const attachment = options.attachments[index]!;
      const info = await stat(attachment.sourcePath).catch(() => undefined);
      if (info === undefined || !info.isFile()) {
        throw new AgentAttachmentValidationError(
          'attachment_source_missing',
          `附件源文件不存在：${attachment.name}。`,
        );
      }
      if (info.size !== attachment.sizeBytes) {
        throw new AgentAttachmentValidationError(
          'attachment_size_mismatch',
          `附件大小与元数据不一致：${attachment.name}。`,
        );
      }
      const relativePath = safeStagedName(index, attachment.name);
      if (attachment.kind === 'image') {
        if (info.size > AGENT_ATTACHMENT_MAX_IMAGE_BYTES) {
          throw new AgentAttachmentValidationError(
            'attachment_too_large',
            `图片不能超过 ${AGENT_ATTACHMENT_MAX_IMAGE_BYTES / 1024 / 1024} MiB。`,
          );
        }
        const buffer = await readFile(attachment.sourcePath);
        assertImageBytes(buffer, attachment.mimeType);
        staged.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType as AgentImageMimeType,
          sizeBytes: info.size,
          kind: 'image',
          dataBase64: buffer.toString('base64'),
        });
        continue;
      }
      if (info.size > AGENT_ATTACHMENT_MAX_FILE_BYTES) {
        throw new AgentAttachmentValidationError(
          'attachment_too_large',
          `文件不能超过 ${AGENT_ATTACHMENT_MAX_FILE_BYTES / 1024 / 1024} MiB。`,
        );
      }
      await copyFile(attachment.sourcePath, resolve(root, relativePath));
      staged.push({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: info.size,
        kind: 'file',
        relativePath,
      });
    }
    const localFiles = await LocalFileService.create({ root });
    return {
      attachments: staged,
      root,
      localFiles,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function cleanupAgentAttachmentSession(options: {
  sessionId: string;
  localFiles?: LocalFileService | undefined;
}): Promise<void> {
  const base = options.localFiles?.root ?? join(tmpdir(), 'synapse-term-agent-attachments');
  const sessionRoot = join(base, ATTACHMENT_DIRECTORY, options.sessionId);
  await rm(sessionRoot, { recursive: true, force: true });
}

function safeStagedName(index: number, original: string): string {
  const cleaned = basename(original)
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/^\.+$/, '')
    .trim();
  return `${index}-${cleaned.length === 0 ? `attachment-${index}` : cleaned}`;
}

function assertImageBytes(buffer: Buffer, mimeType: string): void {
  const matches =
    (mimeType === 'image/png' && startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) ||
    (mimeType === 'image/jpeg' && startsWith(buffer, [0xff, 0xd8, 0xff])) ||
    (mimeType === 'image/webp' &&
      startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP') ||
    (mimeType === 'image/gif' &&
      (startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])));
  if (!matches) {
    throw new AgentAttachmentValidationError(
      'unsupported_image_mime',
      `图片内容与声明的 MIME 类型不一致：${mimeType}。`,
    );
  }
}

function startsWith(buffer: Buffer, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}
