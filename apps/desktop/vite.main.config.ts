import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  ssr: { target: 'node' },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/main/electron-main.ts'),
      formats: ['es'],
      fileName: () => 'electron-main.mjs',
    },
    outDir: resolve(import.meta.dirname, 'dist/main'),
    emptyOutDir: true,
    rollupOptions: {
      external: (id) =>
        id === 'electron' ||
        id === 'electron-updater' ||
        id === 'node-pty' ||
        id.startsWith('node:') ||
        // 原生二进制无法打进 JS bundle
        id === 'node-pty',
    },
  },
});
