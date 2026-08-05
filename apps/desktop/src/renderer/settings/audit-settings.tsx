import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';

import { auditTypeZh, errorMessageZh } from '@synapse-term/ui-platform';
import type {
  AuditCategory,
  AuditListRequest,
  AuditOutcome,
  AuditRetentionResponse,
  AuditRisk,
  AuditTraceDetailView,
  AuditTraceEventView,
  AuditTraceView,
  DesktopApi,
  SessionSummary,
} from '../../preload/preload-api.js';
import { ConfirmDialog } from '../feedback/index.js';

const LOOKBACK_DAYS = 7;
const PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 5_000;

export interface AuditFilterState {
  from: string;
  to: string;
  sessionId: string;
  actor: string;
  category: AuditCategory | '';
  outcome: AuditOutcome | '';
  risk: AuditRisk | '';
  search: string;
  includeObservations: boolean;
}

type AuditFilterTagKey =
  | 'dateRange'
  | 'sessionId'
  | 'actor'
  | 'category'
  | 'outcome'
  | 'risk'
  | 'search'
  | 'includeObservations';

interface AuditFilterTag {
  key: AuditFilterTagKey;
  label: string;
}

const DEFAULT_RETENTION: AuditRetentionResponse = {
  auditRetentionDays: 30,
  rawLogRetentionHours: 24,
};

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  command: '命令',
  approval: '审批',
  file: '文件',
  session: '会话',
  configuration: '配置',
  external: '外部调用',
  observation: '观察',
};

export const AUDIT_OUTCOME_LABELS: Record<AuditOutcome, string> = {
  in_progress: '进行中',
  success: '成功',
  failure: '失败',
  rejected: '已拒绝',
  interrupted: '已中断',
  information: '信息',
};

export const AUDIT_RISK_LABELS: Record<AuditRisk, string> = {
  read_only: '只读',
  unknown: '未知',
  mutating: '修改',
  privileged: '特权',
  destructive: '破坏性',
};

export function createDefaultAuditFilters(now = new Date()): AuditFilterState {
  return {
    from: toDateInput(new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1_000)),
    to: toDateInput(now),
    sessionId: '',
    actor: '',
    category: '',
    outcome: '',
    risk: '',
    search: '',
    includeObservations: false,
  };
}

export function buildAuditListRequest(
  filters: AuditFilterState,
  now = new Date(),
  cursor?: string,
): AuditListRequest {
  const request: AuditListRequest = {
    from:
      dateInputToIso(filters.from, false) ??
      new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1_000).toISOString(),
    to: dateInputToIso(filters.to, true) ?? now.toISOString(),
    includeObservations: filters.includeObservations,
    limit: PAGE_SIZE,
  };
  if (filters.sessionId.length > 0) request.sessionId = filters.sessionId;
  if (filters.actor.trim().length > 0) request.actor = filters.actor.trim();
  if (filters.category !== '') request.category = filters.category;
  if (filters.outcome !== '') request.outcome = filters.outcome;
  if (filters.risk !== '') request.risk = filters.risk;
  if (filters.search.trim().length > 0) request.search = filters.search.trim();
  if (cursor !== undefined) request.cursor = cursor;
  return request;
}

export function buildCleanupDescription(
  retention: AuditRetentionResponse,
  now = new Date(),
): string {
  const auditCutoff = new Date(now.getTime() - retention.auditRetentionDays * 24 * 60 * 60 * 1_000);
  const rawLogCutoff = new Date(now.getTime() - retention.rawLogRetentionHours * 60 * 60 * 1_000);
  return `清理范围：结构化审计截至 ${formatAuditTime(auditCutoff.toISOString())}，原始终端日志截至 ${formatAuditTime(rawLogCutoff.toISOString())}。只清理已过期数据，不删除未过期记录，也不按当前筛选删除。`;
}

export function hasActiveAuditFilters(filters: AuditFilterState, now = new Date()): boolean {
  return getActiveAuditFilterTags(filters, now).length > 0;
}

export class AuditRequestTracker {
  #latestRequestId = 0;

  begin(): number {
    this.#latestRequestId += 1;
    return this.#latestRequestId;
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.#latestRequestId;
  }
}

function toDateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateInputToIso(value: string, endOfDay: boolean): string | undefined {
  if (value.length === 0) return undefined;
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function formatAuditTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function actorLabel(actor: AuditTraceView['actor']): string {
  switch (actor.kind) {
    case 'agent':
      return `Agent Task · ${actor.taskId}`;
    case 'external':
      return `${actor.callerKind?.toUpperCase() ?? '外部'} · ${actor.callerId ?? '未知调用方'}`;
    case 'system':
      return '系统';
    case 'user':
      return '用户';
  }
}

function subjectLabel(subject: AuditTraceView['subject']): string {
  switch (subject) {
    case 'agent_task':
      return 'Agent Task';
    case 'external_transaction':
      return '外部 transaction';
    case 'event':
      return '独立事件';
  }
}

function outcomeClass(outcome: AuditOutcome): string {
  switch (outcome) {
    case 'success':
      return 'text-emerald-400';
    case 'failure':
    case 'rejected':
      return 'text-red-400';
    case 'interrupted':
      return 'text-amber-400';
    case 'in_progress':
      return 'text-blue-400';
    case 'information':
      return 'text-muted-foreground';
  }
}

function commandFromTraceSummary(summary: string): string | undefined {
  const prefix = '命令：';
  return summary.startsWith(prefix) ? summary.slice(prefix.length) : undefined;
}

function isTechnicalAuditType(value: string): boolean {
  return /^(?:session|task|command|approval|external|provider|model|configuration|file|tool)\.[a-z0-9_.-]+$/i.test(
    value,
  );
}

function pathFromTraceSummary(summary: string): string | undefined {
  const prefix = '路径：';
  return summary.startsWith(prefix) ? summary.slice(prefix.length) : undefined;
}

function traceObjectLabel(summary: string): string {
  return (
    commandFromTraceSummary(summary) ??
    pathFromTraceSummary(summary) ??
    (isTechnicalAuditType(summary) ? '事件摘要不可用' : summary)
  );
}

function operationLabel(item: AuditTraceView): string {
  return `${AUDIT_CATEGORY_LABELS[item.category]} · ${subjectLabel(item.subject)}`;
}

function auditEventLabel(event: AuditTraceEventView): string {
  const localized = auditTypeZh(event.type);
  if (localized !== event.type) return localized;
  if (event.type === 'session.renamed') return '更新终端会话名称';
  return `${AUDIT_CATEGORY_LABELS[event.category]}操作`;
}

function isDefaultAuditWindow(filters: AuditFilterState, now: Date): boolean {
  const defaults = createDefaultAuditFilters(now);
  return filters.from === defaults.from && filters.to === defaults.to;
}

function getActiveAuditFilterTags(filters: AuditFilterState, now: Date): AuditFilterTag[] {
  const tags: AuditFilterTag[] = [];
  if (!isDefaultAuditWindow(filters, now)) {
    tags.push({
      key: 'dateRange',
      label: `${filters.from || '不限开始'} 至 ${filters.to || '不限结束'}`,
    });
  }
  if (filters.sessionId !== '')
    tags.push({ key: 'sessionId', label: `Session：${filters.sessionId}` });
  if (filters.actor.trim() !== '')
    tags.push({ key: 'actor', label: `发起者：${filters.actor.trim()}` });
  if (filters.category !== '') {
    tags.push({ key: 'category', label: `类别：${AUDIT_CATEGORY_LABELS[filters.category]}` });
  }
  if (filters.outcome !== '') {
    tags.push({ key: 'outcome', label: `结果：${AUDIT_OUTCOME_LABELS[filters.outcome]}` });
  }
  if (filters.risk !== '')
    tags.push({ key: 'risk', label: `风险：${AUDIT_RISK_LABELS[filters.risk]}` });
  if (filters.search.trim() !== '')
    tags.push({ key: 'search', label: `搜索：${filters.search.trim()}` });
  if (filters.includeObservations) tags.push({ key: 'includeObservations', label: '包含成功观察' });
  return tags;
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}): JSX.Element | null {
  if (value === undefined || value === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-xs text-foreground/90">{value}</dd>
    </div>
  );
}

function EvidenceBlock({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}): JSX.Element | null {
  if (value === undefined || value === '') return null;
  return (
    <div
      className="rounded-md border border-border/50 bg-background px-3 py-2.5"
      style={{ gridColumn: '1 / -1' }}
    >
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className="mt-1 max-h-48 overflow-auto break-words font-mono text-xs text-foreground/90"
        style={{ lineHeight: '1.25rem', whiteSpace: 'pre-wrap' }}
      >
        {value}
      </dd>
    </div>
  );
}

interface AuditModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

function AuditModal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: AuditModalProps): JSX.Element | null {
  if (!open) return null;
  const modal = (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div
        className={`flex h-[88vh] max-h-[900px] w-full flex-col overflow-hidden rounded-xl border border-border bg-[#18181b] shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-xl'}`}
        style={{ height: '88vh', maxHeight: '900px' }}
      >
        <div className="flex items-center justify-between border-b border-border/60 bg-[#09090b] px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            aria-label={`关闭${title}`}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer !== undefined && (
          <div className="flex justify-end gap-2 border-t border-border bg-[#09090b] px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}

function AuditEvent({ event }: { event: AuditTraceEventView }): JSX.Element {
  const details = event.details ?? [];
  const displaySummary = isTechnicalAuditType(event.summary) ? undefined : event.summary;
  const hasDistinctSummary =
    displaySummary !== undefined &&
    displaySummary !== event.commandPreview &&
    displaySummary !== event.pathPreview;
  return (
    <li
      className="rounded-md border border-border/60 bg-background/30 px-3 py-3"
      data-testid={`audit-event:${event.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
          <span className="font-medium text-foreground/90">{auditEventLabel(event)}</span>
          <span className={outcomeClass(event.outcome)}>{AUDIT_OUTCOME_LABELS[event.outcome]}</span>
        </div>
        <time
          className="shrink-0 font-mono text-[11px] text-muted-foreground"
          dateTime={event.occurredAt}
        >
          {formatAuditTime(event.occurredAt)}
        </time>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <EvidenceBlock label="执行命令" value={event.commandPreview} />
        <EvidenceBlock label="影响路径" value={event.pathPreview} />
        <EvidenceBlock label="原因" value={event.reason} />
        <DetailField label="执行结果" value={AUDIT_OUTCOME_LABELS[event.outcome]} />
        <DetailField label="主体" value={actorLabel(event.actor)} />
        <DetailField label="风险" value={AUDIT_RISK_LABELS[event.risk]} />
        <DetailField label="Session" value={event.sessionId} />
        <DetailField label="Task" value={event.taskId} />
        <DetailField label="transaction" value={event.transactionId} />
        <DetailField label="授权" value={event.authorization} />
        <DetailField label="策略" value={event.policy} />
        <DetailField label="审批" value={event.approval} />
        <DetailField label="退出码" value={event.exitCode} />
        <DetailField label="命令 hash" value={event.commandHash} />
        {details.map((detail) => (
          <DetailField key={`${detail.label}:${detail.value}`} {...detail} />
        ))}
      </dl>

      {hasDistinctSummary && (
        <p className="mt-3 border-t border-border/60 pt-3 text-xs leading-5 text-foreground/80">
          <span className="mr-2 text-muted-foreground">事件摘要</span>
          {displaySummary}
        </p>
      )}
    </li>
  );
}

export function AuditTraceEvidence({
  detail,
  loading,
  error,
  onClose = () => undefined,
}: {
  detail: AuditTraceDetailView | undefined;
  loading: boolean;
  error: string | undefined;
  onClose?: () => void;
}): JSX.Element {
  let content: JSX.Element;
  if (loading) {
    content = (
      <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="mr-2 animate-spin" size={15} /> 正在读取事件证据
      </div>
    );
  } else if (error !== undefined) {
    content = (
      <div className="text-sm text-red-300" role="alert">
        {error}
      </div>
    );
  } else if (detail === undefined) {
    content = <div className="text-sm text-muted-foreground">暂无可用的事件证据</div>;
  } else {
    const displaySummary = isTechnicalAuditType(detail.summary)
      ? `${AUDIT_CATEGORY_LABELS[detail.category]}操作`
      : detail.summary;
    const visibleEventCount =
      detail.events.length < detail.eventCount
        ? `${detail.eventCount}（展示最近 ${detail.events.length}）`
        : detail.eventCount;
    content = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words text-sm text-foreground/90">{displaySummary}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {AUDIT_CATEGORY_LABELS[detail.category]} · {subjectLabel(detail.subject)}
            </p>
          </div>
          <span className={`text-xs font-medium ${outcomeClass(detail.outcome)}`}>
            {AUDIT_OUTCOME_LABELS[detail.outcome]}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-3 border-y border-border/50 py-3">
          <DetailField label="开始时间" value={formatAuditTime(detail.startedAt)} />
          <DetailField label="最后活动" value={formatAuditTime(detail.lastActivityAt)} />
          <DetailField label="发起者" value={actorLabel(detail.actor)} />
          <DetailField label="操作" value={AUDIT_CATEGORY_LABELS[detail.category]} />
          <DetailField label="Session" value={detail.sessionId} />
          <DetailField label="Task" value={detail.taskId} />
          <DetailField label="transaction" value={detail.transactionId} />
          <DetailField label="风险" value={AUDIT_RISK_LABELS[detail.risk]} />
          <DetailField label="事件数量" value={visibleEventCount} />
        </dl>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium text-muted-foreground">执行与审批证据</h3>
            <span className="text-[11px] text-muted-foreground">命令、路径和原因已脱敏</span>
          </div>
          <ol className="space-y-3">
            {detail.events.map((event) => (
              <AuditEvent event={event} key={event.id} />
            ))}
          </ol>
        </div>

        <details className="rounded-md border border-border/60 bg-background/20 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            技术信息
          </summary>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DetailField label="Trace ID" value={detail.traceId} />
            <DetailField
              label="原始事件类型"
              value={detail.events.map((event) => event.type).join('、')}
            />
            <DetailField label="命令 hash" value={detail.events.at(-1)?.commandHash} />
          </dl>
        </details>
      </div>
    );
  }

  return (
    <AuditModal onClose={onClose} open title="审计记录详情" wide>
      {content}
    </AuditModal>
  );
}

export interface AuditTraceTableProps {
  items: readonly AuditTraceView[];
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onSelect: (trace: AuditTraceView) => void;
}

export function AuditTraceTable({
  items,
  page,
  hasPreviousPage,
  hasNextPage,
  onPreviousPage,
  onNextPage,
  onSelect,
}: AuditTraceTableProps): JSX.Element {
  return (
    <>
      {items.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center border border-border/60 text-sm text-muted-foreground">
          当前筛选范围没有 Audit Trace
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/60">
          <table
            aria-label="审计记录表格"
            className="w-full min-w-[960px] border-collapse text-left"
          >
            <thead className="bg-secondary/30 text-[11px] font-medium text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-3 py-3">时间</th>
                <th className="whitespace-nowrap px-3 py-3">操作</th>
                <th className="min-w-64 px-3 py-3">对象 / 命令</th>
                <th className="whitespace-nowrap px-3 py-3">Session</th>
                <th className="whitespace-nowrap px-3 py-3">发起者</th>
                <th className="whitespace-nowrap px-3 py-3">结果</th>
                <th className="whitespace-nowrap px-3 py-3">风险</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-xs">
              {items.map((item) => (
                <tr
                  aria-label={`${operationLabel(item)} · ${traceObjectLabel(item.summary)}`}
                  className="cursor-pointer align-top transition-colors hover:bg-secondary/40 focus-within:bg-secondary/40 focus:bg-secondary/40"
                  data-testid="audit-trace-row"
                  key={item.traceId}
                  onClick={() => onSelect(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(item);
                    }
                  }}
                  tabIndex={0}
                >
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] text-muted-foreground">
                    <time dateTime={item.lastActivityAt}>
                      {formatAuditTime(item.lastActivityAt)}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="font-medium text-foreground/90">
                      {AUDIT_CATEGORY_LABELS[item.category]}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {subjectLabel(item.subject)}
                    </div>
                  </td>
                  <td className="max-w-[360px] px-3 py-3">
                    {commandFromTraceSummary(item.summary) !== undefined ? (
                      <code className="block break-words font-mono text-xs text-foreground/95">
                        {commandFromTraceSummary(item.summary)}
                      </code>
                    ) : (
                      <span className="block break-words text-foreground/90">
                        {traceObjectLabel(item.summary)}
                      </span>
                    )}
                    {item.eventCount > 1 && (
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {item.eventCount} 个关联事件
                      </span>
                    )}
                  </td>
                  <td className="max-w-40 break-words px-3 py-3 text-muted-foreground">
                    {item.sessionId ?? '—'}
                  </td>
                  <td className="max-w-44 break-words px-3 py-3 text-muted-foreground">
                    {actorLabel(item.actor)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-3 font-medium ${outcomeClass(item.outcome)}`}
                  >
                    {AUDIT_OUTCOME_LABELS[item.outcome]}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                    {AUDIT_RISK_LABELS[item.risk]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          第 {page} 页 · 每页 {PAGE_SIZE} 条
        </span>
        <div className="flex items-center gap-2">
          <button
            aria-label="审计上一页"
            className="flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!hasPreviousPage}
            onClick={onPreviousPage}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={14} /> 上一页
          </button>
          <button
            aria-label="审计下一页"
            className="flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!hasNextPage}
            onClick={onNextPage}
            type="button"
          >
            下一页 <ChevronRight aria-hidden="true" size={14} />
          </button>
        </div>
      </div>
    </>
  );
}

export interface AuditFilterDialogProps {
  open: boolean;
  filters: AuditFilterState;
  sessions: readonly SessionSummary[];
  onClose: () => void;
  onApply: (filters: AuditFilterState) => void;
}

export function AuditFilterDialog({
  open,
  filters,
  sessions,
  onClose,
  onApply,
}: AuditFilterDialogProps): JSX.Element | null {
  const [draft, setDraft] = useState(filters);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [filters, open]);

  if (!open) return null;

  const updateDraft = <Key extends keyof AuditFilterState>(
    key: Key,
    value: AuditFilterState[Key],
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <AuditModal
      footer={
        <>
          <button
            className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-white/90"
            onClick={() => onApply(draft)}
            type="button"
          >
            应用筛选
          </button>
        </>
      }
      onClose={onClose}
      open
      title="高级筛选"
    >
      <p className="mb-4 text-xs leading-5 text-muted-foreground">
        主搜索栏用于命令、对象、Session 和原因关键词；这里设置结构化条件。
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          <span className="mb-1.5 block">Session</span>
          <span className="relative block">
            <select
              aria-label="高级筛选 Session"
              className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground outline-none focus:border-primary"
              onChange={(event) => updateDraft('sessionId', event.target.value)}
              value={draft.sessionId}
            >
              <option value="">全部 Session</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title} · {session.id}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={15}
            />
          </span>
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="mb-1.5 block">发起者</span>
          <input
            aria-label="高级筛选发起者"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            onChange={(event) => updateDraft('actor', event.target.value)}
            placeholder="Agent、MCP caller ID..."
            type="search"
            value={draft.actor}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="mb-1.5 block">操作类别</span>
          <select
            aria-label="高级筛选操作类别"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            onChange={(event) => updateDraft('category', event.target.value as AuditCategory | '')}
            value={draft.category}
          >
            <option value="">全部类别</option>
            {Object.entries(AUDIT_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="mb-1.5 block">结果</span>
          <select
            aria-label="高级筛选结果"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            onChange={(event) => updateDraft('outcome', event.target.value as AuditOutcome | '')}
            value={draft.outcome}
          >
            <option value="">全部结果</option>
            {Object.entries(AUDIT_OUTCOME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="mb-1.5 block">风险等级</span>
          <select
            aria-label="高级筛选风险等级"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            onChange={(event) => updateDraft('risk', event.target.value as AuditRisk | '')}
            value={draft.risk}
          >
            <option value="">全部风险</option>
            {Object.entries(AUDIT_RISK_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="mb-1.5 block">开始日期</span>
          <input
            aria-label="高级筛选开始日期"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            onChange={(event) => updateDraft('from', event.target.value)}
            type="date"
            value={draft.from}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="mb-1.5 block">结束日期</span>
          <input
            aria-label="高级筛选结束日期"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            onChange={(event) => updateDraft('to', event.target.value)}
            type="date"
            value={draft.to}
          />
        </label>
      </div>
      <label className="mt-5 flex w-fit items-center gap-2 text-xs text-muted-foreground">
        <input
          checked={draft.includeObservations}
          onChange={(event) => updateDraft('includeObservations', event.target.checked)}
          type="checkbox"
        />
        包含成功观察
      </label>
    </AuditModal>
  );
}

export interface AuditRetentionDialogProps {
  open: boolean;
  retention: AuditRetentionResponse;
  retentionLoading: boolean;
  retentionError: string | undefined;
  cleanupError: string | undefined;
  cleanupResult: { rawLogs: number; auditEvents: number } | undefined;
  cleanupBusy?: boolean;
  onClose: () => void;
  onCleanup: () => void;
}

export function AuditRetentionDialog({
  open,
  retention,
  retentionLoading,
  retentionError,
  cleanupError,
  cleanupResult,
  cleanupBusy = false,
  onClose,
  onCleanup,
}: AuditRetentionDialogProps): JSX.Element | null {
  return (
    <AuditModal
      footer={
        <button
          className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
          onClick={onClose}
          type="button"
        >
          关闭
        </button>
      }
      onClose={onClose}
      open={open}
      title="审计保留策略"
    >
      <div className="space-y-4">
        <p className="text-xs leading-5 text-muted-foreground">
          保留策略由运行时维护。这里只能清理已过期数据，不支持按筛选删除、全量清空或修改保留期限。
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border/60 bg-background/30 px-3 py-3">
            <div className="text-xs text-muted-foreground">结构化审计</div>
            <div className="mt-1 text-sm font-medium">
              {retentionLoading ? '读取中…' : `${retention.auditRetentionDays} 天`}
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-background/30 px-3 py-3">
            <div className="text-xs text-muted-foreground">原始终端日志</div>
            <div className="mt-1 text-sm font-medium">
              {retentionLoading ? '读取中…' : `${retention.rawLogRetentionHours} 小时`}
            </div>
          </div>
        </div>
        {retentionError !== undefined && <p className="text-xs text-red-300">{retentionError}</p>}
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3">
          <p className="text-xs leading-5 text-amber-200/90">
            清理只根据上述保留期限执行，当前列表筛选不会扩大或缩小清理范围。
          </p>
          <button
            className="mt-3 flex items-center gap-2 rounded-md border border-red-500/40 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={cleanupBusy || retentionLoading}
            onClick={onCleanup}
            type="button"
          >
            <ShieldAlert aria-hidden="true" size={14} /> 清理已过期数据
          </button>
        </div>
        {cleanupError !== undefined && <p className="text-xs text-red-300">{cleanupError}</p>}
        {cleanupResult !== undefined && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-300" role="status">
            <Check aria-hidden="true" size={13} /> 已清理原始日志 {cleanupResult.rawLogs}{' '}
            条，审计事件 {cleanupResult.auditEvents} 条
          </p>
        )}
      </div>
    </AuditModal>
  );
}

export interface AuditSettingsProps {
  api: DesktopApi;
  sessions?: readonly SessionSummary[];
}

export function AuditSettings({ api, sessions = [] }: AuditSettingsProps): JSX.Element {
  const [filters, setFilters] = useState<AuditFilterState>(() => createDefaultAuditFilters());
  const [items, setItems] = useState<AuditTraceView[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [page, setPage] = useState(1);
  const [pageCursors, setPageCursors] = useState<(string | undefined)[]>([undefined]);
  const [selectedTraceId, setSelectedTraceId] = useState<string>();
  const [selectedDetail, setSelectedDetail] = useState<AuditTraceDetailView>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const [retention, setRetention] = useState<AuditRetentionResponse>(DEFAULT_RETENTION);
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [retentionError, setRetentionError] = useState<string>();
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [retentionDialogOpen, setRetentionDialogOpen] = useState(false);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupError, setCleanupError] = useState<string>();
  const [cleanupResult, setCleanupResult] = useState<{ rawLogs: number; auditEvents: number }>();
  const listRequestTracker = useRef(new AuditRequestTracker());

  const pageCursor = pageCursors[page - 1];
  const listRequest = useMemo(
    () => buildAuditListRequest(filters, new Date(), pageCursor),
    [filters, pageCursor],
  );
  const activeFilterTags = useMemo(() => getActiveAuditFilterTags(filters, new Date()), [filters]);
  const quickRange = useMemo(() => {
    const now = new Date();
    if (isDefaultAuditWindow(filters, now)) return '最近 7 天';
    const thirtyDayFilters = createDefaultAuditFilters(now);
    thirtyDayFilters.from = toDateInput(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000));
    if (filters.from === thirtyDayFilters.from && filters.to === thirtyDayFilters.to) {
      return '最近 30 天';
    }
    return '自定义时间';
  }, [filters]);

  const resetPagination = useCallback((): void => {
    setPage(1);
    setPageCursors([undefined]);
    setSelectedTraceId(undefined);
  }, []);

  const loadFirstPage = useCallback(
    async (silent = false): Promise<void> => {
      const requestId = listRequestTracker.current.begin();
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(undefined);
      try {
        const response = await api.audit.list(listRequest);
        if (!listRequestTracker.current.isCurrent(requestId)) return;
        setItems(response.items);
        setNextCursor(response.nextCursor);
      } catch (caught) {
        if (listRequestTracker.current.isCurrent(requestId)) setError(errorMessageZh(caught));
      } finally {
        if (listRequestTracker.current.isCurrent(requestId)) {
          if (silent) setRefreshing(false);
          else setLoading(false);
        }
      }
    },
    [api, listRequest],
  );

  useEffect(() => {
    void loadFirstPage();
    const timer = globalThis.setInterval(() => {
      void loadFirstPage(true);
    }, POLL_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [loadFirstPage]);

  useEffect(() => {
    let disposed = false;
    setRetentionLoading(true);
    setRetentionError(undefined);
    void api.audit
      .retention()
      .then((response) => {
        if (!disposed) setRetention(response);
      })
      .catch((caught: unknown) => {
        if (!disposed) setRetentionError(errorMessageZh(caught));
      })
      .finally(() => {
        if (!disposed) setRetentionLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [api]);

  useEffect(() => {
    if (selectedTraceId === undefined) {
      setSelectedDetail(undefined);
      setDetailError(undefined);
      return;
    }
    let disposed = false;
    setSelectedDetail(undefined);
    setDetailLoading(true);
    setDetailError(undefined);
    void api.audit
      .detail(selectedTraceId)
      .then((detail) => {
        if (disposed) return;
        if (detail === undefined) {
          setDetailError('该 Audit Trace 已不存在或已过期');
        } else {
          setSelectedDetail(detail);
        }
      })
      .catch((caught: unknown) => {
        if (!disposed) setDetailError(errorMessageZh(caught));
      })
      .finally(() => {
        if (!disposed) setDetailLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [api, selectedTraceId]);

  const applyFilters = useCallback(
    (nextFilters: AuditFilterState): void => {
      setFilters(nextFilters);
      resetPagination();
      setFilterDialogOpen(false);
    },
    [resetPagination],
  );

  const updateSearch = useCallback(
    (search: string): void => {
      setFilters((current) => ({ ...current, search }));
      resetPagination();
    },
    [resetPagination],
  );

  const removeFilter = useCallback(
    (key: AuditFilterTagKey): void => {
      const defaults = createDefaultAuditFilters();
      setFilters((current) => {
        switch (key) {
          case 'dateRange':
            return { ...current, from: defaults.from, to: defaults.to };
          case 'sessionId':
            return { ...current, sessionId: '' };
          case 'actor':
            return { ...current, actor: '' };
          case 'category':
            return { ...current, category: '' };
          case 'outcome':
            return { ...current, outcome: '' };
          case 'risk':
            return { ...current, risk: '' };
          case 'search':
            return { ...current, search: '' };
          case 'includeObservations':
            return { ...current, includeObservations: false };
        }
      });
      resetPagination();
    },
    [resetPagination],
  );

  const clearFilters = useCallback((): void => {
    applyFilters(createDefaultAuditFilters());
  }, [applyFilters]);

  const setQuickRange = useCallback(
    (days: number): void => {
      const now = new Date();
      applyFilters({
        ...filters,
        from: toDateInput(new Date(now.getTime() - days * 24 * 60 * 60 * 1_000)),
        to: toDateInput(now),
      });
    },
    [applyFilters, filters],
  );

  const goNextPage = useCallback((): void => {
    if (nextCursor === undefined || loading || refreshing) return;
    setPageCursors((current) => {
      const next = [...current];
      next[page] = nextCursor;
      return next;
    });
    setPage((current) => current + 1);
    setSelectedTraceId(undefined);
  }, [loading, nextCursor, page, refreshing]);

  const goPreviousPage = useCallback((): void => {
    if (page <= 1 || loading || refreshing) return;
    setPage((current) => current - 1);
    setSelectedTraceId(undefined);
  }, [loading, page, refreshing]);

  const performCleanup = useCallback(async (): Promise<void> => {
    if (cleanupBusy) return;
    setCleanupBusy(true);
    setCleanupError(undefined);
    try {
      const result = await api.audit.cleanup();
      setCleanupResult(result);
      setCleanupConfirmOpen(false);
      await loadFirstPage(true);
    } catch (caught) {
      setCleanupError(errorMessageZh(caught));
    } finally {
      setCleanupBusy(false);
    }
  }, [api, cleanupBusy, loadFirstPage]);

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FileText aria-hidden="true" size={14} /> 安全与诊断
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">审计日志</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            以表格快速定位命令、审批和失败结果；点击记录查看脱敏执行证据。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground/85 transition-colors hover:bg-secondary hover:text-foreground"
            onClick={() => setRetentionDialogOpen(true)}
            type="button"
          >
            <Clock3 aria-hidden="true" size={14} /> 保留策略
          </button>
          <button
            aria-label="刷新审计日志"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
            disabled={loading || refreshing}
            onClick={() => void loadFirstPage()}
            title="刷新审计日志"
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={loading || refreshing ? 'animate-spin' : undefined}
              size={15}
            />
          </button>
        </div>
      </header>

      <section aria-label="审计查询" className="space-y-3 border-y border-border/60 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">审计搜索</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={15}
            />
            <input
              aria-label="审计搜索"
              className="w-full rounded-md border border-border bg-background py-2.5 pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
              onChange={(event) => updateSearch(event.target.value)}
              placeholder="命令、对象、Session、原因"
              type="search"
              value={filters.search}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs text-muted-foreground">时间</span>
            <button
              aria-pressed={quickRange === '最近 7 天'}
              className={`rounded-md border px-2.5 py-2 text-xs transition-colors ${quickRange === '最近 7 天' ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
              onClick={() => setQuickRange(7)}
              type="button"
            >
              最近 7 天
            </button>
            <button
              aria-pressed={quickRange === '最近 30 天'}
              className={`rounded-md border px-2.5 py-2 text-xs transition-colors ${quickRange === '最近 30 天' ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
              onClick={() => setQuickRange(30)}
              type="button"
            >
              最近 30 天
            </button>
            <button
              aria-label="打开高级筛选"
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-2 text-xs font-medium text-foreground/85 transition-colors hover:bg-secondary hover:text-foreground"
              onClick={() => setFilterDialogOpen(true)}
              type="button"
            >
              <Filter aria-hidden="true" size={13} /> 筛选
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>全部 Session · {quickRange} · 成功观察默认隐藏</span>
          <CalendarDays aria-hidden="true" size={13} />
          <span>
            {filters.from || '不限开始'} 至 {filters.to || '不限结束'}
          </span>
        </div>
        {activeFilterTags.length > 0 && (
          <div aria-label="已启用筛选" className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">已启用：</span>
            {activeFilterTags.map((tag) => (
              <button
                aria-label={`移除筛选 ${tag.label}`}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] text-primary/90 transition-colors hover:bg-primary/10"
                key={tag.key}
                onClick={() => removeFilter(tag.key)}
                type="button"
              >
                {tag.label} <X aria-hidden="true" size={11} />
              </button>
            ))}
            <button
              className="px-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={clearFilters}
              type="button"
            >
              清除筛选
            </button>
          </div>
        )}
      </section>

      <section aria-label="Audit Trace 列表" className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">审计记录</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              每页 {PAGE_SIZE} 条 · 最新活动优先 · 点击行查看详情
            </p>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{items.length} 条</span>
        </div>
        {error !== undefined && (
          <div
            className="mb-3 flex items-start gap-2 border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
            role="alert"
          >
            <ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
            <span>{error}</span>
          </div>
        )}
        {loading ? (
          <div className="flex min-h-48 items-center justify-center border border-border/60 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="mr-2 animate-spin" size={15} /> 正在加载审计记录
          </div>
        ) : (
          <AuditTraceTable
            hasNextPage={nextCursor !== undefined}
            hasPreviousPage={page > 1}
            items={items}
            onNextPage={goNextPage}
            onPreviousPage={goPreviousPage}
            onSelect={(trace) => setSelectedTraceId(trace.traceId)}
            page={page}
          />
        )}
      </section>

      <AuditFilterDialog
        filters={filters}
        onApply={applyFilters}
        onClose={() => setFilterDialogOpen(false)}
        open={filterDialogOpen}
        sessions={sessions}
      />

      {selectedTraceId !== undefined && (
        <AuditTraceEvidence
          detail={selectedDetail}
          error={detailError}
          loading={detailLoading}
          onClose={() => setSelectedTraceId(undefined)}
        />
      )}

      <AuditRetentionDialog
        cleanupBusy={cleanupBusy}
        cleanupError={cleanupError}
        cleanupResult={cleanupResult}
        onCleanup={() => {
          setCleanupError(undefined);
          setCleanupConfirmOpen(true);
        }}
        onClose={() => setRetentionDialogOpen(false)}
        open={retentionDialogOpen}
        retention={retention}
        retentionError={retentionError}
        retentionLoading={retentionLoading}
      />

      <ConfirmDialog
        confirmLabel="确认清理"
        danger
        description={buildCleanupDescription(retention)}
        onCancel={() => setCleanupConfirmOpen(false)}
        onConfirm={() => void performCleanup()}
        open={cleanupConfirmOpen}
        pending={cleanupBusy}
        title="确认清理过期审计数据"
      />
    </div>
  );
}
