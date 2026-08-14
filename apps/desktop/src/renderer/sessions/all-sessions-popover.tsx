/** 全部会话弹层（自 app.tsx 拆分）：搜索与切换会话 */
import type { JSX } from 'react';
import { Search, SquareX, X } from 'lucide-react';

import type { SessionSummary } from '../../preload/preload-api.js';
import { isInteractiveSession } from '../session-selection.js';
import { getSessionAvailability } from '../session-status.js';

export function AllSessionsPopover({
  activeSessionId,
  onClose,
  onCloseAll,
  onQueryChange,
  onSelect,
  query,
  sessions,
}: {
  activeSessionId: string | undefined;
  onClose: (sessionId: string) => void | Promise<void>;
  onCloseAll: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (session: SessionSummary) => void;
  query: string;
  sessions: SessionSummary[];
}): JSX.Element {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSessions = sessions.filter((session) =>
    [session.title, session.terminalType, session.pty].some((value) =>
      (value ?? '').toLocaleLowerCase().includes(normalizedQuery),
    ),
  );

  return (
    <div aria-label="全部会话" className="session-all-popover" role="dialog">
      <div className="session-all-search">
        <Search size={15} />
        <input
          aria-label="搜索会话"
          autoFocus
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索会话"
          value={query}
        />
      </div>
      <div aria-label="会话列表" className="session-all-list" role="listbox">
        {visibleSessions.map((session) => {
          const availability = getSessionAvailability(session);
          return (
            <div className="session-all-row" key={session.id}>
              <button
                aria-label={`${session.title} ${session.terminalType}`}
                aria-selected={session.id === activeSessionId}
                className="session-all-select"
                disabled={!isInteractiveSession(session)}
                onClick={() => onSelect(session)}
                role="option"
                type="button"
              >
                <span className="session-all-primary">
                  <span
                    aria-label={availability.label}
                    className={`session-status-dot is-${availability.tone}`}
                    title={availability.label}
                  />
                  <span className="session-all-title">{session.title}</span>
                  <span className="session-all-type">{session.terminalType}</span>
                </span>
                <span className="session-all-status">{availability.label}</span>
              </button>
              <button
                aria-label={`关闭 ${session.title}`}
                className="session-all-close"
                onClick={() => void onClose(session.id)}
                title={`关闭 ${session.title}`}
                type="button"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
        {visibleSessions.length === 0 && <div className="session-all-empty">没有匹配的会话</div>}
      </div>
      <div className="border-t border-border/60 p-2">
        <button
          aria-label="关闭全部终端"
          className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={sessions.length === 0}
          onClick={onCloseAll}
          title="关闭全部终端"
          type="button"
        >
          <SquareX size={14} />
          关闭全部终端
        </button>
      </div>
    </div>
  );
}
