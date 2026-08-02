/** 审计日志面板（自 app.tsx 拆分） */
import type { JSX } from 'react';

import { auditTypeZh } from '@synapse-term/ui-platform';
import type { AuditEventView } from '../../preload/preload-api.js';
import { formatAuditTime } from '../utils/audit-format.js';

export function RuntimeAudit({ events }: { events: AuditEventView[] }): JSX.Element {
  if (events.length === 0) {
    return <div className="text-[13px] text-muted-foreground">暂无审计记录</div>;
  }
  return (
    <div className="text-sm font-mono text-muted-foreground/60 space-y-3">
      {events.map((event) => (
        <div className="flex gap-4" key={event.id}>
          <span className="text-white/20 shrink-0">{formatAuditTime(event.occurredAt)}</span>
          <span className="text-emerald-500">[{auditTypeZh(event.type)}]</span>
          <span>{event.summary}</span>
        </div>
      ))}
    </div>
  );
}
