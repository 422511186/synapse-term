import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { _electron as electron, expect, test, type Page } from '@playwright/test';

const workspace = resolve(import.meta.dirname, '../../..');
const executable =
  process.env.TERMINAL_AGENT_PACKAGED_EXE ??
  resolve(workspace, 'release/win-unpacked/Terminal Agent.exe');
const runtimeRoot = resolve(dirname(executable), 'resources/core');

test.describe('packaged Windows desktop', () => {
  test.skip(process.platform !== 'win32', 'The packaged MVP is Windows-only.');
  test.skip(!existsSync(executable), 'Build release/win-unpacked before running this test.');

  test('starts the deployed Core runtime and executes a real terminal command', async () => {
    test.setTimeout(120_000);
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'terminal-agent-packaged-e2e-'));
    const applicationId = `terminal-agent-packaged-e2e-${basename(userDataDirectory)}`;
    const application = await electron.launch({
      executablePath: executable,
      args: ['--disable-gpu', `--user-data-dir=${userDataDirectory}`],
      env: {
        ...process.env,
        TERMINAL_AGENT_USER_DATA_DIR: userDataDirectory,
        TERMINAL_AGENT_APP_ID: applicationId,
      },
      timeout: 30_000,
    });
    let page: Page | undefined;

    try {
      page = await application.firstWindow({ timeout: 30_000 });
      await expect(page.getByText('Core 已连接', { exact: true })).toBeVisible({ timeout: 30_000 });
      expect(existsSync(resolve(runtimeRoot, 'node.exe'))).toBe(true);
      expect(existsSync(resolve(runtimeRoot, 'dist/core-main.mjs'))).toBe(true);
      expect(existsSync(resolve(runtimeRoot, 'dist/core-maintenance.mjs'))).toBe(true);

      await openNewSessionDialog(page);
      await page.getByLabel('名称').fill('packaged powershell');
      await expect(page.getByLabel('工作目录')).toHaveCount(0);
      await page.getByLabel('Shell').selectOption('powershell');
      await page.getByRole('button', { name: '创建会话' }).click();

      const terminal = page.getByLabel('packaged powershell 终端');
      await expect(terminal.locator('.xterm-screen')).toBeVisible({ timeout: 30_000 });
      await writeTerminalCommand(
        page,
        'packaged powershell',
        "Write-Output 'PACKAGED_DESKTOP_READY'",
      );
      await expect(terminal).toContainText('PACKAGED_DESKTOP_READY', { timeout: 20_000 });
      await page.getByRole('button', { name: '当前 Session：packaged powershell' }).click();
      await page.getByRole('button', { name: '关闭 packaged powershell' }).click();
    } finally {
      await page
        ?.evaluate(async () => {
          const api = (
            globalThis as typeof globalThis & {
              terminalAgent?: { core: { exit(mode: string): Promise<void> } };
            }
          ).terminalAgent;
          await api?.core.exit('terminate_sessions');
        })
        .catch(() => undefined);
      await application.close().catch(() => undefined);
      if (userDataDirectory.startsWith(tmpdir())) {
        await rm(userDataDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });

  test('uses a real local provider, Local File Tool, and ConPTY from the packaged app', async () => {
    test.setTimeout(300_000);
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'terminal-agent-packaged-agent-'));
    const homeDirectory = await mkdtemp(join(tmpdir(), 'terminal-agent-packaged-home-'));
    const filePath = join(homeDirectory, 'workspace', 'message.txt');
    const createdFilePath = join(homeDirectory, 'workspace', 'created.txt');
    const sensitiveFilePath = join(homeDirectory, '.ssh', 'config');
    const outsideFilePath = join(dirname(homeDirectory), `${basename(homeDirectory)}-outside.txt`);
    const manualMutationPath = join(homeDirectory, 'permission-manual.txt');
    const autoMutationPath = join(homeDirectory, 'permission-auto.txt');
    const unknownMutationPath = join(homeDirectory, 'permission-unknown.txt');
    const autoDestructivePath = join(homeDirectory, 'permission-auto-delete');
    const fullDestructivePath = join(homeDirectory, 'permission-full-delete');
    await mkdir(dirname(filePath), { recursive: true });
    await mkdir(dirname(sensitiveFilePath), { recursive: true });
    await mkdir(autoDestructivePath);
    await mkdir(fullDestructivePath);
    await writeFile(filePath, 'before', 'utf8');
    await writeFile(sensitiveFilePath, 'Host packaged-test', 'utf8');
    await writeFile(outsideFilePath, 'outside-secret', 'utf8');
    await writeFile(manualMutationPath, 'original', 'utf8');
    await writeFile(join(autoDestructivePath, 'sentinel.txt'), 'keep', 'utf8');
    await writeFile(join(fullDestructivePath, 'sentinel.txt'), 'remove', 'utf8');
    const provider = await startLocalProvider(filePath, {
      manualMutationPath,
      autoMutationPath,
      unknownMutationPath,
      autoDestructivePath,
      fullDestructivePath,
    });
    const applicationId = `terminal-agent-packaged-agent-${basename(userDataDirectory)}`;
    const application = await electron.launch({
      executablePath: executable,
      args: ['--disable-gpu', `--user-data-dir=${userDataDirectory}`],
      env: {
        ...process.env,
        TERMINAL_AGENT_USER_DATA_DIR: userDataDirectory,
        TERMINAL_AGENT_APP_ID: applicationId,
        TERMINAL_AGENT_E2E: '1',
        TERMINAL_AGENT_E2E_EPHEMERAL_SECRET_STORE: '1',
        USERPROFILE: homeDirectory,
        HOME: homeDirectory,
      },
      timeout: 30_000,
    });
    let page: Page | undefined;

    try {
      page = await application.firstWindow({ timeout: 30_000 });
      await expect(page.getByText('Core 已连接', { exact: true })).toBeVisible({ timeout: 30_000 });

      await page.getByRole('button', { name: '设置' }).click();
      await page.getByRole('menuitem', { name: 'Provider 管理' }).click();
      await page.getByRole('button', { name: '新建 Provider' }).click();
      await page.getByLabel('名称').fill('Packaged Local Provider');
      await page.getByLabel('协议').selectOption('openai_chat_completions');
      await page.getByLabel('Base URL').fill(provider.baseUrl);
      await page.getByLabel('API Key').fill('packaged-integration-key');
      await page.getByRole('button', { name: '保存 Provider' }).click();
      await expect(
        page.locator('.provider-card').filter({ hasText: 'Packaged Local Provider' }),
      ).toBeVisible();

      await page.getByRole('tab', { name: '模型' }).click();
      await page.getByRole('button', { name: '新建模型' }).click();
      await page.getByLabel('显示名称').fill('Packaged Agent Model');
      await page.getByLabel('Provider').selectOption({ label: 'Packaged Local Provider' });
      await page.getByRole('button', { name: '拉取模型' }).click();
      await expect(page.getByRole('status')).toContainText('已发现 1 个模型', { timeout: 20_000 });
      await page.getByRole('option', { name: /packaged-local-model/ }).click();
      await page.getByRole('button', { name: '保存模型' }).click();
      await page.getByRole('button', { name: '检测 Packaged Agent Model' }).click();
      const modelRow = page.getByRole('row', { name: /Packaged Agent Model/ });
      await expect(modelRow).toContainText('可用', {
        timeout: 30_000,
      });
      const enabled = page.getByRole('checkbox', { name: 'Packaged Agent Model 已启用' });
      if (!(await enabled.isChecked())) await enabled.check();
      await expect(enabled).toBeChecked();
      const defaultModel = page.getByRole('checkbox', { name: 'Packaged Agent Model 默认模型' });
      if (!(await defaultModel.isChecked())) await defaultModel.check();
      await expect(defaultModel).toBeChecked();

      await page.getByRole('button', { name: '返回工作区' }).click();
      await openNewSessionDialog(page);
      await page.getByLabel('名称').fill('packaged agent');
      await page.getByLabel('Shell').selectOption('powershell');
      await page.getByRole('button', { name: '创建会话' }).click();
      const terminal = page.getByLabel('packaged agent 终端');
      await expect(terminal.locator('.xterm-screen')).toBeVisible({ timeout: 30_000 });
      await setPermissionMode(page, 'full_access');

      const replayBeforeChat = await readTerminalReplay(page, 'packaged agent');
      await sendGoal(page, 'PACKAGED_PURE_CHAT：不要调用 Tool，只回复“纯聊天完成”。');
      const chatHistory = await waitForCompletedTurn(page, 'packaged agent', 30_000);
      expect(toolCallNames(chatHistory.items)).toEqual([]);
      expect(await readTerminalReplay(page, 'packaged agent')).toBe(replayBeforeChat);

      await sendGoal(
        page,
        'PACKAGED_COMPLETION_REVIEW：依次完成两个只读检查，必须以实际 Tool 证据为准。',
      );
      const completionReviewHistory = await waitForCompletedTurn(page, 'packaged agent', 60_000);
      expect(toolCallNames(completionReviewHistory.items).slice(-2)).toEqual([
        'terminal_execute',
        'terminal_execute',
      ]);
      expect(JSON.stringify(completionReviewHistory.items)).toContain('COMPLETION_FIRST');
      expect(JSON.stringify(completionReviewHistory.items)).toContain('COMPLETION_SECOND');
      await expect(page.getByText('所有检查均已完成。', { exact: true })).toHaveCount(0);
      await expect(page.getByText('补充检查后完成。', { exact: true })).toHaveCount(0);
      await expect(page.locator('.timeline-assistant').last()).toContainText(
        '完成性复核已确认两个检查项。',
      );
      const completionReviewTexts = readAssistantTexts(
        join(userDataDirectory, 'core', 'core.sqlite'),
      );
      expect(completionReviewTexts).not.toContain('所有检查均已完成。');
      expect(completionReviewTexts).not.toContain('补充检查后完成。');
      expect(
        completionReviewTexts.filter((text) => text === '完成性复核已确认两个检查项。'),
      ).toHaveLength(1);

      await page
        .getByPlaceholder('输入目标或问题')
        .fill('PACKAGED_LOCAL_WORKFLOW：检查、创建并编辑本机测试文件，再用 PowerShell 验证。');
      await page.getByTitle('发送').click();

      const history = await waitForCompletedTurn(page, 'packaged agent', 90_000);
      expect(toolCallNames(history.items)).toEqual([
        'local_list_files',
        'local_search_files',
        'local_read_file',
        'local_write_file',
        'local_edit_file',
        'terminal_execute',
        'terminal_wait',
      ]);
      expect(await readFile(filePath, 'utf8')).toBe('after');
      expect(await readFile(createdFilePath, 'utf8')).toBe('created');
      await expect(terminal).toContainText('after', { timeout: 20_000 });
      await expect(page.locator('.timeline-assistant').last()).toContainText('打包链路验证完成');

      await sendGoal(page, 'PACKAGED_HASH_CONFLICT：验证错误 expected SHA-256 不会覆盖文件。');
      const conflictHistory = await waitForCompletedTurn(page, 'packaged agent', 30_000);
      expect(toolCallNames(conflictHistory.items)).toEqual(['local_write_file']);
      expect(conflictHistory.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'tool_result', isError: true })]),
      );
      expect(await readFile(filePath, 'utf8')).toBe('after');

      await setPermissionMode(page, 'manual');
      await sendGoal(page, 'PACKAGED_SENSITIVE_APPROVAL：读取 .ssh/config。');
      await expect(page.locator('.timeline-approval')).toContainText('.ssh/config', {
        timeout: 20_000,
      });
      await cancelTurn(page, 'packaged agent');
      await waitForTurnStatus(page, 'packaged agent', ['cancelled'], 20_000);

      await setPermissionMode(page, 'full_access');
      await sendGoal(page, 'PACKAGED_HOME_ESCAPE：尝试读取 home 之外的文件。');
      const escapeHistory = await waitForTurnStatus(page, 'packaged agent', ['failed'], 30_000);
      expect(toolCallNames(escapeHistory.items)).toEqual(['local_read_file']);
      expect(JSON.stringify(escapeHistory.items)).not.toContain('outside-secret');

      await setPermissionMode(page, 'manual');
      await sendGoal(
        page,
        'PACKAGED_POWERSHELL_PERMISSION_MANUAL_READ_ONLY：执行 PowerShell 只读命令。',
      );
      const powerShellReadOnlyApproval = page
        .locator('.timeline-approval')
        .filter({ hasText: 'PS_READ_ONLY_OK' });
      await expect(powerShellReadOnlyApproval).toBeVisible({ timeout: 20_000 });
      await powerShellReadOnlyApproval.getByRole('button', { name: '批准' }).click();
      const powerShellReadOnly = await waitForCompletedTurn(page, 'packaged agent', 30_000);
      expect(toolCallNames(powerShellReadOnly.items)).toEqual(['terminal_execute']);
      await expect(terminal).toContainText('PS_READ_ONLY_OK', { timeout: 20_000 });

      await sendGoal(
        page,
        'PACKAGED_POWERSHELL_PERMISSION_MANUAL_MUTATING：执行 PowerShell 普通变更命令。',
      );
      await expect(
        page.locator('.timeline-approval').filter({ hasText: 'permission-manual.txt' }),
      ).toBeVisible({ timeout: 20_000 });
      await cancelTurn(page, 'packaged agent');
      await waitForTurnStatus(page, 'packaged agent', ['cancelled'], 20_000);
      expect(await readFile(manualMutationPath, 'utf8')).toBe('original');

      await setPermissionMode(page, 'auto');
      await sendGoal(
        page,
        'PACKAGED_POWERSHELL_PERMISSION_AUTO_MUTATING：执行 PowerShell 普通变更命令。',
      );
      const powerShellAutoMutation = await waitForCompletedTurn(page, 'packaged agent', 30_000);
      expect(toolCallNames(powerShellAutoMutation.items)).toEqual(['terminal_execute']);
      expect(await readFile(autoMutationPath, 'utf8')).toContain('PS_AUTO_MUTATION_OK');

      await sendGoal(
        page,
        'PACKAGED_POWERSHELL_PERMISSION_AUTO_UNKNOWN：执行无法可靠分析的 PowerShell 动态命令。',
      );
      await expect(
        page.locator('.timeline-approval').filter({ hasText: 'Invoke-Expression' }),
      ).toBeVisible({ timeout: 20_000 });
      await cancelTurn(page, 'packaged agent');
      await waitForTurnStatus(page, 'packaged agent', ['cancelled'], 20_000);
      expect(existsSync(unknownMutationPath)).toBe(false);

      await sendGoal(
        page,
        'PACKAGED_POWERSHELL_PERMISSION_AUTO_PRIVILEGED：执行 PowerShell 服务控制命令。',
      );
      await expect(
        page.locator('.timeline-approval').filter({ hasText: 'Restart-Service' }),
      ).toBeVisible({ timeout: 20_000 });
      await cancelTurn(page, 'packaged agent');
      await waitForTurnStatus(page, 'packaged agent', ['cancelled'], 20_000);

      await sendGoal(
        page,
        'PACKAGED_POWERSHELL_PERMISSION_AUTO_DESTRUCTIVE：执行 PowerShell 破坏性命令。',
      );
      await expect(
        page.locator('.timeline-approval').filter({ hasText: 'permission-auto-delete' }),
      ).toBeVisible({ timeout: 20_000 });
      await cancelTurn(page, 'packaged agent');
      await waitForTurnStatus(page, 'packaged agent', ['cancelled'], 20_000);
      expect(existsSync(autoDestructivePath)).toBe(true);

      await setPermissionMode(page, 'full_access');
      await sendGoal(
        page,
        'PACKAGED_POWERSHELL_PERMISSION_FULL_ACCESS_DESTRUCTIVE：执行 PowerShell 破坏性命令。',
      );
      const powerShellFullDestructive = await waitForCompletedTurn(page, 'packaged agent', 30_000);
      expect(toolCallNames(powerShellFullDestructive.items)).toEqual(['terminal_execute']);
      expect(existsSync(fullDestructivePath)).toBe(false);

      const authorizationAudit = readAuthorizationAudit(
        join(userDataDirectory, 'core', 'core.sqlite'),
      );
      expect(authorizationAudit).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolCallId: 'call-ps-manual-read-only',
            executionDialect: 'powershell',
            permissionMode: 'manual',
            risk: 'read_only',
            authorization: 'manual',
            requiresApproval: true,
          }),
          expect.objectContaining({
            toolCallId: 'call-ps-manual-mutating',
            executionDialect: 'powershell',
            permissionMode: 'manual',
            risk: 'mutating',
            authorization: 'manual',
            requiresApproval: true,
          }),
          expect.objectContaining({
            toolCallId: 'call-ps-auto-mutating',
            executionDialect: 'powershell',
            permissionMode: 'auto',
            risk: 'mutating',
            authorization: 'automatic',
            requiresApproval: false,
          }),
          expect.objectContaining({
            toolCallId: 'call-ps-auto-unknown',
            executionDialect: 'powershell',
            permissionMode: 'auto',
            risk: 'unknown',
            authorization: 'manual',
            requiresApproval: true,
          }),
          expect.objectContaining({
            toolCallId: 'call-ps-auto-privileged',
            executionDialect: 'powershell',
            permissionMode: 'auto',
            risk: 'privileged',
            authorization: 'manual',
            requiresApproval: true,
          }),
          expect.objectContaining({
            toolCallId: 'call-ps-auto-destructive',
            executionDialect: 'powershell',
            permissionMode: 'auto',
            risk: 'destructive',
            authorization: 'manual',
            requiresApproval: true,
          }),
          expect.objectContaining({
            toolCallId: 'call-ps-full-destructive',
            executionDialect: 'powershell',
            permissionMode: 'full_access',
            risk: 'destructive',
            authorization: 'full_access',
            requiresApproval: false,
          }),
        ]),
      );

      const gitBashAvailable = await page.evaluate(async () =>
        (await window.terminalAgent.sessions.environment()).shells.some(
          (shell) => shell.kind === 'bash' && shell.available,
        ),
      );
      expect(gitBashAvailable).toBe(true);
      await openNewSessionDialog(page);
      await page.getByLabel('名称').fill('packaged git bash');
      await page.getByLabel('Shell').selectOption('bash');
      await page.getByRole('button', { name: '创建会话' }).click();
      const gitTerminal = page.getByLabel('packaged git bash 终端');
      await expect(gitTerminal.locator('.xterm-screen')).toBeVisible({ timeout: 30_000 });

      await setPermissionMode(page, 'manual');
      await sendGoal(page, 'PACKAGED_PERMISSION_MANUAL_READ_ONLY：执行只读命令。');
      const posixReadOnlyApproval = page
        .locator('.timeline-approval')
        .filter({ hasText: 'PERMISSION_MANUAL_READ_ONLY_OK' });
      await expect(posixReadOnlyApproval).toBeVisible({ timeout: 20_000 });
      await posixReadOnlyApproval.getByRole('button', { name: '批准' }).click();
      const manualReadOnlyHistory = await waitForCompletedTurn(page, 'packaged git bash', 30_000);
      expect(toolCallNames(manualReadOnlyHistory.items)).toEqual(['terminal_execute']);

      await sendGoal(page, 'PACKAGED_PERMISSION_MANUAL_MUTATING：执行普通变更命令。');
      await expect(
        page.locator('.timeline-approval').filter({ hasText: 'touch --version' }),
      ).toBeVisible({ timeout: 20_000 });
      await cancelTurn(page, 'packaged git bash');
      await waitForTurnStatus(page, 'packaged git bash', ['cancelled'], 20_000);

      await setPermissionMode(page, 'auto');
      await sendGoal(page, 'PACKAGED_PERMISSION_AUTO_MUTATING：执行普通变更命令。');
      const autoMutationHistory = await waitForCompletedTurn(page, 'packaged git bash', 30_000);
      expect(toolCallNames(autoMutationHistory.items)).toEqual(['terminal_execute']);
      expect(autoMutationHistory.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'tool_result', isError: false })]),
      );

      await sendGoal(page, 'PACKAGED_PERMISSION_AUTO_DESTRUCTIVE：执行破坏性命令。');
      await expect(page.locator('.timeline-approval').filter({ hasText: 'rm -rf' })).toBeVisible({
        timeout: 20_000,
      });
      await cancelTurn(page, 'packaged git bash');
      await waitForTurnStatus(page, 'packaged git bash', ['cancelled'], 20_000);

      await setPermissionMode(page, 'full_access');
      await sendGoal(page, 'PACKAGED_PERMISSION_FULL_ACCESS_DESTRUCTIVE：执行破坏性命令。');
      const fullAccessHistory = await waitForCompletedTurn(page, 'packaged git bash', 30_000);
      expect(toolCallNames(fullAccessHistory.items)).toEqual(['terminal_execute']);
      expect(fullAccessHistory.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'tool_result', isError: false })]),
      );

      await sendGoal(page, 'PACKAGED_GIT_BASH：在当前 POSIX Session 输出验证标记。');
      const gitHistory = await waitForCompletedTurn(page, 'packaged git bash', 30_000);
      expect(toolCallNames(gitHistory.items)).toEqual(['terminal_execute']);
      await expect(gitTerminal).toContainText('GIT_BASH_AGENT_READY', { timeout: 20_000 });

      expect(provider.requests.some((request) => request.path === '/v1/models')).toBe(true);
      expect(
        provider.requests.every(
          (request) => request.authorization === 'Bearer packaged-integration-key',
        ),
      ).toBe(true);
    } finally {
      await cleanupProviderConfiguration(page);
      await page
        ?.evaluate(async () => {
          await window.terminalAgent.core.exit('terminate_sessions').catch(() => undefined);
        })
        .catch(() => undefined);
      await application.close().catch(() => undefined);
      await provider.close();
      if (userDataDirectory.startsWith(tmpdir())) {
        await rm(userDataDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      if (homeDirectory.startsWith(tmpdir())) {
        await rm(homeDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      if (outsideFilePath.startsWith(tmpdir())) {
        await rm(outsideFilePath, { force: true }).catch(() => undefined);
      }
    }
  });
});

interface CapturedProviderRequest {
  path: string;
  authorization: string | undefined;
  body?: Record<string, unknown>;
}

interface LocalProvider {
  baseUrl: string;
  requests: CapturedProviderRequest[];
  close(): Promise<void>;
}

interface PowerShellPermissionPaths {
  manualMutationPath: string;
  autoMutationPath: string;
  unknownMutationPath: string;
  autoDestructivePath: string;
  fullDestructivePath: string;
}

interface AgentHistoryItem {
  type: string;
  name?: string;
  content?: string;
  isError?: boolean;
}

async function startLocalProvider(
  filePath: string,
  permissionPaths: PowerShellPermissionPaths,
): Promise<LocalProvider> {
  const requests: CapturedProviderRequest[] = [];
  const server = createServer(async (request, response) => {
    const path = request.url ?? '';
    const authorization = request.headers.authorization;
    if (request.method === 'GET' && path === '/v1/models') {
      requests.push({ path, authorization });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'packaged-local-model', object: 'model', owned_by: 'terminal-agent' }],
        }),
      );
      return;
    }
    if (request.method !== 'POST' || path !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readJson(request);
      requests.push({ path, authorization, body });
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      streamAgentResponse(response, body, filePath, permissionPaths);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('local provider missing port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => close(server),
  };
}

function streamAgentResponse(
  response: ServerResponse,
  body: Record<string, unknown>,
  filePath: string,
  permissionPaths: PowerShellPermissionPaths,
): void {
  if (toolNames(body).includes('provider_probe')) {
    streamToolCall(response, 'call-probe', 'provider_probe', '{}');
    return;
  }
  const userMessage = lastUserMessage(body);
  const results = currentToolResults(body);
  const completionReview = isCompletionReviewRequest(body);
  if (userMessage.includes('PACKAGED_PURE_CHAT')) {
    streamText(response, ['纯聊天完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_COMPLETION_REVIEW')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-completion-first',
        'terminal_execute',
        JSON.stringify({
          command: "Get-Location; Write-Output 'COMPLETION_FIRST'",
          observationWindowMs: 3_000,
        }),
      );
      return;
    }
    if (results.length === 1 && !completionReview) {
      streamText(response, ['所有检查均已完成。']);
      return;
    }
    if (results.length === 1) {
      streamToolCall(
        response,
        'call-completion-second',
        'terminal_execute',
        JSON.stringify({
          command: "Get-Date; Write-Output 'COMPLETION_SECOND'",
          observationWindowMs: 3_000,
        }),
      );
      return;
    }
    if (!completionReview) {
      streamText(response, ['补充检查后完成。']);
      return;
    }
    streamText(response, ['完成性复核已确认两个检查项。']);
    return;
  }
  if (userMessage.includes('PACKAGED_POWERSHELL_PERMISSION_MANUAL_READ_ONLY')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-ps-manual-read-only',
        'terminal_execute',
        JSON.stringify({
          command: "Get-Location; Write-Output 'PS_READ_ONLY_OK'",
          observationWindowMs: 3_000,
        }),
      );
      return;
    }
    streamText(response, ['PowerShell 人工审批模式只读命令已完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_POWERSHELL_PERMISSION_MANUAL_MUTATING')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-ps-manual-mutating',
        'terminal_execute',
        JSON.stringify({
          command: `Set-Content -LiteralPath ${powerShellQuote(permissionPaths.manualMutationPath)} -Value 'blocked' -Encoding utf8`,
          observationWindowMs: 3_000,
        }),
      );
      return;
    }
    streamText(response, ['PowerShell 人工审批模式普通变更已完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_POWERSHELL_PERMISSION_AUTO_MUTATING')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-ps-auto-mutating',
        'terminal_execute',
        JSON.stringify({
          command: `Set-Content -LiteralPath ${powerShellQuote(permissionPaths.autoMutationPath)} -Value 'PS_AUTO_MUTATION_OK' -Encoding utf8; Get-Content -LiteralPath ${powerShellQuote(permissionPaths.autoMutationPath)}`,
          observationWindowMs: 3_000,
        }),
      );
      return;
    }
    streamText(response, ['PowerShell 自动审批模式普通变更已完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_POWERSHELL_PERMISSION_AUTO_UNKNOWN')) {
    streamToolCall(
      response,
      'call-ps-auto-unknown',
      'terminal_execute',
      JSON.stringify({
        command: `Invoke-Expression ${powerShellQuote(`Set-Content -LiteralPath ${powerShellQuote(permissionPaths.unknownMutationPath)} -Value 'should-not-run'`)}`,
        observationWindowMs: 3_000,
      }),
    );
    return;
  }
  if (userMessage.includes('PACKAGED_POWERSHELL_PERMISSION_AUTO_PRIVILEGED')) {
    streamToolCall(
      response,
      'call-ps-auto-privileged',
      'terminal_execute',
      JSON.stringify({
        command: "Restart-Service -Name '__terminal_agent_missing__'",
        observationWindowMs: 3_000,
      }),
    );
    return;
  }
  if (userMessage.includes('PACKAGED_POWERSHELL_PERMISSION_AUTO_DESTRUCTIVE')) {
    streamToolCall(
      response,
      'call-ps-auto-destructive',
      'terminal_execute',
      JSON.stringify({
        command: `Remove-Item -LiteralPath ${powerShellQuote(permissionPaths.autoDestructivePath)} -Recurse -Force`,
        observationWindowMs: 3_000,
      }),
    );
    return;
  }
  if (userMessage.includes('PACKAGED_POWERSHELL_PERMISSION_FULL_ACCESS_DESTRUCTIVE')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-ps-full-destructive',
        'terminal_execute',
        JSON.stringify({
          command: `Remove-Item -LiteralPath ${powerShellQuote(permissionPaths.fullDestructivePath)} -Recurse -Force`,
          observationWindowMs: 3_000,
        }),
      );
      return;
    }
    streamText(response, ['PowerShell 完全权限模式破坏性命令已完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_PERMISSION_MANUAL_READ_ONLY')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-permission-manual-read-only',
        'terminal_execute',
        JSON.stringify({
          command: "printf 'PERMISSION_MANUAL_READ_ONLY_OK\\n'",
          observationWindowMs: 3_000,
        }),
      );
      return;
    }
    streamText(response, ['人工审批模式只读命令已完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_PERMISSION_MANUAL_MUTATING')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-permission-manual-mutating',
        'terminal_execute',
        JSON.stringify({ command: 'touch --version', observationWindowMs: 3_000 }),
      );
      return;
    }
    streamText(response, ['人工审批模式普通变更已完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_PERMISSION_AUTO_MUTATING')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-permission-auto-mutating',
        'terminal_execute',
        JSON.stringify({ command: 'touch --version', observationWindowMs: 3_000 }),
      );
      return;
    }
    streamText(response, ['自动审批模式普通变更已完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_PERMISSION_AUTO_DESTRUCTIVE')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-permission-auto-destructive',
        'terminal_execute',
        JSON.stringify({ command: 'rm -rf', observationWindowMs: 3_000 }),
      );
      return;
    }
    streamText(response, ['自动审批模式破坏性命令已完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_PERMISSION_FULL_ACCESS_DESTRUCTIVE')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-permission-full-access-destructive',
        'terminal_execute',
        JSON.stringify({ command: 'rm -rf', observationWindowMs: 3_000 }),
      );
      return;
    }
    streamText(response, ['完全权限模式破坏性命令已完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_GIT_BASH')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-git-bash',
        'terminal_execute',
        JSON.stringify({ command: "printf 'GIT_BASH_AGENT_READY\\n'" }),
      );
      return;
    }
    streamText(response, ['Git Bash 验证完成。']);
    return;
  }
  if (userMessage.includes('PACKAGED_HASH_CONFLICT')) {
    if (results.length === 0) {
      streamToolCall(
        response,
        'call-conflict',
        'local_write_file',
        JSON.stringify({
          path: 'workspace/message.txt',
          mode: 'replace',
          content: 'should-not-write',
          expectedSha256: '0'.repeat(64),
        }),
      );
      return;
    }
    streamText(response, ['哈希冲突已确认，文件未覆盖。']);
    return;
  }
  if (userMessage.includes('PACKAGED_SENSITIVE_APPROVAL')) {
    streamToolCall(
      response,
      'call-sensitive',
      'local_read_file',
      JSON.stringify({ path: '.ssh/config' }),
    );
    return;
  }
  if (userMessage.includes('PACKAGED_HOME_ESCAPE')) {
    streamToolCall(
      response,
      'call-escape',
      'local_read_file',
      JSON.stringify({ path: '../outside.txt' }),
    );
    return;
  }
  if (results.length === 0) {
    streamToolCall(
      response,
      'call-list',
      'local_list_files',
      JSON.stringify({ path: 'workspace', maxDepth: 1, maxResults: 20 }),
    );
    return;
  }
  if (results.length === 1) {
    streamToolCall(
      response,
      'call-search',
      'local_search_files',
      JSON.stringify({ path: 'workspace', query: 'before', mode: 'content' }),
    );
    return;
  }
  if (results.length === 2) {
    streamToolCall(
      response,
      'call-read',
      'local_read_file',
      JSON.stringify({ path: 'workspace/message.txt' }),
    );
    return;
  }
  if (results.length === 3) {
    streamToolCall(
      response,
      'call-write',
      'local_write_file',
      JSON.stringify({ path: 'workspace/created.txt', mode: 'create', content: 'created' }),
    );
    return;
  }
  if (results.length === 4) {
    const sha256 = nestedString(parseToolResult(results[2]!), ['result', 'sha256']);
    streamToolCall(
      response,
      'call-edit',
      'local_edit_file',
      JSON.stringify({
        path: 'workspace/message.txt',
        expectedSha256: sha256,
        edits: [{ oldText: 'before', newText: 'after' }],
      }),
    );
    return;
  }
  if (results.length === 5) {
    streamToolCall(
      response,
      'call-execute',
      'terminal_execute',
      JSON.stringify({
        command: `Start-Sleep -Milliseconds 1000; Get-Content -Raw -LiteralPath ${powerShellQuote(filePath)}`,
        observationWindowMs: 100,
      }),
    );
    return;
  }
  if (results.length === 6) {
    const transactionId = nestedString(parseToolResult(results[5]!), [
      'result',
      'transaction',
      'id',
    ]);
    streamToolCall(
      response,
      'call-wait',
      'terminal_wait',
      JSON.stringify({ transactionId, timeoutMs: 10_000 }),
    );
    return;
  }
  streamText(response, ['## 验证结果\n\n', '打包链路验证完成。']);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function toolNames(body: Record<string, unknown>): string[] {
  return Array.isArray(body.tools)
    ? body.tools.map((tool) => String(record(record(tool).function).name))
    : [];
}

function lastUserMessage(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages.map(record) : [];
  return (
    messages
      .findLast(
        (message) =>
          message.role === 'user' &&
          typeof message.content === 'string' &&
          !isCompletionReviewText(message.content),
      )
      ?.content?.toString() ?? ''
  );
}

function currentToolResults(body: Record<string, unknown>): string[] {
  const messages = Array.isArray(body.messages) ? body.messages.map(record) : [];
  const lastUserIndex = messages.findLastIndex(
    (message) =>
      message.role === 'user' &&
      typeof message.content === 'string' &&
      !isCompletionReviewText(message.content),
  );
  return messages
    .slice(lastUserIndex + 1)
    .flatMap((message) =>
      message.role === 'tool' && typeof message.content === 'string' ? [message.content] : [],
    );
}

function isCompletionReviewRequest(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body.messages) ? body.messages.map(record) : [];
  const lastUser = messages.findLast(
    (message) => message.role === 'user' && typeof message.content === 'string',
  );
  return typeof lastUser?.content === 'string' && isCompletionReviewText(lastUser.content);
}

function isCompletionReviewText(value: string): boolean {
  return value.includes('完成性复核');
}

function parseToolResult(value: string): Record<string, unknown> {
  return record(JSON.parse(value));
}

function nestedString(value: Record<string, unknown>, path: readonly string[]): string {
  let current: unknown = value;
  for (const segment of path) current = record(current)[segment];
  if (typeof current !== 'string')
    throw new Error(`missing provider fixture field ${path.join('.')}`);
  return current;
}

function streamToolCall(
  response: ServerResponse,
  id: string,
  name: string,
  argumentsJson: string,
): void {
  writeSse(
    response,
    chatChunk(
      {
        role: 'assistant',
        tool_calls: [
          { index: 0, id, type: 'function', function: { name, arguments: argumentsJson } },
        ],
      },
      null,
    ),
  );
  writeSse(response, chatChunk({}, 'tool_calls'));
  finishSse(response);
}

function streamText(response: ServerResponse, deltas: readonly string[]): void {
  for (const [index, content] of deltas.entries()) {
    writeSse(response, chatChunk({ content, ...(index === 0 ? { role: 'assistant' } : {}) }, null));
  }
  writeSse(response, chatChunk({}, 'stop'));
  finishSse(response);
}

function chatChunk(delta: Record<string, unknown>, finishReason: string | null) {
  return {
    id: 'chatcmpl-packaged',
    object: 'chat.completion.chunk',
    created: 1_785_000_000,
    model: 'packaged-local-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function writeSse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function finishSse(response: ServerResponse): void {
  response.end('data: [DONE]\n\n');
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function readAuthorizationAudit(databasePath: string): Array<Record<string, unknown>> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `SELECT payload_json
         FROM audit_events
         WHERE type = 'tool.authorization'
         ORDER BY occurred_at ASC, id ASC`,
      )
      .all() as Array<{ payload_json: string }>;
    return rows.map((row) => record(JSON.parse(row.payload_json)));
  } finally {
    database.close();
  }
}

function readAssistantTexts(databasePath: string): string[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return (
      database
        .prepare(
          `SELECT state_json
           FROM model_items
           ORDER BY sequence ASC, id ASC`,
        )
        .all() as Array<{ state_json: string }>
    ).flatMap((row) => {
      const item = record(JSON.parse(row.state_json));
      return item.type === 'assistant_text' && typeof item.content === 'string'
        ? [item.content]
        : [];
    });
  } finally {
    database.close();
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolvePromise();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => (error === undefined ? resolvePromise() : reject(error)));
  });
}

async function waitForCompletedTurn(
  page: Page,
  title: string,
  timeoutMs: number,
): Promise<{ items: AgentHistoryItem[] }> {
  return waitForTurnStatus(page, title, ['completed'], timeoutMs);
}

async function waitForTurnStatus(
  page: Page,
  title: string,
  statuses: readonly string[],
  timeoutMs: number,
): Promise<{ items: AgentHistoryItem[] }> {
  const deadline = Date.now() + timeoutMs;
  let lastHistory: unknown;
  while (Date.now() < deadline) {
    const history = await page.evaluate(async (sessionTitle) => {
      const session = (await window.terminalAgent.sessions.list()).find(
        (candidate) => candidate.title === sessionTitle,
      );
      if (session === undefined) throw new Error('未找到 packaged Agent Session');
      return window.terminalAgent.agent.history(session.id);
    }, title);
    lastHistory = {
      activeTurnId: history.activeTurnId,
      turns: history.turns,
      items: history.items.map((item) => ({
        turnId: item.turnId,
        type: item.type,
        name: item.name,
        isError: item.isError,
        content: item.content?.slice(0, 240),
      })),
    };
    const latestTurnId = history.items.at(-1)?.turnId ?? history.activeTurnId;
    const turn = history.turns.find((candidate) => candidate.id === latestTurnId);
    if (turn !== undefined && statuses.includes(turn.status)) {
      return {
        items: history.items.filter((item) => item.turnId === turn.id) as AgentHistoryItem[],
      };
    }
    await page.waitForTimeout(250);
  }
  throw new Error(
    `packaged Agent Turn 未进入状态：${statuses.join(', ')}；最后状态：${JSON.stringify(lastHistory)}`,
  );
}

async function cleanupProviderConfiguration(page: Page | undefined): Promise<void> {
  await page
    ?.evaluate(async () => {
      for (const model of await window.terminalAgent.models.list()) {
        await window.terminalAgent.models.remove(model.id).catch(() => undefined);
      }
      for (const provider of await window.terminalAgent.providers.list()) {
        await window.terminalAgent.providers.remove(provider.id).catch(() => undefined);
      }
    })
    .catch(() => undefined);
}

async function openNewSessionDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^当前 Session：/ }).click();
  await page.getByRole('button', { name: '新建 Session' }).click();
}

async function setPermissionMode(
  page: Page,
  mode: 'manual' | 'auto' | 'full_access',
): Promise<void> {
  const labels = {
    manual: '人工审批',
    auto: '自动审批',
    full_access: '完全权限',
  } as const;
  const trigger = page.getByRole('button', { name: /^权限模式：/ });
  if ((await trigger.getAttribute('aria-label')) === `权限模式：${labels[mode]}`) return;

  await trigger.click();
  await page.getByRole('menuitemradio', { name: labels[mode] }).click();
  if (mode === 'full_access') {
    await page.getByRole('button', { name: '确认切换' }).click();
  }
}

async function sendGoal(page: Page, goal: string): Promise<void> {
  await page.getByPlaceholder('输入目标或问题').fill(goal);
  await page.getByTitle('发送').click();
}

function toolCallNames(items: readonly AgentHistoryItem[]): Array<string | undefined> {
  return items.filter((item) => item.type === 'assistant_tool_call').map((item) => item.name);
}

async function readTerminalReplay(page: Page, title: string): Promise<string> {
  return page.evaluate(async (sessionTitle) => {
    const session = (await window.terminalAgent.sessions.list()).find(
      (candidate) => candidate.title === sessionTitle,
    );
    if (session === undefined) throw new Error('未找到 packaged replay Session');
    const replay = await window.terminalAgent.terminal.replay(session.id, 0);
    return `${replay.snapshot ?? ''}${replay.events.map((event) => event.data).join('')}`;
  }, title);
}

async function cancelTurn(page: Page, title: string): Promise<void> {
  await page.evaluate(async (sessionTitle) => {
    const session = (await window.terminalAgent.sessions.list()).find(
      (candidate) => candidate.title === sessionTitle,
    );
    if (session === undefined) throw new Error('未找到 packaged cancel Session');
    await window.terminalAgent.agent.cancel(session.id);
  }, title);
}

async function writeTerminalCommand(page: Page, title: string, command: string): Promise<void> {
  await page.evaluate(
    async ({ title: sessionTitle, command: terminalCommand }) => {
      const api = (
        globalThis as typeof globalThis & {
          terminalAgent: {
            sessions: { list(): Promise<Array<{ id: string; title: string }>> };
            terminal: { write(sessionId: string, data: string): Promise<void> };
          };
        }
      ).terminalAgent;
      const session = (await api.sessions.list()).find(
        (candidate) => candidate.title === sessionTitle,
      );
      if (session === undefined) throw new Error('未找到 packaged E2E 终端会话');
      await api.terminal.write(session.id, `${terminalCommand}\r`);
    },
    { title, command },
  );
}
