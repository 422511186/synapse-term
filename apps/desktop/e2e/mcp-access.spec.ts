import { expect, test } from '@playwright/test';

test('covers approval decisions across the endpoint setup and four resolution paths', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?sessions=1');

  await page.getByRole('button', { name: '设置' }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: /MCP 服务/ })
    .click();
  await page.locator('label').filter({ hasText: '启用本机 MCP 端点' }).locator('input').check();
  await page.getByLabel('托管').check();
  await expect(page.getByLabel('MCP 服务端口')).toHaveValue('4739');
  await page.getByLabel('MCP 服务端口').fill('5123');
  await page.getByLabel('MCP 服务端口').press('Enter');
  const connectionStringInput = page.locator('input[readonly]');
  await expect(connectionStringInput).toHaveValue('http://127.0.0.1:5123/mcp');
  await expect(page.getByLabel('Authorization 请求头', { exact: true })).toContainText('Bearer');
  await page.getByRole('button', { name: '复制连接串' }).click();
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe(
    await connectionStringInput.inputValue(),
  );
  await page.getByRole('button', { name: '返回工作区' }).click();

  await page.locator('.session-tab').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '共享到 MCP' }).click();
  const shareDialog = page.getByRole('dialog', { name: '共享终端会话' });
  await expect(shareDialog).toContainText('not_ready 时不要重复调用 synapse_status');
  await expect(shareDialog).toContainText('远端 Shell 提示符就绪后直接调用 synapse_execute');
  await shareDialog.getByLabel('关闭共享').click();

  await page.evaluate(() => window.__synapseMockMcpApproval?.('deploy-production.sh'));
  let card = page.getByRole('dialog', { name: 'MCP 审批' });
  await card.getByRole('button', { name: '允许一次' }).click();
  const banner = page.getByTestId('external-execution-banner');
  await expect(banner).toContainText('deploy-production.sh');

  await page.evaluate(() => window.__synapseMockMcpApproval?.('deploy-production.sh'));
  card = page.getByRole('dialog', { name: 'MCP 审批' });
  await card.getByRole('button', { name: '本会话内放行该命令' }).click();
  await expect(card).toHaveCount(0);

  await page.evaluate(() => window.__synapseMockMcpApproval?.('deploy-production.sh'));
  await expect(page.getByTestId('external-execution-banner')).toContainText('deploy-production.sh');
  await expect(page.getByRole('dialog', { name: 'MCP 审批' })).toHaveCount(0);

  await page.evaluate(() => window.__synapseMockMcpApproval?.('__denied_command__'));
  card = page.getByRole('dialog', { name: 'MCP 审批' });
  await card.getByRole('button', { name: '拒绝' }).click();
  await expect(card).toHaveCount(0);
  await expect(banner).not.toContainText('__denied_command__');

  await page.evaluate(() => window.__synapseMockMcpApproval?.('__timeout_command__'));
  card = page.getByRole('dialog', { name: 'MCP 审批' });
  await expect(card).toContainText('__timeout_command__');
  await page.evaluate(() => window.__synapseMockMcpTimeout?.());
  await expect(card).toHaveCount(0);
  await expect(banner).not.toContainText('__timeout_command__');
});

test('refreshes MCP status and Sharing after cancellation and token changes', async ({ page }) => {
  await page.goto('/?sessions=1');

  await page.getByRole('button', { name: '设置' }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: /MCP 服务/ })
    .click();
  await page.getByLabel('启用本机 MCP 端点').check();
  await expect(page.getByText('运行状态：运行中')).toBeVisible();
  await page.getByRole('button', { name: '返回工作区' }).click();

  await page.locator('.session-tab').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '共享到 MCP' }).click();
  await page.getByRole('dialog', { name: '共享终端会话' }).getByLabel('关闭共享').click();

  await page.getByRole('button', { name: '设置' }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: /MCP 服务/ })
    .click();
  const workspace = page.getByTestId('settings-workspace');
  await expect(workspace.getByText('session 1')).toBeVisible();
  await workspace.getByRole('button', { name: '取消共享' }).click();
  await expect(workspace.getByText('暂无共享 Session')).toBeVisible();
  await expect(workspace.getByText('运行状态：运行中')).toBeVisible();

  await workspace.getByRole('button', { name: '吊销' }).click();
  await expect(workspace.getByText('运行状态：启动中或端口不可用')).toBeVisible();
  await expect(workspace.getByText('暂无共享 Session')).toBeVisible();
});

test('shares a session, approves an external call once, and keeps local typing available', async ({
  page,
}) => {
  await page.goto('/?sessions=1&mcpEnabled=true');

  await page.locator('.session-tab').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '共享到 MCP' }).click();
  const shareDialog = page.getByRole('dialog', { name: '共享终端会话' });
  await expect(shareDialog).toContainText('仅复制裸 ID');
  await shareDialog.getByLabel('关闭共享').click();

  await page.evaluate(() => window.__synapseMockMcpApproval?.('deploy-production.sh'));
  const card = page.getByRole('dialog', { name: 'MCP 审批' });
  await expect(card).toContainText('deploy-production.sh');
  await card.getByRole('button', { name: '允许一次' }).click();

  const banner = page.getByTestId('external-execution-banner');
  await expect(banner).toContainText('deploy-production.sh');
  await page.locator('.xterm-screen:visible').click();
  await page.keyboard.type('local-check');
  await expect(page.locator('.xterm-accessibility-tree:visible')).toContainText('local-check');
});

test('denies an approval without creating the external execution marker', async ({ page }) => {
  await page.goto('/?sessions=1&mcpEnabled=true');
  await expect(page.locator('.xterm-screen:visible')).toBeVisible();

  await page.evaluate(() => window.__synapseMockMcpApproval?.('rm -rf build'));
  const card = page.getByRole('dialog', { name: 'MCP 审批' });
  await expect(card).toContainText('rm -rf build');
  await card.getByRole('button', { name: '拒绝' }).click();

  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('external-execution-banner')).toHaveCount(0);
});
