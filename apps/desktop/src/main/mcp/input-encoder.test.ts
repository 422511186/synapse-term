import { describe, expect, it } from 'vitest';

import {
  encodeInput,
  InputEncoderError,
  INPUT_KEY_BYTES,
  MAX_INPUT_PAYLOAD_BYTES,
  MAX_INPUT_TEXT_BYTES,
  validateInputRequestId,
} from './input-encoder.js';

describe('external input encoder', () => {
  it('normalizes newlines and appends fixed key bytes after text', () => {
    const encoded = encodeInput({ text: '密码\n', keys: ['enter', 'up', 'f12'] });

    expect(encoded.normalizedText).toBe('密码\r');
    expect(encoded.data).toBe(
      `密码\r${INPUT_KEY_BYTES.enter}${INPUT_KEY_BYTES.up}${INPUT_KEY_BYTES.f12}`,
    );
    expect(encoded.textLength).toBe(Buffer.byteLength('密码\r', 'utf8'));
    expect(encoded.payloadBytes).toBe(Buffer.byteLength(encoded.data, 'utf8'));
    expect(encoded.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('encodes every protocol key without accepting arbitrary escape bytes', () => {
    const keys = Object.keys(INPUT_KEY_BYTES);
    const encoded = encodeInput({ keys });
    expect(encoded.keys).toEqual(keys);
    expect(encoded.data).toBe(
      keys.map((key) => INPUT_KEY_BYTES[key as keyof typeof INPUT_KEY_BYTES]).join(''),
    );

    expect(() => encodeInput({ text: 'bad\u001bsequence' })).toThrow(InputEncoderError);
    expect(() => encodeInput({ text: 'bad\rreturn' })).toThrow(InputEncoderError);
    expect(() => encodeInput({ keys: ['unknown'] })).toThrow(InputEncoderError);
  });

  it('rejects empty and oversized payloads before producing a partial write', () => {
    expect(() => encodeInput({})).toThrow(/^COMMAND_NOT_AUDITABLE:/);
    expect(() => encodeInput({ text: 'x'.repeat(MAX_INPUT_TEXT_BYTES + 1) })).toThrow(
      /^COMMAND_NOT_AUDITABLE:/,
    );
    expect(() => encodeInput({ keys: Array.from({ length: 129 }, () => 'up') })).toThrow(
      /^COMMAND_NOT_AUDITABLE:/,
    );
    expect(() => encodeInput({ text: 'x'.repeat(MAX_INPUT_PAYLOAD_BYTES) })).toThrow(
      /^COMMAND_NOT_AUDITABLE:/,
    );
  });

  it('validates request IDs without retaining their input contents', () => {
    expect(validateInputRequestId('request-1')).toBe(true);
    expect(validateInputRequestId('')).toBe(false);
    expect(validateInputRequestId('x'.repeat(257))).toBe(false);
    expect(validateInputRequestId('request\u0000id')).toBe(false);
  });
});
