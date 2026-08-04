import { expect, test, type Page } from '@playwright/test';

const wideDesktop = { width: 1440, height: 900 };

function composer(page: Page) {
  return page.getByPlaceholder('输入目标，Command/Ctrl+Enter 发送');
}

test('opens, filters, and executes slash commands in the composer', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  const input = composer(page);
  await input.fill('/');
  const slashPopover = page.getByRole('listbox', { name: '斜杠命令' });
  await expect(slashPopover).toBeVisible();
  await expect
    .poll(async () => {
      const popoverBox = await slashPopover.boundingBox();
      const inputBox = await input.boundingBox();
      return (
        popoverBox !== null && inputBox !== null && popoverBox.y + popoverBox.height <= inputBox.y
      );
    })
    .toBe(true);
  await expect(page.getByRole('option', { name: /\/model/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /\/permission/ })).toBeVisible();

  await input.fill('/h');
  await expect(slashPopover).toHaveCount(0);

  await input.fill('/mo');
  await expect(page.getByRole('option', { name: /\/model/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /\/permission/ })).toHaveCount(0);
  await input.press('Enter');

  const modelSelector = page.getByRole('group', { name: 'Composer 模型选择' });
  await expect(modelSelector).toBeVisible();
  await expect
    .poll(async () => {
      const panelBox = await modelSelector.boundingBox();
      const inputBox = await input.boundingBox();
      return panelBox !== null && inputBox !== null && panelBox.y + panelBox.height <= inputBox.y;
    })
    .toBe(true);
  await expect(modelSelector.getByRole('option', { name: 'GPT-5' })).toBeVisible();
  await modelSelector.getByRole('button', { name: '关闭模型选择' }).click();

  await input.fill('/permission');
  await input.press('Enter');
  const permissionSelector = page.getByRole('group', { name: 'Composer 权限选择' });
  await expect(permissionSelector).toBeVisible();
  await expect(permissionSelector.getByRole('option', { name: '人工审批' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await input.press('ArrowDown');
  await expect(permissionSelector.getByRole('option', { name: '自动审批' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await input.press('ArrowUp');
  await expect(permissionSelector.getByRole('option', { name: '人工审批' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '当前权限：自动审批', exact: true })).toBeVisible();
});

test('disables state-changing slash commands while running and /clear uses confirmation', async ({
  page,
}) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  const input = composer(page);
  await input.fill('restart the api service');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  await page.getByText('systemctl restart api', { exact: true }).waitFor();

  await input.fill('/model');
  await expect(page.getByRole('option', { name: /\/model/ })).toBeDisabled();
  await input.press('Enter');
  await expect(page.getByRole('group', { name: 'Composer 模型选择' })).toHaveCount(0);

  await page.getByRole('button', { name: '批准执行', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();

  await input.fill('/clear');
  await input.press('Enter');
  const confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('清空当前 Agent 会话');
  await confirm.getByRole('button', { name: '清空会话', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText('输入目标后，Agent 的实时操作会显示在这里。')).toBeVisible();
});

test('picks and removes file attachments and sends attachment metadata to the timeline', async ({
  page,
}) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  const input = composer(page);
  await page.getByRole('button', { name: '添加文件', exact: true }).click();
  await expect(page.getByText('notes.txt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '移除 notes.txt', exact: true }).click();
  await expect(page.getByText('notes.txt', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '添加文件', exact: true }).click();
  await input.fill('read the attached file');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  const timeline = page.locator('[role="tabpanel"][aria-label="Agent 时间线"]');
  await expect(timeline).toContainText('notes.txt');
  await expect(timeline).toContainText('text/plain');
  await expect(timeline).toContainText('2 KB');
});

test('allows image attachments for multimodal models and blocks them for non-multimodal models', async ({
  page,
}) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  const input = composer(page);
  await page.getByRole('button', { name: '添加图片', exact: true }).click();
  await expect(page.getByText('截图.png', { exact: true })).toBeVisible();
  await input.fill('inspect the screenshot');
  await page.getByRole('button', { name: '发送给 Agent', exact: true }).click();
  const timeline = page.locator('[role="tabpanel"][aria-label="Agent 时间线"]');
  await expect(timeline).toContainText('截图.png');
  await expect(page.getByRole('button', { name: '发送给 Agent', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '模型: GPT-5', exact: true }).click();
  await page.getByRole('menuitem', { name: '管理模型配置...', exact: true }).click();
  await page.getByRole('button', { name: '快速诊断 启用状态', exact: true }).click();
  await expect(page.getByRole('button', { name: '快速诊断 启用状态', exact: true })).toContainText(
    '已启用',
  );
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();

  await input.fill('/model');
  await input.press('Enter');
  const modelSelector = page.getByRole('group', { name: 'Composer 模型选择' });
  await expect(modelSelector.getByRole('option', { name: 'GPT-5' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await input.press('ArrowDown');
  await expect(modelSelector.getByRole('option', { name: '快速诊断' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '模型: 快速诊断', exact: true })).toBeVisible();

  const imageButton = page.getByRole('button', { name: '添加图片', exact: true });
  await expect(imageButton).toBeDisabled();
  await expect(imageButton).toHaveAttribute('title', '当前模型不支持图片输入');
  await expect(page.getByRole('button', { name: '添加文件', exact: true })).toBeEnabled();
});

test('navigates sent prompt history with ArrowUp and ArrowDown', async ({ page }) => {
  await page.setViewportSize(wideDesktop);
  await page.goto('/');

  const input = composer(page);
  const sendButton = page.getByRole('button', { name: '发送给 Agent', exact: true });
  const completion = page.getByText('磁盘使用率正常，当前没有失败的 systemd 服务。', {
    exact: false,
  });

  const sendPrompt = async (text: string, completionCount: number): Promise<void> => {
    await input.fill(text);
    await sendButton.click();
    await expect(completion).toHaveCount(completionCount, { timeout: 10_000 });
  };

  await sendPrompt('check disk usage', 1);
  await sendPrompt('list failed services', 2);

  await input.press('ArrowUp');
  await expect(input).toHaveValue('list failed services');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('check disk usage');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('list failed services');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('');
});
