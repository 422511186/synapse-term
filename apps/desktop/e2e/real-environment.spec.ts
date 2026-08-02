import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { _electron as electron, expect, test, type Page } from '@playwright/test';

const enabled = process.env.TERMINAL_AGENT_REAL_E2E === '1';
const sshTarget = process.env.TERMINAL_AGENT_SSH_TARGET?.trim();
const userDataDirectory = process.env.TERMINAL_AGENT_REAL_USER_DATA_DIR?.trim();
const packagedExecutable =
  process.env.TERMINAL_AGENT_PACKAGED_EXE?.trim() ??
  resolve(import.meta.dirname, '../../../release/win-unpacked/Terminal Agent.exe');
const allowedCommands = [
  'uname -a',
  'uptime',
  'free -b',
  'df -P',
  'cat /proc/loadavg',
  'cat /proc/meminfo',
  'cat /proc/net/dev',
] as const;

test.describe('真实模型与 SSH 只读环境', () => {
  test.skip(process.platform !== 'win32', '真实桌面 E2E 当前仅支持 Windows。');
  test.skip(!enabled, '设置 TERMINAL_AGENT_REAL_E2E=1 后运行真实环境验证。');
  test.skip(!sshTarget, 'TERMINAL_AGENT_SSH_TARGET 未配置。');
  test.skip(!userDataDirectory, 'TERMINAL_AGENT_REAL_USER_DATA_DIR 未配置。');
  test.skip(!existsSync(packagedExecutable), '请先构建 release/win-unpacked。');

  test('Agent 通过已连接终端只读分析远程服务器', async () => {
    test.setTimeout(8 * 60_000);
    const sessionTitle = `example-host 只读验收 ${process.pid}`;
    const application = await electron.launch({
      executablePath: packagedExecutable,
      args: ['--disable-gpu', `--user-data-dir=${userDataDirectory}`],
      env: {
        ...process.env,
        TERMINAL_AGENT_USER_DATA_DIR: userDataDirectory,
        TERMINAL_AGENT_APP_ID: `terminal-agent-real-e2e-${process.pid}`,
      },
      timeout: 30_000,
    });
    let page: Page | undefined;
    let sessionId: string | undefined;

    try {
      page = await application.firstWindow({ timeout: 30_000 });
      await expect(page.getByText('Core 已连接', { exact: true })).toBeVisible({ timeout: 30_000 });

      await page.getByRole('button', { name: '当前 Session：无活动 Session' }).click();
      await page.getByRole('button', { name: '新建 Session' }).click();
      await page.getByLabel('名称').fill(sessionTitle);
      await page.getByLabel('Shell').selectOption('powershell');
      await page.getByRole('button', { name: '创建会话' }).click();

      const terminal = page.getByLabel(`${sessionTitle} 终端`);
      await expect(terminal.locator('.xterm-screen')).toBeVisible({ timeout: 20_000 });
      sessionId = await sessionIdByTitle(page, sessionTitle);
      await expect
        .poll(() => sessionPtyState(page!, sessionId!), { timeout: 20_000 })
        .toBe('running');
      await writeTerminal(page, sessionId, "Write-Output '__TA_LOCAL_READY__'\r");
      await expect
        .poll(() => terminalReplayText(page!, sessionId!), { timeout: 20_000 })
        .toContain('__TA_LOCAL_READY__');

      await writeTerminal(page, sessionId, `ssh -o BatchMode=yes ${sshTarget}\r`);
      await page.waitForTimeout(1_500);
      await writeTerminal(page, sessionId, "printf '__TA_SSH_READY__\\n'\r");
      await expect
        .poll(() => terminalReplayText(page!, sessionId!), { timeout: 30_000 })
        .toContain('__TA_SSH_READY__');

      await page.getByRole('button', { name: /^执行方言：/ }).click();
      await page.getByRole('menuitemradio', { name: 'POSIX' }).click();
      await page.getByRole('button', { name: '资源监控' }).click();
      const resources = page.getByRole('dialog', { name: 'Session 资源' });
      await resources.getByRole('button', { name: '刷新资源' }).click();
      await expect(resources).toContainText(/刚刚更新|部分不可用/, { timeout: 30_000 });
      await expect(resources).toContainText('CPU');
      await expect(resources).toContainText('内存');
      await expect(resources).toContainText('磁盘');
      await expect(resources).toContainText('网络');

      await expect(page.getByRole('button', { name: /^模型：/ })).toBeEnabled();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^推理强度：/ }).click();
      await page.getByRole('menuitemradio', { name: 'low' }).click();
      await page.getByRole('button', { name: /^权限模式：/ }).click();
      await page.getByRole('menuitemradio', { name: /人工审批/ }).click();
      await page
        .getByPlaceholder('输入目标或问题')
        .fill(
          [
            `当前终端已经通过 SSH 连接 ${sshTarget}。`,
            '仅允许使用 terminal_execute，每次执行下面白名单中的一条只读命令：',
            ...allowedCommands,
            '每次 terminal_execute 都将 observationWindowMs 设为 10000；若仍返回 running，先 terminal_wait 再继续。',
            '禁止写文件、修改配置、安装软件、重启服务、结束进程或执行任何白名单外命令。',
            '分析 CPU、内存、磁盘、网络和系统运行状态，并用中文 Markdown 给出结论。',
          ].join('\n'),
        );
      await page.getByTitle('发送').click();

      const history = await waitForCompletedTurn(page, sessionId, 5 * 60_000);
      await expect(page.locator('.timeline-approval .approval-actions')).toHaveCount(0);
      const toolCalls = history.items.filter((item) => item.type === 'assistant_tool_call');
      for (const item of toolCalls) {
        expect(['terminal_execute', 'terminal_wait']).toContain(item.name);
      }
      const terminalExecuteCalls = toolCalls.filter((item) => item.name === 'terminal_execute');
      const terminalCommands = terminalExecuteCalls.map((item) =>
        commandFromArguments(item.argumentsJson),
      );
      expect(terminalCommands.length).toBeGreaterThanOrEqual(allowedCommands.length);
      for (const command of terminalCommands) expect(allowedCommands).toContain(command);
      for (const command of allowedCommands) expect(terminalCommands).toContain(command);

      const terminalResults = terminalExecutionResults(history.items, terminalExecuteCalls);
      expect(terminalResults).toHaveLength(terminalExecuteCalls.length);
      for (const result of terminalResults) {
        expect(result).toMatchObject({
          ok: true,
          status: 'completed',
          risk: 'read_only',
          exitCode: 0,
        });
        expect(allowedCommands).toContain(result.command);
      }

      const audit = await page.evaluate(async (currentSessionId) => {
        return window.terminalAgent.audit.list({ sessionId: currentSessionId });
      }, sessionId);
      const approvalRequests = audit.filter((event) => event.type === 'approval.requested');
      expect(approvalRequests).toHaveLength(terminalExecuteCalls.length);
      const authorizations = readAuthorizationAudit(
        join(userDataDirectory, 'core', 'core.sqlite'),
        sessionId,
      );
      expect(authorizations).toHaveLength(terminalExecuteCalls.length * 2);
      for (const authorization of authorizations) {
        expect(authorization).toMatchObject({
          tool: 'terminal_execute',
          permissionMode: 'manual',
          risk: 'read_only',
          authorization: 'manual',
          requiresApproval: true,
          executionDialect: 'posix',
        });
      }
      expect(authorizations.filter((item) => item.approvalProvided === false)).toHaveLength(
        terminalExecuteCalls.length,
      );
      expect(authorizations.filter((item) => item.approvalProvided === true)).toHaveLength(
        terminalExecuteCalls.length,
      );
      const finalAnswer = history.items
        .filter((item) => item.type === 'assistant_text')
        .map((item) => item.content ?? '')
        .join('');
      expect(finalAnswer).not.toMatch(/上一条|前述(?:答复|报告)|沿用(?:原|上)|无需修正|无修正/);
      expect(finalAnswer).toMatch(/Linux|ubuntu/i);
      expect(finalAnswer).toMatch(/负载/);
      expect(finalAnswer).toMatch(/\d+(?:\.\d+)?\s*(?:GB|MB|kB|bytes)/i);
      expect(finalAnswer).toMatch(/\d+(?:\.\d+)?%/);

      const evidenceDirectory = resolve(import.meta.dirname, '../../../docs/evidence');
      await mkdir(evidenceDirectory, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({
        path: join(evidenceDirectory, 'example-host-readonly-1440x900.png'),
        fullPage: true,
      });

      console.log(
        JSON.stringify({
          sshTarget,
          turnId: history.turnId,
          resourceStatus: await resources.innerText(),
          toolCalls: toolCalls.map((item) => item.name),
          terminalCommands,
          terminalResults,
          authorizationSummary: authorizations,
          approvalRequestCount: approvalRequests.length,
          writeToolCallCount: toolCalls.filter((item) => item.name?.startsWith('local_')).length,
          finalAnswer,
        }),
      );
    } finally {
      if (page !== undefined && sessionId !== undefined) {
        await page
          .evaluate(async (currentSessionId) => {
            await window.terminalAgent.agent.cancel(currentSessionId).catch(() => undefined);
            await window.terminalAgent.sessions.close(currentSessionId).catch(() => undefined);
          }, sessionId)
          .catch(() => undefined);
      }
      await page
        ?.evaluate(async () => {
          await window.terminalAgent.core.exit('terminate_sessions').catch(() => undefined);
        })
        .catch(() => undefined);
      await application.close().catch(() => undefined);
    }
  });
});

interface HistoryItem {
  type: string;
  name?: string;
  toolCallId?: string;
  argumentsJson?: string;
  content?: string;
  isError?: boolean;
}

async function sessionIdByTitle(page: Page, title: string): Promise<string> {
  return page.evaluate(async (sessionTitle) => {
    const session = (await window.terminalAgent.sessions.list()).find(
      (candidate) => candidate.title === sessionTitle,
    );
    if (session === undefined) throw new Error('未找到真实 SSH Session');
    return session.id;
  }, title);
}

async function writeTerminal(page: Page, sessionId: string, data: string): Promise<void> {
  await page.evaluate(
    async ({ currentSessionId, terminalData }) => {
      await window.terminalAgent.terminal.write(currentSessionId, terminalData);
    },
    { currentSessionId: sessionId, terminalData: data },
  );
}

async function sessionPtyState(page: Page, sessionId: string): Promise<string | undefined> {
  return page.evaluate(async (currentSessionId) => {
    return (await window.terminalAgent.sessions.list()).find(
      (candidate) => candidate.id === currentSessionId,
    )?.pty;
  }, sessionId);
}

async function terminalReplayText(page: Page, sessionId: string): Promise<string> {
  return page.evaluate(async (currentSessionId) => {
    const replay = await window.terminalAgent.terminal.replay(currentSessionId, 0);
    return `${replay.snapshot ?? ''}${replay.events.map((event) => event.data).join('')}`;
  }, sessionId);
}

async function waitForCompletedTurn(
  page: Page,
  sessionId: string,
  timeoutMs: number,
): Promise<{ turnId: string; items: HistoryItem[] }> {
  const deadline = Date.now() + timeoutMs;
  let observedTurnId: string | undefined;
  while (Date.now() < deadline) {
    const history = await page.evaluate(async (currentSessionId) => {
      return window.terminalAgent.agent.history(currentSessionId);
    }, sessionId);
    observedTurnId ??= history.activeTurnId ?? history.turns.at(-1)?.id;
    const turn = history.turns.find((candidate) => candidate.id === observedTurnId);
    if (turn !== undefined && history.activeTurnId !== observedTurnId) {
      expect(turn.status).toBe('completed');
      return {
        turnId: observedTurnId,
        items: history.items.filter((item) => item.turnId === observedTurnId) as HistoryItem[],
      };
    }
    if (await approvePendingReadOnlyCommand(page)) {
      await page.waitForTimeout(100);
      continue;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('真实 SSH Agent Turn 等待超时');
}

async function approvePendingReadOnlyCommand(page: Page): Promise<boolean> {
  const cards = page.locator('.timeline-approval');
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    if (!(await card.isVisible())) continue;
    const text = await card.innerText();
    if (!allowedCommands.some((command) => text.includes(command))) {
      throw new Error(`真实 SSH 只读验收发现白名单外的审批命令：${text}`);
    }
    const approve = card.getByRole('button', { name: '批准' });
    if ((await approve.count()) === 0 || !(await approve.isVisible())) continue;
    await approve.click();
    return true;
  }
  return false;
}

function commandFromArguments(value: string | undefined): string {
  if (value === undefined) throw new Error('terminal_execute 缺少参数');
  const parsed = JSON.parse(value) as { command?: unknown };
  if (typeof parsed.command !== 'string') throw new Error('terminal_execute 缺少 command');
  return parsed.command;
}

function terminalExecutionResults(
  items: HistoryItem[],
  calls: HistoryItem[],
): Array<{
  toolCallId: string;
  command: string;
  ok: boolean;
  status: string;
  risk: string;
  exitCode: number;
}> {
  const callIds = new Set(
    calls.map((item) => {
      if (item.toolCallId === undefined) throw new Error('terminal_execute 缺少 Tool Call ID');
      return item.toolCallId;
    }),
  );
  return items
    .filter((item) => item.type === 'tool_result' && item.toolCallId !== undefined)
    .filter((item) => callIds.has(item.toolCallId!))
    .map((item) => {
      const parsed = JSON.parse(item.content ?? '') as {
        ok?: unknown;
        result?: {
          status?: unknown;
          transaction?: {
            command?: unknown;
            risk?: unknown;
            exitCode?: unknown;
          };
        };
      };
      const transaction = parsed.result?.transaction;
      if (
        typeof parsed.ok !== 'boolean' ||
        typeof parsed.result?.status !== 'string' ||
        typeof transaction?.command !== 'string' ||
        typeof transaction.risk !== 'string' ||
        typeof transaction.exitCode !== 'number'
      ) {
        throw new Error(`terminal_execute 返回无效：${item.content ?? ''}`);
      }
      return {
        toolCallId: item.toolCallId!,
        command: transaction.command,
        ok: parsed.ok,
        status: parsed.result.status,
        risk: transaction.risk,
        exitCode: transaction.exitCode,
      };
    });
}

function readAuthorizationAudit(
  databasePath: string,
  sessionId: string,
): Array<Record<string, unknown>> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `SELECT payload_json
         FROM audit_events
         WHERE type = 'tool.authorization' AND session_id = ?
         ORDER BY occurred_at ASC, id ASC`,
      )
      .all(sessionId) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as Record<string, unknown>);
  } finally {
    database.close();
  }
}
