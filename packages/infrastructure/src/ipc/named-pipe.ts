import { createServer } from 'node:net';
import { createConnection } from 'node:net';
import { rm } from 'node:fs/promises';
import type { Socket } from 'node:net';

export class NamedPipeServer {
  #server: ReturnType<typeof createServer> | undefined;

  async listen(pipeName: string, handler: (socket: Socket) => void): Promise<void> {
    if (this.#server !== undefined) throw new Error('NamedPipeServer is already listening');
    const server = createServer(handler);
    this.#server = server;
    try {
      await listenServer(server, pipeName);
    } catch (error) {
      this.#server = undefined;
      await closeServer(server);
      if (!isAddressInUse(error) || !(await removeStalePosixEndpoint(pipeName))) throw error;

      const replacement = createServer(handler);
      this.#server = replacement;
      try {
        await listenServer(replacement, pipeName);
      } catch (retryError) {
        this.#server = undefined;
        await closeServer(replacement);
        throw retryError;
      }
    }
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => (error === undefined ? resolve() : reject(error)));
    });
  }
}

function listenServer(server: ReturnType<typeof createServer>, pipeName: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(pipeName);
  });
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

async function removeStalePosixEndpoint(pipeName: string): Promise<boolean> {
  if (process.platform === 'win32' || !pipeName.startsWith('/')) return false;
  const active = await isPosixEndpointActive(pipeName);
  if (active !== false) return false;
  await rm(pipeName, { force: true });
  return true;
}

function isPosixEndpointActive(pipeName: string): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    const socket = createConnection(pipeName);
    let settled = false;
    const finish = (active: boolean | undefined): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(active);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT' || error.code === 'ENOTSOCK') {
        finish(false);
      } else finish(undefined);
    });
  });
}
