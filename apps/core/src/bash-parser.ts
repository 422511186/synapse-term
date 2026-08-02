import { createRequire } from 'node:module';

import { Language, Parser } from 'web-tree-sitter';

import type { ParsedShellAst, ShellAstParser } from './policy-engine.js';

const require = createRequire(import.meta.url);
let runtimeInitialized: Promise<void> | undefined;

export class WebTreeSitterBashParser implements ShellAstParser {
  readonly #parser: Parser;

  private constructor(parser: Parser) {
    this.#parser = parser;
  }

  static async create(): Promise<WebTreeSitterBashParser> {
    await initializeRuntime();
    const parser = new Parser();
    const language = await Language.load(
      require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm'),
    );
    parser.setLanguage(language);
    return new WebTreeSitterBashParser(parser);
  }

  async parse(command: string): Promise<ParsedShellAst> {
    const tree = this.#parser.parse(command);
    if (tree === null) return { hasError: true, tree: '' };
    try {
      return { hasError: tree.rootNode.hasError, tree: tree.rootNode.toString() };
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    this.#parser.delete();
  }
}

async function initializeRuntime(): Promise<void> {
  runtimeInitialized ??= Parser.init({
    locateFile: () => require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
  });
  await runtimeInitialized;
}
