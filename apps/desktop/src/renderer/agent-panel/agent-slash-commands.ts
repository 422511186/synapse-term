export type AgentSlashCommandId = 'clear' | 'model' | 'permission';

export interface AgentSlashCommand {
  id: AgentSlashCommandId;
  command: `/${AgentSlashCommandId}`;
  description: string;
  stateChanging: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export const AGENT_SLASH_COMMANDS: readonly AgentSlashCommand[] = [
  {
    id: 'model',
    command: '/model',
    description: '切换当前模型',
    stateChanging: true,
  },
  {
    id: 'permission',
    command: '/permission',
    description: '切换权限模式',
    stateChanging: true,
  },
  {
    id: 'clear',
    command: '/clear',
    description: '清空当前 Agent 对话',
    stateChanging: true,
  },
];

export function filterAgentSlashCommands(input: string, running = false): AgentSlashCommand[] {
  const query = input.trimStart().toLowerCase();
  if (!query.startsWith('/')) return [];
  return AGENT_SLASH_COMMANDS.filter(
    (command) =>
      command.command.startsWith(query) || command.description.toLowerCase().includes(query),
  ).map((command) => {
    if (!running) return command;
    return command.stateChanging
      ? { ...command, disabled: true, disabledReason: '任务运行中，请先等待完成或取消。' }
      : { ...command, disabled: false };
  });
}
