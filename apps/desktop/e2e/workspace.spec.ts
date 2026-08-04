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
  await expect(page.locator('img[alt="Synapse Term logo"]')).toHaveCount(1);
  await expect(page.locator('img[alt="Synapse Term logo"]')).toHaveAttribute(
    'src',
    /(?:\.svg|^data:image\/svg\+xml)/,
  );
  await expect(
    page.getByRole('tab', { name: 'api-prod / bash Git Bash', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Synapse · Agent', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Agent Timeline', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '审计日志', exact: true })).toHaveCount(0);
  await expect(page.locator('.agent-driver-strip')).toHaveCount(0);
  await expect(page.locator('.agent-progress-card')).toHaveCount(0);

  await expectPrototypeGeometry(page, { terminalWidth: 890, agentWidth: 550, contentHeight: 844 });
  await expect(page.locator('.prototype-header')).toHaveCSS('height', '56px');
  await expect(page.locator('.prototype-header')).toHaveCSS('background-color', 'rgb(9, 9, 11)');
  await expect(page.locator('.prototype-terminal')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('.prototype-agent')).toHaveCSS('background-color', 'rgb(9, 9, 11)');
  await expect(page.getByRole('button', { name: '全部会话', exact: true })).toHaveCSS(
    'display',
    'flex',
  );
  await expect(
    page.getByRole('button', { name: '共享并复制当前 Session ID', exact: true }),
  ).toHaveCSS('display', 'flex');
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

test('keeps Agent hierarchy and controls stable across desktop viewports', async ({ page }) => {
  for (const viewport of [wideDesktop, compactDesktop]) {
    await page.setViewportSize(viewport);
    await page.goto('/?longCommand=1');

    await expect(page.getByText('Synapse · Agent', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Agent Timeline', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '审计日志', exact: true })).toHaveCount(0);
    await expect(page.locator('.agent-driver-strip')).toHaveCount(0);
    await expect(page.locator('.session-tab-list')).toHaveCSS('overflow-x', 'auto');
    await expect(page.locator('.session-tab-tools .session-tab-tool')).toHaveCount(3);

    const shareButton = page.getByRole('button', {
      name: '共享并复制当前 Session ID',
      exact: true,
    });
    await expect(shareButton).toBeVisible();
    if (viewport.width <= compactDesktop.width) {
      const shareBounds = await shareButton.boundingBox();
      expect(shareBounds).not.toBeNull();
      expect(shareBounds!.width).toBeLessThanOrEqual(36);
      expect(
        await page
          .locator('.session-tab-tools .session-action-label')
          .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).display)),
      ).toEqual(['none', 'none']);
    }

    const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
    await composer.fill('show markdown diagnostics');
    await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();

    await expect(page.locator('.current-turn-plan')).toHaveCount(0);
    await expect(page.locator('.current-turn-plan-slot')).toHaveCount(0);
    await expect(page.locator('.agent-progress-card')).toHaveCount(0);
    await expect(page.locator('.running-status-bar')).toBeVisible();
    await expect(page.locator('.running-status-bar').getByRole('button')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '停止当前 Agent 任务', exact: true }),
    ).toBeEnabled();

    const statusGeometry = await page.locator('.running-status-bar').evaluate((element) => {
      const composerShell = element.nextElementSibling;
      if (!(composerShell instanceof HTMLElement)) return undefined;
      const statusRect = element.getBoundingClientRect();
      const composerRect = composerShell.getBoundingClientRect();
      return {
        statusBottom: statusRect.bottom,
        composerTop: composerRect.top,
        composerInput: composerShell.querySelector('textarea') !== null,
      };
    });
    expect(statusGeometry).toBeDefined();
    expect(statusGeometry!.composerInput).toBe(true);
    expect(statusGeometry!.statusBottom).toBeLessThanOrEqual(statusGeometry!.composerTop + 1);

    const userMessage = page.locator('.agent-timeline-user');
    await expect(userMessage).toBeVisible();
    await expect
      .poll(() => userMessage.evaluate((element) => getComputedStyle(element).justifyContent))
      .toBe('flex-end');

    await page.getByRole('button', { name: '停止当前 Agent 任务', exact: true }).click();
    await expect(
      page
        .locator('[aria-label="Agent 时间线"]')
        .locator('span.truncate')
        .filter({ hasText: '当前任务已取消' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '发送给 Agent', exact: true })).toBeVisible();

    await page.goto('/');
    await composer.fill('simple question');
    await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
    await expect(
      page.getByText('磁盘使用率正常，当前没有失败的 systemd 服务。', { exact: true }),
    ).toBeVisible();

    const assistantMessage = page.locator('.agent-timeline-assistant');
    expect(await assistantMessage.count()).toBe(1);
    await expect
      .poll(() => assistantMessage.evaluate((element) => getComputedStyle(element).justifyContent))
      .toBe('flex-start');
    expect(
      await page.locator('.agent-timeline-user img, .agent-timeline-assistant img').count(),
    ).toBe(0);

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(metrics).toEqual({
      scrollWidth: viewport.width,
      clientWidth: viewport.width,
      scrollHeight: viewport.height,
      clientHeight: viewport.height,
    });
  }
});

test('resizes the Agent panel without a title block', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  const workspace = page.locator('.prototype-workspace');
  const terminal = page.locator('.prototype-terminal');
  const agent = page.locator('.prototype-agent');
  const resizeHandle = page.getByRole('separator', { name: '调整 Agent 面板宽度' });

  await expect(resizeHandle).toBeVisible();
  await expect(page.locator('.agent-panel-titlebar')).toHaveCount(0);
  await expect(page.locator('.agent-panel-collapse-button')).toHaveCount(0);
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
  await expect(newSession.getByLabel('Session Alias')).toBeVisible();
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

test('uses runtime Timeline, audit settings, prompt history, and permission states', async ({
  page,
}) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('restart the api service');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await expect(page.getByText('systemctl restart api', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '批准执行', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: '审计日志', exact: true }).click();
  await expect(page.getByText('创建终端会话', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
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
