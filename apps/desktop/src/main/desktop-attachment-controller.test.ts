import { truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { createDesktopAttachmentController } from './desktop-attachment-controller.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('desktop attachment controller', () => {
  it('picks files and returns renderer metadata without sourcePath', async () => {
    await withTemporaryDirectory(async (directory) => {
      const file = join(directory, 'notes.txt');
      await writeFile(file, 'hello');
      const controller = createDesktopAttachmentController({
        selectPaths: async () => [file],
      });

      const picked = await controller.pick({ kind: 'file' });
      expect(picked).toEqual([
        {
          attachmentId: expect.any(String) as unknown as string,
          name: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 5,
          kind: 'file',
        },
      ]);
      expect(picked[0]).not.toHaveProperty('sourcePath');
      expect(picked[0]).not.toHaveProperty('id');
    });
  });

  it('resolves one-time tickets into Core attachment inputs', async () => {
    await withTemporaryDirectory(async (directory) => {
      const file = join(directory, 'shot.png');
      await writeFile(file, PNG_BYTES);
      const controller = createDesktopAttachmentController({
        selectPaths: async () => [file],
      });

      const [picked] = await controller.pick({ kind: 'image' });
      await expect(
        controller.resolve([
          {
            attachmentId: picked!.attachmentId,
            name: picked!.name,
            mimeType: picked!.mimeType,
            sizeBytes: picked!.sizeBytes,
            kind: picked!.kind,
          },
        ]),
      ).resolves.toEqual([
        {
          id: picked!.attachmentId,
          name: 'shot.png',
          mimeType: 'image/png',
          sizeBytes: PNG_BYTES.length,
          kind: 'image',
          sourcePath: file,
        },
      ]);

      await expect(
        controller.resolve([
          {
            attachmentId: picked!.attachmentId,
            name: picked!.name,
            mimeType: picked!.mimeType,
            sizeBytes: picked!.sizeBytes,
            kind: picked!.kind,
          },
        ]),
      ).rejects.toThrow('附件凭证已失效');
    });
  });

  it('enforces image MIME and size limits at pick time', async () => {
    await withTemporaryDirectory(async (directory) => {
      const unsupported = join(directory, 'shot.bmp');
      await writeFile(unsupported, PNG_BYTES);
      const controller = createDesktopAttachmentController({
        selectPaths: async () => [unsupported],
      });
      await expect(controller.pick({ kind: 'image' })).rejects.toThrow('不支持的图片类型');

      const oversized = join(directory, 'large.png');
      await writeFile(oversized, '');
      await truncate(oversized, 10 * 1024 * 1024 + 1);
      const oversizedController = createDesktopAttachmentController({
        selectPaths: async () => [oversized],
      });
      await expect(oversizedController.pick({ kind: 'image' })).rejects.toThrow(
        '图片不能超过 10 MiB',
      );
    });
  });

  it('enforces total count and rejects unknown renderer fields', async () => {
    await withTemporaryDirectory(async (directory) => {
      const file = join(directory, 'notes.txt');
      await writeFile(file, 'hello');
      const controller = createDesktopAttachmentController({
        selectPaths: async () => [file, file],
      });

      await expect(controller.pick({ kind: 'file', currentCount: 7 })).rejects.toThrow(
        '一次任务最多可携带 8 个附件',
      );
      await expect(controller.pick({ kind: 'file', currentCount: 8 })).rejects.toThrow(
        '一次任务最多可携带 8 个附件',
      );
      await expect(
        controller.resolve([
          {
            attachmentId: 'ticket-1',
            name: 'notes.txt',
            mimeType: 'text/plain',
            sizeBytes: 5,
            kind: 'file',
            sourcePath: file,
          },
        ]),
      ).rejects.toThrow();
    });
  });

  it('rejects expired tickets', async () => {
    await withTemporaryDirectory(async (directory) => {
      const file = join(directory, 'notes.txt');
      await writeFile(file, 'hello');
      const controller = createDesktopAttachmentController({
        selectPaths: async () => [file],
        ticketTtlMs: -1,
      });

      const [picked] = await controller.pick({ kind: 'file' });
      await expect(
        controller.resolve([
          {
            attachmentId: picked!.attachmentId,
            name: picked!.name,
            mimeType: picked!.mimeType,
            sizeBytes: picked!.sizeBytes,
            kind: picked!.kind,
          },
        ]),
      ).rejects.toThrow('附件凭证已失效');
    });
  });
});
