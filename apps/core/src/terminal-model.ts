import headlessPackage from '@xterm/headless';
import serializePackage from '@xterm/addon-serialize';

const { Terminal } = headlessPackage;
const { SerializeAddon } = serializePackage;

export interface TerminalModelOptions {
  columns: number;
  rows: number;
  scrollback?: number;
}

export class TerminalModel {
  readonly #terminal: InstanceType<typeof Terminal>;
  readonly #serializeAddon: InstanceType<typeof SerializeAddon>;
  readonly #oscDisposables: Array<{ dispose(): void }> = [];
  #disposed = false;

  constructor(options: TerminalModelOptions) {
    if (
      !Number.isInteger(options.columns) ||
      options.columns < 1 ||
      !Number.isInteger(options.rows) ||
      options.rows < 1
    ) {
      throw new RangeError('terminal dimensions must be positive integers');
    }
    const scrollback = options.scrollback ?? 10_000;
    if (!Number.isInteger(scrollback) || scrollback < 1) {
      throw new RangeError('scrollback must be a positive integer');
    }

    this.#terminal = new Terminal({
      allowProposedApi: true,
      cols: options.columns,
      rows: options.rows,
      scrollback,
    });
    this.#serializeAddon = new SerializeAddon();
    this.#terminal.loadAddon(this.#serializeAddon);
  }

  registerOscHandler(id: number, handler: (payload: string) => void): void {
    if (this.#disposed) throw new Error('terminal model is disposed');
    this.#oscDisposables.push(
      this.#terminal.parser.registerOscHandler(id, (payload) => {
        handler(payload);
        return true;
      }),
    );
  }

  async write(data: string | Uint8Array): Promise<void> {
    if (this.#disposed) throw new Error('terminal model is disposed');
    await new Promise<void>((resolve) => this.#terminal.write(data, resolve));
  }

  resize(columns: number, rows: number): void {
    if (this.#disposed) throw new Error('terminal model is disposed');
    if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
      throw new RangeError('terminal dimensions must be positive integers');
    }
    this.#terminal.resize(columns, rows);
  }

  serialize(): string {
    if (this.#disposed) throw new Error('terminal model is disposed');
    return this.#serializeAddon.serialize();
  }

  get bufferLength(): number {
    return this.#terminal.buffer.active.length;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const disposable of this.#oscDisposables) disposable.dispose();
    this.#oscDisposables.length = 0;
    this.#serializeAddon.dispose();
    this.#terminal.dispose();
  }
}
