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
  const closeConfirm = page.getByRole('alertdialog', { name: '操作确认' });
  await expect(closeConfirm).toBeVisible();
  await closeConfirm.getByRole('button', { name: '关闭会话', exact: true }).click();
  await expect(openSessions).toBeVisible();
  await expect(openSessions.getByRole('option')).toHaveCount(17);
  await expect(page.getByRole('tab', { name: /session 20/i })).toHaveCount(0);
});

test('uses default aliases, allows duplicate renames, and copies the unique Session ID', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?sessions=2');

  await page.getByRole('button', { name: '新建终端会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建终端会话' });
  const alias = dialog.getByLabel('Session Alias');
  await expect(alias).toHaveValue('终端 1');
  await alias.fill('   ');
  await dialog.getByRole('button', { name: '创建并连接', exact: true }).click();

  const createdTab = page.getByRole('tab', { name: '终端 1 Git Bash', exact: true });
  await expect(createdTab).toBeVisible();
  await createdTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const renameDialog = page.getByRole('dialog', { name: '重命名会话' });
  await renameDialog.getByLabel('名称').fill('session 1');
  await renameDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'session 1 Git Bash', exact: true }).last(),
  ).toBeVisible();

  await page.getByRole('button', { name: '共享并复制当前 Session ID', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Session ID 已复制');
  const copiedId = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedId).toBe('session-3');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(
    page.getByRole('tab', { name: 'session 1 Git Bash', exact: true }).last(),
  ).toBeVisible();
});
