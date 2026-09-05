import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import plist from 'plist';

export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const helper = join(app, 'Contents/Helpers/SynapseUpdater.app/Contents/MacOS/SynapseUpdater');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  execFileSync('/usr/bin/lipo', ['-verify_arch', 'arm64', helper]);
  execFileSync('/usr/bin/lipo', [
    '-verify_arch',
    'arm64',
    join(app, 'Contents/MacOS/Synapse Term'),
  ]);
  if ((await readFile(join(app, 'Contents/Resources/Sparkle-LICENSE.txt'))).byteLength === 0) {
    throw new Error('Sparkle license is missing');
  }
  const info = plist.parse(await readFile(join(app, 'Contents/Info.plist'), 'utf8'));
  if (
    info.SUPublicEDKey !== process.env.SPARKLE_PUBLIC_KEY?.trim() ||
    info.SUVerifyUpdateBeforeExtraction !== true ||
    info.SUAutomaticallyUpdate !== false ||
    info.SUAllowsAutomaticUpdates !== false ||
    info.SUEnableAutomaticChecks !== false ||
    info.SUSendProfileInfo !== false ||
    info.SUFeedURL !==
      'https://github.com/422511186/synapse-term/releases/latest/download/appcast.xml' ||
    info.CFBundleVersion !== context.packager.appInfo.version
  )
    throw new Error('Invalid packaged Sparkle configuration');
  // Launch the bundled helper to check dylib resolution and rejection before any network/installation.
  const rejected = spawnSync(helper, [], {
    input: '{"command":"install","version":"invalid"}\n',
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (rejected.status !== 1 || JSON.parse(rejected.stdout.trim()).type !== 'error') {
    throw new Error('Packaged Sparkle helper failed the protocol check');
  }
  const prepared = spawnSync(helper, [], {
    input: `${JSON.stringify({
      command: 'prepare',
      version: info.CFBundleVersion,
      signature: Buffer.alloc(64).toString('base64'),
      length: 1,
    })}\n`,
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (prepared.status !== 0 || JSON.parse(prepared.stdout.trim()).type !== 'prepared') {
    throw new Error('Packaged Sparkle helper could not check its application volume');
  }
  const disconnected = spawnSync(helper, [], { input: '', encoding: 'utf8', timeout: 10_000 });
  if (disconnected.status !== 1) throw new Error('Sparkle helper did not exit after parent EOF');
}
