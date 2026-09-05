import { generateKeyPairSync } from 'node:crypto';
import { appendFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const keys = generateKeyPairSync('ed25519');
const privateJwk = keys.privateKey.export({ format: 'jwk' });
const publicKey = Buffer.from(privateJwk.x, 'base64url');
const secret = Buffer.from(privateJwk.d, 'base64url').toString('base64');

if (process.argv[2] === '--test-env') {
  if (!process.env.GITHUB_ENV || !process.env.CI)
    throw new Error('--test-env is only available in CI');
  console.log(`::add-mask::${secret}`);
  await appendFile(
    process.env.GITHUB_ENV,
    `SPARKLE_PUBLIC_KEY=${publicKey.toString('base64')}\nSPARKLE_PRIVATE_KEY=${secret}\nSYNAPSE_UPDATE_TEST_BUILD=1\n`,
  );
  console.log('Generated a separate test update key for this CI run.');
} else {
  const target = process.argv[2];
  if (!target || !isAbsolute(target)) {
    throw new Error('Pass an absolute key-file path outside the repository.');
  }
  const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const parent = await realpath(dirname(resolve(target)));
  const fromRoot = relative(root, parent);
  if (
    fromRoot === '' ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
  ) {
    throw new Error('Key files must be outside the repository, including symlink targets.');
  }
  const privatePath = join(parent, basename(target));
  await writeFile(privatePath, `${secret}\n`, { flag: 'wx', mode: 0o600 });
  try {
    await writeFile(`${privatePath}.pub`, `${publicKey.toString('base64')}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    await rm(privatePath);
    throw error;
  }
  console.log(
    `Public key: ${publicKey.toString('base64')}\nPrivate key created at the requested path. Back it up securely before the first release.`,
  );
}
