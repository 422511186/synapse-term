import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';

const appRoot = fileURLToPath(new URL('../', import.meta.url));

test.skip(!process.env.SYNAPSE_TERM_ELECTRON_E2E, 'real Electron verification is opt-in');

let electronApp: ElectronApplication;
let page: Awaited<ReturnType<ElectronApplication['firstWindow']>>;
let userDataDirectory: string;

async function callTool(client: Client, name: string, input: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: input });
  const text = response.content?.[0]?.type === 'text' ? response.content[0].text : '';
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = undefined;
  }
  return {
    isError: response.isError === true,
    text,
    json,
  };
}

function transactionIdOf(result: Awaited<ReturnType<typeof callTool>>): string {
  const json = result.json as { transaction?: { id?: string } } | undefined;
  const transactionId = json?.transaction?.id;
  if (typeof transactionId !== 'string') throw new Error(`missing transaction id: ${result.text}`);
  return transactionId;
}

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(join(tmpdir(), 'synapse-electron-e2e-'));
  electronApp = await _electron.launch({
    args: ['.'],
    cwd: appRoot,
    env: {
      ...process.env,
      SYNAPSE_TERM_USER_DATA_DIR: userDataDirectory,
      SYNAPSE_TERM_MCP_APPROVAL_TIMEOUT_MS: '5000',
    },
    logger: {
      info: (message) => console.log('[electron-info]', message),
      warn: (message) => console.warn('[electron-warn]', message),
      error: (message) => console.error('[electron-error]', message),
    },
  });
  page = await electronApp.firstWindow();
  await page.waitForSelector('.prototype-shell');
});

test.afterAll(async () => {
  await electronApp.close();
  await rm(userDataDirectory, { recursive: true, force: true });
});

test('verifies real MCP calls, approvals, visibility, grants, timeout, denial, and revocation', async () => {
  test.setTimeout(120_000);

  await page.getByRole('button', { name: '新建终端会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建终端会话' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '创建并连接' }).click();
  await expect(page.getByRole('tab')).toBeVisible();

  await page.getByRole('button', { name: '设置' }).click();
  const enabledToggle = page
    .locator('label')
    .filter({ hasText: '启用本机 MCP 端点' })
    .locator('input');
  await enabledToggle.click();
  await expect(enabledToggle).toBeChecked();
  await page.getByLabel('托管').click();
  await expect(page.getByLabel('托管')).toBeChecked();
  await expect(page.getByText('运行状态：运行中')).toBeVisible();
  await expect(page.getByLabel('MCP 服务端口')).toHaveValue('4739');
  await expect(page.locator('input[readonly]')).toHaveValue('http://127.0.0.1:4739/mcp');
  await expect(page.getByLabel('Authorization 请求头', { exact: true })).toContainText('Bearer');
  await page.screenshot({ path: 'test-results/ui-audit/01-settings.png' });
  await page.getByRole('button', { name: '返回工作区' }).click();

  await page.locator('.session-tab').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '共享到 MCP' }).click();
  const shareDialog = page.getByRole('dialog', { name: '共享终端会话' });
  await shareDialog.getByRole('button', { name: '复制共享提示词块' }).click();
  await expect(shareDialog).toContainText('已复制');
  await page.screenshot({ path: 'test-results/ui-audit/02-share-dialog.png' });
  await shareDialog.getByLabel('关闭共享').click();

  const runtime = await page.evaluate(async () => {
    if (!window.synapseTerm) throw new Error('preload API unavailable');
    const [settings, status, shared] = await Promise.all([
      window.synapseTerm.mcp.getSettings(),
      window.synapseTerm.mcp.getStatus(),
      window.synapseTerm.mcp.listSharedSessions(),
    ]);
    return {
      token: settings.token,
      connectionString: status.connectionString,
      sessionId: shared[0]?.id,
      terminalType: (await window.synapseTerm.sessions.list())[0]?.terminalType,
    };
  });
  expect(runtime.token).toBeTruthy();
  expect(runtime.connectionString).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  expect(runtime.sessionId).toBeTruthy();

  const transport = new StreamableHTTPClientTransport(new URL(runtime.connectionString!), {
    requestInit: { headers: { authorization: `Bearer ${runtime.token}` } },
  });
  const client = new Client({ name: 'playwright-external-client', version: '1.0.0' });
  await client.connect(transport);

  const status = await callTool(client, 'synapse_status', { sessionId: runtime.sessionId });
  expect(status.isError).toBe(false);
  expect(status.json).toMatchObject({ status: 'ready' });

  const appWindow = await electronApp.browserWindow(page);
  await appWindow.evaluate((desktopWindow) => desktopWindow.minimize());

  const command = /powershell/i.test(runtime.terminalType ?? '')
    ? 'Start-Sleep -Seconds 2'
    : 'sleep 2';
  let executePromise = callTool(client, 'synapse_execute', {
    sessionId: runtime.sessionId,
    command,
  });
  let card = page.getByRole('dialog', { name: 'MCP 审批' });
  await expect(card).toBeVisible();
  expect(await appWindow.evaluate((desktopWindow) => desktopWindow.isMinimized())).toBe(false);
  await expect(card).toContainText(command);
  await page.screenshot({ path: 'test-results/ui-audit/03-approval-card.png' });
  await card.getByRole('button', { name: '允许一次' }).click();
  let executeResult = await executePromise;
  expect(executeResult.isError).toBe(false);
  await page.screenshot({ path: 'test-results/ui-audit/04-external-execution.png' });
  const firstWait = await callTool(client, 'synapse_wait', {
    sessionId: runtime.sessionId,
    transactionId: transactionIdOf(executeResult),
  });
  expect(firstWait.isError, firstWait.text).toBe(false);
  expect(firstWait.json).toMatchObject({ status: 'completed' });

  const literalCommand = /powershell/i.test(runtime.terminalType ?? '')
    ? "Write-Output 'literal-mcp-audit-ok'"
    : "printf 'literal-mcp-audit-ok\\n'";
  const literalExecute = await callTool(client, 'synapse_execute', {
    sessionId: runtime.sessionId,
    command: literalCommand,
  });
  expect(literalExecute.isError, literalExecute.text).toBe(false);
  expect(literalExecute.json).toMatchObject({
    transaction: { command: literalCommand },
  });
  const literalWait = await callTool(client, 'synapse_wait', {
    sessionId: runtime.sessionId,
    transactionId: transactionIdOf(literalExecute),
  });
  expect(literalWait.isError, literalWait.text).toBe(false);
  expect(literalWait.json).toMatchObject({
    status: 'completed',
    output: expect.stringContaining('literal-mcp-audit-ok'),
  });
  expect(`${literalExecute.text}\n${literalWait.text}`).not.toContain('\u001b]777;TA;');

  executePromise = callTool(client, 'synapse_execute', {
    sessionId: runtime.sessionId,
    command,
  });
  card = page.getByRole('dialog', { name: 'MCP 审批' });
  await expect(card).toContainText(command);
  await page.screenshot({ path: 'test-results/ui-audit/05-session-grant-card.png' });
  await card.getByRole('button', { name: '本会话内放行该命令' }).click();
  executeResult = await executePromise;
  expect(executeResult.isError, JSON.stringify(executeResult)).toBe(false);
  const secondWait = await callTool(client, 'synapse_wait', {
    sessionId: runtime.sessionId,
    transactionId: transactionIdOf(executeResult),
  });
  expect(secondWait.isError, secondWait.text).toBe(false);
  expect(secondWait.json).toMatchObject({ status: 'completed' });

  executePromise = callTool(client, 'synapse_execute', {
    sessionId: runtime.sessionId,
    command,
  });
  executeResult = await executePromise;
  expect(executeResult.isError).toBe(false);
  const thirdWait = await callTool(client, 'synapse_wait', {
    sessionId: runtime.sessionId,
    transactionId: transactionIdOf(executeResult),
  });
  expect(thirdWait.isError, thirdWait.text).toBe(false);
  expect(thirdWait.json).toMatchObject({ status: 'completed' });
  await expect(card).toHaveCount(0);

  const denied = callTool(client, 'synapse_execute', {
    sessionId: runtime.sessionId,
    command: '__synapse_denied_command__',
  });
  card = page.getByRole('dialog', { name: 'MCP 审批' });
  await expect(card).toContainText('__synapse_denied_command__');
  await page.screenshot({ path: 'test-results/ui-audit/06-denial-card.png' });
  await card.getByRole('button', { name: '拒绝' }).click();
  const deniedResult = await denied;
  expect(deniedResult.text).toMatch(/^APPROVAL_DENIED:/);

  const timedOut = callTool(client, 'synapse_execute', {
    sessionId: runtime.sessionId,
    command: '__synapse_timeout_command__',
  });
  await expect(page.getByRole('dialog', { name: 'MCP 审批' })).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-audit/07-timeout-card.png' });
  await expect(page.getByRole('dialog', { name: 'MCP 审批' })).toHaveCount(0, {
    timeout: 7_000,
  });
  const timeoutResult = await timedOut;
  expect(timeoutResult.text).toMatch(/^APPROVAL_TIMEOUT:/);

  await client.close();
  await page.evaluate(
    (sessionId) => window.synapseTerm?.mcp.unshareSession(sessionId),
    runtime.sessionId,
  );
  const expiredTransport = new StreamableHTTPClientTransport(new URL(runtime.connectionString!), {
    requestInit: { headers: { authorization: `Bearer ${runtime.token}` } },
  });
  const expiredClient = new Client({ name: 'expired-client', version: '1.0.0' });
  await expiredClient.connect(expiredTransport);
  const expired = await callTool(expiredClient, 'synapse_status', {
    sessionId: runtime.sessionId,
  });
  expect(expired.json).toMatchObject({ status: 'expired' });
  await expiredClient.close();
});
