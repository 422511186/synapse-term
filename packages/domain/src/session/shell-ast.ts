/**
 * Shell AST 解析契约（领域层）
 *
 * PolicyEngine（平台内核）与 BashParser（终端服务）之间的共享类型。
 * 下沉到领域层以避免 terminal-service ↔ platform-kernel 的循环依赖：
 * 策略引擎只依赖抽象接口，具体解析实现由终端服务提供并动态加载。
 */

/** 解析后的 Shell AST 摘要：是否含语法错误 + 可审计的序列化树 */
export interface ParsedShellAst {
  hasError: boolean;
  tree: string;
}

/** Shell AST 解析器抽象（如 web-tree-sitter 的 Bash 解析实现） */
export interface ShellAstParser {
  parse(command: string): Promise<ParsedShellAst>;
}
