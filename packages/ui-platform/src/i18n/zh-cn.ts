const ptyStatuses: Record<string, string> = {
  starting: '启动中',
  running: '运行中',
  exited: '已退出',
  failed: '失败',
  interrupted: '已中断',
  idle: '空闲',
};

const shellStatuses: Record<string, string> = {
  unknown: '待探测',
  probing: '正在探测',
  ready: '可执行',
  executing: '执行中',
  interaction_required: '等待人工交互',
};

const timelineStatuses: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  streaming: '生成中',
  observed: '已观察',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  suspended: '已挂起',
  waiting_approval: '等待批准',
  waiting_user: '等待用户',
  interaction_required: '等待人工交互',
  interrupted: '已中断',
  shell_lost: 'Shell 已断开',
  protocol_error: '协议错误',
};

const providerStatuses: Record<string, string> = {
  unverified: '未检测',
  validating: '检测中',
  available: '可用',
  unavailable: '不可用',
};

const reasonMessages: Record<string, string> = {
  url_scheme_mismatch: 'TLS 握手失败，请检查 URL 使用的是 http:// 还是 https://。',
  authentication_failed: '鉴权失败，请检查 API Key、额外请求头和服务端权限。',
  model_not_found: '模型不存在或当前凭据无权访问，请检查模型 ID。',
  provider_connection_failed: '无法连接 Provider，请检查地址、端口和本机服务状态。',
  provider_timeout: 'Provider 检测超时，请检查网络、服务响应和超时配置。',
  provider_cancelled: 'Provider 检测已取消。',
  provider_stream_missing: 'Provider 未返回可识别的流式事件。',
  provider_tool_call_missing: 'Provider 未完成要求的 Tool Call，当前协议不满足 Agent 需求。',
};

export function sessionPtyStatusZh(status: string): string {
  return ptyStatuses[status] ?? status;
}

export function sessionShellStatusZh(status: string): string {
  return shellStatuses[status] ?? status;
}

export function timelineStatusZh(status: string): string {
  return timelineStatuses[status] ?? status;
}

export function providerStatusZh(status: string): string {
  return providerStatuses[status] ?? status;
}

export function providerReasonZh(reason: string): string {
  const separator = reason.indexOf(':');
  const code = separator < 0 ? reason : reason.slice(0, separator);
  const detail = separator < 0 ? '' : reason.slice(separator + 1).trim();
  const message = reasonMessages[code] ?? 'Provider 检测失败。';
  return detail.length === 0 ? message : `${message} 技术详情：${detail}`;
}

export function providerTransportNoticeZh(
  baseUrl: string,
): { tone: 'info' | 'danger'; text: string } | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:') return undefined;
  const hostname = url.hostname.toLowerCase();
  const isLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1';
  return isLoopback
    ? {
        tone: 'info',
        text: '这是本机 HTTP 地址，适合本地模型服务；API Key 不会经过 TLS 加密。',
      }
    : {
        tone: 'danger',
        text: '该地址使用未加密 HTTP，API Key 和请求内容可能被窃听。请改用 HTTPS。',
      };
}

export function errorMessageZh(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, '');
  const timeout = /^Core request timed out:\s*(.+)$/i.exec(message);
  if (timeout !== null) return `Core 请求超时：${timeout[1]}`;
  const exact: Record<string, string> = {
    'Working directory does not exist': '工作目录不存在',
    'Core protocol version is incompatible': 'Core 协议版本不兼容',
    'Extra headers must be a JSON object': '额外请求头必须是 JSON 对象',
  };
  if (exact[message] !== undefined) return exact[message];
  if (message.startsWith('File not found:')) {
    return `找不到文件：${message.slice('File not found:'.length).trim()}`;
  }
  return message;
}

export function commandRiskZh(risk: string): string {
  const labels: Record<string, string> = {
    read_only: '只读操作',
    unknown: '风险未知',
    mutating: '会修改状态',
    privileged: '高权限操作',
    destructive: '高风险操作',
  };
  return labels[risk] ?? risk;
}

export function approvalReasonZh(reason: string): string {
  const exact: Record<string, string> = {
    'empty command': '命令为空，无法判断风险',
    'shell parser failed': 'Shell 解析失败，无法证明操作安全',
    'shell syntax error': 'Shell 语法异常，无法判断实际影响',
    'alias or function override is not trusted': '别名或函数覆盖可能改变命令含义',
    'command substitution is not proven safe': '命令替换的实际影响无法安全判断',
    'compound command evaluated segment by segment': '复合命令已逐段评估风险',
    'redirection can change filesystem state': '重定向可能修改文件系统状态',
    'all commands and arguments match read-only rules': '命令和参数均符合只读规则',
    'command requests privilege escalation': '命令请求提升权限',
    'command has irreversible or destructive semantics': '命令包含不可逆或破坏性操作',
    'find can delete or execute a mutating action': 'find 可能删除文件或执行修改操作',
    'systemctl action changes service state': 'systemctl 操作会修改服务状态',
    'git action can change repository state': 'git 操作可能修改仓库状态',
    'docker action is not proven read-only': '无法证明该 docker 操作为只读',
    'in-place editing changes files': '原地编辑会修改文件',
    'local file write changes filesystem state': '本机文件写入会修改文件系统状态',
  };
  if (exact[reason] !== undefined) return exact[reason];
  const mutation = /^(\S+) can change system state$/.exec(reason);
  if (mutation !== null) return `${mutation[1]} 可能修改系统状态`;
  const unknownExecutable = /^unknown executable: (.+)$/.exec(reason);
  if (unknownExecutable !== null) return `无法判断可执行文件风险：${unknownExecutable[1]}`;
  return reason;
}

export function timelineKindZh(kind: string): string {
  const labels: Record<string, string> = {
    user: '你',
    assistant: 'Agent',
    tool: '工具',
    command: '命令',
    file: '本机文件',
    approval: '待批准操作',
    system: '系统',
  };
  return labels[kind] ?? kind;
}

export function shellSourceZh(source: string): string {
  const labels: Record<string, string> = {
    path: 'PATH',
    registry: '注册表',
    environment: '系统环境',
    system: '系统组件',
    unavailable: '不可用',
  };
  return labels[source] ?? source;
}

export function auditTypeZh(type: string): string {
  const labels: Record<string, string> = {
    'session.created': '创建终端会话',
    'session.closed': '关闭终端会话',
    'session.input': '用户输入',
    'session.dialect_changed': '切换执行方言',
    'task.started': 'Agent 任务开始',
    'task.completed': 'Agent 任务完成',
    'task.failed': 'Agent 任务失败',
    'task.cancelled': 'Agent 任务取消',
    'approval.requested': '请求批准',
    'approval.granted': '批准操作',
    'approval.rejected': '拒绝操作',
    'provider.created': '创建 Provider',
    'provider.updated': '更新 Provider',
    'provider.tested': '检测 Provider',
    'provider.removed': '删除 Provider',
  };
  if (type.startsWith('command.'))
    return `命令：${timelineStatusZh(type.slice('command.'.length))}`;
  return labels[type] ?? type;
}
