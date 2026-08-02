import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const REQUIRED_NODE_VERSION = '24.12.0';
const workspace = resolve(import.meta.dirname, '..');
const packagingDirectory = resolve(workspace, '.packaging');
const target = resolve(packagingDirectory, 'core-runtime');
const deployTarget = resolve(packagingDirectory, 'core-deploy');
const RUNTIME_PACKAGES = [
  '@anthropic-ai/sdk',
  '@napi-rs/keyring',
  '@vscode/tree-sitter-wasm',
  '@xterm/addon-serialize',
  '@xterm/headless',
  'node-pty',
  'openai',
  'web-tree-sitter',
];

const platform = process.platform;
const nodeBinary = platform === 'win32' ? 'node.exe' : 'node';
const keyringSuffix = platform === 'win32' ? 'win32-x64-msvc' : 'darwin-arm64';
const ptyPrebuildDir = platform === 'win32' ? 'win32-x64' : 'darwin-arm64';

if (platform !== 'win32' && platform !== 'darwin') {
  throw new Error(`Unsupported platform: ${platform}. Only win32 and darwin are supported.`);
}
if (process.versions.node !== REQUIRED_NODE_VERSION) {
  throw new Error(
    `Core packaging requires Node ${REQUIRED_NODE_VERSION}; current runtime is ${process.versions.node}`,
  );
}
if (basename(process.execPath).toLowerCase() !== nodeBinary.toLowerCase()) {
  throw new Error(`Expected a standalone ${nodeBinary} runtime, received ${process.execPath}`);
}
if (
  !target.startsWith(`${packagingDirectory}${sep}`) ||
  !deployTarget.startsWith(`${packagingDirectory}${sep}`)
) {
  throw new Error(`Refusing to stage Core outside ${packagingDirectory}`);
}

await runPnpm(['--filter', '@terminal-agent/core', 'build']);
await rm(target, { recursive: true, force: true });
await rm(deployTarget, { recursive: true, force: true });
await runPnpm(['--filter', '@terminal-agent/core', '--prod', '--legacy', 'deploy', deployTarget]);

await mkdir(join(target, 'node_modules'), { recursive: true });
await cp(join(deployTarget, 'dist'), join(target, 'dist'), { recursive: true });
await copyFile(join(deployTarget, 'package.json'), join(target, 'package.json'));
for (const packageName of RUNTIME_PACKAGES) {
  const source = await resolveInstalledPackage(join(deployTarget, 'node_modules'), packageName);
  if (source === undefined)
    throw new Error(`Runtime package is missing after deploy: ${packageName}`);
  await stagePackage(
    packageName,
    source,
    join(target, 'node_modules', ...packageName.split('/')),
    new Set(),
  );
}
await pruneRuntimePackages();

// node-pty's spawn-helper must be executable on POSIX; pnpm store may not preserve +x.
if (platform === 'darwin') {
  const spawnHelpers = await findFiles(target, (p) => basename(p) === 'spawn-helper');
  for (const helper of spawnHelpers) await chmod(helper, 0o755);
}

await rm(deployTarget, { recursive: true, force: true });

await copyFile(process.execPath, join(target, nodeBinary));
if (platform === 'darwin') await chmod(join(target, nodeBinary), 0o755);

const nativeModules = await findFiles(target, (path) => path.endsWith('.node'));
const wasmAssets = await findFiles(target, (path) => path.endsWith('.wasm'));
for (const required of [
  join(target, 'dist', 'core-main.mjs'),
  join(target, 'dist', 'core-maintenance.mjs'),
  join(target, nodeBinary),
]) {
  await stat(required);
}
if (nativeModules.length < 2) {
  throw new Error('Core staging did not include the required native modules.');
}
if (!wasmAssets.some((path) => path.endsWith('tree-sitter-bash.wasm'))) {
  throw new Error('Core staging did not include the Bash tree-sitter grammar.');
}

const manifest = {
  nodeVersion: process.versions.node,
  nodeSha256: await sha256(join(target, nodeBinary)),
  coreSha256: await sha256(join(target, 'dist', 'core-main.mjs')),
  maintenanceSha256: await sha256(join(target, 'dist', 'core-maintenance.mjs')),
  nativeModules: nativeModules.map((path) => relative(target, path).replaceAll('\\', '/')).sort(),
  wasmAssets: wasmAssets.map((path) => relative(target, path).replaceAll('\\', '/')).sort(),
};
await writeFile(
  join(target, 'runtime-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

async function runPnpm(argumentsValue) {
  const npmExecPath = process.env.npm_execpath;
  const command =
    npmExecPath === undefined ? (platform === 'win32' ? 'pnpm.cmd' : 'pnpm') : process.execPath;
  const argumentsWithCli =
    npmExecPath === undefined ? argumentsValue : [npmExecPath, ...argumentsValue];
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsWithCli, {
      cwd: workspace,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`pnpm ${argumentsValue.join(' ')} exited with ${String(code)}`));
    });
  });
}

async function findFiles(directory, predicate) {
  const matches = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...(await findFiles(path, predicate)));
    else if (entry.isFile() && predicate(path)) matches.push(path);
  }
  return matches;
}

async function stagePackage(packageName, source, destination, ancestors) {
  const canonicalSource = await realpath(source);
  if (ancestors.has(canonicalSource)) return;
  await mkdir(dirname(destination), { recursive: true });
  await cp(canonicalSource, destination, {
    recursive: true,
    dereference: true,
    filter: (sourcePath) => {
      const local = relative(canonicalSource, sourcePath);
      return local.length === 0 || !local.split(sep).includes('node_modules');
    },
  });

  const packageJson = JSON.parse(await readFile(join(canonicalSource, 'package.json'), 'utf8'));
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  const optionalDependencies = Object.keys(packageJson.optionalDependencies ?? {}).filter(
    includeOptionalDependency,
  );
  const requiredPeers = Object.keys(packageJson.peerDependencies ?? {}).filter(
    (name) => packageJson.peerDependenciesMeta?.[name]?.optional !== true,
  );
  const modulesRoot = packageNodeModulesRoot(canonicalSource);
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(canonicalSource);
  for (const dependency of new Set([...dependencies, ...optionalDependencies, ...requiredPeers])) {
    const dependencySource = await resolveInstalledPackage(modulesRoot, dependency);
    if (dependencySource === undefined) {
      if (dependencies.includes(dependency) || requiredPeers.includes(dependency)) {
        throw new Error(`Runtime dependency ${dependency} required by ${packageName} is missing`);
      }
      continue;
    }
    await stagePackage(
      dependency,
      dependencySource,
      join(destination, 'node_modules', ...dependency.split('/')),
      nextAncestors,
    );
  }
}

async function resolveInstalledPackage(modulesRoot, packageName) {
  try {
    return await realpath(join(modulesRoot, ...packageName.split('/')));
  } catch {
    return undefined;
  }
}

function packageNodeModulesRoot(packagePath) {
  const parent = dirname(packagePath);
  return basename(parent).startsWith('@') ? dirname(parent) : parent;
}

function includeOptionalDependency(packageName) {
  if (!packageName.startsWith('@napi-rs/keyring-')) return true;
  return packageName === `@napi-rs/keyring-${keyringSuffix}`;
}

async function pruneRuntimePackages() {
  const prebuilds = join(target, 'node_modules', 'node-pty', 'prebuilds');
  for (const entry of await readdir(prebuilds, { withFileTypes: true })) {
    if (entry.name === ptyPrebuildDir) continue;
    await rm(join(prebuilds, entry.name), { recursive: true, force: true });
  }
  const grammarDirectory = join(target, 'node_modules', '@vscode', 'tree-sitter-wasm', 'wasm');
  for (const entry of await readdir(grammarDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'tree-sitter-bash.wasm') continue;
    if (entry.name.startsWith('tree-sitter-') && entry.name.endsWith('.wasm')) {
      await rm(join(grammarDirectory, entry.name), { force: true });
    }
  }
  await rm(join(target, 'node_modules', 'web-tree-sitter', 'debug'), {
    recursive: true,
    force: true,
  });
}

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
