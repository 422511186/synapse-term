import { AsyncEntry } from '@napi-rs/keyring';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

export interface CredentialEntry {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | null | undefined>;
  deletePassword(): Promise<boolean>;
}

export interface CredentialEntryFactory {
  create(service: string, account: string): CredentialEntry;
}

const keyringFactory: CredentialEntryFactory = {
  create(service, account) {
    const entry = new AsyncEntry(service, account);
    return {
      setPassword: (password) => entry.setPassword(password),
      getPassword: () => entry.getPassword(),
      deletePassword: () => entry.deleteCredential(),
    };
  },
};

export class CredentialSecretStore {
  readonly #service: string;
  readonly #factory: CredentialEntryFactory;

  constructor(service = 'terminal-agent', factory: CredentialEntryFactory = keyringFactory) {
    if (service.trim().length === 0) throw new RangeError('credential service must not be empty');
    this.#service = service;
    this.#factory = factory;
  }

  async set(reference: string, secret: string): Promise<void> {
    validateReference(reference);
    if (secret.length === 0) throw new RangeError('secret must not be empty');
    await this.#factory.create(this.#service, reference).setPassword(secret);
  }

  async get(reference: string): Promise<string | undefined> {
    validateReference(reference);
    const secret = await this.#factory.create(this.#service, reference).getPassword();
    return secret == null || secret.length === 0 ? undefined : secret;
  }

  async delete(reference: string): Promise<boolean> {
    validateReference(reference);
    return this.#factory.create(this.#service, reference).deletePassword();
  }
}

export interface CoreSecretStoreSelection {
  kind: 'credential_manager' | 'ephemeral_e2e';
  store: CredentialSecretStore;
}

export function createCoreSecretStore(options: {
  environment?: NodeJS.ProcessEnv;
  dataDirectory: string;
  temporaryDirectory?: string;
}): CoreSecretStoreSelection {
  const environment = options.environment ?? process.env;
  if (environment.TERMINAL_AGENT_E2E_EPHEMERAL_SECRET_STORE !== '1') {
    return { kind: 'credential_manager', store: new CredentialSecretStore() };
  }
  if (environment.TERMINAL_AGENT_E2E !== '1') {
    throw new Error('Ephemeral Secret Store requires explicit E2E mode');
  }
  const temporaryDirectory = resolve(options.temporaryDirectory ?? tmpdir());
  const dataDirectory = resolve(options.dataDirectory);
  const pathFromTemporaryDirectory = relative(temporaryDirectory, dataDirectory);
  if (
    pathFromTemporaryDirectory.length === 0 ||
    pathFromTemporaryDirectory.startsWith('..') ||
    isAbsolute(pathFromTemporaryDirectory)
  ) {
    throw new Error('Ephemeral Secret Store data must stay under the temporary directory');
  }
  return {
    kind: 'ephemeral_e2e',
    store: new CredentialSecretStore('terminal-agent-e2e', memoryCredentialFactory()),
  };
}

function memoryCredentialFactory(): CredentialEntryFactory {
  const values = new Map<string, string>();
  return {
    create(service, account) {
      const key = `${service}\u0000${account}`;
      return {
        setPassword: async (password) => {
          values.set(key, password);
        },
        getPassword: async () => values.get(key),
        deletePassword: async () => values.delete(key),
      };
    },
  };
}

function validateReference(reference: string): void {
  if (reference.trim().length === 0) throw new RangeError('credential reference must not be empty');
}
