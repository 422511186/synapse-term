/** Agent 实时时间线（自 app.tsx 拆分）：用户/助手/审批/命令卡片展示 */
import { useState, type JSX } from 'react';
import { Check, Clock, Command, FileText, Image as ImageIcon, Play, XCircle } from 'lucide-react';

import {
  groupAgentTimelineItems,
  isApprovalActionable,
  isTerminalTimelineStatus,
  MarkdownContent,
} from '@synapse-term/ui-platform';
import type { AgentTimelineItem } from '../../preload/preload-api.js';
import { timelineStatusLabel } from './timeline-utils.js';
import { ToolTimelineCard } from './tool-timeline-card.js';

export function RuntimeTimeline({
  events,
  onApprove,
  onInterrupt,
  onTakeOver,
  thinking = false,
}: {
  events: AgentTimelineItem[];
  onApprove: (item: AgentTimelineItem) => Promise<void>;
  onInterrupt: (item: AgentTimelineItem) => Promise<void>;
  onTakeOver: (item?: AgentTimelineItem) => Promise<void>;
  thinking?: boolean;
}): JSX.Element {
  const [approvingId, setApprovingId] = useState<string>();
  const [rejectingId, setRejectingId] = useState<string>();

  if (events.length === 0) {
    return (
      <div className="space-y-4">
        {thinking && <ThinkingBubble />}
        {!thinking && (
          <div className="text-[13px] text-muted-foreground">
            输入目标后，Agent 的实时操作会显示在这里。
          </div>
        )}
      </div>
    );
  }

  const groups = groupAgentTimelineItems(events);

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        if (group.kind === 'tool') {
          return (
            <ToolTimelineCard
              group={group}
              onInterrupt={onInterrupt}
              key={`tool-${group.toolCallId}`}
            />
          );
        }
        const event = group.event;
        if (event.kind === 'user') {
          return (
            <div className="flex gap-3" key={event.id}>
              <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center shrink-0 text-xs font-bold border border-border shadow-sm">
                ME
              </div>
              <div className="bg-secondary/40 border border-border/50 px-4 py-3 rounded-xl rounded-tl-sm text-[13px] text-foreground/90 leading-relaxed shadow-sm">
                {event.text}
                {event.attachments?.map((attachment) => (
                  <div
                    className="mt-2 flex items-center gap-2 rounded-lg border border-border/60 bg-[#121214] px-3 py-2 text-[11px]"
                    key={attachment.id}
                  >
                    {attachment.kind === 'image' ? (
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-12 h-12 shrink-0 rounded-md bg-secondary/80 border border-border/70 flex items-center justify-center text-primary">
                          <ImageIcon size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground/90">
                            {attachment.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {attachment.mimeType} · {formatAttachmentSize(attachment.sizeBytes)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={15} className="shrink-0 text-primary" />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground/90">
                            {attachment.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {attachment.mimeType} · {formatAttachmentSize(attachment.sizeBytes)}
                            {attachment.relativePath !== undefined &&
                              ` · ${attachment.relativePath}`}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (event.kind === 'assistant') {
          return (
            <div className="flex gap-3" key={event.id}>
              <div className="w-8 h-8 rounded bg-white text-black flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(255,255,255,0.15)]">
                <Command size={16} strokeWidth={2.5} />
              </div>
              <div className="flex-1 min-w-0 text-[13px] leading-relaxed text-foreground/90">
                <MarkdownContent>{event.text}</MarkdownContent>
              </div>
            </div>
          );
        }

        if (event.kind === 'approval') {
          const waiting = isApprovalActionable(event.status, undefined);
          const succeeded = event.status === 'completed';
          return (
            <div
              className={`rounded-lg overflow-hidden shadow-sm ${waiting ? 'border border-amber-500/50 bg-amber-500/5' : succeeded ? 'border border-border/50 bg-[#121214]' : 'border border-red-500/30 bg-[#121214]'}`}
              key={event.id}
            >
              <div
                className={`px-3 py-2.5 flex items-center justify-between ${waiting ? 'bg-amber-500/10 border-b border-amber-500/20' : succeeded ? 'bg-secondary/10 border-b border-border/50' : 'bg-red-500/5'}`}
              >
                <div
                  className={`flex items-center gap-2 text-xs font-mono ${waiting ? 'text-amber-500 font-medium' : succeeded ? 'text-muted-foreground' : 'text-red-400'}`}
                >
                  <FileText size={14} /> {event.text}
                </div>
                <span
                  className={`text-[10px] flex items-center gap-1 font-medium ${waiting ? 'text-amber-500' : succeeded ? 'text-emerald-500' : 'text-red-500'}`}
                >
                  {waiting ? (
                    <Clock size={12} />
                  ) : succeeded ? (
                    <Check size={12} />
                  ) : (
                    <XCircle size={12} />
                  )}
                  {waiting
                    ? '需要人工审批'
                    : succeeded
                      ? '已完成'
                      : event.status === 'cancelled'
                        ? '已拒绝'
                        : '已接管'}
                </span>
              </div>
              <div className="p-3 text-[11px] font-mono text-white/50 break-all bg-[#000000] leading-relaxed">
                {event.change?.path ?? event.reasons?.join('；') ?? '该操作将改变运行时状态。'}
              </div>
              {waiting && (
                <div className="px-3 py-2.5 border-t border-amber-500/20 bg-amber-500/5 flex gap-2">
                  <button
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs py-1.5 rounded transition flex justify-center items-center gap-1.5 shadow-sm disabled:opacity-40"
                    disabled={approvingId === event.id || rejectingId === event.id}
                    onClick={() => {
                      setApprovingId(event.id);
                      void onApprove(event).finally(() => setApprovingId(undefined));
                    }}
                    type="button"
                  >
                    <Check size={14} /> {approvingId === event.id ? '批准中…' : '批准执行'}
                  </button>
                  <button
                    className="flex-1 bg-secondary hover:bg-secondary/80 text-foreground font-medium text-xs py-1.5 rounded transition flex justify-center items-center gap-1.5 border border-border shadow-sm disabled:opacity-40"
                    disabled={approvingId === event.id || rejectingId === event.id}
                    onClick={() => {
                      setRejectingId(event.id);
                      void onTakeOver(event).finally(() => setRejectingId(undefined));
                    }}
                    type="button"
                  >
                    <XCircle size={14} />{' '}
                    {rejectingId === event.id
                      ? '拒绝中…'
                      : event.driver === 'acp'
                        ? '拒绝执行'
                        : '拒绝并接管'}
                  </button>
                </div>
              )}
            </div>
          );
        }

        return (
          <div
            className="border border-border/50 rounded-lg bg-[#121214] overflow-hidden shadow-sm"
            key={event.id}
          >
            <div className="px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <Play size={12} className="text-primary shrink-0" />
                <span className="truncate">{event.text}</span>
              </div>
              <span
                className={`shrink-0 text-[10px] flex items-center gap-1 font-medium ${event.status === 'completed' ? 'text-emerald-500' : isTerminalTimelineStatus(event.status) ? 'text-red-400' : 'text-amber-500'}`}
              >
                {event.status === 'completed' ? (
                  <Check size={12} />
                ) : isTerminalTimelineStatus(event.status) ? (
                  <XCircle size={12} />
                ) : (
                  <Clock size={12} />
                )}
                {timelineStatusLabel(event.status)}
              </span>
            </div>
          </div>
        );
      })}
      {thinking && <ThinkingBubble />}
    </div>
  );
}

function ThinkingBubble(): JSX.Element {
  return (
    <div className="thinking-placeholder flex gap-3">
      <div className="w-8 h-8 rounded bg-white text-black flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(255,255,255,0.15)]">
        <Command size={16} strokeWidth={2.5} />
      </div>
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
          <span
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
            style={{ animationDelay: '300ms' }}
          />
        </span>
        思考中…
      </div>
    </div>
  );
}

function formatAttachmentSize(sizeBytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = sizeBytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Math.round(value * 10) / 10} ${units[unit]}`;
}
