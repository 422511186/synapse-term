const MCP_TOOLS = [
  'synapse_execute',
  'synapse_start_interactive',
  'synapse_input',
  'synapse_finish_interactive',
  'synapse_observe',
  'synapse_wait',
  'synapse_interrupt',
  'synapse_status',
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
    normalized +=
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
        ? ' '
        : character;
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
    '1. 先调用 synapse_status 检查上面的 Session 是否 ready；status 是只读快照，不会触发 Probe。not_ready 时不要重复调用 synapse_status；如果远端 Shell 提示符尚未就绪，先完成 SSH/嵌套 Shell 交互，远端 Shell 提示符就绪后直接调用 synapse_execute 或选择交互事务入口。',
    '2. 首次执行前必须调用 synapse_observe，读取当前终端内容并取得 executionContextId；可省略 afterCursor 从本次 Sharing 边界的最早历史开始读取，也可用 tail: true 快速查看最近一页。',
    '3. 普通结构化命令调用 synapse_execute 时必须把 observe 返回的 executionContextId 原样作为 expectedContextId 传入，并按原文提交 command；返回 transactionId 后调用 synapse_wait，完整输出继续用 synapse_observe 分页读取。预期会读取 stdin 的 sudo、su、ssh、vim、REPL 或菜单命令不要使用 synapse_execute。',
    '4. 交互事务遵循 synapse_start_interactive -> synapse_input -> synapse_observe -> synapse_finish_interactive：start 必须选择 one_shot 或 bounded 并取得 inputGrantId；每次 input 都要携带调用方生成的 inputRequestId；先 observe 看到程序回到 Shell，再把最近一次 observe 的 nextCursor 作为 observedCursor 调用 finish。synapse_wait 在 finish 前不会注入 Probe。',
    '5. 已由用户在 PTY 中打开的菜单或交互程序可使用自由模式 synapse_input：只携带当前 expectedContextId、inputRequestId 和 text/keys；每次成功写入都会轮换 executionContextId，下一次输入前必须重新 observe。活动交互事务期间必须改用事务内 inputGrantId。',
    '6. synapse_observe 使用上一次返回的 nextCursor 作为 afterCursor；读取不会消费历史。tail 与 afterCursor 互斥，出现 historyTruncated 时从 earliestCursor 重新同步。',
    '7. 进入 SSH、容器、WSL 或嵌套 Shell 后，命令会按原文发送到当前 Shell；当前 PTY environment 以运行时 Probe 和输出观察为准，不能根据启动 Shell 提示推断当前环境。',
    '8. 每次调用都必须使用上面的 sessionId；只操作这个 Session，不枚举、猜测或切换其他 Session。',
    '9. 不要自行添加 eval、Base64、bash -c、EncodedCommand 或其他包装器；不要隐式翻译用户命令。输入响应只返回规范化长度、键名、输出和游标，不回显 text 原文；这不保证密码不会出现在 PTY 回显、终端 UI、Sharing 输出历史或审批卡片。',
    '10. 完成探针由 Synapse Term 独立发送，用于报告退出码；它不属于用户命令，目标 Shell、SSH 或远程服务器可能记录这条固定辅助命令。',
    '11. 如果返回 EXECUTION_CONTEXT_REQUIRED 或 EXECUTION_CONTEXT_STALE，先停止执行并重新调用 synapse_observe（必要时 tail: true）取得当前内容和新的 ID；如果 Probe 失败并返回 SESSION_NOT_READY，用户命令不会写入 PTY，等待远端提示符稳定后再提交。',
    '',
    '如果返回 SESSION_NOT_READY、SHELL_MISMATCH 或 SESSION_EXPIRED，请按错误指引停止盲目重试。',
    '',
    `可用工具：${MCP_TOOLS.join('、')}`,
  ].join('\n');
}
