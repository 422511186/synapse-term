import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import {
  AGENT_ATTACHMENT_IMAGE_MIME_TYPES,
  AGENT_ATTACHMENT_MAX_FILE_BYTES,
  AGENT_ATTACHMENT_MAX_IMAGE_BYTES,
  AGENT_ATTACHMENT_MAX_ITEMS,
  type AgentAttachmentInput,
} from '@synapse-term/domain';

import {
  desktopAttachmentPickOptionsSchema,
  desktopAttachmentSubmissionSchema,
  type DesktopAttachmentSource,
  type PickedAgentAttachment,
} from '../shared/desktop-attachment.js';

const DEFAULT_TICKET_TTL_MS = 15 * 60 * 1_000;

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const FILE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

export class DesktopAttachmentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DesktopAttachmentError';
    this.code = code;
  }
}

export interface DesktopAttachmentControllerOptions {
  selectPaths(kind: 'image' | 'file'): Promise<string[]>;
  ticketTtlMs?: number;
}

export interface DesktopAttachmentController {
  pick(options: unknown): Promise<PickedAgentAttachment[]>;
  resolve(value: unknown): Promise<AgentAttachmentInput[]>;
  clear(): void;
}

interface AttachmentTicket extends DesktopAttachmentSource {
  expiresAt: number;
}

export function createDesktopAttachmentController(
  options: DesktopAttachmentControllerOptions,
): DesktopAttachmentController {
  const tickets = new Map<string, AttachmentTicket>();
  const ticketTtlMs = options.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS;

  return {
    async pick(value) {
      const parsed = desktopAttachmentPickOptionsSchema.parse(value);
      const currentCount = parsed.currentCount ?? 0;
      if (currentCount >= AGENT_ATTACHMENT_MAX_ITEMS) {
        throw new DesktopAttachmentError(
          'agent_attachment_limit',
          `一次任务最多可携带 ${AGENT_ATTACHMENT_MAX_ITEMS} 个附件。`,
        );
      }
      const paths = await options.selectPaths(parsed.kind);
      if (paths.length === 0) return [];
      if (currentCount + paths.length > AGENT_ATTACHMENT_MAX_ITEMS) {
        throw new DesktopAttachmentError(
          'agent_attachment_limit',
          `一次任务最多可携带 ${AGENT_ATTACHMENT_MAX_ITEMS} 个附件。`,
        );
      }

      const sources: DesktopAttachmentSource[] = [];
      for (const sourcePath of paths) {
        const info = await stat(sourcePath).catch(() => undefined);
        if (info === undefined || !info.isFile()) {
          throw new DesktopAttachmentError(
            'attachment_source_missing',
            `附件源文件不存在：${basename(sourcePath)}。`,
          );
        }
        const name = basename(sourcePath);
        const mimeType = mimeTypeForPath(name, parsed.kind);
        const sizeBytes = info.size;
        if (parsed.kind === 'image') {
          if (!AGENT_ATTACHMENT_IMAGE_MIME_TYPES.includes(mimeType as never)) {
            throw new DesktopAttachmentError(
              'unsupported_image_mime',
              `不支持的图片类型：${mimeType}。`,
            );
          }
          if (sizeBytes > AGENT_ATTACHMENT_MAX_IMAGE_BYTES) {
            throw new DesktopAttachmentError(
              'attachment_too_large',
              `图片不能超过 ${AGENT_ATTACHMENT_MAX_IMAGE_BYTES / 1024 / 1024} MiB。`,
            );
          }
        } else if (sizeBytes > AGENT_ATTACHMENT_MAX_FILE_BYTES) {
          throw new DesktopAttachmentError(
            'attachment_too_large',
            `文件不能超过 ${AGENT_ATTACHMENT_MAX_FILE_BYTES / 1024 / 1024} MiB。`,
          );
        }
        sources.push({ sourcePath, name, mimeType, sizeBytes, kind: parsed.kind });
      }

      const issued: PickedAgentAttachment[] = [];
      for (const source of sources) {
        const attachmentId = randomUUID();
        tickets.set(attachmentId, { ...source, expiresAt: Date.now() + ticketTtlMs });
        issued.push({
          attachmentId,
          name: source.name,
          mimeType: source.mimeType,
          sizeBytes: source.sizeBytes,
          kind: source.kind,
        });
      }
      return issued;
    },

    async resolve(value) {
      const submissions = desktopAttachmentSubmissionSchema.parse(value);
      const resolved: AgentAttachmentInput[] = [];
      for (const submission of submissions) {
        const ticket = tickets.get(submission.attachmentId);
        if (ticket === undefined || ticket.expiresAt <= Date.now()) {
          tickets.delete(submission.attachmentId);
          throw new DesktopAttachmentError(
            'attachment_ticket_invalid',
            '附件凭证已失效，请重新选择附件。',
          );
        }
        if (
          ticket.name !== submission.name ||
          ticket.mimeType !== submission.mimeType ||
          ticket.sizeBytes !== submission.sizeBytes ||
          ticket.kind !== submission.kind
        ) {
          throw new DesktopAttachmentError(
            'attachment_ticket_invalid',
            '附件元数据与选择结果不一致，请重新选择附件。',
          );
        }
        const info = await stat(ticket.sourcePath).catch(() => undefined);
        if (info === undefined || !info.isFile()) {
          throw new DesktopAttachmentError(
            'attachment_source_missing',
            `附件源文件不存在：${ticket.name}。`,
          );
        }
        if (info.size !== ticket.sizeBytes) {
          throw new DesktopAttachmentError(
            'attachment_size_mismatch',
            `附件大小与元数据不一致：${ticket.name}。`,
          );
        }
        if (ticket.kind === 'image' && info.size > AGENT_ATTACHMENT_MAX_IMAGE_BYTES) {
          throw new DesktopAttachmentError(
            'attachment_too_large',
            `图片不能超过 ${AGENT_ATTACHMENT_MAX_IMAGE_BYTES / 1024 / 1024} MiB。`,
          );
        }
        if (ticket.kind === 'file' && info.size > AGENT_ATTACHMENT_MAX_FILE_BYTES) {
          throw new DesktopAttachmentError(
            'attachment_too_large',
            `文件不能超过 ${AGENT_ATTACHMENT_MAX_FILE_BYTES / 1024 / 1024} MiB。`,
          );
        }
        tickets.delete(submission.attachmentId);
        resolved.push({
          id: submission.attachmentId,
          name: ticket.name,
          mimeType: ticket.mimeType,
          sizeBytes: ticket.sizeBytes,
          kind: ticket.kind,
          sourcePath: ticket.sourcePath,
        });
      }
      return resolved;
    },

    clear: () => tickets.clear(),
  };
}

function mimeTypeForPath(name: string, kind: 'image' | 'file'): string {
  const extension = extname(name).toLowerCase();
  if (kind === 'image') {
    return IMAGE_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
  }
  return FILE_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}
