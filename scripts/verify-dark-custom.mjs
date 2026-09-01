import { chromium } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const readCustom = () =>
  page.evaluate(() => {
    const inputs = [...document.querySelectorAll('.theme-color-fields .theme-color-input')].map(
      (el) => el.value,
    );
    const enabled = document.querySelector('input[aria-label="启用自定义配色"]')?.checked;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
    return { inputs: inputs.slice(0, 3), enabled, scheme: document.documentElement.dataset.theme, bg };
  });

const openAppearance = async () => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: /外观/ }).click();
  const section = page.getByTestId('theme-settings-section');
  await page.waitForSelector('[data-testid="theme-settings-section"]');
  return section;
};

try {
  // Scenario A: clean new session, default dark scheme, inspect custom core colors.
  await page.goto(`${BASE_URL}`);
  await page.waitForSelector('.prototype-shell');
  let section = await openAppearance();
  console.log('A) default dark, before enable:', await readCustom());

  await section.getByLabel('启用自定义配色').check();
  await sleep(300);
  console.log('A) default dark, after enable:', await readCustom());

  // Scenario B: switch to light, enable custom (white seed), then switch back to dark.
  // Emulate the earlier fix: enabling on light seeds light core (#ffffff bg).
  await section.getByText('浅色', { exact: true }).click();
  await sleep(300);
  console.log('B) light + custom(core seeded):', await readCustom());

  await section.getByText('深色', { exact: true }).click();
  await sleep(500);
  console.log('B) back to dark, custom still on:', await readCustom());

  await page.getByRole('button', { name: /返回工作区/ }).click();
  await sleep(300);
  console.log('B) workspace bg after returning to dark:', await readCustom());
} finally {
  await browser.close();
}
console.log('done');