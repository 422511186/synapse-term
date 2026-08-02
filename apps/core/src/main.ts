import { spawn } from 'node:child_process';

import { CoreApplication } from './core-application.js';
import { parseCoreMainOptions } from './main-options.js';
import { createCoreSecretStore } from '@synapse-term/infrastructure';

function forceTerminateOwnProcessTree(exitCode: number): void {
  if (process.platform !== 'win32') {
    process.exit(exitCode);
  }
  const killer = spawn('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
    detached: true,
  });
  killer.unref();
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const options = parseCoreMainOptions(process.env);
  const secretStore = createCoreSecretStore({
    environment: process.env,
    dataDirectory: options.dataDirectory,
  });
  const application = await CoreApplication.create({ ...options, secrets: secretStore.store });

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= application.close();
    return closing;
  };

  process.once('SIGINT', () => {
    void close().then(() => {
      process.exitCode = 0;
      forceTerminateOwnProcessTree(0);
    });
  });
  process.once('SIGTERM', () => {
    void close().then(() => {
      process.exitCode = 0;
      forceTerminateOwnProcessTree(0);
    });
  });
  process.once('uncaughtException', (error) => {
    console.error(error);
    void close().finally(() => {
      process.exitCode = 1;
      forceTerminateOwnProcessTree(1);
    });
  });
  process.once('unhandledRejection', (error) => {
    console.error(error);
    void close().finally(() => {
      process.exitCode = 1;
      forceTerminateOwnProcessTree(1);
    });
  });

  await application.start();
  await application.waitForClose();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await close();
  forceTerminateOwnProcessTree(0);
}

void main().catch((error: unknown) => {
  console.error(error);
  forceTerminateOwnProcessTree(1);
});
