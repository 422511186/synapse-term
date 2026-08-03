import { describe, expect, it } from 'vitest';

import { AGENT_SLASH_COMMANDS, filterAgentSlashCommands } from './agent-slash-commands.js';

describe('agent slash command registry', () => {
  it('ships exactly the Codex-style command surface without /new', () => {
    expect(AGENT_SLASH_COMMANDS.map((command) => command.command)).toEqual([
      '/model',
      '/permission',
      '/clear',
    ]);
  });

  it('filters by command prefix and leaves no-match input as ordinary text', () => {
    expect(filterAgentSlashCommands('/m').map((command) => command.id)).toEqual(['model']);
    expect(filterAgentSlashCommands('/per').map((command) => command.id)).toEqual(['permission']);
    expect(filterAgentSlashCommands('/compact')).toEqual([]);
    expect(filterAgentSlashCommands('run /clear')).toEqual([]);
  });

  it('disables all slash commands while running', () => {
    const commands = filterAgentSlashCommands('/', true);

    expect(commands).toEqual([
      expect.objectContaining({ id: 'model', disabled: true }),
      expect.objectContaining({ id: 'permission', disabled: true }),
      expect.objectContaining({ id: 'clear', disabled: true }),
    ]);
  });
});
