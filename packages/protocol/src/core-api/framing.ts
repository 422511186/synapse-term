import { controlEnvelopeSchema, type ControlEnvelope } from './envelope.js';

const LENGTH_PREFIX_BYTES = 4;
const CONTROL_FRAME_TYPE = 1;
const TERMINAL_OUTPUT_FRAME_TYPE = 2;
const SESSION_ID_LENGTH_BYTES = 2;
const SEQUENCE_BYTES = 8;
export const DEFAULT_MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const MAX_TERMINAL_OUTPUT_CHUNK_BYTES = 256 * 1024;
export const MAX_TERMINAL_REPLAY_BYTES = 512 * 1024;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export type FramingErrorCode = 'invalid_frame' | 'frame_too_large' | 'resource_exhausted';

export class FramingError extends Error {
  readonly code: FramingErrorCode;

  constructor(code: FramingErrorCode, message: string) {
    super(message);
    this.name = 'FramingError';
    this.code = code;
  }
}

export function splitUtf8Text(value: string, maxBytes = MAX_TERMINAL_OUTPUT_CHUNK_BYTES): string[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer');
  }
  if (value.length === 0) return [];

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (characterBytes > maxBytes) {
      throw new RangeError('maxBytes is smaller than one UTF-8 code point');
    }
    if (current.length > 0 && currentBytes + characterBytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export interface FrameDecoderOptions {
  maxFrameBytes?: number;
  maxBufferedBytes?: number;
  pauseAtBufferedBytes?: number;
}

export type DecodedFrame =
  | { kind: 'control'; envelope: ControlEnvelope }
  | { kind: 'terminal_output'; sessionId: string; sequence: number; data: Uint8Array };

export interface TerminalOutputFrame {
  sessionId: string;
  sequence: number;
  data: Uint8Array;
}

export function encodeControlFrame(envelope: ControlEnvelope): Uint8Array {
  const validated = controlEnvelopeSchema.parse(envelope);
  const payload = Buffer.from(JSON.stringify(validated), 'utf8');
  const frameLength = 1 + payload.length;
  assertFrameLength(frameLength);
  const frame = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES + frameLength);
  frame.writeUInt32BE(frameLength, 0);
  frame[LENGTH_PREFIX_BYTES] = CONTROL_FRAME_TYPE;
  payload.copy(frame, LENGTH_PREFIX_BYTES + 1);
  return frame;
}

export function encodeTerminalOutputFrame(output: TerminalOutputFrame): Uint8Array {
  const sessionId = Buffer.from(output.sessionId, 'utf8');
  if (sessionId.length === 0 || sessionId.length > 0xffff) {
    throw new RangeError('sessionId must encode to between 1 and 65535 bytes');
  }
  if (!Number.isSafeInteger(output.sequence) || output.sequence < 0) {
    throw new RangeError('sequence must be a non-negative safe integer');
  }

  const data = Buffer.from(output.data.buffer, output.data.byteOffset, output.data.byteLength);
  const frameLength = 1 + SESSION_ID_LENGTH_BYTES + sessionId.length + SEQUENCE_BYTES + data.length;
  assertFrameLength(frameLength);
  const frame = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES + frameLength);
  frame.writeUInt32BE(frameLength, 0);
  let offset = LENGTH_PREFIX_BYTES;
  frame[offset] = TERMINAL_OUTPUT_FRAME_TYPE;
  offset += 1;
  frame.writeUInt16BE(sessionId.length, offset);
  offset += SESSION_ID_LENGTH_BYTES;
  sessionId.copy(frame, offset);
  offset += sessionId.length;
  frame.writeBigUInt64BE(BigInt(output.sequence), offset);
  offset += SEQUENCE_BYTES;
  data.copy(frame, offset);
  return frame;
}

function assertFrameLength(frameLength: number): void {
  if (frameLength > DEFAULT_MAX_FRAME_BYTES) {
    throw new FramingError(
      'frame_too_large',
      `frame length ${String(frameLength)} exceeds ${String(DEFAULT_MAX_FRAME_BYTES)}`,
    );
  }
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);
  readonly #maxFrameBytes: number;
  readonly #maxBufferedBytes: number;
  readonly #pauseAtBufferedBytes: number;

  constructor(options: FrameDecoderOptions = {}) {
    this.#maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.#maxBufferedBytes = options.maxBufferedBytes ?? this.#maxFrameBytes + LENGTH_PREFIX_BYTES;
    this.#pauseAtBufferedBytes =
      options.pauseAtBufferedBytes ?? Math.max(1, Math.floor(this.#maxBufferedBytes / 2));

    if (
      !Number.isSafeInteger(this.#maxFrameBytes) ||
      this.#maxFrameBytes < 1 ||
      this.#maxFrameBytes > 0xffffffff
    ) {
      throw new RangeError('maxFrameBytes must be an integer between 1 and 4294967295');
    }
    if (
      !Number.isSafeInteger(this.#maxBufferedBytes) ||
      this.#maxBufferedBytes < LENGTH_PREFIX_BYTES
    ) {
      throw new RangeError('maxBufferedBytes must be an integer of at least 4');
    }
    if (
      !Number.isSafeInteger(this.#pauseAtBufferedBytes) ||
      this.#pauseAtBufferedBytes < 1 ||
      this.#pauseAtBufferedBytes > this.#maxBufferedBytes
    ) {
      throw new RangeError('pauseAtBufferedBytes must be within the buffer limit');
    }
  }

  get bufferedBytes(): number {
    return this.#buffer.length;
  }

  get shouldPause(): boolean {
    return this.#buffer.length >= this.#pauseAtBufferedBytes;
  }

  push(chunk: Uint8Array): DecodedFrame[] {
    if (this.#buffer.length + chunk.length > this.#maxBufferedBytes) {
      throw new FramingError(
        'resource_exhausted',
        `buffered data would exceed ${String(this.#maxBufferedBytes)} bytes`,
      );
    }

    if (chunk.length > 0) {
      this.#buffer = Buffer.concat([
        this.#buffer,
        Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      ]);
    }

    const frames: DecodedFrame[] = [];
    while (this.#buffer.length >= LENGTH_PREFIX_BYTES) {
      const frameLength = this.#buffer.readUInt32BE(0);
      if (frameLength < 1) {
        throw new FramingError('invalid_frame', 'frame body must include a type byte');
      }
      if (frameLength > this.#maxFrameBytes) {
        throw new FramingError(
          'frame_too_large',
          `frame length ${String(frameLength)} exceeds ${String(this.#maxFrameBytes)}`,
        );
      }
      const totalLength = LENGTH_PREFIX_BYTES + frameLength;
      if (this.#buffer.length < totalLength) break;

      const frameType = this.#buffer[LENGTH_PREFIX_BYTES];
      if (frameType === CONTROL_FRAME_TYPE) {
        const payload = this.#buffer.subarray(LENGTH_PREFIX_BYTES + 1, totalLength);
        let envelope: ControlEnvelope;
        try {
          envelope = controlEnvelopeSchema.parse(JSON.parse(utf8Decoder.decode(payload)));
        } catch {
          throw new FramingError('invalid_frame', 'invalid control frame payload');
        }
        frames.push({ kind: 'control', envelope });
      } else if (frameType === TERMINAL_OUTPUT_FRAME_TYPE) {
        if (frameLength < 1 + SESSION_ID_LENGTH_BYTES + SEQUENCE_BYTES) {
          throw new FramingError('invalid_frame', 'terminal output frame header is truncated');
        }
        const sessionLengthOffset = LENGTH_PREFIX_BYTES + 1;
        const sessionIdLength = this.#buffer.readUInt16BE(sessionLengthOffset);
        const sessionIdOffset = sessionLengthOffset + SESSION_ID_LENGTH_BYTES;
        const sequenceOffset = sessionIdOffset + sessionIdLength;
        const dataOffset = sequenceOffset + SEQUENCE_BYTES;
        if (sessionIdLength === 0 || dataOffset > totalLength) {
          throw new FramingError('invalid_frame', 'invalid terminal output frame header');
        }

        const sequence = this.#buffer.readBigUInt64BE(sequenceOffset);
        if (sequence > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new FramingError(
            'invalid_frame',
            'terminal output sequence exceeds the safe integer range',
          );
        }

        let sessionId: string;
        try {
          sessionId = utf8Decoder.decode(this.#buffer.subarray(sessionIdOffset, sequenceOffset));
        } catch {
          throw new FramingError('invalid_frame', 'terminal output session ID is not UTF-8');
        }

        frames.push({
          kind: 'terminal_output',
          sessionId,
          sequence: Number(sequence),
          data: this.#buffer.subarray(dataOffset, totalLength),
        });
      } else {
        throw new FramingError('invalid_frame', `unsupported frame type: ${String(frameType)}`);
      }
      this.#buffer = this.#buffer.subarray(totalLength);
    }

    return frames;
  }
}
