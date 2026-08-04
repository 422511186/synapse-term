import { expect, test, type Page } from '@playwright/test';

const wideDesktop = { width: 1440, height: 900 };

async function openModelsPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '模型配置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '模型配置' })).toBeVisible();
}

test('shows model test three states and blocks repeated clicks while pending', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await openModelsPage(page);

  const testButton = page.getByRole('button', { name: '检测 快速诊断' });
  await expect(testButton).toContainText('检测');
  const idleBox = await testButton.boundingBox();

  await testButton.click();
  await expect(testButton).toHaveAttribute('aria-busy', 'true');
  await expect(testButton).toContainText('检测中…');
  await expect(testButton).toBeDisabled();
  // 进行中文案+spinner 不应改变按钮宽度，避免挤压表格行
  const busyBox = await testButton.boundingBox();
  expect(busyBox?.width).toBe(idleBox?.width);

  // 进行中再次点击：按钮已禁用，无法触发第二次请求
  await testButton.click({ trial: true }).catch(() => undefined);

  await expect(testButton).toContainText('检测通过', { timeout: 3_000 });
  await expect(page.getByRole('status').filter({ hasText: '检测通过' })).toBeVisible();
  await expect(
    page.getByRole('table', { name: '模型配置列表' }).locator('tr').filter({ hasText: '快速诊断' }),
  ).toContainText('可用');
});

test('reports an unavailable model as failed instead of 检测通过', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/?modelTestUnavailable=1');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '模型配置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '模型配置' })).toBeVisible();

  const testButton = page.getByRole('button', { name: '检测 快速诊断' });
  await testButton.click();

  await expect(page.getByRole('alert').filter({ hasText: '模型不存在' })).toBeVisible({
    timeout: 3_000,
  });
  await expect(testButton).toContainText('检测');
  await expect(testButton).not.toContainText('检测通过');
  await expect(
    page.getByRole('table', { name: '模型配置列表' }).locator('tr').filter({ hasText: '快速诊断' }),
  ).toContainText('不可用');
});

test('enables a model optimistically with success toast', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await openModelsPage(page);

  const toggle = page.getByRole('button', { name: '快速诊断 启用状态' });
  await expect(toggle).toContainText('已停用');

  await toggle.click();

  await expect(toggle).toContainText('已启用');
  await expect(page.getByRole('status').filter({ hasText: '模型已启用' })).toBeVisible();
});

test('rolls back the optimistic enable when the API fails', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/?modelEnableError=1');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '模型配置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '模型配置' })).toBeVisible();

  const toggle = page.getByRole('button', { name: '快速诊断 启用状态' });
  await expect(toggle).toContainText('已停用');

  await toggle.click();
  await expect(toggle).toContainText('已启用');

  await expect(toggle).toContainText('已停用', { timeout: 3_000 });
  await expect(page.getByRole('alert').filter({ hasText: '启用失败（模拟）' })).toBeVisible();
});

test('shows the agent running status bar and thinking placeholder', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/?agentThinking=1');

  const input = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await input.fill('delete the cache recursively');
  await page.getByRole('button', { name: '发送给 Agent' }).click();

  const thinkingPlaceholder = page.locator('.thinking-placeholder');
  await expect(thinkingPlaceholder).toBeVisible();
  const statusBar = page.locator('.running-status-bar');
  await expect(statusBar).toContainText('Agent 运行中');
  await expect(statusBar.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止当前 Agent 任务' })).toBeVisible();

  await expect(page.getByText('需要人工审批', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(thinkingPlaceholder).toHaveCount(0);
});

test('shows MCP server start/stop transitions and revoke confirmation', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: 'MCP 服务', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'MCP 服务' })).toBeVisible();

  const toggle = page.getByRole('button', { name: '启用 MCP Server', exact: true });
  await toggle.click();
  await expect(page.getByText('正在启动…', { exact: true })).toBeVisible();
  await expect(page.getByText('运行中', { exact: true })).toBeVisible({ timeout: 3_000 });

  await page.getByRole('button', { name: '吊销', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '操作确认' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '吊销', exact: true }).click();
  await expect(page.getByText('暂无 token，启用前需要先生成', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '停用 MCP Server', exact: true }).click();
  await expect(page.getByText('正在停止…', { exact: true })).toBeVisible();
  await expect(page.getByText('未运行', { exact: true })).toBeVisible({ timeout: 3_000 });

  // 停用后再次启用：应重新生成 token 并回到运行中
  await page.getByRole('button', { name: '启用 MCP Server', exact: true }).click();
  await expect(page.getByText('正在启动…', { exact: true })).toBeVisible();
  await expect(page.getByText('运行中', { exact: true })).toBeVisible({ timeout: 3_000 });
});

test('shows ACP integration start/stop transitions', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: 'ACP 集成', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ACP 集成' })).toBeVisible();

  const toggle = page.getByRole('button', { name: '启用 ACP 集成', exact: true });
  await toggle.click();
  await expect(page.getByText('正在启动…', { exact: true })).toBeVisible();
  await expect(page.getByText('未运行', { exact: true })).toBeVisible({ timeout: 3_000 });

  await page.getByRole('button', { name: '停用 ACP 集成', exact: true }).click();
  await expect(page.getByText('正在停止…', { exact: true })).toBeVisible();
  await expect(page.getByText('未运行', { exact: true })).toBeVisible({ timeout: 3_000 });
});
