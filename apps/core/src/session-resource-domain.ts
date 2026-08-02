export type SessionResourceDialect = 'posix' | 'powershell';

export type SessionResourceSnapshotStatus = 'complete' | 'partial' | 'unavailable';

export type ResourceUnavailableReason = 'not_reported' | 'command_unavailable' | 'invalid_output';

export interface AvailableResourceMetric<T> {
  status: 'available';
  value: T;
}

export interface UnavailableResourceMetric {
  status: 'unavailable';
  reason: ResourceUnavailableReason;
  message: string;
}

export type ResourceMetric<T> = AvailableResourceMetric<T> | UnavailableResourceMetric;

export interface HostResource {
  name: string;
}

export interface OperatingSystemResource {
  name: string;
  version?: string;
  architecture?: string;
}

export interface UptimeResource {
  seconds: number;
}

export interface LoadAverageResource {
  oneMinute: number;
  fiveMinutes: number;
  fifteenMinutes: number;
}

export interface CpuResource {
  logicalProcessors?: number;
  usagePercent?: number;
  loadAverage?: LoadAverageResource;
}

export interface MemoryResource {
  totalBytes: number;
  usedBytes: number;
  availableBytes?: number;
}

export interface SwapResource {
  totalBytes: number;
  usedBytes: number;
  availableBytes?: number;
}

export interface DiskResource {
  name: string;
  mountPoint?: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes?: number;
  usagePercent?: number;
}

export interface NetworkResource {
  name: string;
  receivedBytes: number;
  transmittedBytes: number;
}

export interface SessionResourceSnapshot {
  dialect: SessionResourceDialect;
  collectedAt: string;
  status: SessionResourceSnapshotStatus;
  host: ResourceMetric<HostResource>;
  os: ResourceMetric<OperatingSystemResource>;
  uptime: ResourceMetric<UptimeResource>;
  cpu: ResourceMetric<CpuResource>;
  memory: ResourceMetric<MemoryResource>;
  swap: ResourceMetric<SwapResource>;
  disks: ResourceMetric<readonly DiskResource[]>;
  network: ResourceMetric<readonly NetworkResource[]>;
}

export interface RefreshSessionResourcesRequest {
  sessionId: string;
}

export type SessionResourceRefreshErrorCode =
  | 'session_not_found'
  | 'session_not_ready'
  | 'execution_dialect_unsupported'
  | 'lease_unavailable'
  | 'collection_timeout'
  | 'collection_failed';

export interface SessionResourceRefreshError {
  code: SessionResourceRefreshErrorCode;
  message: string;
}

export type RefreshSessionResourcesResult =
  | { ok: true; snapshot: SessionResourceSnapshot }
  | { ok: false; error: SessionResourceRefreshError };

export const SESSION_RESOURCE_REFRESH_ERROR_MESSAGES: Readonly<
  Record<SessionResourceRefreshErrorCode, string>
> = {
  session_not_found: '终端会话不存在。',
  session_not_ready: '终端会话当前无法安全刷新资源。',
  execution_dialect_unsupported: '当前终端会话的执行方言不支持资源刷新。',
  lease_unavailable: '终端会话正忙，暂时无法刷新资源。',
  collection_timeout: '资源采集超时。',
  collection_failed: '资源采集失败。',
};

export function sessionResourceRefreshError(
  code: SessionResourceRefreshErrorCode,
): SessionResourceRefreshError {
  return { code, message: SESSION_RESOURCE_REFRESH_ERROR_MESSAGES[code] };
}
