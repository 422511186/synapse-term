import { expect, test } from '@playwright/test';

test('backs the prototype workspace with runtime sessions and xterm', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const activeSession = page.getByRole('tab', { name: 'api-prod / bash Git Bash', exact: true });
  await expect(activeSession).toBeVisible();
  await expect(activeSession).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.prototype-terminal .terminal-host')).toBeVisible();

  const logsSession = page.getByRole('tab', {
    name: 'logs / container Container logs',
    exact: true,
  });
  await logsSession.click();
  await expect(logsSession).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: '方言: 仅观察 (Observe)', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'POSIX', exact: true }).click();
  await expect(page.getByRole('button', { name: '方言: POSIX', exact: true })).toBeVisible();
});

test('keeps progress in the timeline without a separate plan card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await expect(page.getByText('Synapse · Agent', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Agent Timeline', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '审计日志', exact: true })).toHaveCount(0);
  await expect(page.locator('.agent-driver-strip')).toHaveCount(0);

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('show markdown diagnostics');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();

  await expect(page.locator('.current-turn-plan')).toHaveCount(0);
  await expect(page.locator('.current-turn-plan-slot')).toHaveCount(0);
  await expect(page.locator('.agent-progress-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '诊断结论', exact: true })).toBeVisible();
});

test('keeps the terminal viewport aligned to complete rows at the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const geometry = await page.locator('.terminal-host').evaluate((host) => {
    const viewport = host.querySelector('.xterm-viewport');
    const screen = host.querySelector('.xterm-screen');
    const rows = host.querySelector('.xterm-rows');
    if (
      !(viewport instanceof HTMLElement) ||
      !(screen instanceof HTMLElement) ||
      !(rows instanceof HTMLElement)
    ) {
      throw new Error('xterm geometry is unavailable');
    }
    const viewportRect = viewport.getBoundingClientRect();
    const screenRect = screen.getBoundingClientRect();
    const firstRow = rows.firstElementChild;
    const rowHeight = firstRow instanceof HTMLElement ? firstRow.getBoundingClientRect().height : 0;
    return {
      clippedPixels: screenRect.bottom - viewportRect.bottom,
      rowHeight,
      rowCount: rows.children.length,
    };
  });

  expect(geometry.rowHeight).toBeGreaterThan(0);
  expect(geometry.rowCount).toBeGreaterThan(0);
  expect(geometry.clippedPixels).toBeLessThanOrEqual(0.5);
});

test('forwards terminal search input to the active xterm search addon', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.prototype-terminal').hover();

  await page.evaluate(() => {
    const target = window as Window & { terminalSearchQueries?: string[] };
    target.terminalSearchQueries = [];
    window.addEventListener('terminal-agent-search', (event) => {
      target.terminalSearchQueries?.push((event as CustomEvent<string>).detail);
    });
  });

  await page.getByPlaceholder('搜索终端输出 (Ctrl+F)').fill('kubectl');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { terminalSearchQueries?: string[] }).terminalSearchQueries,
      ),
    )
    .toEqual(['kubectl']);
});

test('opens terminal search with Ctrl+F while the terminal has focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const searchInput = page.getByPlaceholder('搜索终端输出 (Ctrl+F)');
  await page.locator('.terminal-host').click();
  await page.keyboard.press('Control+f');

  await expect(searchInput).toBeFocused();
  await expect(searchInput).toBeVisible();
  await expect(searchInput.locator('..')).toHaveCSS('background-color', 'rgb(24, 24, 27)');
});

test('backs the prototype resource, agent, approval, and audit surfaces with runtime APIs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: '资源监控', exact: true }).click();
  const resourceMonitor = page.getByRole('dialog', { name: '目标资源监控' });
  await resourceMonitor.getByRole('button', { name: '获取/刷新', exact: true }).click();
  await expect(resourceMonitor).toContainText('23%');
  await expect(resourceMonitor).toContainText('9.4 GB / 16 GB');
  await page.getByRole('button', { name: '关闭资源监控' }).click();

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('restart the api service');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await expect(page.getByText('systemctl restart api', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '批准执行', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('systemctl action changes service state', { exact: true }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '审计日志', exact: true }).click();
  await expect(page.getByRole('heading', { name: '审计日志', exact: true })).toBeVisible();
  const commandTrace = page
    .getByTestId('audit-trace-row')
    .filter({ hasText: 'systemctl restart api' })
    .first();
  await expect(commandTrace).toBeVisible();
  await commandTrace.click();
  const commandDetail = page.getByRole('dialog', { name: '审计记录详情' });
  await expect(commandDetail).toContainText('执行命令');
  await expect(
    commandDetail.getByText('执行命令', { exact: true }).locator('..').first(),
  ).toHaveCSS('grid-column', '1 / -1');
  await expect(
    commandDetail.getByText('systemctl restart api', { exact: true }).first(),
  ).toBeVisible();
  await expect(commandDetail).toContainText('command.completed');
  await expect(commandDetail).toContainText('成功');
  await expect(commandDetail).toContainText('退出码');
  await expect(commandDetail).toContainText('0');
  const modalAtHeaderPoint = await page.evaluate(() => {
    const settingsButton = document.querySelector<HTMLButtonElement>('button[aria-label="设置"]');
    if (settingsButton === null) return undefined;
    const bounds = settingsButton.getBoundingClientRect();
    return document
      .elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      ?.closest('[role="dialog"]')
      ?.getAttribute('aria-label');
  });
  expect(modalAtHeaderPoint).toBe('审计记录详情');
  await commandDetail.getByRole('button', { name: '关闭审计记录详情', exact: true }).click();
  await page.getByRole('button', { name: '打开高级筛选', exact: true }).click();
  const filterDialog = page.getByRole('dialog', { name: '高级筛选' });
  await expect(filterDialog.getByText('包含成功观察', { exact: true })).toBeVisible();
  await filterDialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(filterDialog).toHaveCount(0);
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
});

test('stops audit polling after leaving the audit topic', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?auditTraceCalls=1');
  await page.evaluate(() => {
    const target = window as Window & { mockAuditListCalls?: number };
    target.mockAuditListCalls = 0;
    window.addEventListener('mock-audit-list-call', () => {
      target.mockAuditListCalls = (target.mockAuditListCalls ?? 0) + 1;
    });
  });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '审计日志', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { mockAuditListCalls?: number }).mockAuditListCalls),
    )
    .toBeGreaterThan(0);
  const callsBeforeLeaving = await page.evaluate(
    () => (window as Window & { mockAuditListCalls?: number }).mockAuditListCalls ?? 0,
  );

  await page.getByRole('button', { name: '模型配置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '模型配置', exact: true })).toBeVisible();
  await page.waitForTimeout(5_500);
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { mockAuditListCalls?: number }).mockAuditListCalls),
    )
    .toBe(callsBeforeLeaving);
});

test('creates, closes, and reuses sessions through the prototype controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: '新建终端会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建终端会话' });
  await dialog.getByLabel('Session Alias').fill('staging / bash');
  await dialog.getByLabel('系统 Shell').selectOption('bash');
  await dialog.getByRole('button', { name: '创建并连接', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'staging / bash Git Bash', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('staging / bash 终端')).toBeVisible();

  await page.getByRole('tab', { name: 'staging / bash Git Bash', exact: true }).click();
  await page.getByRole('button', { name: '关闭 staging / bash', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'api-prod / bash Git Bash', exact: true }),
  ).toBeVisible();
});

test('reuses runtime prompt history and can cancel an active turn', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('show markdown diagnostics');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await expect(
    page.getByText('df -h && systemctl --failed --no-pager', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '停止当前 Agent 任务', exact: true }).click();
  await expect(page.getByText('已取消', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '提示词历史', exact: true }).click();
  const promptHistory = page.getByRole('dialog', { name: '提示词历史' });
  await expect(promptHistory.getByText('show markdown diagnostics', { exact: true })).toBeVisible();
  await promptHistory.getByText('show markdown diagnostics', { exact: true }).click();
  await expect(composer).toHaveValue('show markdown diagnostics');
});

test('interrupts a running terminal command from its Timeline card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?longCommand=1');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('show markdown diagnostics');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();

  const toolCard = page.locator('.agent-tool-card');
  await expect(toolCard).toContainText('进行中');
  const interrupt = toolCard.getByRole('button', { name: '中断执行', exact: true });
  await expect(interrupt).toBeVisible();
  await interrupt.click();

  await expect(toolCard).toContainText('已中断');
  await expect(toolCard.getByRole('button', { name: '中断执行', exact: true })).toHaveCount(0);
});

test('shows runtime errors in a dismissible modal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?historyErrorAfter=0');

  const dialog = page.getByRole('alertdialog', { name: '运行错误' });
  await expect(dialog).toContainText('Core 请求超时：agent.history');
  await dialog.getByRole('button', { name: '关闭错误提示', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('keeps task cancellation available when approval failure covers the timeline', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?approvalError=1');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('restart the api service');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await page.getByText('systemctl restart api', { exact: true }).waitFor();

  await page.getByRole('button', { name: '批准执行', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '运行错误' });
  await expect(dialog).toContainText('模拟审批失败');
  await dialog.getByRole('button', { name: '关闭错误提示', exact: true }).click();
  await page.getByRole('button', { name: '停止当前 Agent 任务', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator('[aria-label="Agent 时间线"]').getByText('当前任务已取消', { exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '发送给 Agent', exact: true })).toBeVisible();
});

test('retires a stale approval without leaving an actionable card or error overlay', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?approvalStale=1');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('restart the api service');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await page.getByText('systemctl restart api', { exact: true }).waitFor();
  await page.getByRole('button', { name: '批准执行', exact: true }).click();

  await expect(page.getByRole('alertdialog', { name: '运行错误' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '批准执行', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送给 Agent', exact: true })).toBeVisible();
});

test('places Agent failure events below their corresponding prompt', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?agentFailure=1');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  const timeline = page.locator('[role="tabpanel"][aria-label="Agent 时间线"]');
  const firstPrompt = '查一下第一轮内存';
  const secondPrompt = '查一下第二轮内存';

  for (const prompt of [firstPrompt, secondPrompt]) {
    await composer.fill(prompt);
    await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
    await expect(timeline.getByText(prompt, { exact: true })).toBeVisible();
  }

  await expect(
    timeline.getByText('Agent 执行失败：provider_stream_error: 424', { exact: false }),
  ).toHaveCount(2);
  const order = await timeline
    .locator('.space-y-4 > div')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));
  const firstPromptIndex = order.findIndex((text) => text.includes(firstPrompt));
  const secondPromptIndex = order.findIndex((text) => text.includes(secondPrompt));
  const failureIndexes = order
    .map((text, index) =>
      text.includes('Agent 执行失败：provider_stream_error: 424') ? index : -1,
    )
    .filter((index) => index >= 0);

  expect(firstPromptIndex).toBeGreaterThanOrEqual(0);
  expect(secondPromptIndex).toBeGreaterThan(firstPromptIndex);
  expect(failureIndexes).toEqual([expect.any(Number), expect.any(Number)]);
  expect(failureIndexes[0]).toBeGreaterThan(firstPromptIndex);
  expect(failureIndexes[0]).toBeLessThan(secondPromptIndex);
  expect(failureIndexes[1]).toBeGreaterThan(secondPromptIndex);
});

test('releases the Agent turn after a history timeout recovery', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?historyErrorAfter=2');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('show markdown diagnostics');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await expect(
    page.locator('[aria-label="Agent 时间线"]').getByText('当前任务已取消', { exact: true }).last(),
  ).toBeVisible();

  const dialog = page.getByRole('alertdialog', { name: '运行错误' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭错误提示', exact: true }).click();
  await expect(page.getByRole('button', { name: '发送给 Agent', exact: true })).toBeDisabled();
  await composer.fill('a follow-up goal');
  await expect(page.getByRole('button', { name: '发送给 Agent', exact: true })).toBeEnabled();
});

test('renders tool invocation and result in one collapsed card with complete Markdown', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('show markdown diagnostics');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();

  const toolCard = page.locator('.agent-tool-card');
  await expect(toolCard).toHaveCount(1);
  const result = page.locator('.agent-tool-result');
  await expect(result).toHaveCount(1);
  await expect(result).not.toHaveAttribute('open', '');
  await expect(page.getByRole('heading', { name: '诊断结论', exact: true })).toBeVisible();
  await expect(page.locator('.agent-markdown table')).toBeVisible();

  await result.locator('summary').click();
  await expect(result).toHaveAttribute('open', '');
  await expect(result.locator('pre')).toContainText('completed');
});

test('follows new Timeline messages at the latest position without stealing historical browsing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  const timeline = page.locator('[role="tabpanel"][aria-label="Agent 时间线"]');

  for (let index = 1; index <= 4; index += 1) {
    const prompt = `show markdown diagnostics ${index}`;
    await composer.fill(prompt);
    await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
    await expect(page.getByText(prompt, { exact: true })).toBeVisible();
    await page.waitForTimeout(800);
  }

  await expect
    .poll(() =>
      timeline.evaluate((element) => ({
        overflowing: element.scrollHeight > element.clientHeight,
        distanceFromBottom: element.scrollHeight - element.scrollTop - element.clientHeight,
      })),
    )
    .toMatchObject({ overflowing: true });
  await timeline.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() =>
      timeline.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThan(2);

  const latestPrompt = 'show markdown diagnostics latest';
  await composer.fill(latestPrompt);
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await expect(page.getByText(latestPrompt, { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      timeline.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThan(32);

  await timeline.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBeLessThan(2);

  const historicalPrompt = 'show markdown diagnostics while browsing history';
  await composer.fill(historicalPrompt);
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await expect(page.getByText(historicalPrompt, { exact: true })).toBeVisible();
  await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBeLessThan(32);
});

test('sends the current Agent goal with Control+Enter in the desktop browser workflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('sent with the desktop shortcut');
  await composer.press('Control+Enter');

  await expect(page.getByText('sent with the desktop shortcut', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
});

test('keeps Agent clearing in /clear and removes the duplicate settings action', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const composer = page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
  await composer.fill('conversation that should be cleared');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await expect(
    page.getByText('conversation that should be cleared', { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByTestId('settings-workspace')).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: '清空当前 Agent 会话', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: '退出 Core', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();

  await composer.fill('/clear');
  await composer.press('Enter');
  const confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '清空会话', exact: true }).click();

  await expect(page.getByText('conversation that should be cleared', { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: '提示词历史', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: '提示词历史' })
      .getByText('conversation that should be cleared', {
        exact: true,
      }),
  ).toHaveCount(0);
});

test('keeps Core shutdown outside the settings workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByTestId('settings-workspace')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '退出 Core', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'api-prod / bash Git Bash', exact: true }),
  ).toBeVisible();
});

test('uses runtime model and Provider configuration behind the prototype pages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: '模型: GPT-5', exact: true }).click();
  await page.getByRole('menuitem', { name: '管理模型配置...', exact: true }).click();
  await expect(page.getByRole('table', { name: '模型配置列表' })).toContainText('GPT-5');
  await page.getByRole('button', { name: '编辑 GPT-5', exact: true }).click();
  const modelEditor = page.getByRole('dialog', { name: '编辑模型配置' });
  await expect(modelEditor.getByLabel('模型 ID (Model ID)')).toHaveValue('gpt-5');
  await modelEditor.getByRole('button', { name: '拉取远程模型', exact: true }).click();
  await expect(modelEditor.getByRole('button', { name: 'gpt-5-nano', exact: true })).toBeVisible();
  await modelEditor.getByLabel('搜索远程模型').fill('mimo');
  await expect(modelEditor.getByRole('button', { name: 'gpt-5-nano', exact: true })).toHaveCount(0);
  await expect(
    modelEditor.getByRole('button', { name: 'mimo-v2.5-pro', exact: true }),
  ).toBeVisible();
  await modelEditor.getByLabel('搜索远程模型').fill('');
  await modelEditor.getByRole('button', { name: 'gpt-5-nano', exact: true }).click();
  await modelEditor.getByLabel('展示名称 (Display Name)').fill('GPT-5 runtime');
  await modelEditor.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('table', { name: '模型配置列表' })).toContainText('GPT-5 runtime');

  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '模型: GPT-5 runtime', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '服务商配置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '服务商凭据' })).toBeVisible();
  const providerRow = page
    .getByRole('table', { name: '服务商配置列表' })
    .locator('tbody tr')
    .filter({ hasText: 'OpenAI 官方' });
  await expect(providerRow).toBeVisible();
  await providerRow.getByRole('button', { name: '测试连接 OpenAI 官方', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '连接成功' })).toBeVisible();
  await providerRow.getByRole('button', { name: '编辑 OpenAI 官方', exact: true }).click();
  const providerEditor = page.getByRole('dialog', { name: '配置服务商' });
  await providerEditor.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(providerEditor.getByRole('button', { name: '测试成功', exact: true })).toBeVisible();
});
