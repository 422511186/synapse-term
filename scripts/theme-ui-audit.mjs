/* 临时截图脚本：主题功能 UI 审查用（首轮交付后希望收集意见）。 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const OUT_DIR = '/workspace/test-results/ui-audit';
const BASE_URL = 'http://127.0.0.1:4173';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`${BASE_URL}/?sessions=1`);
  await page.waitForSelector('.prototype-shell');
  await sleep(600);
  await page.screenshot({ path: `${OUT_DIR}/01-workspace-dark.png` });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /外观/ }).click();
  await page.waitForSelector('[data-testid="theme-settings-section"]');
  await sleep(400);
  await page.screenshot({ path: `${OUT_DIR}/02-appearance-default.png` });

  const section = page.getByTestId('theme-settings-section');
  await section.getByLabel('启用自定义配色').check();
  await section.getByLabel('背景色 输入').fill('#1e293b');
  await section.getByLabel('前景色 输入').fill('#e2e8f0');
  await section.getByLabel('强调色 输入').fill('#38bdf8');
  await sleep(400);
  await page.screenshot({ path: `${OUT_DIR}/03-custom-core.png` });

  await section.getByLabel('终端文字 红 输入').fill('#ff0000');
  await section.getByLabel('终端文字 亮绿 输入').fill('#4ade80');
  await sleep(400);
  await page.screenshot({ path: `${OUT_DIR}/04-custom-terminal-text.png` });

  await section.getByText('浅色', { exact: true }).click();
  await sleep(600);
  await page.screenshot({ path: `${OUT_DIR}/05-light-custom.png` });
} finally {
  await browser.close();
}
console.log('done');