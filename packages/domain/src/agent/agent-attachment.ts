export type AgentAttachmentKind = 'image' | 'file';
export type AgentImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export const AGENT_ATTACHMENT_MAX_ITEMS = 8;
export const AGENT_ATTACHMENT_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const AGENT_ATTACHMENT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const AGENT_ATTACHMENT_IMAGE_MIME_TYPES: readonly AgentImageMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

export interface AgentAttachmentInput {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: AgentAttachmentKind;
  sourcePath: string;
}

export interface AgentAttachmentMetadata {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: AgentAttachmentKind;
  relativePath?: string | undefined;
}

export type StagedAgentAttachment =
  | {
      id: string;
      name: string;
      mimeType: AgentImageMimeType;
      sizeBytes: number;
      kind: 'image';
      relativePath?: string | undefined;
      dataBase64: string;
    }
  | {
      id: string;
      name: string;
      mimeType: string;
      sizeBytes: number;
      kind: 'file';
      relativePath: string;
    };
