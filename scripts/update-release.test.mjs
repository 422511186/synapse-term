import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { createAppcast, validateAssets, validateSigningKey } from './update-release.mjs';

describe('release update assets', () => {
  it('accepts the RFC 8032 seed format used by Sparkle and rejects other keys', () => {
    const seed = Buffer.from(
      '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
      'hex',
    ).toString('base64');
    const publicKey = Buffer.from(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
      'hex',
    ).toString('base64');
    expect(() => validateSigningKey(seed, publicKey)).not.toThrow();
    expect(() => validateSigningKey(Buffer.alloc(32, 1).toString('base64'), publicKey)).toThrow(
      /match/,
    );
    expect(() => validateSigningKey(Buffer.alloc(64).toString('base64'), publicKey)).toThrow(
      /32-byte/,
    );
  });

  it('validates both platforms and rejects a signed DMG changed after publishing its manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synapse-release-test-'));
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const key = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
    const version = '0.6.0';
    const exeName = `Synapse-Term-${version}-x64-Setup.exe`;
    const dmgName = `Synapse-Term-${version}-arm64.dmg`;
    const exe = Buffer.from('fixture EXE');
    const dmg = Buffer.from('fixture DMG');
    try {
      await writeFile(join(directory, exeName), exe);
      await writeFile(
        join(directory, `${exeName}.blockmap`),
        gzipSync(
          JSON.stringify({
            version: '2',
            files: [{ name: 'file', offset: 0, checksums: ['checksum'], sizes: [exe.length] }],
          }),
        ),
      );
      await writeFile(join(directory, dmgName), dmg);
      await writeFile(
        join(directory, 'latest.yml'),
        yaml.dump({
          version,
          files: [
            {
              url: exeName,
              size: exe.length,
              sha512: createHash('sha512').update(exe).digest('base64'),
            },
          ],
        }),
      );
      await writeFile(
        join(directory, 'appcast.xml'),
        createAppcast(version, dmg.length, sign(null, dmg, privateKey).toString('base64')),
      );
      await writeFile(
        join(directory, 'mac-update-build.json'),
        JSON.stringify({
          version,
          publicKey: key,
          testBuild: false,
          arch: 'arm64',
          sparkleVersion: '2.9.6',
        }),
      );
      await validateAssets({ directory, version, publicKey: key });
      expect(await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).toContain(dmgName);
      await writeFile(
        join(directory, 'mac-update-build.json'),
        JSON.stringify({
          version,
          publicKey: key,
          testBuild: true,
          arch: 'arm64',
          sparkleVersion: '2.9.6',
        }),
      );
      await expect(validateAssets({ directory, version, publicKey: key })).rejects.toThrow(
        /production/i,
      );
      await validateAssets({ directory, version, publicKey: key, allowTestBuild: true });
      await writeFile(
        join(directory, 'mac-update-build.json'),
        JSON.stringify({
          version,
          publicKey: key,
          testBuild: false,
          arch: 'arm64',
          sparkleVersion: '2.9.6',
        }),
      );
      await writeFile(join(directory, dmgName), 'changed DMG');
      await expect(validateAssets({ directory, version, publicKey: key })).rejects.toThrow(
        /signature/i,
      );
      await writeFile(join(directory, dmgName), dmg);
      await writeFile(join(directory, `${exeName}.blockmap`), 'broken blockmap');
      await expect(validateAssets({ directory, version, publicKey: key })).rejects.toThrow();
      await rm(join(directory, 'latest.yml'));
      await expect(validateAssets({ directory, version, publicKey: key })).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
