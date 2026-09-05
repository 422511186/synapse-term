import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Real ConPTY integration tests become timing-dependent when Windows is oversubscribed.
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
    },
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', '**/e2e/**'],
    include: ['{apps,packages}/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
});
