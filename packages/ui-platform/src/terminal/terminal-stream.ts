import type { TerminalOutputEvent, TerminalReplay } from '../contracts.js';

export function reconcileTerminalReplay(
  replay: TerminalReplay,
  liveEvents: readonly TerminalOutputEvent[],
): { chunks: string[]; lastSequence: number } {
  return reconcileTerminalReplayPages([replay], liveEvents);
}

export function reconcileTerminalReplayPages(
  replays: readonly TerminalReplay[],
  liveEvents: readonly TerminalOutputEvent[],
): { chunks: string[]; lastSequence: number } {
  const lastReplay = replays.at(-1);
  const replayLastSequence =
    lastReplay === undefined
      ? 0
      : (lastReplay.nextAfterSequence ?? Math.max(0, lastReplay.nextSequence - 1));
  const snapshot = replays.find((replay) => replay.snapshot !== undefined)?.snapshot;
  const replayChunks =
    snapshot === undefined
      ? replays
          .flatMap((replay) => replay.events)
          .sort((left, right) => left.sequence - right.sequence)
          .map((event) => event.data)
      : [snapshot];
  const newer = [...liveEvents]
    .filter((event) => event.sequence > replayLastSequence)
    .sort((left, right) => left.sequence - right.sequence);
  return {
    chunks: [...replayChunks, ...newer.map((event) => event.data)],
    lastSequence: newer.at(-1)?.sequence ?? replayLastSequence,
  };
}
