import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import synapseTermLogoUrl from '../assets/synapse-term-logo.svg';

export type SettingsTopic = 'provider' | 'model' | 'mcp' | 'acp' | 'audit';

export type SettingsTopicContent = Record<SettingsTopic, ReactNode>;

export interface SettingsTopicDefinition {
  id: SettingsTopic;
  label: string;
}

export interface SettingsTopicGroup {
  label: string;
  defaultTopic: SettingsTopic;
  topics: readonly SettingsTopicDefinition[];
}

export interface SettingsWorkspaceProps {
  activeTopic?: SettingsTopic;
  onTopicChange: (topic: SettingsTopic) => void;
  onBack: () => void;
  topicContent: SettingsTopicContent;
}

export const DEFAULT_SETTINGS_TOPIC: SettingsTopic = 'provider';

export const SETTINGS_TOPIC_GROUPS: readonly SettingsTopicGroup[] = [
  {
    label: '配置',
    defaultTopic: 'provider',
    topics: [
      { id: 'provider', label: '服务商配置' },
      { id: 'model', label: '模型配置' },
    ],
  },
  {
    label: '外部接入',
    defaultTopic: 'mcp',
    topics: [
      { id: 'mcp', label: 'MCP 服务' },
      { id: 'acp', label: 'ACP 集成' },
    ],
  },
  {
    label: '安全与诊断',
    defaultTopic: 'audit',
    topics: [{ id: 'audit', label: '审计日志' }],
  },
];

export function SettingsWorkspace({
  activeTopic = DEFAULT_SETTINGS_TOPIC,
  onTopicChange,
  onBack,
  topicContent,
}: SettingsWorkspaceProps): JSX.Element {
  return (
    <div
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-[#09090b]"
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
          className="h-7 w-7 shrink-0"
          height={28}
          src={synapseTermLogoUrl}
          width={28}
        />
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Synapse Term</p>
          <h1
            className="truncate text-lg font-semibold text-foreground"
            id="settings-workspace-title"
          >
            设置工作区
          </h1>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="设置导航"
          className="w-64 shrink-0 overflow-y-auto border-r border-border/50 px-5 py-5"
        >
          <div className="space-y-7">
            {SETTINGS_TOPIC_GROUPS.map((group) => {
              const groupSelected = group.topics.some((topic) => activeTopic === topic.id);

              return (
                <section key={group.label}>
                  <button
                    aria-current={groupSelected ? 'location' : undefined}
                    className={`group flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      groupSelected
                        ? 'bg-secondary/40 text-foreground'
                        : 'text-foreground/80 hover:bg-secondary/60 hover:text-foreground'
                    }`}
                    data-testid={`settings-group-${group.defaultTopic}`}
                    onClick={() => onTopicChange(group.defaultTopic)}
                    type="button"
                  >
                    <span>{group.label}</span>
                    <ChevronRight
                      aria-hidden="true"
                      className="text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      size={15}
                    />
                  </button>

                  <div className="ml-2 mt-2 space-y-1 border-l border-border/70 pl-8">
                    {group.topics.map((topic) => {
                      const selected = activeTopic === topic.id;
                      return (
                        <button
                          aria-current={selected ? 'page' : undefined}
                          className={`flex min-h-10 w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            selected
                              ? 'bg-secondary text-foreground shadow-sm'
                              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                          }`}
                          key={topic.id}
                          onClick={() => onTopicChange(topic.id)}
                          type="button"
                        >
                          {topic.label}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </nav>

        <main aria-labelledby="settings-workspace-title" className="min-w-0 flex-1 overflow-y-auto">
          <div className="min-h-full p-4 sm:p-6 lg:p-8" data-testid="settings-topic-content">
            {topicContent[activeTopic]}
          </div>
        </main>
      </div>
    </div>
  );
}
