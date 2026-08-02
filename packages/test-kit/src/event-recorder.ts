import { deepStrictEqual } from 'node:assert/strict';

export class EventRecorder<T> {
  readonly #events: T[] = [];

  get events(): readonly T[] {
    return [...this.#events];
  }

  record = (event: T): void => {
    this.#events.push(event);
  };

  assertEvents(expected: readonly T[]): void {
    deepStrictEqual(this.#events, expected);
  }
}
