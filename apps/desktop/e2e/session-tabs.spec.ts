import { expect, test } from '@playwright/test';

test('keeps up to twenty runtime Sessions reachable through tabs and search', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 640 });
  await page.goto('/?sessions=20&stale=2');

  const tabs = page.getByRole('tablist', { name: '终端会话' });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(18);
  await expect
    .poll(() => tabs.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);
  await expect
    .poll(() =>
      tabs.evaluate(
        (element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
      ),
    )
    .toBe('rgba(82, 82, 91, 0.9)');
  await expect(page.getByRole('button', { name: '新建终端会话' })).toBeVisible();

  await page.getByRole('button', { name: '全部会话' }).click();
  const allSessions = page.getByRole('dialog', { name: '全部会话' });
  await expect(allSessions).toBeVisible();
  await expect(allSessions.getByRole('option')).toHaveCount(20);
  await allSessions.getByPlaceholder('搜索会话').fill('session 20');
  await expect(allSessions.getByRole('option', { name: /session 20.*Git Bash/i })).toBeVisible();
  await allSessions.getByRole('option', { name: /session 20.*Git Bash/i }).click();
  await expect(page.getByLabel('session 20 终端')).toBeVisible();
  await expect(page.locator('.terminal-host')).toHaveCount(1);
  await page.getByRole('button', { name: '全部会话' }).click();
  const openSessions = page.getByRole('dialog', { name: '全部会话' });
  await openSessions.getByRole('button', { exact: true, name: '关闭 session 1' }).click();
  await expect(openSessions).toBeVisible();
  await expect(openSessions.getByRole('option')).toHaveCount(19);
  await openSessions.getByRole('button', { exact: true, name: '关闭 session 2' }).click();
  await expect(openSessions).toBeVisible();
  await expect(openSessions.getByRole('option')).toHaveCount(18);
  await openSessions.getByRole('button', { exact: true, name: '关闭 session 20' }).click();
  await expect(openSessions).toBeVisible();
  await expect(openSessions.getByRole('option')).toHaveCount(17);
  await expect(page.getByRole('tab', { name: /session 20/i })).toHaveCount(0);
});
