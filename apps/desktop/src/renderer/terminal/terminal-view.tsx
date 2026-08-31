import { useEffect, useRef, type JSX } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import type { SessionSummary, TerminalOutputEvent, ThemeState } from '../../shared/contracts.js';
import { buildXtermTheme } from '../theme/theme-palette.js';
import { prototypeTerminalMetrics, prototypeTerminalOptions } from './prototype-terminal.js';
import { containsTerminalClearSequence } from './terminal-output-state.js';

export interface TerminalViewApi {
  terminal: {
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, columns: number, rows: number): Promise<void>;
    onOutput(listener: (event: TerminalOutputEvent) => void): () => void;
  };
}

export function TerminalView({
  api,
  initialEvents = [],
  session,
  themeState,
}: {
  api: TerminalViewApi;
  initialEvents?: readonly TerminalOutputEvent[];
  session: SessionSummary;
  themeState: ThemeState;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const themeStateRef = useRef(themeState);
  themeStateRef.current = themeState;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const terminal = new Terminal({
      allowProposedApi: true,
      ...prototypeTerminalOptions,
      theme: buildXtermTheme(themeStateRef.current),
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(host);

    const writeTerminalData = (data: string): void => {
      if (containsTerminalClearSequence(data)) {
        terminal.clear();
        terminal.scrollToTop();
      }
      terminal.write(data);
    };
    let disposed = false;
    let lastSequence = 0;
    for (const event of [...initialEvents].sort((left, right) => left.sequence - right.sequence)) {
      if (event.sequence <= lastSequence) continue;
      writeTerminalData(event.data);
      lastSequence = event.sequence;
    }
    let fitFrame: number | undefined;
    const scheduleFit = (): void => {
      if (fitFrame !== undefined) window.cancelAnimationFrame(fitFrame);
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = undefined;
        if (disposed || host.clientWidth < 80 || host.clientHeight < 40) return;
        fit.fit();
      });
    };
    scheduleFit();

    const disposeOutput = api.terminal.onOutput((event) => {
      if (event.sessionId !== session.id || event.sequence <= lastSequence) return;
      lastSequence = event.sequence;
      writeTerminalData(event.data);
    });
    const input = terminal.onData((data) => {
      void api.terminal.write(session.id, data);
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      void api.terminal.resize(session.id, cols, rows);
    });
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(host);
    window.addEventListener('resize', scheduleFit);
    const searchHandler = (event: Event): void => {
      const query = (event as CustomEvent<string>).detail;
      if (query.length > 0) search.findNext(query, { incremental: true });
    };
    window.addEventListener('terminal-search', searchHandler);

    return () => {
      disposed = true;
      if (fitFrame !== undefined) window.cancelAnimationFrame(fitFrame);
      observer.disconnect();
      disposeOutput();
      input.dispose();
      resize.dispose();
      window.removeEventListener('resize', scheduleFit);
      window.removeEventListener('terminal-search', searchHandler);
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [api, initialEvents, session.id]);

  // Theme changes only repaint the existing terminal; the instance is never
  // recreated so scrollback and output are preserved.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal === null) return;
    terminal.options.theme = buildXtermTheme(themeState);
  }, [themeState]);

  return (
    <div
      className="terminal-host"
      aria-label={`${session.title} 终端`}
      style={{ padding: prototypeTerminalMetrics.padding }}
    >
      <div className="terminal-surface" ref={hostRef} />
    </div>
  );
}
