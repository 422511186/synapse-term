import { ArrowLeft } from 'lucide-react';
import type { JSX } from 'react';

import synapseTermLogoUrl from '../assets/synapse-term-logo.svg';

export function SettingsWorkspace({ onBack }: { onBack: () => void }): JSX.Element {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return (
    <div
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-[#09090b]"
      data-desktop-platform={isMac ? 'darwin' : undefined}
      data-testid="settings-workspace"
    >
      <header className="flex min-w-0 shrink-0 items-center gap-3 border-b border-border/50 px-4 py-4 sm:gap-4 sm:px-6">
        <button
          aria-label="返回工作区"
          className="flex min-h-9 shrink-0 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          返回工作区
        </button>
        <img
          alt="Synapse Term logo"
          className="h-9 w-9 shrink-0"
          height={36}
          src={synapseTermLogoUrl}
          width={36}
        />
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Synapse Term</p>
          <h1 className="truncate text-lg font-semibold text-foreground">设置工作区</h1>
        </div>
      </header>

      <main
        aria-labelledby="settings-workspace-title"
        className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-6"
      >
        <div
          className="rounded-xl border border-border/60 bg-secondary/20 px-8 py-10 text-center text-sm text-muted-foreground"
          data-testid="settings-topic-content"
        >
          暂无设置项
        </div>
      </main>
    </div>
  );
}
