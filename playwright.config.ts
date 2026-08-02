import { defineConfig } from '@playwright/test';

const rendererUrl = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './apps/desktop/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command:
      process.platform === 'win32'
        ? 'pnpm.cmd --filter @synapse-term/desktop dev'
        : 'pnpm --filter @synapse-term/desktop dev',
    url: rendererUrl,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: rendererUrl,
    launchOptions:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH === undefined
        ? undefined
        : { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
