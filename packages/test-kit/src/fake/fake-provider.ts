export class FakeProvider<TRequest, TEvent> {
  readonly requests: TRequest[] = [];
  readonly #turns: Array<readonly TEvent[]> = [];

  enqueueTurn(events: readonly TEvent[]): void {
    this.#turns.push([...events]);
  }

  async *stream(request: TRequest, signal?: AbortSignal): AsyncIterable<TEvent> {
    this.requests.push(request);
    const events = this.#turns.shift();
    if (events === undefined) throw new Error('no scripted provider turn is available');

    for (const event of events) {
      if (signal?.aborted) {
        const error = new Error('provider stream aborted');
        error.name = 'AbortError';
        throw error;
      }
      yield event;
    }
  }
}
