import { expect, test } from '@playwright/test';

test('downloads an update and requires confirmation before ending Sessions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?sessions=2&updates=available');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const updates = page.getByRole('region', { name: '软件更新' });
  await expect(updates).toBeVisible();
  await updates.getByRole('button', { name: '下载更新' }).click();
  await expect(updates.getByRole('button', { name: '取消下载' })).toBeVisible();
  await updates.getByRole('button', { name: '取消下载' }).click();
  await expect(updates.getByRole('button', { name: '下载更新' })).toBeVisible();
  await updates.getByRole('button', { name: '下载更新' }).click();
  await updates.getByRole('button', { name: '重启并更新' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('2 个 Session');
  await expect(confirmation).toContainText('无法恢复');
  await page.screenshot({ path: 'test-results/updates-desktop-confirmation.png', fullPage: true });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '返回工作区' }).click();
  await expect(page.getByRole('tab', { name: 'session 1 Git Bash', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await updates.getByRole('button', { name: '重启并更新' }).click();
  await confirmation.getByRole('button', { name: '结束 Session 并更新' }).click();
  await expect(updates).toContainText('正在安装');
});

test('shows check failures and keeps the narrow light settings layout within the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?updates=error');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: /外观/ })
    .click();
  await page.getByRole('radio', { name: '浅色' }).check();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: /通用/ })
    .click();
  const updates = page.getByRole('region', { name: '软件更新' });
  await expect(updates).toContainText('检查更新失败');
  await expect(updates.getByRole('link', { name: /GitHub Releases/ })).toHaveAttribute(
    'href',
    'https://github.com/422511186/synapse-term/releases',
  );
  expect(await updates.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/updates-mobile-light.png', fullPage: true });
});
