import { createHash } from 'node:crypto';

import type { InputKey } from '@synapse-term/domain';
import type { InteractiveInputPayload } from '@synapse-term/terminal-service';

export const MAX_INPUT_TEXT_BYTES = 8 * 1024;
export const MAX_INPUT_KEYS = 128;
export const MAX_INPUT_PAYLOAD_BYTES = 16 * 1024;
export const BOUNDED_INPUT_MAX_CALLS = 256;
export const BOUNDED_INPUT_MAX_BYTES = 256 * 1024;
export const BOUNDED_INPUT_IDLE_TIMEOUT_MS = 10 * 60_000;

export const INPUT_KEY_BYTES: Readonly<Record<InputKey, string>> = {
  up: '\u001b[A',
  down: '\u001b[B',
  right: '\u001b[C',
  left: '\u001b[D',
  enter: '\r',
  esc: '\u001b',
  tab: '\t',
  backspace: '\u007f',
  delete: '\u001b[3~',
  home: '\u001b[H',
  end: '\u001b[F',
  pageup: '\u001b[5~',
  pagedown: '\u001b[6~',
  space: ' ',
  f1: '\u001bOP',
  f2: '\u001bOQ',
  f3: '\u001bOR',
  f4: '\u001bOS',
  f5: '\u001b[15~',
  f6: '\u001b[17~',
  f7: '\u001b[18~',
  f8: '\u001b[19~',
  f9: '\u001b[20~',
  f10: '\u001b[21~',
  f11: '\u001b[23~',
  f12: '\u001b[24~',
};

export const INPUT_KEYS = Object.freeze(Object.keys(INPUT_KEY_BYTES) as InputKey[]);

export interface InputEncodingInput {
  text?: unknown;
  keys?: unknown;
}

export interface EncodedInput extends InteractiveInputPayload {
  readonly normalizedText: string;
}

export class InputEncoderError extends Error {
  readonly code = 'COMMAND_NOT_AUDITABLE' as const;

  constructor(message: string) {
    super(`COMMAND_NOT_AUDITABLE: ${message} 请调整输入后重试；本次未写入。`);
    this.name = this.code;
  }
}

export function encodeInput(input: InputEncodingInput): EncodedInput {
  const normalizedText = normalizeText(input.text);
  const keys = normalizeKeys(input.keys);
  const textLength = Buffer.byteLength(normalizedText, 'utf8');
  if (textLength > MAX_INPUT_TEXT_BYTES) {
    throw new InputEncoderError(`文本 UTF-8 字节数不得超过 ${MAX_INPUT_TEXT_BYTES}。`);
  }
  if (normalizedText.length === 0 && keys.length === 0) {
    throw new InputEncoderError('text 与 keys 不能同时为空。');
  }
  const keyPayload = keys.map((key) => INPUT_KEY_BYTES[key]).join('');
  const data = `${normalizedText}${keyPayload}`;
  const payloadBytes = Buffer.byteLength(data, 'utf8');
  if (payloadBytes > MAX_INPUT_PAYLOAD_BYTES) {
    throw new InputEncoderError(`合并输入 payload 字节数不得超过 ${MAX_INPUT_PAYLOAD_BYTES}。`);
  }
  const payloadHash = createHash('sha256')
    .update(JSON.stringify({ text: normalizedText, keys }), 'utf8')
    .digest('hex');
  return {
    data,
    normalizedText,
    textLength,
    keys,
    payloadBytes,
    payloadHash,
  };
}

export const encodeExternalInput = encodeInput;

export function validateInputRequestId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) return false;
  return [...value].every((character) => !isControlCodePoint(character.codePointAt(0) ?? 0));
}

function normalizeText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new InputEncoderError('text 必须是字符串。');
  let normalized = '';
  for (let index = 0; index < value.length;) {
    const codeUnit = value.charCodeAt(index);
    const codePoint = value.codePointAt(index) ?? 0;
    const character = String.fromCodePoint(codePoint);
    if (isUnpairedSurrogate(codeUnit, value, index)) {
      throw new InputEncoderError('text 包含无效的 Unicode 字符。');
    }
    if (character === '\n') {
      normalized += '\r';
    } else if (isControlCodePoint(codePoint)) {
      throw new InputEncoderError('text 只允许可打印 Unicode 字符和换行。');
    } else {
      normalized += character;
    }
    index += character.length;
  }
  return normalized;
}

function normalizeKeys(value: unknown): InputKey[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InputEncoderError('keys 必须是固定键名数组。');
  if (value.length > MAX_INPUT_KEYS) {
    throw new InputEncoderError(`keys 数量不得超过 ${MAX_INPUT_KEYS}。`);
  }
  const keys: InputKey[] = [];
  for (const key of value) {
    if (typeof key !== 'string' || !isInputKey(key)) {
      throw new InputEncoderError('keys 包含不在白名单中的键名。');
    }
    keys.push(key);
  }
  return keys;
}

function isInputKey(value: string): value is InputKey {
  return Object.prototype.hasOwnProperty.call(INPUT_KEY_BYTES, value);
}

function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);
}

function isUnpairedSurrogate(codeUnit: number, value: string, index: number): boolean {
  if (codeUnit < 0xd800 || codeUnit > 0xdfff) return false;
  if (codeUnit <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return next < 0xdc00 || next > 0xdfff;
  }
  const previous = value.charCodeAt(index - 1);
  return previous < 0xd800 || previous > 0xdbff;
}
