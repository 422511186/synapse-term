import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import plist from 'plist';

import { packageVersion } from './update-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const sparkleVersion = '2.9.6';
const digest = '52bf9e88cdd972fc0c81501377a880e90d47031bd8ca5462488f843e2609e192';
const staging = join(root, '.packaging');
const sparkle = join(staging, `sparkle-${sparkleVersion}`);
const helper = join(staging, 'macos-updater/SynapseUpdater.app');

function publicKey() {
  const key = process.env.SPARKLE_PUBLIC_KEY?.trim();
  if (!key || !/^[A-Za-z0-9+/]{43}=$/.test(key))
    throw new Error(
      'Set a valid SPARKLE_PUBLIC_KEY before packaging macOS. See docs/engineering/app-updates.md.',
    );
  return key;
}

export async function fetchSparkle() {
  await mkdir(staging, { recursive: true });
  const archive = join(staging, `Sparkle-${sparkleVersion}.tar.xz`);
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch {
    const response = await fetch(
      `https://github.com/sparkle-project/Sparkle/releases/download/${sparkleVersion}/Sparkle-${sparkleVersion}.tar.xz`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok) throw new Error(`Sparkle download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== digest)
    throw new Error('Sparkle archive SHA-256 mismatch');
  await writeFile(archive, bytes);
  return archive;
}

async function prepare() {
  if (process.platform !== 'darwin') throw new Error('Native Sparkle preparation requires macOS');
  publicKey();
  const version = await packageVersion();
  const archive = await fetchSparkle();
  await mkdir(sparkle, { recursive: true });
  execFileSync('/usr/bin/tar', ['-xJf', archive, '-C', sparkle], { stdio: 'inherit' });
  const contents = join(helper, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await writeFile(
    join(contents, 'Info.plist'),
    plist.build({
      CFBundleIdentifier: 'com.synapseterm.desktop.updater',
      CFBundleName: 'SynapseUpdater',
      CFBundleExecutable: 'SynapseUpdater',
      CFBundlePackageType: 'APPL',
      CFBundleVersion: version,
      CFBundleShortVersionString: version,
      LSUIElement: true,
      LSMinimumSystemVersion: '12.0',
      SUEnableInstallerLauncherService: false,
      SUEnableDownloaderService: false,
      SUEnableInstallerConnectionService: false,
      SUEnableInstallerStatusService: false,
    }),
  );
  execFileSync(
    '/usr/bin/xcrun',
    [
      'clang',
      '-arch',
      'arm64',
      '-mmacosx-version-min=12.0',
      '-fobjc-arc',
      '-Wall',
      '-Wextra',
      '-Wno-unused-parameter',
      '-Werror=implicit-function-declaration',
      '-framework',
      'Cocoa',
      '-F',
      sparkle,
      '-framework',
      'Sparkle',
      '-Wl,-rpath,@executable_path/../../../../Frameworks',
      join(root, 'apps/desktop/native/updater.m'),
      '-o',
      join(contents, 'MacOS/SynapseUpdater'),
    ],
    { stdio: 'inherit' },
  );
  execFileSync('/usr/bin/lipo', ['-verify_arch', 'arm64', join(contents, 'MacOS/SynapseUpdater')]);
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const key = publicKey();
  const version = await packageVersion();
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const contents = join(app, 'Contents');
  const framework = join(contents, 'Frameworks/Sparkle.framework');
  const bundledHelper = join(contents, 'Helpers/SynapseUpdater.app');
  await cp(join(sparkle, 'Sparkle.framework'), framework, {
    recursive: true,
    verbatimSymlinks: true,
  });
  await cp(helper, bundledHelper, { recursive: true, verbatimSymlinks: true });
  await cp(join(sparkle, 'LICENSE'), join(contents, 'Resources/Sparkle-LICENSE.txt'));
  const infoPath = join(contents, 'Info.plist');
  const info = plist.parse(await readFile(infoPath, 'utf8'));
  if (info.CFBundleShortVersionString !== version)
    throw new Error('Packaged macOS version mismatch');
  Object.assign(info, {
    CFBundleVersion: version,
    SUPublicEDKey: key,
    SUFeedURL: 'https://github.com/422511186/synapse-term/releases/latest/download/appcast.xml',
    SUEnableAutomaticChecks: false,
    SUAutomaticallyUpdate: false,
    SUAllowsAutomaticUpdates: false,
    SUEnableSystemProfiling: false,
    SUSendProfileInfo: false,
    SUVerifyUpdateBeforeExtraction: true,
    SUEnableInstallerLauncherService: false,
    SUEnableDownloaderService: false,
    SUEnableInstallerConnectionService: false,
    SUEnableInstallerStatusService: false,
  });
  await writeFile(infoPath, plist.build(info));
  // Sparkle's shipped Developer ID signatures must match this app's ad-hoc trust boundary.
  execFileSync(
    '/usr/bin/codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', framework],
    { stdio: 'inherit' },
  );
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', bundledHelper], {
    stdio: 'inherit',
  });
  await writeFile(
    join(context.outDir, 'mac-update-build.json'),
    JSON.stringify(
      {
        version,
        publicKey: key,
        arch: 'arm64',
        sparkleVersion,
        testBuild: process.env.SYNAPSE_UPDATE_TEST_BUILD === '1',
      },
      null,
      2,
    ) + '\n',
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === 'fetch') console.log(await fetchSparkle());
    else if (process.argv[2] === 'prepare') await prepare();
    else throw new Error('Expected fetch or prepare');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
