import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import yaml from 'js-yaml';
import semver from 'semver';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'https://github.com/422511186/synapse-term/releases';
const maxSize = 512 * 1024 * 1024;

function stable(version) {
  if (semver.valid(version) !== version || semver.prerelease(version) || version.includes('+'))
    throw new Error('A stable X.Y.Z version is required');
  return version;
}

function publicKeyObject(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error('SPARKLE_PUBLIC_KEY must be a 32-byte base64 Ed25519 public key');
  return createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(value, 'base64').toString('base64url') },
  });
}

export function validateSigningKey(secret, publicKey) {
  const key = publicKeyObject(publicKey);
  if (typeof secret !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(secret)) {
    throw new Error('SPARKLE_PRIVATE_KEY must contain a 32-byte base64 Sparkle seed');
  }
  // RFC 8410 PKCS#8 wraps the raw seed; OpenSSL derives its public key independently.
  const privateKey = createPrivateKey({
    format: 'der',
    type: 'pkcs8',
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(secret, 'base64'),
    ]),
  });
  if (createPublicKey(privateKey).export({ format: 'jwk' }).x !== key.export({ format: 'jwk' }).x) {
    throw new Error('Production update keys do not match');
  }
  return key;
}

export async function packageVersion(tag) {
  const main = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const desktop = JSON.parse(await readFile(join(root, 'apps/desktop/package.json'), 'utf8'));
  stable(main.version);
  if (main.version !== desktop.version || (tag && tag !== `v${main.version}`))
    throw new Error('Tag, root package and desktop package versions must match');
  return main.version;
}

export function createAppcast(version, length, signature) {
  stable(version);
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) throw new Error('Invalid DMG signature');
  return new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: true }).build({
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    rss: {
      '@_version': '2.0',
      '@_xmlns:sparkle': 'http://www.andymatuschak.org/xml-namespaces/sparkle',
      channel: {
        title: 'Synapse Term',
        link: base,
        description: 'Synapse Term macOS updates',
        item: {
          title: `Synapse Term ${version}`,
          pubDate: new Date().toUTCString(),
          'sparkle:version': version,
          'sparkle:shortVersionString': version,
          'sparkle:minimumSystemVersion': '12.0',
          'sparkle:hardwareRequirements': 'arm64',
          enclosure: {
            '@_url': `${base}/download/v${version}/Synapse-Term-${version}-arm64.dmg`,
            '@_length': String(length),
            '@_type': 'application/octet-stream',
            '@_sparkle:os': 'macos',
            '@_sparkle:installationType': 'application',
            '@_sparkle:edSignature': signature,
          },
        },
      },
    },
  });
}

async function hashFile(path, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest(encoding);
}

export async function validateAssets({ directory, version, publicKey, allowTestBuild = false }) {
  stable(version);
  const key = publicKeyObject(publicKey);
  const exe = `Synapse-Term-${version}-x64-Setup.exe`;
  const dmg = `Synapse-Term-${version}-arm64.dmg`;
  const names = [exe, `${exe}.blockmap`, 'latest.yml', dmg, 'appcast.xml', 'mac-update-build.json'];
  const present = await readdir(directory);
  if (present.some((name) => ![...names, 'SHA256SUMS.txt'].includes(name)))
    throw new Error('Unexpected release asset');
  for (const name of names) {
    const info = await stat(join(directory, name));
    if (!info.isFile() || info.size <= 0 || info.size > maxSize)
      throw new Error(`Invalid asset: ${name}`);
  }
  const manifest = yaml.load(await readFile(join(directory, 'latest.yml'), 'utf8'));
  const file = manifest?.files?.[0];
  if (
    manifest?.version !== version ||
    manifest?.files?.length !== 1 ||
    'packages' in manifest ||
    file?.url !== exe ||
    file?.size !== (await stat(join(directory, exe))).size ||
    file?.sha512 !== (await hashFile(join(directory, exe), 'sha512', 'base64'))
  )
    throw new Error('Windows manifest version, URL, size or checksum mismatch');
  const blockmap = JSON.parse(
    gunzipSync(await readFile(join(directory, `${exe}.blockmap`)), {
      maxOutputLength: 16 * 1024 * 1024,
    }).toString('utf8'),
  );
  const block = blockmap?.files?.[0];
  if (
    blockmap?.version !== '2' ||
    blockmap?.files?.length !== 1 ||
    block?.offset !== 0 ||
    !Array.isArray(block?.sizes) ||
    !Array.isArray(block?.checksums) ||
    block.sizes.length !== block.checksums.length ||
    block.sizes.some((size) => !Number.isSafeInteger(size) || size <= 0) ||
    block.checksums.some((checksum) => typeof checksum !== 'string' || checksum.length === 0) ||
    block.sizes.reduce((total, size) => total + size, 0) !== file.size
  )
    throw new Error('Invalid Windows blockmap');
  const xml = await readFile(join(directory, 'appcast.xml'), 'utf8');
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error('Invalid appcast XML');
  const item = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
  }).parse(xml)?.rss?.channel?.item;
  const enclosure = item?.enclosure;
  if (
    item?.['sparkle:version'] !== version ||
    item?.['sparkle:shortVersionString'] !== version ||
    item?.['sparkle:hardwareRequirements'] !== 'arm64' ||
    enclosure?.['@_sparkle:os'] !== 'macos' ||
    enclosure?.['@_sparkle:installationType'] !== 'application' ||
    enclosure?.['@_url'] !== `${base}/download/v${version}/${dmg}` ||
    Number(enclosure?.['@_length']) !== (await stat(join(directory, dmg))).size
  )
    throw new Error('macOS appcast version, architecture, URL or size mismatch');
  const signature = enclosure['@_sparkle:edSignature'];
  if (
    typeof signature !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(signature) ||
    !verify(null, await readFile(join(directory, dmg)), key, Buffer.from(signature, 'base64'))
  )
    throw new Error('macOS update signature mismatch');
  const build = JSON.parse(await readFile(join(directory, 'mac-update-build.json'), 'utf8'));
  if (
    build.version !== version ||
    build.publicKey !== publicKey ||
    build.arch !== 'arm64' ||
    build.sparkleVersion !== '2.9.6' ||
    (build.testBuild !== false && !(allowTestBuild && build.testBuild === true))
  )
    throw new Error('macOS build metadata or production public key mismatch');
  const sums = [];
  for (const name of names)
    sums.push(`${await hashFile(join(directory, name), 'sha256', 'hex')}  ${name}`);
  await writeFile(join(directory, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
  return [...names, 'SHA256SUMS.txt'];
}

async function signMac(version) {
  if (process.platform !== 'darwin') throw new Error('Sparkle signing requires macOS');
  const publicKey = process.env.SPARKLE_PUBLIC_KEY?.trim();
  const secret = process.env.SPARKLE_PRIVATE_KEY?.trim();
  const key = validateSigningKey(secret, publicKey);
  const directory = join(root, 'release');
  const path = join(directory, `Synapse-Term-${version}-arm64.dmg`);
  const result = spawnSync(
    join(root, '.packaging/sparkle-2.9.6/bin/sign_update'),
    ['--ed-key-file', '-', '-p', path],
    {
      input: `${secret}\n`,
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  // Never forward signer stderr: an invalid key parser may include its input.
  if (result.status !== 0) throw new Error('Sparkle sign_update failed');
  const signature = result.stdout.trim();
  if (
    !/^[A-Za-z0-9+/]{86}==$/.test(signature) ||
    !verify(null, await readFile(path), key, Buffer.from(signature, 'base64'))
  ) {
    throw new Error('Sparkle signature verification failed');
  }
  await writeFile(
    join(directory, 'appcast.xml'),
    createAppcast(version, (await stat(path)).size, signature),
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.SYNAPSE_UPDATE_TEST_BUILD) {
      throw new Error('Test update builds cannot be published');
    }
    const version = await packageVersion(
      process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined,
    );
    const command = process.argv[2];
    if (command === 'versions') console.log(`Release versions match: ${version}`);
    else if (command === 'production-keys') {
      if (process.env.SYNAPSE_UPDATE_TEST_BUILD)
        throw new Error('Test update builds cannot be published');
      validateSigningKey(
        process.env.SPARKLE_PRIVATE_KEY?.trim(),
        process.env.SPARKLE_PUBLIC_KEY?.trim(),
      );
      console.log('Production update key configuration is valid.');
    } else if (command === 'sign-mac') await signMac(version);
    else if (command === 'validate') {
      await validateAssets({
        directory: resolve(process.argv[3] ?? 'release-assets'),
        version,
        publicKey: process.env.SPARKLE_PUBLIC_KEY?.trim(),
        allowTestBuild: process.env.SYNAPSE_UPDATE_TEST_BUILD === '1',
      });
      console.log(`Validated complete update assets for ${version}`);
    } else throw new Error('Expected versions, production-keys, sign-mac or validate');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
