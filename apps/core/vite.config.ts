import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

import { defineConfig } from 'vite';

const externalPackages = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  '@anthropic-ai/sdk',
  '@napi-rs/keyring',
  '@vscode/tree-sitter-wasm',
  '@xterm/addon-serialize',
  '@xterm/headless',
  'node-pty',
  'openai',
  'web-tree-sitter',
]);

export default defineConfig({
  ssr: {
    noExternal: ['@terminal-agent/domain', '@terminal-agent/protocol'],
  },
  build: {
    ssr: true,
    target: 'node24',
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'core-main': resolve(import.meta.dirname, 'src/main.ts'),
        'core-maintenance': resolve(import.meta.dirname, 'src/maintenance-main.ts'),
      },
      external: (id) => externalPackages.has(id),
      output: {
        entryFileNames: '[name].mjs',
        chunkFileNames: 'chunks/[name]-[hash].mjs',
      },
    },
  },
});
