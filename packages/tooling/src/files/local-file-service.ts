import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, readdir, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

import type {
  LocalEditFileInput,
  LocalListFilesInput,
  LocalReadFileInput,
  LocalSearchFilesInput,
  LocalWriteFileInput,
} from '@synapse-term/protocol';

type TextEncoding = 'utf8' | 'utf16le' | 'utf16be';

export class LocalFileError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(code: string, message: string, recoverable = false) {
    super(message);
    this.name = 'LocalFileError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

export interface LocalFileChangePreview {
  path: string;
  operation: 'create' | 'replace' | 'edit';
  beforeSha256?: string;
  afterSha256: string;
  bytes: number;
  diff: string;
  truncated: boolean;
}

export class LocalFileService {
  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
  }

  static async create(options: { root: string }): Promise<LocalFileService> {
    const canonicalRoot = await realpath(options.root);
    return new LocalFileService(canonicalRoot);
  }

  get root(): string {
    return this.#root;
  }

  async list(input: LocalListFilesInput) {
    const baseRelative = this.#validateRelative(input.path ?? '', true);
    const base = await this.#resolveExisting(baseRelative);
    const baseStat = await lstat(base);
    if (!baseStat.isDirectory()) {
      throw new LocalFileError('local_file_not_directory', 'Local path is not a directory');
    }
    const maxDepth = input.maxDepth ?? 1;
    const maxResults = input.maxResults ?? 200;
    const entries = await this.#collectEntries(base, baseRelative, maxDepth, maxResults + 1);
    return {
      path: baseRelative,
      entries: entries.slice(0, maxResults),
      truncated: entries.length > maxResults,
    };
  }

  async search(input: LocalSearchFilesInput, signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
    const baseRelative = this.#validateRelative(input.path ?? '', true);
    const base = await this.#resolveExisting(baseRelative);
    const baseStat = await lstat(base);
    if (!baseStat.isDirectory()) {
      throw new LocalFileError('local_file_not_directory', 'Local path is not a directory');
    }
    const maxDepth = input.maxDepth ?? 8;
    const maxResults = input.maxResults ?? 200;
    const maxReadBytes = input.maxBytes ?? 8 * 1024 * 1024;
    const deadline = Date.now() + (input.timeoutMs ?? 5_000);
    const candidates = await this.#collectEntries(base, baseRelative, maxDepth, 20_000);
    const query = input.query.toLocaleLowerCase('en-US');
    const results: Array<Record<string, unknown>> = [];
    let truncated = false;
    let timedOut = false;
    let bytesRead = 0;

    for (const entry of candidates) {
      if (signal?.aborted) throw abortError();
      if (Date.now() > deadline) {
        truncated = true;
        timedOut = true;
        break;
      }
      if (input.mode === 'filename') {
        if (entry.path.toLocaleLowerCase('en-US').includes(query)) {
          results.push({ path: entry.path, type: entry.type });
        }
      } else if (entry.type === 'file') {
        if (bytesRead >= maxReadBytes) {
          truncated = true;
          break;
        }
        try {
          const target = await this.#resolveExisting(entry.path);
          const info = await lstat(target);
          if (info.size > 1024 * 1024) continue;
          if (bytesRead + info.size > maxReadBytes) {
            truncated = true;
            break;
          }
          const buffer = await readBounded(target, 1024 * 1024);
          bytesRead += buffer.length;
          const decoded = decodeText(buffer);
          const lines = decoded.text.split(/\r?\n/);
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index]!;
            if (!line.toLocaleLowerCase('en-US').includes(query)) continue;
            results.push({ path: entry.path, line: index + 1, preview: line.slice(0, 500) });
            if (results.length >= maxResults) break;
          }
        } catch (error) {
          if (!(error instanceof LocalFileError) || error.code !== 'local_file_binary') throw error;
        }
      }
      if (results.length >= maxResults) {
        truncated = true;
        break;
      }
    }

    return { path: baseRelative, results, truncated, timedOut, bytesRead };
  }

  async read(input: LocalReadFileInput) {
    const relativePath = this.#validateRelative(input.path, false);
    const target = await this.#resolveExisting(relativePath);
    const file = await this.#readTextFile(target);
    const lines = file.text.split(/\r?\n/);
    const startLine = input.startLine ?? 1;
    const endLine = input.endLine ?? lines.length;
    if (endLine < startLine) {
      throw new LocalFileError('local_file_range_invalid', 'endLine must not precede startLine');
    }
    let content = lines.slice(startLine - 1, endLine).join('\n');
    const bounded = takeUtf8(content, input.maxBytes ?? 256 * 1024);
    content = bounded.text;
    return {
      path: relativePath,
      content,
      encoding: file.encoding,
      sha256: file.sha256,
      totalBytes: file.buffer.length,
      startLine,
      endLine: Math.min(endLine, lines.length),
      truncated: bounded.truncated || endLine < lines.length,
    };
  }

  async write(input: LocalWriteFileInput) {
    const relativePath = this.#validateRelative(input.path, false);
    const target = await this.#resolveWriteTarget(relativePath);
    const data = Buffer.from(input.content, 'utf8');
    if (input.mode === 'create') {
      await this.#atomicCreate(target, data);
      return {
        path: relativePath,
        operation: 'create' as const,
        sha256: hash(data),
        bytes: data.length,
      };
    }

    const current = await this.#readExistingBuffer(target);
    const beforeSha256 = hash(current);
    if (!equalHash(beforeSha256, input.expectedSha256)) {
      throw conflict('Local file changed since it was read');
    }
    await this.#atomicReplace(target, data, input.expectedSha256);
    return {
      path: relativePath,
      operation: 'replace' as const,
      beforeSha256,
      sha256: hash(data),
      bytes: data.length,
    };
  }

  async previewWrite(input: LocalWriteFileInput): Promise<LocalFileChangePreview> {
    const relativePath = this.#validateRelative(input.path, false);
    const target = await this.#resolveWriteTarget(relativePath);
    const data = Buffer.from(input.content, 'utf8');
    if (input.mode === 'create') {
      const exists = await lstat(target).then(
        () => true,
        (error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
          throw mapFsError(error);
        },
      );
      if (exists) throw conflict('Local file already exists');
      const diff = createUnifiedDiff(relativePath, '', input.content);
      return {
        path: relativePath,
        operation: 'create',
        afterSha256: hash(data),
        bytes: data.length,
        ...diff,
      };
    }

    const current = await this.#readExistingBuffer(target);
    const beforeSha256 = hash(current);
    if (!equalHash(beforeSha256, input.expectedSha256)) {
      throw conflict('Local file changed since it was read');
    }
    const before = decodeText(current).text;
    const diff = createUnifiedDiff(relativePath, before, input.content);
    return {
      path: relativePath,
      operation: 'replace',
      beforeSha256,
      afterSha256: hash(data),
      bytes: data.length,
      ...diff,
    };
  }

  async edit(input: LocalEditFileInput) {
    const prepared = await this.#prepareEdit(input);
    const { relativePath, target, file, data } = prepared;
    await this.#atomicReplace(target, data, input.expectedSha256);
    return {
      path: relativePath,
      operation: 'edit' as const,
      beforeSha256: file.sha256,
      sha256: hash(data),
      bytes: data.length,
    };
  }

  async previewEdit(input: LocalEditFileInput): Promise<LocalFileChangePreview> {
    const prepared = await this.#prepareEdit(input);
    const diff = createUnifiedDiff(prepared.relativePath, prepared.file.text, prepared.next);
    return {
      path: prepared.relativePath,
      operation: 'edit',
      beforeSha256: prepared.file.sha256,
      afterSha256: hash(prepared.data),
      bytes: prepared.data.length,
      ...diff,
    };
  }

  async #prepareEdit(input: LocalEditFileInput): Promise<{
    relativePath: string;
    target: string;
    file: { buffer: Buffer; text: string; encoding: TextEncoding; sha256: string };
    next: string;
    data: Buffer;
  }> {
    const relativePath = this.#validateRelative(input.path, false);
    const target = await this.#resolveExisting(relativePath);
    const file = await this.#readTextFile(target);
    if (!equalHash(file.sha256, input.expectedSha256)) {
      throw conflict('Local file changed since it was read');
    }

    let next = file.text;
    for (const edit of input.edits) {
      const matches = countOccurrences(next, edit.oldText);
      if (matches === 0 || (edit.replaceAll !== true && matches !== 1)) {
        throw new LocalFileError(
          'local_file_edit_conflict',
          'Exact edit text did not match the expected number of occurrences',
          true,
        );
      }
      next =
        edit.replaceAll === true
          ? next.split(edit.oldText).join(edit.newText)
          : next.replace(edit.oldText, edit.newText);
    }
    return { relativePath, target, file, next, data: encodeText(next, file.encoding) };
  }

  async #collectEntries(
    base: string,
    baseRelative: string,
    maxDepth: number,
    maxEntries: number,
  ): Promise<Array<{ path: string; type: string; size: number; modifiedAt: string }>> {
    const results: Array<{ path: string; type: string; size: number; modifiedAt: string }> = [];
    const walk = async (
      directory: string,
      relativeDirectory: string,
      depth: number,
    ): Promise<void> => {
      if (results.length >= maxEntries) return;
      const children = await readdir(directory, { withFileTypes: true });
      children.sort((left, right) => stableCompare(left.name, right.name));
      for (const child of children) {
        const childRelative = joinRelative(relativeDirectory, child.name);
        const childPath = resolve(directory, child.name);
        const info = await lstat(childPath);
        const type = info.isSymbolicLink()
          ? 'symlink'
          : info.isDirectory()
            ? 'directory'
            : info.isFile()
              ? 'file'
              : 'other';
        results.push({
          path: childRelative,
          type,
          size: info.isFile() ? info.size : 0,
          modifiedAt: info.mtime.toISOString(),
        });
        if (results.length >= maxEntries) return;
        if (type === 'directory' && depth < maxDepth) {
          const canonical = await realpath(childPath);
          this.#assertInside(canonical);
          await walk(canonical, childRelative, depth + 1);
        }
      }
    };
    await walk(base, baseRelative, 1);
    return results;
  }

  async #readTextFile(target: string): Promise<{
    buffer: Buffer;
    text: string;
    encoding: TextEncoding;
    sha256: string;
  }> {
    const buffer = await readBounded(target, 16 * 1024 * 1024);
    const decoded = decodeText(buffer);
    return { buffer, ...decoded, sha256: hash(buffer) };
  }

  async #readExistingBuffer(target: string): Promise<Buffer> {
    const canonical = await realpath(target).catch((error: unknown) => {
      throw mapFsError(error);
    });
    this.#assertInside(canonical);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new LocalFileError('local_file_invalid_type', 'Local path is not a regular file');
    }
    return readBounded(target, 16 * 1024 * 1024);
  }

  async #resolveExisting(relativePath: string): Promise<string> {
    const candidate = resolve(this.#root, ...segments(relativePath));
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch (error) {
      throw mapFsError(error);
    }
    this.#assertInside(canonical);
    return canonical;
  }

  async #resolveWriteTarget(relativePath: string): Promise<string> {
    const candidate = resolve(this.#root, ...segments(relativePath));
    const canonicalParent = await realpath(dirname(candidate)).catch((error: unknown) => {
      throw mapFsError(error);
    });
    this.#assertInside(canonicalParent);
    const target = resolve(canonicalParent, candidate.slice(dirname(candidate).length + 1));
    this.#assertInside(target);
    return target;
  }

  #validateRelative(value: string, allowEmpty: boolean): string {
    if (value.includes('\0') || value.includes(':') || isAbsolute(value) || /^[\\/]/.test(value)) {
      throw invalidPath();
    }
    const parts = value.split(/[\\/]+/).filter((part) => part.length > 0 && part !== '.');
    if ((!allowEmpty && parts.length === 0) || parts.some((part) => part === '..')) {
      throw invalidPath();
    }
    if (parts.some((part) => isReservedWindowsName(part))) throw invalidPath();
    return parts.join('/');
  }

  #assertInside(target: string): void {
    const root = pathKey(this.#root);
    const candidate = pathKey(target);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      throw new LocalFileError(
        'local_path_escape',
        'Local path resolves outside current user home',
      );
    }
  }

  async #atomicCreate(target: string, data: Buffer): Promise<void> {
    const temporary = temporaryPath(target);
    await writeSynced(temporary, data);
    try {
      await link(temporary, target);
    } catch (error) {
      throw mapFsError(error, 'local_file_conflict');
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async #atomicReplace(target: string, data: Buffer, expectedSha256: string): Promise<void> {
    const temporary = temporaryPath(target);
    await writeSynced(temporary, data);
    try {
      const current = await this.#readExistingBuffer(target);
      if (!equalHash(hash(current), expectedSha256)) {
        throw conflict('Local file changed before atomic replacement');
      }
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

async function readBounded(path: string, maximumBytes: number): Promise<Buffer> {
  const info = await lstat(path).catch((error: unknown) => {
    throw mapFsError(error);
  });
  if (!info.isFile()) {
    throw new LocalFileError('local_file_invalid_type', 'Local path is not a regular file');
  }
  if (info.size > maximumBytes) {
    throw new LocalFileError(
      'local_file_too_large',
      'Local file exceeds the configured byte limit',
    );
  }
  return readFile(path);
}

function decodeText(buffer: Buffer): { text: string; encoding: TextEncoding } {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf16le' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return { text: swapped.toString('utf16le'), encoding: 'utf16be' };
  }
  const content =
    buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;
  if (content.includes(0) || looksBinary(content)) {
    throw new LocalFileError('local_file_binary', 'Binary file cannot be disclosed as text');
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(content), encoding: 'utf8' };
  } catch {
    throw new LocalFileError('local_file_binary', 'File is not valid UTF-8 or BOM UTF-16 text');
  }
}

function encodeText(text: string, encoding: TextEncoding): Buffer {
  if (encoding === 'utf16le') {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  }
  if (encoding === 'utf16be') {
    const content = Buffer.from(text, 'utf16le');
    content.swap16();
    return Buffer.concat([Buffer.from([0xfe, 0xff]), content]);
  }
  return Buffer.from(text, 'utf8');
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  let controls = 0;
  for (const byte of buffer) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controls += 1;
  }
  return controls / buffer.length > 0.1;
}

async function writeSynced(path: string, data: Buffer): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function temporaryPath(target: string): string {
  return resolve(dirname(target), `.terminal-agent-${randomUUID()}.tmp`);
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function equalHash(left: string, right: string): boolean {
  return left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US');
}

function conflict(message: string): LocalFileError {
  return new LocalFileError('local_file_conflict', message, true);
}

function invalidPath(): LocalFileError {
  return new LocalFileError('local_path_invalid', 'Path must be a safe relative path under home');
}

function mapFsError(error: unknown, conflictCode?: string): LocalFileError {
  const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
  if (code === 'ENOENT')
    return new LocalFileError('local_file_not_found', 'Local file was not found');
  if (code === 'EEXIST' && conflictCode !== undefined) {
    return new LocalFileError(conflictCode, 'Local file already exists', true);
  }
  if (error instanceof LocalFileError) return error;
  return new LocalFileError(
    'local_file_io_error',
    error instanceof Error ? error.message : String(error),
  );
}

function isReservedWindowsName(segment: string): boolean {
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment);
}

function pathKey(value: string): string {
  const normalized = resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function segments(value: string): string[] {
  return value.length === 0 ? [] : value.split('/');
}

function joinRelative(parent: string, child: string): string {
  return parent.length === 0 ? child : `${parent}/${child}`;
}

function stableCompare(left: string, right: string): number {
  return (
    left.toLocaleLowerCase('en-US').localeCompare(right.toLocaleLowerCase('en-US'), 'en-US') ||
    left.localeCompare(right, 'en-US')
  );
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let index = 0;
  while (index <= value.length - search.length) {
    const found = value.indexOf(search, index);
    if (found < 0) break;
    count += 1;
    index = found + search.length;
  }
  return count;
}

function takeUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) return { text: value, truncated: false };
  return {
    text: new TextDecoder('utf-8').decode(buffer.subarray(0, maxBytes)),
    truncated: true,
  };
}

function createUnifiedDiff(
  path: string,
  before: string,
  after: string,
): { diff: string; truncated: boolean } {
  const header = `--- a/${path}\n+++ b/${path}\n@@\n`;
  const beforeLines = before
    .split('\n')
    .map((line) => `-${line}`)
    .join('\n');
  const afterLines = after
    .split('\n')
    .map((line) => `+${line}`)
    .join('\n');
  const bounded = takeUtf8(`${header}${beforeLines}\n${afterLines}`, 32 * 1024);
  return {
    diff: bounded.truncated ? `${bounded.text}\n[diff truncated]` : bounded.text,
    truncated: bounded.truncated,
  };
}

function abortError(): Error {
  const error = new Error('Local file search was cancelled');
  error.name = 'AbortError';
  return error;
}
