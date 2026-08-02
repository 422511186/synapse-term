import { describe, expect, it } from 'vitest';

import { ProtectedInputController, SecretRedactor } from './secret-protection.js';

describe('secret protection', () => {
  it('sends protected input only to the PTY callback and never exposes it in history', async () => {
    const writes: string[] = [];
    const controller = new ProtectedInputController(async (value) => {
      writes.push(value);
    });

    await controller.enter();
    await controller.send('super-secret\r');
    await controller.leave();

    expect(writes).toEqual(['super-secret\r']);
    expect(controller.history).toEqual([]);
    await expect(controller.send('after')).rejects.toThrow(/protected input/);
  });

  it('redacts tokens for model disclosure while preserving the local value', () => {
    const redactor = new SecretRedactor();
    const value = 'Authorization: Bearer abcdefghijklmnop\nnormal output';

    expect(redactor.redact(value)).toMatchObject({
      text: 'Authorization: Bearer [REDACTED]\nnormal output',
      redacted: true,
    });
    expect(value).toContain('abcdefghijklmnop');
  });

  it('fails closed when a custom detector throws', () => {
    const redactor = new SecretRedactor({
      detectors: [
        {
          name: 'broken',
          detect: () => {
            throw new Error('detector failed');
          },
        },
      ],
    });

    expect(redactor.redact('possibly secret')).toEqual({
      text: '[REDACTED:detector-error]',
      redacted: true,
      detectorError: true,
    });
  });
});
