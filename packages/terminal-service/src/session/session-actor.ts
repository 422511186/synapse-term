import {
  createSessionState,
  invalidateSessionEnvironment,
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

export type SessionActorEvent =
  | { type: 'pty_output'; sequence: number; data: string }
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
              this.#emitOutput(protocolData, terminalData);
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

  onEvent(listener: (event: SessionActorEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  markPtyRunning(): Promise<void> {
    return this.#enqueue(() => {
      const transition = transitionSessionPty(this.#state, 'running');
      if (!transition.ok) throw new Error(transition.error);
      this.#state = transition.value;
    });
  }

  rename(title: string): Promise<void> {
    return this.#enqueue(() => {
      this.#state = { ...this.#state, title: title.trim() };
    });
  }

  writeUser(data: string): Promise<{ ok: true } | { ok: false; error: 'session-not-running' }> {
    return this.#enqueue(() => {
      if (this.#state.pty !== 'running') {
        return { ok: false as const, error: 'session-not-running' as const };
      }
      this.#state = invalidateSessionEnvironment(this.#state);
      this.#emit({
        type: 'environment_invalidated',
        capabilityEpoch: this.#state.environment.capabilityEpoch,
      });
      this.#backend.write(data);
      return { ok: true as const };
    });
  }

  verifyEnvironment(
    dialect: Exclude<ExecutionDialect, 'unknown'>,
    platform: Exclude<EnvironmentPlatform, 'unknown'>,
    verifiedAt = new Date().toISOString(),
  ): Promise<void> {
    return this.#enqueue(() => {
      this.#state = verifySessionEnvironment(this.#state, {
        dialect,
        platform,
        source: 'probe',
        verifiedAt,
      });
    });
  }

  writeProbe(data: string): Promise<{ ok: true } | { ok: false; error: 'session-not-running' }> {
    return this.#enqueue(() => {
      if (this.#state.pty !== 'running') {
        return { ok: false as const, error: 'session-not-running' as const };
      }
      this.#backend.write(data);
      return { ok: true as const };
    });
  }

  setProbeEchoVisibility(hide: boolean): Promise<void> {
    return this.#enqueue(() => {
      this.#hideCompletionProbeEcho = hide;
    });
  }

  writeExternal(
    data: string,
    expectedEnvironmentEpoch: number,
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        error: 'stale-environment-epoch' | 'environment-unverified' | 'session-not-running';
      }
  > {
    return this.#enqueue(() => {
      if (this.#state.pty !== 'running') {
        return { ok: false as const, error: 'session-not-running' as const };
      }
      if (this.#state.environment.verificationStatus !== 'verified') {
        return { ok: false as const, error: 'environment-unverified' as const };
      }
      if (this.#state.environment.capabilityEpoch !== expectedEnvironmentEpoch) {
        return { ok: false as const, error: 'stale-environment-epoch' as const };
      }
      this.#backend.write(data);
      return { ok: true as const };
    });
  }

  resize(columns: number, rows: number): Promise<void> {
    return this.#enqueue(() => {
      this.#state = resizeSession(this.#state, columns, rows);
      if (this.#state.pty === 'running') this.#backend.resize(columns, rows);
    });
  }

  interrupt(): Promise<void> {
    return this.#enqueue(() => {
      if (this.#state.pty === 'running') this.#backend.interrupt();
    });
  }

  terminate(): Promise<void> {
    return this.#enqueue(() => {
      this.#backend.terminate();
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
    this.#suppressedInputEchoes.clear();
    this.#environmentProbeEchoes.clear();
  }

  suppressInputEcho(pattern: InputEchoPattern): void {
    if (pattern.start.length > 0 && pattern.end.length > 0) {
      this.#suppressedInputEchoes.set(pattern.start, { ...pattern, active: false, carry: '' });
    }
  }

  releaseInputEcho(pattern: InputEchoPattern): Promise<void> {
    return this.#enqueue(() => {
      const state = this.#suppressedInputEchoes.get(pattern.start);
      this.#suppressedInputEchoes.delete(pattern.start);
      if (state !== undefined && !state.active && state.carry.length > 0) {
        if (!this.#hideCompletionProbeEcho) this.#emitTerminalOutput(state.carry);
      }
    });
  }

  suppressEnvironmentProbeEcho(nonce: string): void {
    if (nonce.length === 0) return;
    const marker = `__SYNAPSE_DIALECT_${nonce}__`;
    this.#environmentProbeEchoes.set(nonce, {
      command: `echo ${marker}:$?`,
      marker,
      phase: 'command',
      carry: '',
    });
  }

  releaseEnvironmentProbeEcho(nonce: string): Promise<void> {
    return this.#enqueue(() => {
      this.#environmentProbeEchoes.delete(nonce);
    });
  }

  #scanOsc777(
    data: string,
  ): Array<{ type: 'output'; data: string } | { type: 'control'; payload: string }> {
    const prefix = '\u001b]777;';
    const input = this.#osc777Carry + data;
    this.#osc777Carry = '';
    const events: Array<{ type: 'output'; data: string } | { type: 'control'; payload: string }> =
      [];
    let index = 0;
    while (index < input.length) {
      const start = input.indexOf(prefix, index);
      if (start < 0) {
        const suffixStart = possiblePrefixStart(input, prefix, index);
        if (suffixStart > index)
          events.push({ type: 'output', data: input.slice(index, suffixStart) });
        if (suffixStart < input.length) this.#osc777Carry = input.slice(suffixStart);
        break;
      }
      if (start > index) events.push({ type: 'output', data: input.slice(index, start) });
      const end = input.indexOf('\u0007', start + prefix.length);
      if (end < 0) {
        this.#osc777Carry = input.slice(start);
        break;
      }
      events.push({ type: 'control', payload: input.slice(start + prefix.length, end) });
      index = end + 1;
    }
    return events;
  }

  #suppressInputEcho(data: string): string {
    let visible = data;
    for (const [start, state] of this.#suppressedInputEchoes) {
      const stripped = stripSuppressedEcho(`${state.carry}${visible}`, state);
      this.#suppressedInputEchoes.set(start, stripped.state);
      visible = stripped.output;
    }
    return visible;
  }

  #suppressEnvironmentProbeEchoes(data: string): string {
    let visible = data;
    for (const [nonce, state] of this.#environmentProbeEchoes) {
      const stripped = stripEnvironmentProbeEcho(visible, state);
      this.#environmentProbeEchoes.set(nonce, stripped.state);
      visible = stripped.output;
    }
    return visible;
  }

  #emitOutput(protocolData: string, terminalData = protocolData): void {
    if (protocolData.length === 0 && terminalData.length === 0) return;
    this.#outputSequence += 1;
    if (protocolData.length > 0) {
      this.#emit({ type: 'pty_output', sequence: this.#outputSequence, data: protocolData });
    }
    if (terminalData.length > 0) this.#emitTerminalOutput(terminalData);
  }

  #emitTerminalOutput(data: string): void {
    this.#emit({ type: 'terminal_output', sequence: this.#outputSequence, data });
  }

  #emit(event: SessionActorEvent): void {
    for (const listener of this.#eventListeners) listener(event);
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

function possiblePrefixStart(value: string, prefix: string, from: number): number {
  for (let length = Math.min(prefix.length - 1, value.length - from); length > 0; length -= 1) {
    const start = value.length - length;
    if (start >= from && value.slice(start) === prefix.slice(0, length)) return start;
  }
  return value.length;
}

export interface InputEchoPattern {
  readonly start: string;
  readonly end: string;
}

interface InputEchoSuppression extends InputEchoPattern {
  active: boolean;
  carry: string;
}

type EnvironmentProbeEchoPhase = 'command' | 'command_line' | 'result' | 'done';

interface EnvironmentProbeEchoSuppression {
  command: string;
  marker: string;
  phase: EnvironmentProbeEchoPhase;
  carry: string;
}

function stripSuppressedEcho(
  input: string,
  state: InputEchoSuppression,
): { output: string; state: InputEchoSuppression } {
  let output = '';
  let index = 0;
  while (index < input.length) {
    if (!state.active) {
      const match = findFlexibleMarker(input, state.start, index);
      if (match !== undefined) {
        output += input.slice(index, match.start);
        index = match.end;
        state.active = true;
        continue;
      }

      const suffixLength = trailingMarkerWindow(input, state.start, index);
      const suffixStart = input.length - suffixLength;
      output += input.slice(index, suffixStart);
      return { output, state: { ...state, carry: input.slice(suffixStart) } };
    }

    const end = findFlexibleMarker(input, state.end, index);
    if (end === undefined) {
      const suffixLength = trailingMarkerWindow(input, state.end, index);
      const suffixStart = input.length - suffixLength;
      return { output, state: { ...state, carry: input.slice(suffixStart) } };
    }
    index = end.end;
    state.active = false;
    state.carry = '';
  }
  return { output, state: { ...state, carry: '' } };
}

function stripEnvironmentProbeEcho(
  input: string,
  state: EnvironmentProbeEchoSuppression,
): { output: string; state: EnvironmentProbeEchoSuppression } {
  const data = `${state.carry}${input}`;
  let cursor = 0;
  let output = '';
  let nextState: EnvironmentProbeEchoSuppression = { ...state, carry: '' };

  while (nextState.phase !== 'done') {
    if (nextState.phase === 'command') {
      const command = findFlexibleMarker(data, nextState.command, cursor);
      if (command === undefined) {
        const suffixLength = trailingMarkerWindow(data, nextState.command, cursor);
        const suffixStart = data.length - suffixLength;
        return {
          output: `${output}${data.slice(cursor, suffixStart)}`,
          state: { ...nextState, carry: data.slice(suffixStart) },
        };
      }
      output += data.slice(cursor, command.start);
      cursor = command.end;
      nextState = { ...nextState, phase: 'command_line' };
    }

    if (nextState.phase === 'command_line') {
      const lineEnd = findFlexibleMarker(data, '\n', cursor);
      if (lineEnd === undefined) {
        return { output, state: { ...nextState, carry: data.slice(cursor) } };
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
          state: { ...nextState, carry: data.slice(suffixStart) },
        };
      }
      output += data.slice(cursor, result.start);
      const lineEnd = findFlexibleMarker(data, '\n', result.end);
      if (lineEnd === undefined) {
        return { output, state: { ...nextState, carry: data.slice(result.start) } };
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
