import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    outDir: resolve(import.meta.dirname, 'dist/preload'),
    emptyOutDir: true,
    rollupOptions: { external: ['electron'] },
  },
});
