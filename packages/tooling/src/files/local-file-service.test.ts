import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { LocalFileService } from './local-file-service.js';

describe('LocalFileService', () => {
  it('rejects paths that are not safe relative paths under home', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      await mkdir(home);
      const service = await LocalFileService.create({ root: home });

      for (const path of [
        '..\\outside.txt',
        'C:\\outside.txt',
        '\\\\server\\share\\file.txt',
        '\\\\?\\C:\\device.txt',
        'folder\\secret.txt:stream',
        'NUL.txt',
        'folder\\COM1',
        'has\0nul',
      ]) {
        await expect(service.read({ path })).rejects.toMatchObject({ code: 'local_path_invalid' });
      }
    });
  });

  it('rejects a junction or symlink that resolves outside home', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      const outside = join(directory, 'outside');
      await mkdir(home);
      await mkdir(outside);
      await writeFile(join(outside, 'secret.txt'), 'outside');
      await symlink(
        outside,
        join(home, 'escape'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const service = await LocalFileService.create({ root: home });

      await expect(service.read({ path: 'escape/secret.txt' })).rejects.toMatchObject({
        code: 'local_path_escape',
      });
    });
  });

  it('lists entries in stable relative-path order with depth and result bounds', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      await mkdir(join(home, 'project', 'nested'), { recursive: true });
      await writeFile(join(home, 'project', 'z.txt'), 'z');
      await writeFile(join(home, 'project', 'a.txt'), 'a');
      await writeFile(join(home, 'project', 'nested', 'deep.txt'), 'deep');
      const service = await LocalFileService.create({ root: home });

      await expect(
        service.list({ path: 'project', maxDepth: 1, maxResults: 2 }),
      ).resolves.toMatchObject({
        entries: [
          { path: 'project/a.txt', type: 'file', size: 1 },
          { path: 'project/nested', type: 'directory' },
        ],
        truncated: true,
      });
    });
  });

  it('searches file names and bounded text content', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      await mkdir(join(home, 'project'), { recursive: true });
      await writeFile(join(home, 'project', 'app.log'), 'ready\nneedle here\n');
      await writeFile(join(home, 'project', 'notes.txt'), 'nothing');
      const service = await LocalFileService.create({ root: home });

      await expect(
        service.search({ path: 'project', query: '.log', mode: 'filename', maxResults: 10 }),
      ).resolves.toMatchObject({ results: [{ path: 'project/app.log', type: 'file' }] });
      await expect(
        service.search({ path: 'project', query: 'needle', mode: 'content', maxResults: 10 }),
      ).resolves.toMatchObject({
        results: [{ path: 'project/app.log', line: 2, preview: 'needle here' }],
        truncated: false,
      });
    });
  });

  it('bounds aggregate bytes read during content search and supports cancellation', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      await mkdir(home);
      await writeFile(join(home, 'a.txt'), 'needle');
      await writeFile(join(home, 'b.txt'), 'needle');
      const service = await LocalFileService.create({ root: home });

      await expect(
        service.search({ path: '', query: 'needle', mode: 'content', maxBytes: 6 }),
      ).resolves.toMatchObject({
        results: [{ path: 'a.txt', line: 1 }],
        bytesRead: 6,
        truncated: true,
      });

      const controller = new AbortController();
      controller.abort();
      await expect(
        service.search({ path: '', query: 'needle', mode: 'content' }, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  it('reads UTF-8 and BOM UTF-16 text with hashes and rejects binary files', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      await mkdir(home);
      const utf8 = Buffer.from('one\ntwo\nthree\n', 'utf8');
      const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('甲\n乙', 'utf16le')]);
      await writeFile(join(home, 'utf8.txt'), utf8);
      await writeFile(join(home, 'utf16.txt'), utf16);
      await writeFile(join(home, 'binary.bin'), Buffer.from([0, 1, 2, 3, 255]));
      const service = await LocalFileService.create({ root: home });

      await expect(
        service.read({ path: 'utf8.txt', startLine: 2, endLine: 2 }),
      ).resolves.toMatchObject({
        path: 'utf8.txt',
        content: 'two',
        encoding: 'utf8',
        sha256: sha256(utf8),
      });
      await expect(service.read({ path: 'utf16.txt' })).resolves.toMatchObject({
        content: '甲\n乙',
        encoding: 'utf16le',
        sha256: sha256(utf16),
      });
      await expect(service.read({ path: 'binary.bin' })).rejects.toMatchObject({
        code: 'local_file_binary',
      });
    });
  });

  it('creates and replaces files atomically with optimistic hash checks', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      await mkdir(home);
      const service = await LocalFileService.create({ root: home });

      const created = await service.write({ path: 'config.txt', mode: 'create', content: 'v1' });
      expect(created).toMatchObject({
        path: 'config.txt',
        operation: 'create',
        sha256: sha256('v1'),
      });
      await expect(
        service.write({
          path: 'config.txt',
          mode: 'replace',
          content: 'v2',
          expectedSha256: '0'.repeat(64),
        }),
      ).rejects.toMatchObject({ code: 'local_file_conflict', recoverable: true });
      expect(await readFile(join(home, 'config.txt'), 'utf8')).toBe('v1');

      await expect(
        service.write({
          path: 'config.txt',
          mode: 'replace',
          content: 'v2',
          expectedSha256: created.sha256,
        }),
      ).resolves.toMatchObject({ beforeSha256: created.sha256, sha256: sha256('v2') });
      expect(await readFile(join(home, 'config.txt'), 'utf8')).toBe('v2');
      expect((await readdir(home)).some((name) => name.startsWith('.terminal-agent-'))).toBe(false);
    });
  });

  it('applies exact edits all-or-nothing against the expected hash', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      await mkdir(home);
      await writeFile(join(home, 'app.txt'), 'alpha\nbeta\nalpha\n');
      const service = await LocalFileService.create({ root: home });
      const current = await service.read({ path: 'app.txt' });

      await expect(
        service.edit({
          path: 'app.txt',
          expectedSha256: current.sha256,
          edits: [
            { oldText: 'beta', newText: 'BETA' },
            { oldText: 'alpha', newText: 'ALPHA' },
          ],
        }),
      ).rejects.toMatchObject({ code: 'local_file_edit_conflict', recoverable: true });
      expect(await readFile(join(home, 'app.txt'), 'utf8')).toBe('alpha\nbeta\nalpha\n');

      await expect(
        service.edit({
          path: 'app.txt',
          expectedSha256: current.sha256,
          edits: [
            { oldText: 'beta', newText: 'BETA' },
            { oldText: 'alpha', newText: 'ALPHA', replaceAll: true },
          ],
        }),
      ).resolves.toMatchObject({ sha256: sha256('ALPHA\nBETA\nALPHA\n') });
      expect(await readFile(join(home, 'app.txt'), 'utf8')).toBe('ALPHA\nBETA\nALPHA\n');
    });
  });
});

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
