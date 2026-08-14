import { expect, test } from '@playwright/test';

test('keeps up to twenty Sessions reachable through tabs and search', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 640 });
  await page.goto('/?sessions=20&stale=2');

  const tabs = page.getByRole('tablist', { name: '终端会话' });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(20);
  await expect(page.getByRole('button', { name: '新建终端会话' })).toBeVisible();

  await page.getByRole('button', { name: '全部会话' }).click();
  const allSessions = page.getByRole('dialog', { name: '全部会话' });
  await expect(allSessions).toBeVisible();
  const allSessionsBox = await allSessions.boundingBox();
  expect(allSessionsBox).not.toBeNull();
  expect(allSessionsBox!.y).toBeGreaterThan(40);
  expect(allSessionsBox!.y).toBeLessThan(220);
  await expect(allSessions.getByRole('option')).toHaveCount(20);
  await allSessions.getByPlaceholder('搜索会话').fill('session 20');
  await expect(allSessions.getByRole('option', { name: /session 20.*Git Bash/i })).toBeVisible();
  await allSessions.getByRole('option', { name: /session 20.*Git Bash/i }).click();
  await expect(page.getByLabel('session 20 终端')).toBeVisible();

  await page.getByRole('button', { name: '全部会话' }).click();
  const openSessions = page.getByRole('dialog', { name: '全部会话' });
  await openSessions.getByRole('button', { exact: true, name: '关闭 session 20' }).click();
  const closeConfirm = page.getByRole('alertdialog', { name: '操作确认' });
  await expect(closeConfirm).toBeVisible();
  await closeConfirm.getByRole('button', { name: '关闭终端', exact: true }).click();
  await expect(page.getByRole('tab', { name: /session 20/i })).toHaveCount(0);
});

test('uses default aliases and supports duplicate renames', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?sessions=2');

  await page.getByRole('button', { name: '新建终端会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建终端会话' });
  const alias = dialog.getByLabel('Session Alias');
  await expect(alias).toHaveValue('终端 1');
  await alias.fill('   ');
  await dialog.getByRole('button', { name: '创建并连接', exact: true }).click();

  const createdTab = page.getByRole('tab', { name: '终端 1 Zsh', exact: true });
  await expect(createdTab).toBeVisible();
  await createdTab.click({ button: 'right' });
  const contextMenu = page.getByRole('menu', { name: '会话操作菜单' });
  await expect(contextMenu).toBeVisible();
  await contextMenu.getByRole('menuitem', { name: '重命名' }).click();
  const renameDialog = page.getByRole('dialog', { name: '重命名会话' });
  await expect(renameDialog).toBeVisible();
  await renameDialog.getByLabel('名称').fill('session 1');
  await renameDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'session 1 Git Bash', exact: true }).last(),
  ).toBeVisible();
});

test('closes the all-sessions popover when clicking outside', async ({ page }) => {
  await page.goto('/?sessions=2');
  await page.getByRole('button', { name: '全部会话' }).click();
  const allSessions = page.getByRole('dialog', { name: '全部会话' });
  await expect(allSessions).toBeVisible();

  await page.mouse.click(320, 600);
  await expect(allSessions).toHaveCount(0);
});

test('closes all terminals from the all-sessions popover', async ({ page }) => {
  await page.goto('/?sessions=3');
  await expect(page.getByRole('tab')).toHaveCount(3);

  await page.getByRole('button', { name: '全部会话' }).click();
  const popover = page.getByRole('dialog', { name: '全部会话' });
  await popover.getByRole('button', { name: '关闭全部终端' }).click();
  const confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '全部关闭', exact: true }).click();

  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '快速新建终端会话' })).toBeVisible();
});

test('closes the current tab from the context menu', async ({ page }) => {
  await page.goto('/?sessions=3');
  await page
    .getByRole('tab', { name: 'session 2 Git Bash', exact: true })
    .click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '会话操作菜单' });
  await menu.getByRole('menuitem', { name: '关闭当前' }).click();
  const confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await confirm.getByRole('button', { name: '关闭终端', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'session 2 Git Bash', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(2);
});

test('closes left and right tabs from the context menu', async ({ page }) => {
  await page.goto('/?sessions=4');
  await page
    .getByRole('tab', { name: 'session 3 Git Bash', exact: true })
    .click({ button: 'right' });
  let menu = page.getByRole('menu', { name: '会话操作菜单' });
  await menu.getByRole('menuitem', { name: '关闭左侧所有' }).click();
  let confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await confirm.getByRole('button', { name: '关闭所选', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'session 1 Git Bash', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'session 3 Git Bash', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'session 4 Git Bash', exact: true })).toBeVisible();

  await page
    .getByRole('tab', { name: 'session 3 Git Bash', exact: true })
    .click({ button: 'right' });
  menu = page.getByRole('menu', { name: '会话操作菜单' });
  await menu.getByRole('menuitem', { name: '关闭右侧所有' }).click();
  confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await confirm.getByRole('button', { name: '关闭所选', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'session 4 Git Bash', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(1);
});

test('closes all tabs from the context menu', async ({ page }) => {
  await page.goto('/?sessions=3');
  await page
    .getByRole('tab', { name: 'session 1 Git Bash', exact: true })
    .click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '会话操作菜单' });
  await menu.getByRole('menuitem', { name: '关闭所有' }).click();
  const confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await confirm.getByRole('button', { name: '全部关闭', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
});
