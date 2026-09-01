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

  await expect(page.locator('#active-terminal-panel .xterm:visible')).toBeVisible();
  await expect(page.locator('#active-terminal-panel .terminal-host:visible')).toHaveCSS(
    'font-family',
    /JetBrains Mono/i,
  );
});

test('opens the categorized settings workspace with menu navigation', async ({ page }) => {
  await page.goto('/?sessions=1');
  await page.getByRole('button', { name: '设置', exact: true }).click();

  const workspace = page.getByTestId('settings-workspace');
  await expect(workspace).toBeVisible();

  // Settings are organized into a left category menu.
  const nav = workspace.getByRole('navigation', { name: '设置分类' });
  await expect(nav.getByRole('button', { name: /通用/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /外观/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /MCP 服务/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /通用/ })).toHaveAttribute('aria-current', 'page');

  // The default category shows general settings only.
  await expect(workspace.getByRole('region', { name: '终端显示' })).toBeVisible();
  const probeEchoToggle = workspace.getByLabel('隐藏自动 Probe 回显');
  await expect(probeEchoToggle).toBeChecked();
  await probeEchoToggle.uncheck();
  await expect(probeEchoToggle).not.toBeChecked();
  await expect(workspace.getByText('Probe 仍会写入当前 PTY')).toBeVisible();
  await expect(workspace.getByRole('region', { name: 'MCP 服务' })).toHaveCount(0);

  // Switching to the MCP category reveals the MCP settings panel.
  await nav.getByRole('button', { name: /MCP 服务/ }).click();
  await expect(nav.getByRole('button', { name: /MCP 服务/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(workspace.getByRole('region', { name: 'MCP 服务' })).toBeVisible();
  await expect(workspace.getByRole('region', { name: '内嵌 MCP Server' })).toBeVisible();
  await expect(workspace.getByLabel('MCP 服务端口')).toHaveValue('4739');
  await expect(workspace.getByText('启用本机 MCP 端点')).toBeVisible();
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

test('keeps terminal content when switching tabs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '快速新建终端会话', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新建终端会话' });
  await dialog.getByRole('button', { name: '创建并连接', exact: true }).click();
  await expect(page.getByRole('tab', { name: '终端 1 Zsh', exact: true })).toBeVisible();
  await expect(
    page.locator('#active-terminal-panel .xterm-accessibility-tree:visible'),
  ).toContainText('终端 1 已就绪');

  await page.getByRole('button', { name: '新建终端会话', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新建终端会话' });
  await dialog.getByRole('button', { name: '创建并连接', exact: true }).click();
  await expect(page.getByRole('tab', { name: '终端 2 Zsh', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: '终端 1 Zsh', exact: true }).click();
  await expect(
    page.locator('#active-terminal-panel .xterm-accessibility-tree:visible'),
  ).toContainText('终端 1 已就绪');
});

test('switches theme mode and custom terminal colors from settings', async ({ page }) => {
  await page.goto('/?sessions=1');
  const rootVar = (name: string): Promise<string> =>
    page.evaluate(
      (prop) => getComputedStyle(document.documentElement).getPropertyValue(prop),
      name,
    );
  const rootBackground = (): Promise<string> => rootVar('--background');
  const rootForeground = (): Promise<string> => rootVar('--foreground');

  await expect.poll(rootBackground).toBe('#09090b');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const workspace = page.getByTestId('settings-workspace');
  const nav = workspace.getByRole('navigation', { name: '设置分类' });
  await nav.getByRole('button', { name: /外观/ }).click();
  const themeSection = workspace.getByTestId('theme-settings-section');
  await expect(themeSection).toBeVisible();
  await expect(themeSection.getByText('跟随系统', { exact: true })).toBeVisible();

  // Switch to the light scheme and verify the CSS variables repaint.
  await themeSection.getByText('浅色', { exact: true }).click();
  await expect.poll(rootBackground).toBe('#ffffff');
  await expect.poll(rootForeground).toBe('#09090b');

  // Enabling the custom palette on a light scheme must seed readable core
  // colors (dark foreground on light background) instead of keeping the
  // default dark values, otherwise terminal text would be invisible.
  await themeSection.getByLabel('启用自定义配色').check();
  await expect.poll(rootBackground).toBe('#ffffff');
  await expect.poll(rootForeground).toBe('#09090b');

  // Set the custom background color; the foreground stays readable.
  await themeSection.getByLabel('背景色 选择器').fill('#123456');
  await expect.poll(rootBackground).toBe('#123456');

  // Customize a terminal ANSI color; the reset control appears and clears it.
  const redInput = themeSection.getByLabel('终端文字 红 输入');
  await redInput.fill('#ff0000');
  await expect(redInput).toHaveValue('#ff0000');
  const resetButton = themeSection.getByRole('button', { name: '恢复默认终端文字配色' });
  await expect(resetButton).toBeVisible();
  await resetButton.click();
  await expect(themeSection.getByRole('button', { name: '恢复默认终端文字配色' })).toHaveCount(0);

  await workspace.getByRole('button', { name: '返回工作区' }).click();
  await expect(page.locator('.prototype-shell')).toBeVisible();
});
