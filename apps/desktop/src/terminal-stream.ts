import type { TerminalOutputEvent, TerminalReplay } from './preload-api.js';

export function reconcileTerminalReplay(
  replay: TerminalReplay,
  liveEvents: readonly TerminalOutputEvent[],
): { chunks: string[]; lastSequence: number } {
  const replayLastSequence = Math.max(0, replay.nextSequence - 1);
  const replayChunks =
    replay.snapshot === undefined
      ? [...replay.events]
          .sort((left, right) => left.sequence - right.sequence)
          .map((event) => event.data)
      : [replay.snapshot];
  const newer = [...liveEvents]
    .filter((event) => event.sequence > replayLastSequence)
    .sort((left, right) => left.sequence - right.sequence);
  return {
    chunks: [...replayChunks, ...newer.map((event) => event.data)],
    lastSequence: newer.at(-1)?.sequence ?? replayLastSequence,
  };
}
