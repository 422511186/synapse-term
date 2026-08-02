import { expect, test, type Locator, type Page } from '@playwright/test';

const wideDesktop = { width: 1440, height: 900 };
const compactDesktop = { width: 980, height: 640 };

test('renders the runtime-backed Synapse Term workspace at the wide prototype geometry', async ({
  page,
}) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  await expect(page.locator('.prototype-shell')).toBeVisible();
  await expect(page.getByText('Synapse Term', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('tab', { name: 'api-prod / bash Git Bash', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Agent Timeline', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '审计日志', exact: true })).toBeVisible();

  await expectPrototypeGeometry(page, { terminalWidth: 890, agentWidth: 550, contentHeight: 844 });
  await expect(page.locator('.prototype-header')).toHaveCSS('height', '56px');
  await expect(page.locator('.prototype-header')).toHaveCSS('background-color', 'rgb(9, 9, 11)');
  await expect(page.locator('.prototype-terminal')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('.prototype-agent')).toHaveCSS('background-color', 'rgb(9, 9, 11)');
  await expect(page.locator('.terminal-host')).toHaveCSS('font-size', '14px');
  await expect(page.locator('.terminal-host')).toHaveCSS('line-height', '22.75px');
  await expect(page.locator('.terminal-host')).toHaveCSS('font-family', /JetBrains Mono/i);
  await expect(page.locator('.terminal-host .xterm')).toBeVisible();
  await expect(page.locator('.prototype-shell')).toHaveCSS('font-family', /Inter/i);
  await expect(page.getByRole('button', { name: '资源监控', exact: true })).toHaveCSS(
    'font-size',
    '12px',
  );
  await expect(page.getByRole('button', { name: '资源监控', exact: true })).toHaveCSS(
    'line-height',
    '16px',
  );
  await expect(page.getByRole('button', { name: '资源监控', exact: true })).toHaveCSS(
    'height',
    '30px',
  );
  await expect(page.getByRole('tab', { name: 'Agent Timeline', exact: true })).toHaveCSS(
    'font-size',
    '13px',
  );
  await expect(page.getByRole('tab', { name: 'Agent Timeline', exact: true })).toHaveCSS(
    'font-weight',
    '500',
  );
  await expect(page.getByText('人工审批', { exact: true })).toHaveCSS('text-rendering', 'auto');
});

test('keeps the agent visible at the compact desktop prototype geometry', async ({ page }) => {
  await page.setViewportSize(compactDesktop);
  await page.goto('/');

  await expectPrototypeGeometry(page, { terminalWidth: 500, agentWidth: 480, contentHeight: 584 });
  await expect(page.locator('.prototype-agent')).toBeVisible();
  await expect(page.getByRole('button', { name: '显示 Agent 面板' })).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
  await expectDocumentBounds(page);
});

test('resizes, hides, and restores the Agent panel', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  const workspace = page.locator('.prototype-workspace');
  const terminal = page.locator('.prototype-terminal');
  const agent = page.locator('.prototype-agent');
  const resizeHandle = page.getByRole('separator', { name: '调整 Agent 面板宽度' });
  const hideButton = page.getByRole('button', { name: '隐藏 Agent 面板' });

  await expect(resizeHandle).toBeVisible();
  const initialAgentBounds = await agent.boundingBox();
  expect(initialAgentBounds).not.toBeNull();

  const handleBounds = await resizeHandle.boundingBox();
  expect(handleBounds).not.toBeNull();
  const dragY = handleBounds!.y + handleBounds!.height / 2;
  await page.mouse.move(handleBounds!.x + handleBounds!.width / 2, dragY);
  await page.mouse.down();
  await page.mouse.move(handleBounds!.x - 80, dragY, { steps: 5 });
  await page.mouse.up();

  const resizedAgentBounds = await agent.boundingBox();
  expect(resizedAgentBounds).not.toBeNull();
  expect(resizedAgentBounds!.width).toBeGreaterThan(initialAgentBounds!.width + 60);
  expect(resizedAgentBounds!.width).toBeLessThanOrEqual(720);
  await expectBoundsToShareEdge(workspace, terminal, agent);

  await hideButton.click();
  await expect(agent).toHaveCount(0);
  await expect(page.getByRole('button', { name: '显示 Agent 面板' })).toBeVisible();

  const workspaceBounds = await workspace.boundingBox();
  const terminalBounds = await terminal.boundingBox();
  expect(workspaceBounds).not.toBeNull();
  expect(terminalBounds).not.toBeNull();
  expect(terminalBounds!.width).toBe(workspaceBounds!.width);

  await page.getByRole('button', { name: '显示 Agent 面板' }).click();
  await expect(agent).toBeVisible();
  const restoredAgentBounds = await agent.boundingBox();
  expect(restoredAgentBounds).not.toBeNull();
  expect(restoredAgentBounds!.width).toBe(resizedAgentBounds!.width);
  await expectBoundsToShareEdge(workspace, terminal, agent);
});

test('uses runtime sessions and resources behind prototype controls', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  await page.getByRole('tab', { name: 'logs / container Container logs', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'logs / container Container logs', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('logs / container 终端')).toBeVisible();

  await page.getByRole('button', { name: '新建终端会话', exact: true }).click();
  const newSession = page.getByRole('dialog', { name: '新建终端会话' });
  await expect(newSession).toBeVisible();
  await expect(newSession.getByLabel('会话名称')).toBeVisible();
  await newSession.getByRole('button', { name: '取消', exact: true }).click();
  await expect(newSession).toHaveCount(0);

  await page.getByRole('tab', { name: 'api-prod / bash Git Bash', exact: true }).click();
  await page.getByRole('button', { name: '资源监控', exact: true }).click();
  const resourceMonitor = page.getByRole('dialog', { name: '目标资源监控' });
  const refresh = resourceMonitor.getByRole('button', { name: '获取/刷新', exact: true });
  await refresh.click();
  await expect(refresh.locator('svg')).toHaveClass(/animate-spin/);
  await expect(resourceMonitor).toContainText('23%');
  await expect(resourceMonitor).toContainText('9.4 GB / 16 GB');
  await expect(refresh.locator('svg')).not.toHaveClass(/animate-spin/, { timeout: 1_500 });
  await page.getByRole('button', { name: '关闭资源监控' }).click();
  await expect(resourceMonitor).toHaveCount(0);
});

test('uses runtime Timeline, Audit, prompt history, and permission states', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('restart the api service');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await expect(page.getByText('systemctl restart api', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '批准执行', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();

  await page.getByRole('tab', { name: '审计日志', exact: true }).click();
  const audit = page.getByRole('tabpanel', { name: '审计日志' });
  await expect(audit).toContainText('创建终端会话');
  await page.getByRole('tab', { name: 'Agent Timeline', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '提示词历史', exact: true }).click();
  const promptHistory = page.getByRole('dialog', { name: '提示词历史' });
  await expect(promptHistory).toBeVisible();
  await expect(promptHistory.getByPlaceholder('搜索提示词历史...')).toHaveCSS(
    'outline-style',
    'none',
  );
  await promptHistory.getByText('restart the api service', { exact: true }).click();
  await expect(composer).toHaveValue('restart the api service');

  await page.getByRole('button', { name: '当前权限：人工审批', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '自动审批 (推荐)', exact: true }).click();
  await expect(page.getByRole('button', { name: '当前权限：自动审批', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '当前权限：自动审批', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '完全权限 (高风险)', exact: true }).click();
  await expect(page.getByRole('button', { name: '当前权限：完全权限', exact: true })).toBeVisible();
});

test('uses runtime model and Provider data behind prototype secondary pages', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  await page.getByRole('button', { name: '模型: GPT-5', exact: true }).click();
  await page.getByRole('menuitem', { name: '管理模型配置...', exact: true }).click();
  await expect(page.getByRole('heading', { name: '模型配置' })).toBeVisible();
  await expect(page.getByRole('table', { name: '模型配置列表' })).toContainText('GPT-5');
  await page.getByRole('button', { name: '编辑 GPT-5', exact: true }).click();
  const modelEditor = page.getByRole('dialog', { name: '编辑模型配置' });
  await expect(modelEditor.getByLabel('模型 ID (Model ID)')).toHaveValue('gpt-5');
  await modelEditor.getByRole('button', { name: '拉取远程模型', exact: true }).click();
  await expect(modelEditor.getByRole('button', { name: 'gpt-5-nano', exact: true })).toBeVisible();
  await modelEditor.getByRole('button', { name: 'gpt-5-nano', exact: true }).click();
  await expect(modelEditor.getByLabel('模型 ID (Model ID)')).toHaveValue('gpt-5-nano');
  await modelEditor.getByRole('button', { name: '取消', exact: true }).click();

  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '服务商配置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '服务商凭据' })).toBeVisible();
  await expect(page.getByText('OpenAI 官方', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '测试连接 / 编辑', exact: true }).click();
  const providerEditor = page.getByRole('dialog', { name: '配置服务商' });
  await providerEditor.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(
    providerEditor.getByRole('button', { name: '连接中...', exact: true }),
  ).toBeVisible();
  await expect(providerEditor.getByRole('button', { name: '测试成功', exact: true })).toBeVisible({
    timeout: 1_500,
  });
  await providerEditor.getByRole('button', { name: '保存凭据', exact: true }).click();
  await expect(providerEditor).toHaveCount(0);
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
  await expect(page.locator('.prototype-terminal .terminal-host')).toBeVisible();
});

async function expectPrototypeGeometry(
  page: Page,
  expected: { terminalWidth: number; agentWidth: number; contentHeight: number },
): Promise<void> {
  const header = page.locator('.prototype-header');
  const terminal = page.locator('.prototype-terminal');
  const agent = page.locator('.prototype-agent');
  await expect(header).toHaveCSS('height', '56px');
  await expectBounds(header, {
    x: 0,
    y: 0,
    width: expected.terminalWidth + expected.agentWidth,
    height: 56,
  });
  await expectBounds(terminal, {
    x: 0,
    y: 56,
    width: expected.terminalWidth,
    height: expected.contentHeight,
  });
  await expectBounds(agent, {
    x: expected.terminalWidth,
    y: 56,
    width: expected.agentWidth,
    height: expected.contentHeight,
  });
}

async function expectBoundsToShareEdge(
  workspace: Locator,
  terminal: Locator,
  agent: Locator,
): Promise<void> {
  const workspaceBounds = await workspace.boundingBox();
  const terminalBounds = await terminal.boundingBox();
  const agentBounds = await agent.boundingBox();
  expect(workspaceBounds).not.toBeNull();
  expect(terminalBounds).not.toBeNull();
  expect(agentBounds).not.toBeNull();
  expect(Math.abs(terminalBounds!.x - workspaceBounds!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(terminalBounds!.x + terminalBounds!.width - agentBounds!.x)).toBeLessThanOrEqual(
    1,
  );
  expect(
    Math.abs(agentBounds!.x + agentBounds!.width - (workspaceBounds!.x + workspaceBounds!.width)),
  ).toBeLessThanOrEqual(1);
}

async function expectBounds(
  locator: Locator,
  expected: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds).toEqual(expected);
}

async function expectDocumentBounds(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientHeight: document.documentElement.clientHeight,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions).toEqual({
    scrollHeight: compactDesktop.height,
    scrollWidth: compactDesktop.width,
    clientHeight: compactDesktop.height,
    clientWidth: compactDesktop.width,
  });
}
