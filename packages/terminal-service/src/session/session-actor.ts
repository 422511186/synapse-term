import { randomUUID } from 'node:crypto';

import {
  createSessionState,
  invalidateSessionEnvironment,
  replaceSessionExecutionContext,
  resizeSession,
  transitionSessionPty,
  verifySessionEnvironment,
  type EnvironmentPlatform,
  type ExecutionDialect,
  type SessionState,
  type TerminalBackend,
  type TerminalExitEvent,
  type TerminalSubscription,
} from '@synapse-term/domain';

import { splitTerminalOutput, TERMINAL_OUTPUT_FRAME_BYTES } from './output-frame.js';

export interface SessionActorOptions {
  title: string;
  terminalType: string;
  columns?: number;
  rows?: number;
  hideCompletionProbeEcho?: boolean;
}

export interface ExternalWriteGuard {
  isCancelled(): boolean;
}

export type SessionActorEvent =
  | { type: 'pty_output'; sequence: number; data: string; historyData?: string }
  | { type: 'terminal_output'; sequence: number; data: string }
  | { type: 'environment_invalidated'; capabilityEpoch: number }
  | { type: 'osc_777'; payload: string }
  | { type: 'pty_exit'; exitCode: number; signal?: number | undefined };

export class SessionActor {
  readonly #backend: TerminalBackend;
  #state: SessionState;
  #outputSequence = 0;
  #escapeCarry = '';
  #osc777Carry = '';
  #suppressedInputEchoes = new Map<string, InputEchoSuppression>();
  #environmentProbeEchoes = new Map<string, EnvironmentProbeEchoSuppression>();
  #hideCompletionProbeEcho: boolean;
  #queue: Promise<void> = Promise.resolve();
  #disposed = false;
  #ptyExited = false;
  readonly #exitWaiters = new Set<() => void>();
  readonly #eventListeners = new Set<(event: SessionActorEvent) => void>();
  readonly #subscriptions: TerminalSubscription[] = [];

  constructor(id: string, backend: TerminalBackend, options: SessionActorOptions) {
    this.#backend = backend;
    this.#state = createSessionState({
      id,
      title: options.title,
      terminalType: options.terminalType,
      executionContextId: randomUUID(),
      ...(options.columns === undefined ? {} : { columns: options.columns }),
      ...(options.rows === undefined ? {} : { rows: options.rows }),
    });
    this.#hideCompletionProbeEcho = options.hideCompletionProbeEcho ?? true;
    this.#subscriptions.push(
      backend.onData((data) => {
        void this.#enqueue(() => {
          if (this.#disposed) return;
          const { chunks, carry } = splitTerminalOutput(
            data,
            TERMINAL_OUTPUT_FRAME_BYTES,
            this.#escapeCarry,
          );
          this.#escapeCarry = carry;
          for (const chunk of chunks) {
            for (const event of this.#scanOsc777(chunk)) {
              if (event.type === 'control') {
                this.#emit({ type: 'osc_777', payload: event.payload });
                continue;
              }
              if (event.data.length === 0) continue;
              const protocolData = this.#suppressInputEcho(event.data);
              const environmentProbeData = this.#suppressEnvironmentProbeEchoes(protocolData);
              const terminalData = this.#hideCompletionProbeEcho
                ? environmentProbeData
                : event.data;
              this.#emitOutput(protocolData, terminalData, environmentProbeData);
            }
          }
        });
      }),
      backend.onExit((event: TerminalExitEvent) => {
        void this.#enqueue(() => {
          this.#ptyExited = true;
          for (const waiter of this.#exitWaiters) waiter();
          this.#exitWaiters.clear();
          const next = event.exitCode === 0 ? 'exited' : 'failed';
          const transition = transitionSessionPty(this.#state, next);
          if (transition.ok) this.#state = transition.value;
          this.#emit({ type: 'pty_exit', ...event });
        });
      }),
    );
  }

  get snapshot(): SessionState {
    return structuredClone(this.#state);
  }

  /** 已发出的公共 PTY 输出事件序号，用于建立当前 Sharing 输出边界。 */
  get outputSequence(): number {
    return this.#outputSequence;
  }

  onEvent(listener: (event: SessionActorEvent) => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  /**
   * 在当前串行队列排空后订阅后续 PTY 输出。
   *
   * Sharing 需要一个不会把已经排队的输出误判为边界之后输出的原子切点；
   * 订阅本身也必须在这个切点内完成，不能由调用方先读 outputSequence 再稍后注册监听器。
   */
  onPtyOutputAfterBoundary(
    listener: (event: Extract<SessionActorEvent, { type: 'pty_output' }>) => void,
  ): Promise<() => void> {
    return this.#enqueue(() => {
      if (this.#disposed) return () => undefined;
      const boundary = this.#outputSequence;
      const onEvent = (event: SessionActorEvent): void => {
        if (event.type === 'pty_output' && event.sequence > boundary) listener(event);
      };
      this.#eventListeners.add(onEvent);
      return () => this.#eventListeners.delete(onEvent);
    });
  }

  markPtyRunning(): Promise<void> {
    return this.#enqueue(() => {
      if (this.#disposed) return;
      const transition = transitionSessionPty(this.#state, 'running');
      if (!transition.ok) throw new Error(transition.error);
      this.#state = transition.value;
    });
  }

  rename(title: string): Promise<void> {
    return this.#enqueue(() => {
      if (this.#disposed) return;
      this.#state = { ...this.#state, title: title.trim() };
    });
  }

  writeUser(data: string): Promise<{ ok: true } | { ok: false; error: 'session-not-running' }> {
    return this.#enqueue(() => {
      if (this.#disposed || this.#state.pty !== 'running') {
        return { ok: false as const, error: 'session-not-running' as const };
      }
      this.#invalidateEnvironment();
      this.#backend.write(data);
      return { ok: true as const };
    });
  }

  invalidateEnvironment(): Promise<void> {
    return this.#enqueue(() => {
      if (!this.#disposed && this.#state.pty === 'running') this.#invalidateEnvironment();
    });
  }

  verifyEnvironment(
    dialect: Exclude<ExecutionDialect, 'unknown'>,
    platform: Exclude<EnvironmentPlatform, 'unknown'>,
    verifiedAt = new Date().toISOString(),
  ): Promise<void> {
    return this.#enqueue(() => {
      if (this.#disposed) return;
      this.#state = verifySessionEnvironment(this.#state, {
        dialect,
        platform,
        source: 'probe',
        verifiedAt,
      });
    });
  }

  verifyEnvironmentIfCurrent(
    dialect: Exclude<ExecutionDialect, 'unknown'>,
    platform: Exclude<EnvironmentPlatform, 'unknown'>,
    expectedCapabilityEpoch: number,
    verifiedAt = new Date().toISOString(),
  ): Promise<boolean> {
    return this.#enqueue(() => {
      if (
        this.#disposed ||
        this.#state.pty !== 'running' ||
        this.#state.environment.capabilityEpoch !== expectedCapabilityEpoch
      ) {
        return false;
      }
      this.#state = verifySessionEnvironment(this.#state, {
        dialect,
        platform,
        source: 'probe',
        verifiedAt,
      });
      return true;
    });
  }

  writeProbe(data: string): Promise<{ ok: true } | { ok: false; error: 'session-not-running' }> {
    return this.#enqueue(() => {
      if (this.#disposed || this.#state.pty !== 'running') {
        return { ok: false as const, error: 'session-not-running' as const };
      }
      this.#backend.write(data);
      return { ok: true as const };
    });
  }

  setProbeEchoVisibility(hide: boolean): Promise<void> {
    return this.#enqueue(() => {
      if (this.#disposed) return;
      this.#hideCompletionProbeEcho = hide;
    });
  }

  writeExternal(
    data: string,
    expectedEnvironmentEpoch: number,
    expectedContextId: string,
    guard?: ExternalWriteGuard,
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        error:
          | 'stale-environment-epoch'
          | 'stale-execution-context'
          | 'environment-unverified'
          | 'session-not-running'
          | 'external-write-cancelled';
      }
  > {
    return this.#enqueue(() => {
      if (guard?.isCancelled() === true) {
        return { ok: false as const, error: 'external-write-cancelled' as const };
      }
      if (this.#disposed || this.#state.pty !== 'running') {
        return { ok: false as const, error: 'session-not-running' as const };
      }
      if (this.#state.environment.verificationStatus !== 'verified') {
        return { ok: false as const, error: 'environment-unverified' as const };
      }
      if (this.#state.environment.capabilityEpoch !== expectedEnvironmentEpoch) {
        return { ok: false as const, error: 'stale-environment-epoch' as const };
      }
      if (this.#state.executionContextId !== expectedContextId) {
        return { ok: false as const, error: 'stale-execution-context' as const };
      }
      this.#backend.write(data);
      this.#state = replaceSessionExecutionContext(this.#state, randomUUID());
      return { ok: true as const };
    });
  }

  resize(columns: number, rows: number): Promise<void> {
    return this.#enqueue(() => {
      if (this.#disposed) return;
      this.#state = resizeSession(this.#state, columns, rows);
      if (this.#state.pty === 'running') this.#backend.resize(columns, rows);
    });
  }

  interrupt(): Promise<void> {
    return this.#enqueue(() => {
      if (!this.#disposed && this.#state.pty === 'running') this.#backend.interrupt();
    });
  }

  terminate(): Promise<void> {
    return this.#enqueue(() => {
      if (!this.#disposed) this.#backend.terminate();
    });
  }

  waitForExit(timeoutMs: number): Promise<void> {
    if (this.#ptyExited) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#exitWaiters.delete(waiter);
        resolve();
      }, timeoutMs);
      const waiter = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.#exitWaiters.add(waiter);
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#eventListeners.clear();
    this.#exitWaiters.clear();
    this.#osc777Carry = '';
    for (const state of this.#suppressedInputEchoes.values()) this.#discardInputEcho(state);
    this.#suppressedInputEchoes.clear();
    this.#environmentProbeEchoes.clear();
  }

  suppressInputEcho(pattern: InputEchoPattern): void {
    if (pattern.start.length > 0 && pattern.end.length > 0) {
      const previous = this.#suppressedInputEchoes.get(pattern.start);
      if (previous !== undefined) this.#completeInputEcho(pattern.start, previous);
      this.#suppressedInputEchoes.set(pattern.start, {
        ...pattern,
        phase: 'searching',
        pending: [],
        endSearchOffset: 0,
        releaseWaiters: new Set(),
      });
    }
  }

  releaseInputEcho(
    pattern: InputEchoPattern,
    options: InputEchoReleaseOptions = {},
  ): Promise<void> {
    const graceMs = options.graceMs ?? 0;
    if (!Number.isFinite(graceMs) || graceMs < 0) {
      return Promise.reject(new RangeError('graceMs must be a non-negative finite number'));
    }

    let resolveRelease!: () => void;
    const released = new Promise<void>((resolve) => {
      resolveRelease = resolve;
    });
    const scheduled = this.#enqueue(() => {
      const state = this.#suppressedInputEchoes.get(pattern.start);
      if (state === undefined) {
        resolveRelease();
        return;
      }
      state.releaseWaiters.add(resolveRelease);
      if (graceMs === 0) {
        this.#completeInputEcho(pattern.start, state);
        return;
      }
      if (state.releaseTimer !== undefined) return;
      const timer = setTimeout(() => {
        void this.#enqueue(() => {
          const current = this.#suppressedInputEchoes.get(pattern.start);
          if (current?.releaseTimer === timer) {
            this.#completeInputEcho(pattern.start, current);
          }
        });
      }, graceMs);
      state.releaseTimer = timer;
    });
    void scheduled.catch(() => resolveRelease());
    return released;
  }

  suppressEnvironmentProbeEcho(nonce: string): void {
    if (nonce.length === 0) return;
    const marker = `__SYNAPSE_DIALECT_${nonce}__`;
    const previous = this.#environmentProbeEchoes.get(nonce);
    if (previous !== undefined) {
      const terminalData = joinPendingInputEcho(
        previous.pending.filter((segment) => !segment.terminalDelivered),
      );
      if (terminalData.length > 0) this.#emitTerminalOutput(terminalData);
    }
    this.#environmentProbeEchoes.set(nonce, {
      command: `echo ${marker}:$?`,
      marker,
      phase: 'command',
      pending: [],
    });
  }

  releaseEnvironmentProbeEcho(nonce: string): Promise<void> {
    return this.#enqueue(() => {
      const state = this.#environmentProbeEchoes.get(nonce);
      this.#environmentProbeEchoes.delete(nonce);
      if (state === undefined || state.pending.length === 0) return;
      const terminalData = joinPendingInputEcho(
        state.pending.filter((segment) => !segment.terminalDelivered),
      );
      if (terminalData.length > 0) this.#emitTerminalOutput(terminalData);
    });
  }

  #scanOsc777(
    data: string,
  ): Array<{ type: 'output'; data: string } | { type: 'control'; payload: string }> {
    const prefixes = ['\u001b]777;', '\u009d777;'] as const;
    const input = this.#osc777Carry + data;
    this.#osc777Carry = '';
    const events: Array<{ type: 'output'; data: string } | { type: 'control'; payload: string }> =
      [];
    let index = 0;
    while (index < input.length) {
      const match = findNextOsc777Prefix(input, prefixes, index);
      if (match === undefined) {
        const suffixStart = possibleOsc777PrefixStart(input, prefixes, index);
        if (suffixStart > index)
          events.push({ type: 'output', data: input.slice(index, suffixStart) });
        if (suffixStart < input.length) this.#osc777Carry = input.slice(suffixStart);
        break;
      }
      if (match.start > index)
        events.push({ type: 'output', data: input.slice(index, match.start) });
      const terminator = findOscTerminator(input, match.end);
      if (terminator === undefined) {
        this.#osc777Carry = limitOsc777Carry(input.slice(match.start), match.end - match.start);
        break;
      }
      events.push({
        type: 'control',
        payload: input.slice(match.end, terminator.payloadEnd),
      });
      index = terminator.end;
    }
    return events;
  }

  #suppressInputEcho(data: string): string {
    let visible = data;
    for (const [start, state] of this.#suppressedInputEchoes) {
      const stripped = stripSuppressedEcho(visible, state, this.#hideCompletionProbeEcho);
      this.#suppressedInputEchoes.set(start, stripped.state);
      visible = stripped.output;
    }
    return visible;
  }

  #suppressEnvironmentProbeEchoes(data: string): string {
    let visible = data;
    for (const [nonce, state] of this.#environmentProbeEchoes) {
      if (state.phase === 'done') {
        this.#environmentProbeEchoes.delete(nonce);
        continue;
      }
      const stripped = stripEnvironmentProbeEcho(visible, state, this.#hideCompletionProbeEcho);
      if (stripped.state.phase === 'done') this.#environmentProbeEchoes.delete(nonce);
      else this.#environmentProbeEchoes.set(nonce, stripped.state);
      visible = stripped.output;
    }
    return visible;
  }

  #completeInputEcho(start: string, state: InputEchoSuppression): void {
    if (this.#suppressedInputEchoes.get(start) !== state) return;
    if (state.releaseTimer !== undefined) clearTimeout(state.releaseTimer);
    this.#suppressedInputEchoes.delete(start);
    if (state.pending.length > 0) {
      const protocolData = joinPendingInputEcho(state.pending);
      const terminalData = joinPendingInputEcho(
        state.pending.filter((segment) => !segment.terminalDelivered),
      );
      this.#emitOutput(protocolData, terminalData, '');
    }
    for (const resolve of state.releaseWaiters) resolve();
    state.releaseWaiters.clear();
  }

  #discardInputEcho(state: InputEchoSuppression): void {
    if (state.releaseTimer !== undefined) clearTimeout(state.releaseTimer);
    for (const resolve of state.releaseWaiters) resolve();
    state.releaseWaiters.clear();
  }

  #emitOutput(protocolData: string, terminalData = protocolData, historyData = protocolData): void {
    if (protocolData.length === 0 && terminalData.length === 0) return;
    this.#outputSequence += 1;
    if (protocolData.length > 0) {
      this.#emit({
        type: 'pty_output',
        sequence: this.#outputSequence,
        data: protocolData,
        ...(historyData.length === 0 ? { historyData: '' } : { historyData }),
      });
    }
    if (terminalData.length > 0) this.#emitTerminalOutput(terminalData);
  }

  #emitTerminalOutput(data: string): void {
    this.#emit({ type: 'terminal_output', sequence: this.#outputSequence, data });
  }

  #emit(event: SessionActorEvent): void {
    for (const listener of this.#eventListeners) listener(event);
  }

  #invalidateEnvironment(): void {
    this.#state = replaceSessionExecutionContext(
      invalidateSessionEnvironment(this.#state),
      randomUUID(),
    );
    this.#emit({
      type: 'environment_invalidated',
      capabilityEpoch: this.#state.environment.capabilityEpoch,
    });
  }

  #enqueue<T>(task: () => T): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

const MAX_OSC777_CARRY_BYTES = 16 * 1024;

function limitOsc777Carry(value: string, prefixLength: number): string {
  if (Buffer.byteLength(value, 'utf8') <= MAX_OSC777_CARRY_BYTES) return value;
  const prefix = value.slice(0, prefixLength);
  const prefixBytes = Buffer.byteLength(prefix, 'utf8');
  return `${prefix}${takeStringFromEnd(value, MAX_OSC777_CARRY_BYTES - prefixBytes)}`;
}

function possiblePrefixStart(value: string, prefix: string, from: number): number {
  for (let length = Math.min(prefix.length - 1, value.length - from); length > 0; length -= 1) {
    const start = value.length - length;
    if (start >= from && value.slice(start) === prefix.slice(0, length)) return start;
  }
  return value.length;
}

function findNextOsc777Prefix(
  value: string,
  prefixes: readonly string[],
  from: number,
): { start: number; end: number } | undefined {
  let match: { start: number; end: number } | undefined;
  for (const prefix of prefixes) {
    const start = value.indexOf(prefix, from);
    if (start < 0 || (match !== undefined && start >= match.start)) continue;
    match = { start, end: start + prefix.length };
  }
  return match;
}

function possibleOsc777PrefixStart(
  value: string,
  prefixes: readonly string[],
  from: number,
): number {
  let suffixStart = value.length;
  for (const prefix of prefixes) {
    suffixStart = Math.min(suffixStart, possiblePrefixStart(value, prefix, from));
  }
  return suffixStart;
}

function findOscTerminator(
  value: string,
  from: number,
): { payloadEnd: number; end: number } | undefined {
  const candidates = [
    { index: value.indexOf('\u0007', from), length: 1 },
    { index: value.indexOf('\u009c', from), length: 1 },
    { index: value.indexOf('\u001b\\', from), length: 2 },
  ].filter((candidate) => candidate.index >= 0);
  if (candidates.length === 0) return undefined;
  const first = candidates.reduce((left, right) => (right.index < left.index ? right : left));
  return { payloadEnd: first.index, end: first.index + first.length };
}

export interface InputEchoPattern {
  readonly start: string;
  readonly end: string;
}

export interface InputEchoReleaseOptions {
  readonly graceMs?: number;
}

interface InputEchoSuppression extends InputEchoPattern {
  phase: InputEchoPhase;
  pending: PendingInputEchoSegment[];
  endSearchOffset: number;
  releaseTimer?: NodeJS.Timeout | undefined;
  releaseWaiters: Set<() => void>;
}

type InputEchoPhase = 'searching' | 'matching' | 'awaiting_line';

interface PendingInputEchoSegment {
  data: string;
  terminalDelivered: boolean;
}

type EnvironmentProbeEchoPhase = 'command' | 'command_line' | 'result' | 'done';

interface EnvironmentProbeEchoSuppression {
  command: string;
  marker: string;
  phase: EnvironmentProbeEchoPhase;
  pending: PendingInputEchoSegment[];
}

function stripSuppressedEcho(
  input: string,
  state: InputEchoSuppression,
  probeEchoHidden: boolean,
): { output: string; state: InputEchoSuppression } {
  const incoming: PendingInputEchoSegment = {
    data: input,
    terminalDelivered: !probeEchoHidden,
  };
  const segments = [...state.pending, ...(input.length > 0 ? [incoming] : [])];
  const data = joinPendingInputEcho(segments);
  if (state.phase === 'matching') {
    const end = findFlexibleMarker(data, state.end, state.endSearchOffset);
    if (end === undefined) {
      return {
        output: '',
        state: { ...state, pending: limitPendingInputEcho(segments) },
      };
    }
    return finishSuppressedInputEcho(data, end.end, state, probeEchoHidden);
  }

  if (state.phase === 'awaiting_line') {
    const lineBoundary = findLineBoundary(data);
    if (lineBoundary === undefined) return { output: data, state };
    const continued = stripSuppressedEcho(
      data.slice(lineBoundary),
      { ...state, phase: 'searching', pending: [], endSearchOffset: 0 },
      probeEchoHidden,
    );
    return {
      output: `${data.slice(0, lineBoundary)}${continued.output}`,
      state: continued.state,
    };
  }

  const start = findFlexibleMarker(data, state.start, 0);
  if (start !== undefined) {
    const candidate = slicePendingInputEcho(segments, start.start);
    const end = findFlexibleMarker(data, state.end, start.end);
    const matchingState: InputEchoSuppression = {
      ...state,
      phase: 'matching',
      pending: limitPendingInputEcho(candidate),
      endSearchOffset: start.end - start.start,
    };
    if (end === undefined) {
      return {
        output: data.slice(0, start.start),
        state: matchingState,
      };
    }
    return finishSuppressedInputEcho(
      data,
      end.end,
      matchingState,
      probeEchoHidden,
      data.slice(0, start.start),
    );
  }

  const suffixLength = trailingMarkerWindow(data, state.start, 0);
  const suffixStart = data.length - suffixLength;
  const pending = suffixLength > 0 ? slicePendingInputEcho(segments, suffixStart) : [];
  return {
    output: data.slice(0, suffixStart),
    state: {
      ...state,
      pending: limitPendingInputEcho(pending),
      phase: 'searching',
      endSearchOffset: 0,
    },
  };
}

function finishSuppressedInputEcho(
  data: string,
  end: number,
  state: InputEchoSuppression,
  probeEchoHidden: boolean,
  prefix = '',
): { output: string; state: InputEchoSuppression } {
  const afterEnd = data.slice(end);
  if (findLineBoundary(afterEnd) !== undefined) {
    const continued = stripSuppressedEcho(
      afterEnd,
      { ...state, phase: 'searching', pending: [], endSearchOffset: 0 },
      probeEchoHidden,
    );
    return { output: `${prefix}${continued.output}`, state: continued.state };
  }
  return {
    output: `${prefix}${afterEnd}`,
    state: {
      ...state,
      phase: 'awaiting_line',
      pending: [],
      endSearchOffset: 0,
    },
  };
}

function limitPendingInputEcho(segments: PendingInputEchoSegment[]): PendingInputEchoSegment[] {
  const maxBytes = 16 * 1024;
  let remaining = maxBytes;
  const limited: PendingInputEchoSegment[] = [];
  for (let index = segments.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const segment = segments[index]!;
    const data = takeStringFromEnd(segment.data, remaining);
    if (data.length === 0) continue;
    limited.unshift({ ...segment, data });
    remaining -= Buffer.byteLength(data, 'utf8');
  }
  return limited;
}

function joinPendingInputEcho(segments: PendingInputEchoSegment[]): string {
  return segments.map((segment) => segment.data).join('');
}

function slicePendingInputEcho(
  segments: PendingInputEchoSegment[],
  start: number,
  end = Number.POSITIVE_INFINITY,
): PendingInputEchoSegment[] {
  const result: PendingInputEchoSegment[] = [];
  let offset = 0;
  for (const segment of segments) {
    const segmentEnd = offset + segment.data.length;
    const sliceStart = Math.max(start, offset) - offset;
    const sliceEnd = Math.min(end, segmentEnd) - offset;
    if (sliceEnd > sliceStart) {
      result.push({ ...segment, data: segment.data.slice(sliceStart, sliceEnd) });
    }
    offset = segmentEnd;
    if (offset >= end) break;
  }
  return result;
}

function findLineBoundary(input: string): number | undefined {
  const carriageReturn = input.indexOf('\r');
  const lineFeed = input.indexOf('\n');
  if (carriageReturn < 0) return lineFeed < 0 ? undefined : lineFeed;
  if (lineFeed < 0) return carriageReturn;
  return Math.min(carriageReturn, lineFeed);
}

function takeStringFromEnd(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  const characters = [...value];
  for (const character of characters.reverse()) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    result = character + result;
    bytes += size;
  }
  return result;
}

function stripEnvironmentProbeEcho(
  input: string,
  state: EnvironmentProbeEchoSuppression,
  probeEchoHidden: boolean,
): { output: string; state: EnvironmentProbeEchoSuppression } {
  if (state.phase === 'done') return { output: input, state };
  const incoming: PendingInputEchoSegment = {
    data: input,
    terminalDelivered: !probeEchoHidden,
  };
  const segments = [...state.pending, ...(input.length > 0 ? [incoming] : [])];
  const data = joinPendingInputEcho(segments);
  let cursor = 0;
  let output = '';
  let nextState: EnvironmentProbeEchoSuppression = { ...state, pending: [] };

  while (nextState.phase !== 'done') {
    if (nextState.phase === 'command') {
      const command = findFlexibleMarker(data, nextState.command, cursor);
      if (command === undefined) {
        const suffixLength = trailingMarkerWindow(data, nextState.command, cursor);
        const suffixStart = data.length - suffixLength;
        return {
          output: `${output}${data.slice(cursor, suffixStart)}`,
          state: {
            ...nextState,
            pending: limitPendingInputEcho(slicePendingInputEcho(segments, suffixStart)),
          },
        };
      }
      output += data.slice(cursor, command.start);
      cursor = command.end;
      nextState = { ...nextState, phase: 'command_line' };
    }

    if (nextState.phase === 'command_line') {
      const lineEnd = findFlexibleMarker(data, '\n', cursor);
      if (lineEnd === undefined) {
        return {
          output,
          state: {
            ...nextState,
            pending: limitPendingInputEcho(slicePendingInputEcho(segments, cursor)),
          },
        };
      }
      cursor = lineEnd.end;
      nextState = { ...nextState, phase: 'result' };
    }

    if (nextState.phase === 'result') {
      const resultPrefix = `${nextState.marker}:`;
      const result = findFlexibleMarker(data, resultPrefix, cursor);
      if (result === undefined) {
        const suffixLength = trailingMarkerWindow(data, resultPrefix, cursor);
        const suffixStart = data.length - suffixLength;
        return {
          output: `${output}${data.slice(cursor, suffixStart)}`,
          state: {
            ...nextState,
            pending: limitPendingInputEcho(slicePendingInputEcho(segments, suffixStart)),
          },
        };
      }
      output += data.slice(cursor, result.start);
      const lineEnd = findFlexibleMarker(data, '\n', result.end);
      if (lineEnd === undefined) {
        return {
          output,
          state: {
            ...nextState,
            pending: limitPendingInputEcho(slicePendingInputEcho(segments, result.start)),
          },
        };
      }
      const value = removeTerminalEchoControls(data.slice(result.end, lineEnd.start)).trim();
      if (/^\d+$/.test(value) || /^(?:true|false)$/i.test(value)) {
        cursor = lineEnd.end;
        nextState = { ...nextState, phase: 'done' };
        output += data.slice(cursor);
        continue;
      }
      output += data.slice(result.start, lineEnd.end);
      cursor = lineEnd.end;
    }
  }

  return { output, state: nextState };
}

interface FlexibleMarkerMatch {
  start: number;
  end: number;
}

function findFlexibleMarker(
  input: string,
  marker: string,
  from: number,
): FlexibleMarkerMatch | undefined {
  const expression = new RegExp(
    [...marker]
      .map((character) => `${escapeRegExp(character)}${terminalEchoControlSequence}*`)
      .join(''),
    'g',
  );
  expression.lastIndex = from;
  const match = expression.exec(input);
  return match === null ? undefined : { start: match.index, end: match.index + match[0].length };
}

function trailingMarkerWindow(input: string, marker: string, from: number): number {
  const maxWindow = Math.min(input.length - from, Math.max(64, marker.length * 16));
  for (let start = input.length - 1; start >= input.length - maxWindow; start -= 1) {
    const normalized = removeTerminalEchoControls(input.slice(start));
    if (normalized.length > 0 && marker.startsWith(normalized)) return input.length - start;
  }
  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const terminalEchoControlSequence =
  '(?:\\x1b\\[[0-?]*[ -/]*[@-~]|\\x1b\\][^\\x07]*(?:\\x07|\\x1b\\\\)|\\x1b[@-_]|\\x08|\\r)';

function removeTerminalEchoControls(value: string): string {
  return value.replace(terminalEchoControlExpression, '');
}

const terminalEscapeCharacter = String.fromCharCode(0x1b);
const terminalBellCharacter = String.fromCharCode(0x07);
const terminalBackspaceCharacter = String.fromCharCode(0x08);
const terminalCarriageReturnCharacter = String.fromCharCode(0x0d);
const terminalEchoControlExpression = new RegExp(
  `${terminalEscapeCharacter}\\[[0-?]*[ -/]*[@-~]|${terminalEscapeCharacter}\\][^${terminalBellCharacter}]*` +
    `(?:${terminalBellCharacter}|${terminalEscapeCharacter}\\\\)|${terminalEscapeCharacter}[@-_]|` +
    `${terminalBackspaceCharacter}|${terminalCarriageReturnCharacter}`,
  'g',
);
