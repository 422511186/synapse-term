import { ChevronLeft, ChevronRight, Radio, X } from 'lucide-react';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';

import type { SessionSummary } from '../../preload/preload-api.js';
import { getSessionAvailability } from '../session-status.js';

export function SessionTabList({
  sessions,
  activeSessionId,
  isExecuting,
  onSelect,
  onClose,
  onRename,
  onOpenMenu,
}: {
  sessions: SessionSummary[];
  activeSessionId: string;
  isExecuting: (sessionId: string) => boolean;
  onSelect: (sessionId: string) => void;
  onClose: (session: SessionSummary) => void;
  onRename: (session: SessionSummary) => void;
  onOpenMenu: (sessionId: string, x: number, y: number) => void;
}): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const [scrollState, setScrollState] = useState({ overflow: false, left: false, right: false });
  const updateScrollState = useCallback((): void => {
    const list = listRef.current;
    if (!list) return;
    const next = {
      overflow: list.scrollWidth > list.clientWidth + 1,
      left: list.scrollLeft > 1,
      right: list.scrollLeft + list.clientWidth < list.scrollWidth - 1,
    };
    setScrollState((current) =>
      current.overflow === next.overflow &&
      current.left === next.left &&
      current.right === next.right
        ? current
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    const revealActiveTab = (): void => {
      buttonsRef.current.get(activeSessionId)?.parentElement?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'instant',
      });
      updateScrollState();
    };
    revealActiveTab();
    const observer = new ResizeObserver(revealActiveTab);
    if (listRef.current) observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [activeSessionId, sessions.length, updateScrollState]);

  const scroll = (direction: -1 | 1): void => {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({
      left: direction * list.clientWidth * 0.75,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    session: SessionSummary,
    index: number,
  ): void => {
    if (event.key === 'F2') {
      event.preventDefault();
      onRename(session);
      return;
    }
    if (event.key === 'F10' && event.shiftKey) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onOpenMenu(session.id, rect.left, rect.bottom + 4);
      return;
    }
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % sessions.length,
      ArrowLeft: (index - 1 + sessions.length) % sessions.length,
      Home: 0,
      End: sessions.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    const nextSession = sessions[target];
    if (!nextSession) return;
    event.preventDefault();
    onSelect(nextSession.id);
    buttonsRef.current.get(nextSession.id)?.focus({ preventScroll: true });
  };

  return (
    <div className="session-tabs-viewport">
      {scrollState.overflow && (
        <button
          aria-label="向左滚动会话标签"
          className="session-tab-scroll"
          disabled={!scrollState.left}
          onClick={() => scroll(-1)}
          title="向左滚动会话标签"
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={14} />
        </button>
      )}
      <div
        aria-label="终端会话"
        className="session-tab-list"
        onScroll={updateScrollState}
        ref={listRef}
        role="tablist"
      >
        {sessions.map((session, index) => {
          const availability = getSessionAvailability(session);
          const active = session.id === activeSessionId;
          return (
            <div
              className={`session-tab ${active ? 'is-active' : ''}`}
              key={session.id}
              onContextMenu={(event) => {
                event.preventDefault();
                onOpenMenu(session.id, event.clientX, event.clientY);
              }}
            >
              <button
                aria-controls="active-terminal-panel"
                aria-label={`${session.title} ${session.terminalType}`}
                aria-selected={active}
                className="session-tab-select"
                onClick={() => onSelect(session.id)}
                onDoubleClick={() => onRename(session)}
                onKeyDown={(event) => handleKeyDown(event, session, index)}
                ref={(element) => {
                  if (element) buttonsRef.current.set(session.id, element);
                  else buttonsRef.current.delete(session.id);
                }}
                role="tab"
                tabIndex={active ? 0 : -1}
                title={`${session.title} · ${session.terminalType} · ${availability.label}`}
                type="button"
              >
                <span
                  aria-label={availability.label}
                  className={`session-status-dot is-${availability.tone}`}
                  title={availability.label}
                />
                <span className="session-tab-copy-block">
                  <span className="session-tab-title">{session.title}</span>
                  <span className="session-tab-type">{session.terminalType}</span>
                </span>
                {isExecuting(session.id) && (
                  <Radio
                    aria-label="外部执行中"
                    className="session-execution-indicator"
                    size={12}
                  />
                )}
              </button>
              <button
                aria-label={`关闭 ${session.title}`}
                className="session-tab-close"
                onClick={() => onClose(session)}
                tabIndex={active ? 0 : -1}
                title={`关闭 ${session.title}`}
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {scrollState.overflow && (
        <button
          aria-label="向右滚动会话标签"
          className="session-tab-scroll"
          disabled={!scrollState.right}
          onClick={() => scroll(1)}
          title="向右滚动会话标签"
          type="button"
        >
          <ChevronRight aria-hidden="true" size={14} />
        </button>
      )}
    </div>
  );
}
