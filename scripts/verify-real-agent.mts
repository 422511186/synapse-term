import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

import { CoreApplication } from '../apps/core/src/core-application.js';
import { ShellLocator } from '@synapse-term/terminal-service';

async function main(): Promise<void> {
  const dataDirectory = required(process.env.TERMINAL_AGENT_DATA_DIR, 'TERMINAL_AGENT_DATA_DIR');
  const modelConfigurationId = required(
    process.env.TERMINAL_AGENT_MODEL_CONFIGURATION_ID,
    'TERMINAL_AGENT_MODEL_CONFIGURATION_ID',
  );
  const shell = new ShellLocator()
    .list()
    .find((candidate) => candidate.kind === 'powershell' && candidate.available);
  if (shell?.executable === undefined) throw new Error('当前系统没有可用的 PowerShell');

  const application = await CoreApplication.create({
    dataDirectory,
    appId: `terminal-agent-real-agent-${process.pid}`,
    instanceId: randomUUID(),
    version: '0.3.0',
    idleExitDelayMs: 0,
  });
  let sessionId: string | undefined;

  try {
    const validation = asModel(await application.request('model.test', { modelConfigurationId }));
    if (validation.status !== 'available') {
      throw new Error(
        `模型检测失败：${validation.status}；${JSON.stringify(validation.validation)}`,
      );
    }
    if (!validation.enabled) {
      await application.request('model.setEnabled', { modelConfigurationId, enabled: true });
    }
    if (!validation.isDefault) {
      await application.request('model.setDefault', { modelConfigurationId, isDefault: true });
    }

    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    const session = asSession(
      await application.request('session.create', {
        title: '真实模型验证',
        executable: shell.executable,
        args: shell.args,
        cwd: homedir(),
        env: { ...environment, TERM: environment.TERM ?? 'xterm-256color' },
        columns: 120,
        rows: 40,
        executionDialect: shell.executionDialect,
      }),
    );
    sessionId = session.id;

    const plain = await runTurn(
      application,
      session.id,
      modelConfigurationId,
      '不要调用任何工具。请只用一句中文回复：模型连接正常。',
    );
    assertNoTools(plain, '普通对话');

    const markdown = await runTurn(
      application,
      session.id,
      modelConfigurationId,
      '不要调用任何工具。请用 Markdown 输出二级标题“验证结果”，并列出一项“流式输出正常”。',
    );
    assertNoTools(markdown, 'Markdown 对话');
    const markdownAnswer = assistantText(markdown);
    if (!markdownAnswer.includes('##') || !markdownAnswer.includes('流式输出正常')) {
      throw new Error(`Markdown 输出不符合预期：${markdownAnswer}`);
    }

    const tools = await runTurn(
      application,
      session.id,
      modelConfigurationId,
      [
        '请在当前 PowerShell 终端中完成只读验证。',
        '必须分两次调用 terminal_execute，每次只执行一条命令：',
        '第一条是 Get-Date -Format o，第二条是 Get-Location。',
        '不要写入文件、不要修改配置，最后用中文 Markdown 总结两个结果。',
      ].join('\n'),
      'full_access',
    );
    const terminalExecutions = tools.items.filter(
      (item) => item.type === 'assistant_tool_call' && item.name === 'terminal_execute',
    );
    if (terminalExecutions.length < 2) {
      throw new Error(`预期至少两次 terminal_execute，实际为 ${terminalExecutions.length}`);
    }
    const terminalResults = terminalExecutionResults(tools.items);
    const dateResult = terminalResults.find((result) => result.command === 'Get-Date -Format o');
    const locationResult = terminalResults.find((result) => result.command === 'Get-Location');
    for (const result of [dateResult, locationResult]) {
      if (
        result === undefined ||
        result.status !== 'completed' ||
        result.risk !== 'read_only' ||
        result.exitCode !== 0
      ) {
        throw new Error(`PowerShell 只读结果不完整：${JSON.stringify(terminalResults)}`);
      }
    }
    if (dateResult.output.trim().length === 0) throw new Error('Get-Date 未返回输出');
    if (!locationResult.output.toLowerCase().includes(homedir().toLowerCase())) {
      throw new Error(`Get-Location 未返回当前用户目录：${JSON.stringify(locationResult)}`);
    }

    console.log(
      JSON.stringify(
        {
          modelConfigurationId,
          validation: validation.validation,
          plainAnswer: assistantText(plain),
          markdownAnswer,
          toolCalls: tools.items
            .filter((item) => item.type === 'assistant_tool_call')
            .map((item) => item.name),
          toolResultCount: tools.items.filter((item) => item.type === 'tool_result').length,
          terminalResults,
          finalAnswer: assistantText(tools),
        },
        null,
        2,
      ),
    );
  } finally {
    if (sessionId !== undefined) {
      await application.request('session.close', { sessionId }).catch(() => undefined);
    }
    await application.close();
  }
}

void main().then(
  () => settleProcess(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    settleProcess(1);
  },
);

function settleProcess(code: number): void {
  process.exitCode = code;
  const fallback = setTimeout(() => process.exit(code), 5_000);
  fallback.unref();
}

interface ModelView {
  id: string;
  enabled: boolean;
  isDefault: boolean;
  status: string;
  validation: unknown;
}

interface SessionView {
  id: string;
}

interface HistoryItem {
  turnId: string;
  type: string;
  content?: string;
  name?: string;
  toolCallId?: string;
  argumentsJson?: string;
}

interface TurnHistory {
  turnId: string;
  status: string;
  items: HistoryItem[];
}

async function runTurn(
  application: CoreApplication,
  currentSessionId: string,
  currentModelConfigurationId: string,
  goal: string,
  permissionMode: 'manual' | 'full_access' = 'manual',
): Promise<TurnHistory> {
  const started = (await application.request('agent.start', {
    sessionId: currentSessionId,
    goal,
    modelConfigurationId: currentModelConfigurationId,
    reasoningEffort: 'low',
    permissionMode,
  })) as { turnId: string };
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const history = (await application.request('agent.history', {
      sessionId: currentSessionId,
    })) as {
      activeTurnId?: string;
      turns: Array<{ id: string; status: string }>;
      items: HistoryItem[];
    };
    const turn = history.turns.find((candidate) => candidate.id === started.turnId);
    if (turn !== undefined && history.activeTurnId !== started.turnId) {
      if (turn.status !== 'completed') {
        throw new Error(`Agent Turn ${started.turnId} 结束状态为 ${turn.status}`);
      }
      return {
        turnId: started.turnId,
        status: turn.status,
        items: history.items.filter((item) => item.turnId === started.turnId),
      };
    }
    await delay(250);
  }
  await application.request('agent.cancel', {
    sessionId: currentSessionId,
    turnId: started.turnId,
  });
  throw new Error(`Agent Turn ${started.turnId} 等待超时`);
}

function assertNoTools(history: TurnHistory, label: string): void {
  const toolCalls = history.items.filter((item) => item.type === 'assistant_tool_call');
  if (toolCalls.length > 0) throw new Error(`${label}不应调用工具`);
}

function assistantText(history: TurnHistory): string {
  return history.items
    .filter((item) => item.type === 'assistant_text')
    .map((item) => item.content ?? '')
    .join('')
    .trim();
}

function terminalExecutionResults(items: HistoryItem[]): Array<{
  command: string;
  status: string;
  risk: string;
  exitCode: number;
  output: string;
}> {
  const commands = new Map(
    items
      .filter((item) => item.type === 'assistant_tool_call' && item.name === 'terminal_execute')
      .map((item) => {
        if (item.toolCallId === undefined || item.argumentsJson === undefined) {
          throw new Error('terminal_execute 缺少 Tool Call ID 或参数');
        }
        const parsed = JSON.parse(item.argumentsJson) as { command?: unknown };
        if (typeof parsed.command !== 'string') throw new Error('terminal_execute 缺少 command');
        return [item.toolCallId, parsed.command] as const;
      }),
  );
  return items
    .filter((item) => item.type === 'tool_result' && item.toolCallId !== undefined)
    .filter((item) => commands.has(item.toolCallId!))
    .map((item) => {
      const parsed = JSON.parse(item.content ?? '') as {
        ok?: unknown;
        result?: {
          status?: unknown;
          transaction?: { risk?: unknown; exitCode?: unknown };
          output?: { text?: unknown };
        };
      };
      if (
        parsed.ok !== true ||
        typeof parsed.result?.status !== 'string' ||
        typeof parsed.result.transaction?.risk !== 'string' ||
        typeof parsed.result.transaction.exitCode !== 'number' ||
        typeof parsed.result.output?.text !== 'string'
      ) {
        throw new Error(`terminal_execute 返回无效：${item.content ?? ''}`);
      }
      return {
        command: commands.get(item.toolCallId!)!,
        status: parsed.result.status,
        risk: parsed.result.transaction.risk,
        exitCode: parsed.result.transaction.exitCode,
        output: parsed.result.output.text,
      };
    });
}

function asModel(value: unknown): ModelView {
  if (typeof value !== 'object' || value === null || !('id' in value)) {
    throw new Error('模型检测返回无效');
  }
  return value as ModelView;
}

function asSession(value: unknown): SessionView {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { id?: unknown }).id !== 'string'
  ) {
    throw new Error('Session 创建返回无效');
  }
  return value as SessionView;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) throw new Error(`${name} is required`);
  return normalized;
}
