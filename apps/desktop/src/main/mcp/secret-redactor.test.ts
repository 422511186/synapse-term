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
});
