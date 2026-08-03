import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';
import type { AgentAttachmentInput } from '@synapse-term/domain';

import {
  cleanupAgentAttachmentSession,
  stageAgentAttachments,
  validateAgentAttachmentInputs,
} from './agent-attachment-staging.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fileAttachment(overrides: Partial<AgentAttachmentInput> = {}): AgentAttachmentInput {
  return {
    id: 'file-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    sizeBytes: 4,
    kind: 'file',
    sourcePath: 'C:/tmp/notes.txt',
    ...overrides,
  };
}

function imageAttachment(overrides: Partial<AgentAttachmentInput> = {}): AgentAttachmentInput {
  return {
    id: 'image-1',
    name: 'shot.png',
    mimeType: 'image/png',
    sizeBytes: PNG_BYTES.length,
    kind: 'image',
    sourcePath: 'C:/tmp/shot.png',
    ...overrides,
  };
}

function assertValidationCode(fn: () => void, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  expect.fail('expected agent attachment validation error');
}

describe('agent attachment staging', () => {
  it('validates count, multimodal gate, MIME, and size limits', () => {
    expect(() => validateAgentAttachmentInputs([], true)).not.toThrow();
    assertValidationCode(
      () =>
        validateAgentAttachmentInputs(
          Array.from({ length: 9 }, (_, index) => fileAttachment({ id: `${index}` })),
          true,
        ),
      'agent_attachment_limit',
    );
    assertValidationCode(
      () => validateAgentAttachmentInputs([imageAttachment()], false),
      'multimodal_unsupported',
    );
    assertValidationCode(
      () => validateAgentAttachmentInputs([imageAttachment({ mimeType: 'image/bmp' })], true),
      'unsupported_image_mime',
    );
    assertValidationCode(
      () =>
        validateAgentAttachmentInputs([fileAttachment({ sizeBytes: 50 * 1024 * 1024 + 1 })], true),
      'attachment_too_large',
    );
    assertValidationCode(
      () =>
        validateAgentAttachmentInputs([imageAttachment({ sizeBytes: 10 * 1024 * 1024 + 1 })], true),
      'attachment_too_large',
    );
  });

  it('stages files and image content blocks with safe relative paths', async () => {
    await withTemporaryDirectory(async (directory) => {
      const source = join(directory, 'source');
      await mkdir(source);
      await writeFile(join(source, 'notes.txt'), 'hello');
      await writeFile(join(source, 'shot.png'), PNG_BYTES);

      const bundle = await stageAgentAttachments({
        sessionId: 'session-1',
        taskId: 'task-1',
        multimodal: true,
        attachments: [
          fileAttachment({ sourcePath: join(source, 'notes.txt'), sizeBytes: 5 }),
          imageAttachment({ sourcePath: join(source, 'shot.png') }),
        ],
      });

      try {
        expect(bundle.attachments).toEqual([
          expect.objectContaining({ id: 'file-1', relativePath: '0-notes.txt' }),
          expect.objectContaining({
            id: 'image-1',
            dataBase64: PNG_BYTES.toString('base64'),
          }),
        ]);
        expect(bundle.root).toEqual(
          expect.stringContaining(join('.synapse-term-attachments', 'session-1', 'task-1')),
        );
        expect(await readdir(join(bundle.root!, '..'))).toContain('task-1');
        expect(await readFile(join(bundle.root!, '0-notes.txt'), 'utf8')).toBe('hello');
      } finally {
        await bundle.dispose();
      }
    });
  });

  it('rejects mismatched image bytes and cleans partial staging', async () => {
    await withTemporaryDirectory(async (directory) => {
      const source = join(directory, 'fake.png');
      await writeFile(source, 'not an image');
      await expect(
        stageAgentAttachments({
          sessionId: 'session-2',
          taskId: 'task-2',
          multimodal: true,
          attachments: [imageAttachment({ sourcePath: source, sizeBytes: 12 })],
        }),
      ).rejects.toMatchObject({ code: 'unsupported_image_mime' });
      await expect(
        cleanupAgentAttachmentSession({ sessionId: 'session-2' }),
      ).resolves.toBeUndefined();
    });
  });

  it('sanitizes source names and never creates nested relative paths', async () => {
    await withTemporaryDirectory(async (directory) => {
      const source = join(directory, 'escape.txt');
      await writeFile(source, 'safe');
      const bundle = await stageAgentAttachments({
        sessionId: 'session-3',
        taskId: 'task-3',
        multimodal: true,
        attachments: [fileAttachment({ name: '../../escape.txt', sourcePath: source })],
      });
      try {
        expect(bundle.attachments[0]).toMatchObject({
          relativePath: '0-escape.txt',
        });
        expect(await readFile(join(bundle.root!, '0-escape.txt'), 'utf8')).toBe('safe');
      } finally {
        await bundle.dispose();
      }
    });
  });
});
