import { expect, test } from '@playwright/test';

test('renders the terminal-only Synapse Term workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?sessions=2');

  await expect(page.locator('.prototype-shell')).toBeVisible();
  await expect(page.getByText('Synapse Term', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'session 1 Git Bash', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'session 2 Git Bash', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建终端会话', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '全部会话', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();

  await expect(page.locator('.agent-driver-strip')).toHaveCount(0);
  await expect(page.locator('.agent-panel')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '共享并复制当前 Session ID', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提示词历史', exact: true })).toHaveCount(0);

  await expect(page.locator('.terminal-host .xterm')).toBeVisible();
  await expect(page.locator('.terminal-host')).toHaveCSS('font-family', /JetBrains Mono/i);
});

test('opens the single-page settings placeholder', async ({ page }) => {
  await page.goto('/?sessions=1');
  await page.getByRole('button', { name: '设置', exact: true }).click();

  const workspace = page.getByTestId('settings-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByTestId('settings-topic-content')).toContainText('暂无设置项');
  await expect(workspace.getByRole('button', { name: '返回工作区' })).toBeVisible();
  await expect(workspace.getByRole('button', { name: '服务商配置' })).toHaveCount(0);

  await workspace.getByRole('button', { name: '返回工作区' }).click();
  await expect(page.locator('.prototype-shell')).toBeVisible();
});

test('creates a session from the new session modal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建终端会话', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: '新建终端会话' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '创建并连接', exact: true }).click();

  await expect(page.getByRole('tab', { name: '终端 1 Zsh', exact: true })).toBeVisible();
  await expect(page.getByLabel('终端 1 终端')).toBeVisible();
});

test('creates a session from the quick-add empty state', async ({ page }) => {
  await page.goto('/');
  const quickAdd = page.getByRole('button', { name: '快速新建终端会话', exact: true });
  await expect(quickAdd).toBeVisible();
  await quickAdd.click();

  const dialog = page.getByRole('dialog', { name: '新建终端会话' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '创建并连接', exact: true }).click();

  await expect(page.getByRole('tab', { name: '终端 1 Zsh', exact: true })).toBeVisible();
  await expect(page.getByLabel('终端 1 终端')).toBeVisible();
});
