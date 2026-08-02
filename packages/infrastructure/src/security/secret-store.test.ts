import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createCoreSecretStore,
  CredentialSecretStore,
  type CredentialEntry,
  type CredentialEntryFactory,
} from './secret-store.js';

class MemoryEntry implements CredentialEntry {
  value: string | undefined;

  async setPassword(password: string): Promise<void> {
    this.value = password;
  }

  async getPassword(): Promise<string | undefined> {
    return this.value;
  }

  async deletePassword(): Promise<boolean> {
    const existed = this.value !== undefined;
    this.value = undefined;
    return existed;
  }
}

describe('CredentialSecretStore', () => {
  it('stores provider secrets behind opaque credential references', async () => {
    const entries = new Map<string, MemoryEntry>();
    const factory: CredentialEntryFactory = {
      create: (_service, account) => {
        const entry = entries.get(account) ?? new MemoryEntry();
        entries.set(account, entry);
        return entry;
      },
    };
    const store = new CredentialSecretStore('terminal-agent-test', factory);

    await store.set('credential:provider-1', 'api-secret');
    await expect(store.get('credential:provider-1')).resolves.toBe('api-secret');
    await expect(store.delete('credential:provider-1')).resolves.toBe(true);
    await expect(store.get('credential:provider-1')).resolves.toBeUndefined();
  });

  it('rejects empty references and secrets', async () => {
    const store = new CredentialSecretStore('terminal-agent-test', {
      create: () => new MemoryEntry(),
    });
    await expect(store.set('', 'secret')).rejects.toThrow();
    await expect(store.set('credential:x', '')).rejects.toThrow();
  });

  it('treats an empty platform credential as missing', async () => {
    const entry = new MemoryEntry();
    entry.value = '';
    const store = new CredentialSecretStore('terminal-agent-test', {
      create: () => entry,
    });

    await expect(store.get('credential:x')).resolves.toBeUndefined();
  });

  it('treats a null platform credential as missing', async () => {
    const store = new CredentialSecretStore('terminal-agent-test', {
      create: () => ({
        setPassword: async () => undefined,
        getPassword: async () => null,
        deletePassword: async () => false,
      }),
    });

    await expect(store.get('credential:x')).resolves.toBeUndefined();
  });

  it('uses an ephemeral store only for explicit E2E data under the temporary directory', async () => {
    const tmpBase = join(tmpdir(), 'ta-e2e-test');
    const selection = createCoreSecretStore({
      environment: {
        TERMINAL_AGENT_E2E: '1',
        TERMINAL_AGENT_E2E_EPHEMERAL_SECRET_STORE: '1',
      },
      dataDirectory: join(tmpBase, 'core'),
      temporaryDirectory: tmpBase,
    });

    expect(selection.kind).toBe('ephemeral_e2e');
    await selection.store.set('provider:test', 'test-secret');
    await expect(selection.store.get('provider:test')).resolves.toBe('test-secret');
    await expect(selection.store.delete('provider:test')).resolves.toBe(true);
  });

  it('rejects the ephemeral store outside explicit E2E mode or the temporary directory', () => {
    expect(() =>
      createCoreSecretStore({
        environment: { TERMINAL_AGENT_E2E_EPHEMERAL_SECRET_STORE: '1' },
        dataDirectory: 'C:\\Temp\\terminal-agent-e2e\\core',
        temporaryDirectory: 'C:\\Temp',
      }),
    ).toThrow(/explicit E2E mode/);
    expect(() =>
      createCoreSecretStore({
        environment: {
          TERMINAL_AGENT_E2E: '1',
          TERMINAL_AGENT_E2E_EPHEMERAL_SECRET_STORE: '1',
        },
        dataDirectory: 'D:\\TerminalAgent\\core',
        temporaryDirectory: 'C:\\Temp',
      }),
    ).toThrow(/temporary directory/);
  });
});
