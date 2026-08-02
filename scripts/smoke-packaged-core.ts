import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

import { CURRENT_PROTOCOL_VERSION } from '@synapse-term/protocol';

import { getDesktopCoreConfig } from '../apps/desktop/src/main/core-config.js';
import { NamedPipeCoreConnector } from '../apps/desktop/src/main/named-pipe-core-connector.js';

const workspace = resolve(import.meta.dirname, '..');
const runtime = resolve(
  process.env.TERMINAL_AGENT_RUNTIME_DIR ?? resolve(workspace, '.packaging/core-runtime'),
);
const nodeBinary = process.platform === 'win32' ? 'node.exe' : 'node';
const dataDirectory = resolve(tmpdir(), `terminal-agent-packaged-core-${randomUUID()}`);
const appId = `terminal-agent-smoke-${randomUUID()}`;
const username = userInfo().username;
const config = getDesktopCoreConfig(dataDirectory, appId, username);
const child = spawn(join(runtime, nodeBinary), [join(runtime, 'dist/core-main.mjs')], {
  cwd: runtime,
  env: {
    ...process.env,
    TERMINAL_AGENT_DATA_DIR: dataDirectory,
    TERMINAL_AGENT_APP_ID: appId,
    TERMINAL_AGENT_USERNAME: username,
    TERMINAL_AGENT_INSTANCE_ID: randomUUID(),
    TERMINAL_AGENT_VERSION: '0.1.0-smoke',
    TERMINAL_AGENT_IDLE_EXIT_MS: '30000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let stderr = '';
child.stderr?.on('data', (chunk) => {
  stderr += Buffer.from(chunk).toString('utf8');
});
const childExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
  (resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  },
);

async function main(): Promise<void> {
  let connection: Awaited<ReturnType<NamedPipeCoreConnector['connect']>> | undefined;
  try {
    const connector = new NamedPipeCoreConnector({
      pipeName: config.pipeName,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      clientInstanceId: randomUUID(),
      loadToken: async () => {
        try {
          return await readFile(config.tokenPath, 'utf8');
        } catch {
          return undefined;
        }
      },
      requestTimeoutMs: 15_000,
    });
    connection = await connectWithRetry(connector, 60, 100);
    const handshake = await connection.handshake();
    if (!handshake.ok) throw new Error(`Packaged Core handshake failed: ${handshake.error}`);

    const output: string[] = [];
    const removeOutput = connection.onTerminalOutput((event) => output.push(event.data));
    const sessionExecutable = process.platform === 'win32' ? 'powershell.exe' : 'zsh';
    const sessionArgs = process.platform === 'win32' ? ['-NoLogo'] : ['--no-rcs'];
    const session = await connection.request<{ id: string }>('session.create', {
      title: 'packaged smoke',
      terminalType: process.platform === 'win32' ? 'PowerShell' : 'Zsh',
      executable: sessionExecutable,
      args: sessionArgs,
      cwd: workspace,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      columns: 100,
      rows: 30,
    });
    const echoCommand =
      process.platform === 'win32'
        ? "Write-Output 'PACKAGED_CORE_READY'\r"
        : 'echo PACKAGED_CORE_READY\r';
    await connection.request('terminal.write', {
      sessionId: session.id,
      data: echoCommand,
    });
    await waitUntil(() => output.join('').includes('PACKAGED_CORE_READY'), 15_000);
    const replay = await connection.request<{ events: unknown[] }>('terminal.replay', {
      sessionId: session.id,
      afterSequence: 0,
    });
    await connection.request('session.close', { sessionId: session.id });
    await connection.request('core.shutdown', { mode: 'terminate_all' });
    removeOutput();
    await connection.close().catch(() => undefined);
    connection = undefined;

    const exit = await withTimeout(childExit, 15_000, 'Packaged Core did not exit');
    if (exit.code !== 0) {
      throw new Error(`Packaged Core exited with ${String(exit.code)}: ${stderr}`);
    }
    process.stdout.write(
      `${JSON.stringify({ handshake, outputSeen: true, replayEvents: replay.events.length, exitCode: exit.code })}\n`,
    );
  } finally {
    await connection?.close().catch(() => undefined);
    if (child.exitCode === null) child.kill();
    if (dataDirectory.startsWith(`${resolve(tmpdir())}${sep}`)) {
      await rm(dataDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  if (stderr.trim().length > 0) console.error(stderr.trim());
  process.exitCode = 1;
});

async function connectWithRetry(
  connector: NamedPipeCoreConnector,
  attempts: number,
  delayMs: number,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await connector.connect();
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Packaged Core did not bind its Pipe');
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for packaged Core output');
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
