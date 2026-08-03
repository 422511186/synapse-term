import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { filterAgentSlashCommands } from './agent-slash-commands.js';
import { SlashCommandPopover } from './slash-command-popover.js';

describe('SlashCommandPopover', () => {
  it('renders filtered commands and marks the selected entry', () => {
    const html = renderToString(
      <SlashCommandPopover
        commands={filterAgentSlashCommands('/m')}
        onSelect={() => undefined}
        selectedIndex={0}
      />,
    );

    expect(html).toContain('/model');
    expect(html).toContain('切换当前模型');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain('/clear');
  });

  it('shows disabled state-changing commands while running', () => {
    const html = renderToString(
      <SlashCommandPopover
        commands={filterAgentSlashCommands('/', true)}
        onSelect={() => undefined}
        selectedIndex={2}
      />,
    );

    expect(html).toContain('任务运行中，请先等待完成或取消。');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('/help');
  });
});
