import { type JSX } from 'react';
import { Box, RefreshCw, ShieldAlert } from 'lucide-react';

import type { AgentSlashCommand } from './agent-slash-commands.js';

const commandIcons = {
  model: Box,
  permission: ShieldAlert,
  clear: RefreshCw,
};

export function SlashCommandPopover({
  commands,
  selectedIndex,
  onSelect,
}: {
  commands: AgentSlashCommand[];
  selectedIndex: number;
  onSelect: (command: AgentSlashCommand) => void;
}): JSX.Element {
  return (
    <div
      aria-label="斜杠命令"
      className="absolute bottom-full left-0 right-0 mb-2 z-30 max-h-64 overflow-y-auto rounded-lg border border-border bg-[#18181b] shadow-2xl py-1"
      role="listbox"
    >
      {commands.map((command, index) => {
        const Icon = commandIcons[command.id];
        return (
          <button
            aria-selected={selectedIndex === index}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed ${selectedIndex === index ? 'bg-secondary/80 text-foreground' : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground'}`}
            disabled={command.disabled === true}
            key={command.id}
            onClick={() => {
              if (command.disabled !== true) onSelect(command);
            }}
            role="option"
            type="button"
          >
            <Icon className={command.disabled === true ? 'opacity-40' : 'text-primary'} size={14} />
            <span className="font-mono shrink-0 mr-3">{command.command}</span>
            <span className="flex-1 truncate opacity-80">{command.description}</span>
            {command.disabled === true && (
              <span className="text-[10px] text-amber-400/80">{command.disabledReason}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
