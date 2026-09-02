import { describe, expect, it } from 'vitest';

import { SecretRedactor } from './secret-redactor.js';

describe('SecretRedactor', () => {
  it('masks common credential formats', () => {
    const value = [
      'aws AKIAIOSFODNN7EXAMPLE',
      'github ghp_abcdefghijklmnopqrstuvwxyz012345',
      'api_key=super-secret-value',
      'Bearer abc.def.ghi',
    ].join('\n');
    const result = new SecretRedactor().redact(value);

    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.text).not.toContain('super-secret-value');
    expect(result.text).toContain('[REDACTED]');
  });

  it('leaves ordinary output unchanged', () => {
    const value = 'tests 12 passed, coverage 91%';
    expect(new SecretRedactor().redact(value)).toEqual({ text: value, redacted: false });
  });

  it('redacts a credential split across output chunks before it can be observed', () => {
    const stream = new SecretRedactor().createStream();
    const first = stream.push('api_key=super-');
    const second = stream.push('secret-value\nnext');
    const last = stream.flush();

    expect(`${first.text}${second.text}${last.text}`).toBe('[REDACTED]\nnext');
    expect(`${first.text}${second.text}${last.text}`).not.toContain('super-secret-value');
  });

  it('bounds an unclosed credential carry without emitting its contents', () => {
    const stream = new SecretRedactor().createStream();
    const result = stream.push(`api_key=${'x'.repeat(20_000)}`);

    expect(result.redacted).toBe(true);
    expect(result.text).toBe('[REDACTED]');
    expect(result.text).not.toContain('x'.repeat(100));
  });
});
