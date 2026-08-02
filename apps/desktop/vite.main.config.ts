import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  ssr: { target: 'node' },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/electron-main.ts'),
      formats: ['es'],
      fileName: () => 'electron-main.mjs',
    },
    outDir: resolve(import.meta.dirname, 'dist/main'),
    emptyOutDir: true,
    rollupOptions: {
      external: (id) => id === 'electron' || id.startsWith('node:'),
    },
  },
});
