/** Agent 实时时间线（自 app.tsx 拆分）：用户/助手/审批/命令卡片展示 */
import type { JSX } from 'react';
import { Check, Clock, Command, FileText, Play, XCircle } from 'lucide-react';

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
}: {
  events: AgentTimelineItem[];
  onApprove: (item: AgentTimelineItem) => Promise<void>;
  onInterrupt: (item: AgentTimelineItem) => Promise<void>;
  onTakeOver: (item?: AgentTimelineItem) => Promise<void>;
}): JSX.Element {
  if (events.length === 0) {
    return (
      <div className="text-[13px] text-muted-foreground">
        输入目标后，Agent 的实时操作会显示在这里。
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
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs py-1.5 rounded transition flex justify-center items-center gap-1.5 shadow-sm"
                    onClick={() => void onApprove(event)}
                    type="button"
                  >
                    <Check size={14} /> 批准执行
                  </button>
                  <button
                    className="flex-1 bg-secondary hover:bg-secondary/80 text-foreground font-medium text-xs py-1.5 rounded transition flex justify-center items-center gap-1.5 border border-border shadow-sm"
                    onClick={() => void onTakeOver(event)}
                    type="button"
                  >
                    <XCircle size={14} /> {event.driver === 'acp' ? '拒绝执行' : '拒绝并接管'}
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
    </div>
  );
}
