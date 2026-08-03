import { z } from 'zod';

export type DesktopAttachmentKind = 'image' | 'file';

export interface PickedAgentAttachment {
  attachmentId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: DesktopAttachmentKind;
}

export interface DesktopAttachmentSource {
  sourcePath: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: DesktopAttachmentKind;
}

export const desktopAttachmentSubmissionSchema = z
  .array(
    z.strictObject({
      attachmentId: z.string().min(1),
      name: z.string().min(1),
      mimeType: z.string().min(1),
      sizeBytes: z.number().int().nonnegative(),
      kind: z.enum(['image', 'file']),
    }),
  )
  .max(8);

export const desktopAttachmentPickOptionsSchema = z.strictObject({
  kind: z.enum(['image', 'file']),
  currentCount: z.number().int().nonnegative().max(8).optional(),
});
