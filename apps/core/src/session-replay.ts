import type { OutputJournal, JournalEvent } from './output-journal.js';
import type { TerminalModel } from './terminal-model.js';

export interface SessionReplayResult {
  historyGap: boolean;
  snapshot?: string | undefined;
  events: JournalEvent[];
  oldestSequence: number | undefined;
  nextSequence: number;
}

export class SessionReplay {
  readonly #sessionId: string;
  readonly #journal: OutputJournal;
  readonly #terminal: TerminalModel;

  constructor(sessionId: string, journal: OutputJournal, terminal: TerminalModel) {
    this.#sessionId = sessionId;
    this.#journal = journal;
    this.#terminal = terminal;
  }

  async ingest(data: string | Uint8Array): Promise<JournalEvent> {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : new Uint8Array(data);
    const event = this.#journal.append(this.#sessionId, bytes);
    await this.#terminal.write(data);
    return event;
  }

  replay(afterSequence: number): SessionReplayResult {
    const result = this.#journal.replay(this.#sessionId, afterSequence);
    return {
      ...result,
      snapshot: result.historyGap ? this.#terminal.serialize() : undefined,
    };
  }
}
