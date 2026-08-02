import { describe, expect, it } from 'vitest';

import { WebTreeSitterBashParser } from './bash-parser.js';

describe('WebTreeSitterBashParser', () => {
  it('parses Bash pipelines and reports syntax errors', async () => {
    const parser = await WebTreeSitterBashParser.create();
    try {
      await expect(parser.parse('printf ok | grep ok')).resolves.toMatchObject({
        hasError: false,
      });
      await expect(parser.parse('printf (')).resolves.toMatchObject({ hasError: true });
    } finally {
      parser.dispose();
    }
  }, 15_000);
});
