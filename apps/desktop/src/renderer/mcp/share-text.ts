const MCP_TOOLS = [
  'synapse_status',
  'synapse_observe',
  'synapse_execute',
  'synapse_wait',
  'synapse_interrupt',
] as const;

export interface ShareTextInput {
  sessionId: string;
  terminalType: string;
  title: string;
}

function safeSingleLine(value: string, fallback: string): string {
  let normalized = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    normalized += codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  }
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized.length === 0 ? fallback : normalized;
}

export function buildShareText(input: ShareTextInput): string {
  const title = safeSingleLine(input.title, '未命名 Session');
  const sessionId = safeSingleLine(input.sessionId, '未知 Session ID');
  const terminalType = safeSingleLine(input.terminalType, '未知 Shell');
  return [
    '请使用已配置的 Synapse Term 内嵌 MCP Server，仅操作下面这个明确共享的 Terminal Session。',
    '',
    `Session Alias：${title}`,
    `sessionId：${sessionId}`,
    `启动 Shell 提示：${terminalType}（仅供参考）`,
    '',
    '连接前提：外部客户端应已连接 Synapse Term 的内嵌 MCP Server，并在 MCP 服务中配置 Authorization: Bearer <Token> 请求头。不要把 Token 放进 URL、sessionId 或 command。',
    '',
    '操作规则：',
    '1. 先调用 synapse_status 检查上面的 Session 是否 ready；not_ready 时不要重复调用 synapse_status。如果远端 Shell 提示符尚未就绪，先完成 SSH/嵌套 Shell 交互；远端 Shell 提示符就绪后直接调用 synapse_execute 提交要执行的原文命令，执行管线会先运行固定明文 Probe。',
    '2. 需要执行命令时调用 synapse_execute；返回 transactionId 后调用 synapse_wait 等待事务收敛。',
    '3. 命令会按原文发送到当前 Shell；当前 PTY environment 以 synapse_status 和运行时 Probe 为准。',
    '4. 进入 SSH、容器、WSL 或嵌套 Shell 后，不要根据启动 Shell 提示推断当前环境。',
    '5. 每次调用都必须使用上面的 sessionId；只操作这个 Session，不枚举、猜测或切换其他 Session。',
    '6. 不要自行添加 eval、Base64、bash -c、EncodedCommand 或其他包装器；不要隐式翻译用户命令。',
    '7. 完成探针由 Synapse Term 独立发送，用于报告退出码；它不属于用户命令，目标 Shell、SSH 或远程服务器可能记录这条固定辅助命令。',
    '8. 如果 Probe 失败并返回 SESSION_NOT_READY，用户命令不会写入 PTY；等待远端提示符稳定后再重新提交，不能只重复调用 synapse_status。',
    '',
    '如果返回 SESSION_NOT_READY、SHELL_MISMATCH 或 SESSION_EXPIRED，请按错误指引停止盲目重试。',
    '',
    `可用工具：${MCP_TOOLS.join('、')}`,
  ].join('\n');
}
