import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MacosUpdateAdapter } from './macos-update-adapter.js';
import { UpdateVerificationError } from './update-adapter.js';

describe('macOS signed update staging', () => {
  it('verifies Ed25519 before installation and rejects a changed download', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synapse-update-test-'));
    await mkdir(join(directory, 'download-orphan'));
    await writeFile(join(directory, 'download-orphan/update.dmg'), 'incomplete download');
    await writeFile(join(directory, 'unrelated.txt'), 'retained');
    const keys = generateKeyPairSync('ed25519');
    const bytes = Buffer.from('the signed DMG fixture');
    const publicKey = Buffer.from(
      keys.publicKey.export({ format: 'jwk' }).x!,
      'base64url',
    ).toString('base64');
    const signature = sign(null, bytes, keys.privateKey).toString('base64');
    const base = 'https://github.com/422511186/synapse-term/releases/download/v0.6.0/';
    const filename = 'Synapse-Term-0.6.0-arm64.dmg';
    let downloaded = bytes;
    let installations = 0;
    let readOnlyVolume = false;
    const engine = new MacosUpdateAdapter({
      currentVersion: '0.5.1',
      cacheDirectory: directory,
      native: {
        check: async () => ({
          version: '0.6.0',
          url: base + filename,
          length: bytes.length,
          signature,
          publicKey,
        }),
        install: async () => {
          installations++;
        },
        prepare: async () => {
          if (readOnlyVolume) throw new Error('Read-only application volume');
        },
        dispose: async () => undefined,
      },
      fetcher: async (url) =>
        String(url).includes('api.github.com')
          ? Response.json([
              {
                tag_name: 'v0.6.0',
                draft: false,
                prerelease: false,
                assets: [filename, 'appcast.xml'].map((name) => ({
                  name,
                  size: bytes.length,
                  browser_download_url: base + name,
                })),
              },
            ])
          : new Response(new Uint8Array(downloaded)),
    });
    try {
      const signal = new AbortController().signal;
      expect(await engine.check(signal)).toMatchObject({ version: '0.6.0' });
      await engine.download(signal, () => undefined);
      await expect(readFile(join(directory, 'download-orphan/update.dmg'))).rejects.toThrow();
      expect(await readFile(join(directory, 'unrelated.txt'), 'utf8')).toBe('retained');
      await engine.prepare();
      expect(installations).toBe(0);
      readOnlyVolume = true;
      await expect(engine.prepare()).rejects.toThrow('Read-only application volume');
      readOnlyVolume = false;
      downloaded = Buffer.from('bad signed DMG fixture');
      await expect(engine.download(signal, () => undefined)).rejects.toBeInstanceOf(
        UpdateVerificationError,
      );
      expect(installations).toBe(0);
    } finally {
      await engine.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
