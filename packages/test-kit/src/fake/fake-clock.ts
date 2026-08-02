export class FakeClock {
  #currentTime: number;
  #nextTimerId = 1;
  readonly #timers = new Map<number, { dueAt: number; callback: () => void }>();

  constructor(initialTime: number) {
    if (!Number.isFinite(initialTime)) throw new RangeError('initialTime must be finite');
    this.#currentTime = initialTime;
  }

  now(): number {
    return this.#currentTime;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError('delayMs must be a non-negative finite number');
    }

    const id = this.#nextTimerId++;
    this.#timers.set(id, { dueAt: this.#currentTime + delayMs, callback });
    return id;
  }

  clearTimeout(id: number): void {
    this.#timers.delete(id);
  }

  advanceBy(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError('durationMs must be a non-negative finite number');
    }

    const targetTime = this.#currentTime + durationMs;
    while (true) {
      const nextTimer = [...this.#timers.entries()]
        .filter(([, timer]) => timer.dueAt <= targetTime)
        .sort(
          ([leftId, left], [rightId, right]) => left.dueAt - right.dueAt || leftId - rightId,
        )[0];
      if (nextTimer === undefined) break;

      const [id, timer] = nextTimer;
      this.#timers.delete(id);
      this.#currentTime = timer.dueAt;
      timer.callback();
    }

    this.#currentTime = targetTime;
  }
}
