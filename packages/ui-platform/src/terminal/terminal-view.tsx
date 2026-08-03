import { useEffect, useRef, type JSX } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import type { SessionSummary, TerminalOutputEvent, TerminalViewApi } from '../contracts.js';
import { prototypeTerminalMetrics, prototypeTerminalOptions } from './prototype-terminal.js';
import { reconcileTerminalReplayPages } from './terminal-stream.js';
import { containsTerminalClearSequence } from './terminal-output-state.js';

export function TerminalView({
  api,
  session,
}: {
  api: TerminalViewApi;
  session: SessionSummary;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const terminal = new Terminal({
      allowProposedApi: true,
      ...prototypeTerminalOptions,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(host);
    const writeTerminalData = (data: string, callback?: () => void): void => {
      if (containsTerminalClearSequence(data)) {
        terminal.clear();
        terminal.scrollToTop();
      }
      terminal.write(data, callback);
    };
    let disposed = false;
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
    let replaying = false;
    let lastSequence = 0;
    const pending: TerminalOutputEvent[] = [];

    const recover = async (): Promise<void> => {
      if (replaying || disposed) return;
      replaying = true;
      try {
        const replays = [];
        let cursor = lastSequence;
        while (true) {
          const replay = await api.terminal.replay(session.id, cursor);
          replays.push(replay);
          if (replay.hasMore !== true) break;
          cursor = replay.nextAfterSequence ?? Math.max(0, replay.nextSequence - 1);
        }
        if (disposed) return;
        const reconciled = reconcileTerminalReplayPages(replays, pending.splice(0));
        if (replays.some((replay) => replay.snapshot !== undefined)) terminal.reset();
        const replayData = reconciled.chunks.join('');
        if (replayData.length > 0) {
          await new Promise<void>((resolve) => writeTerminalData(replayData, resolve));
        }
        if (disposed) return;
        lastSequence = reconciled.lastSequence;
      } catch (error) {
        if (!disposed) {
          writeTerminalData(
            `\r\n[Core replay failed: ${error instanceof Error ? error.message : String(error)}]\r\n`,
          );
        }
      } finally {
        replaying = false;
        if (!disposed && pending.some((event) => event.sequence > lastSequence)) {
          void recover();
        }
      }
    };

    const disposeOutput = api.terminal.onOutput((event) => {
      if (event.sessionId !== session.id || event.sequence <= lastSequence) return;
      if (replaying || event.sequence > lastSequence + 1) {
        pending.push(event);
        void recover();
        return;
      }
      writeTerminalData(event.data);
      lastSequence = event.sequence;
    });
    void recover();
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
    window.addEventListener('terminal-agent-search', searchHandler);

    return () => {
      disposed = true;
      if (fitFrame !== undefined) window.cancelAnimationFrame(fitFrame);
      observer.disconnect();
      disposeOutput();
      input.dispose();
      resize.dispose();
      window.removeEventListener('resize', scheduleFit);
      window.removeEventListener('terminal-agent-search', searchHandler);
      terminal.dispose();
    };
  }, [api, session.id, session.title]);

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
